// 翻譯引擎（動態路由）：
//   Gemini AI（選用，需自備金鑰）→ Google（非官方 gtx 端點）→ MyMemory 備援
// 翻成中文時自動套用「台灣用語守護」（OpenCC s2twp＋台灣詞典）
import { LANGS, DETECTED_NAMES, AI } from './config.js';
import { settings, saveSettings } from './store.js';
import { taiwanize } from './taiwanize.js';

const memCache = new Map(); // 本次工作階段的記憶體快取
let googleHealthy = true;
let aiFailCount = 0;
let aiCooldownUntil = 0; // AI 引擎連續失敗後的暫停期限

function cacheKey(text, from, to) { return `${from}|${to}|${text}`; }

async function fetchWithTimeout(url, options = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: options.signal ?? ctrl.signal });
  } finally { clearTimeout(timer); }
}

// ---------- Gemini AI（LLM 翻譯，通順度最佳；使用者自備免費金鑰） ----------
const TARGET_DESC = {
  'zh-TW': '台灣正體中文。務必使用台灣慣用語（例如：行動電源、計程車、影片、軟體），絕不可出現中國大陸用語',
  'en': '自然流暢的英文',
  'ja': '自然的日文，依情境使用合適的丁寧語',
  'ko': '自然的韓文，依情境使用合適的敬語（-요/-습니다體）',
};

// 低延遲思考設定依模型世代而異；不被接受時會以裸設定重試
function geminiGenConfig(model, bare) {
  const cfg = { temperature: 0.2 };
  if (!bare) {
    if (/gemini-2\.5/.test(model)) cfg.thinkingConfig = { thinkingBudget: 0 };
    else cfg.thinkingConfig = { thinkingLevel: 'low' };
  }
  return cfg;
}

async function geminiCall(model, key, sys, text, bare = false) {
  const res = await fetchWithTimeout(`${AI.endpoint}${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: sys }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: geminiGenConfig(model, bare),
    }),
  }, 20000);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json())?.error?.message?.slice(0, 160) || detail; } catch {}
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const out = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!out) throw new Error('AI 回應為空');
  return { text: out, model };
}

function isModelGone(err) {
  return err?.status === 404 || /no longer available|not found|not supported/i.test(err?.message || '');
}

// 模型被汰換時，向 ListModels 探索目前金鑰可用的最新 flash 模型
async function discoverModel(key) {
  const res = await fetchWithTimeout(`${AI.endpoint.replace(/\/$/, '')}?pageSize=200`, {
    headers: { 'x-goog-api-key': key },
  }, 15000);
  if (!res.ok) throw new Error(`無法取得模型清單（HTTP ${res.status}）`);
  const data = await res.json();
  const scored = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => (m.name || '').replace(/^models\//, ''))
    .filter(n => /^gemini-[\d.]+-flash/.test(n))
    .map(n => {
      let score = parseFloat(n.match(/^gemini-([\d.]+)-flash/)[1]);
      if (n.includes('lite')) score -= 0.4;                 // 優先完整版 flash
      if (/preview|exp/.test(n)) score -= 0.05;             // 優先正式版
      if (!/^gemini-[\d.]+-flash$/.test(n)) score -= 0.02;  // 優先無後綴的乾淨名稱
      return { name: n, score };
    })
    .sort((a, b) => b.score - a.score);
  if (!scored.length) throw new Error('這組金鑰找不到可用的 Gemini flash 模型');
  return scored[0].name;
}

async function geminiTranslate(text, from, to) {
  const key = (settings.geminiKey || '').trim();
  if (!key) throw new Error('尚未設定 API 金鑰');
  const srcLine = from === 'auto' ? '自動偵測原文語言。' : `原文語言：${LANGS[from]?.name ?? from}。`;
  const sys = `你是頂尖的專業翻譯，服務對象是台灣使用者。${srcLine}將輸入文字翻譯成：${TARGET_DESC[to] ?? to}。
規則：
1. 只輸出譯文本身，不加任何解釋、前綴、引號或標註。
2. 譯文要自然、道地、口語，像母語者會說的話；意譯優先於逐字直譯。
3. 完整保留原文的語氣（請求、疑問、急迫、禮貌）與所有資訊。
4. 輸入若有多行，輸出行數必須與輸入完全相同，逐行對應翻譯。
5. 原文若缺少標點，先在心中合理斷句再翻譯。
6. 人名、地名、品牌採台灣慣用譯名，沒有慣用譯名就保留原文。`;

  const attempt = async (model) => {
    try {
      return await geminiCall(model, key, sys, text);
    } catch (err) {
      // 思考設定不被此模型接受時，改用裸設定重試一次
      if (err.status === 400 && !isModelGone(err)) return geminiCall(model, key, sys, text, true);
      throw err;
    }
  };

  let model = (settings.aiModel || '').trim() || AI.model;
  let r;
  try {
    r = await attempt(model);
  } catch (err) {
    if (!isModelGone(err)) throw err;
    // 模型已被 Google 汰換 → 自動探索可用模型並記住
    model = await discoverModel(key);
    settings.aiModel = model;
    saveSettings();
    r = await attempt(model);
  }
  return { text: r.text, detected: from === 'auto' ? '' : from, provider: 'Gemini AI', model: r.model };
}

// 設定頁的「測試」按鈕用：直接打 AI 引擎驗證金鑰
export async function testAIEngine() {
  return geminiTranslate('不好意思，我對花生過敏，這道菜可以不要加花生嗎？', 'zh-TW', 'ja');
}

// ---------- Google（非官方免費端點） ----------
async function googleTranslate(text, from, to) {
  const sl = from === 'auto' ? 'auto' : (LANGS[from]?.google ?? from);
  const tl = LANGS[to]?.google ?? to;
  const base = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t`;
  let res;
  if (text.length < 1500) {
    res = await fetchWithTimeout(`${base}&q=${encodeURIComponent(text)}`);
  } else {
    res = await fetchWithTimeout(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `q=${encodeURIComponent(text)}`,
    });
  }
  if (!res.ok) throw new Error(`Google ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('Google 回應格式異常');
  const translated = data[0].map(seg => seg?.[0] ?? '').join('');
  return { text: translated, detected: typeof data[2] === 'string' ? data[2] : from, provider: 'Google' };
}

// ---------- MyMemory（免費備援，單次 500 字內，長文自動分段） ----------
function splitChunks(text, max = 450) {
  if (text.length <= max) return [text];
  const parts = [];
  let buf = '';
  for (const piece of text.split(/(?<=[。．.!?！？\n])/u)) {
    if ((buf + piece).length > max && buf) { parts.push(buf); buf = ''; }
    if (piece.length > max) { // 單句過長時硬切
      for (let i = 0; i < piece.length; i += max) parts.push(piece.slice(i, i + max));
    } else buf += piece;
  }
  if (buf) parts.push(buf);
  return parts;
}

async function mymemoryTranslate(text, from, to) {
  const sl = from === 'auto' ? 'Autodetect' : (LANGS[from]?.mymemory ?? from);
  const tl = LANGS[to]?.mymemory ?? to;
  const chunks = splitChunks(text);
  const out = [];
  let detected = from;
  for (const chunk of chunks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(sl)}|${encodeURIComponent(tl)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`MyMemory ${res.status}`);
    const data = await res.json();
    if (data.responseStatus !== 200 || !data.responseData?.translatedText) {
      throw new Error(data.responseDetails || 'MyMemory 回應異常');
    }
    if (data.responseData.detectedLanguage) detected = data.responseData.detectedLanguage;
    out.push(data.responseData.translatedText);
  }
  return { text: out.join(''), detected, provider: 'MyMemory' };
}

// ---------- 對外主函式 ----------
// opts.fast：即時相機等高頻場景，跳過 AI 引擎（速度與額度優先）
export async function translateText(rawText, from, to, { skipGuard = false, fast = false } = {}) {
  const text = rawText.trim();
  if (!text) return { text: '', detected: from, provider: '' };
  if (from === to) return { text, detected: from, provider: '原文' };

  const aiReady = settings.aiEngine && settings.geminiKey && !fast && Date.now() >= aiCooldownUntil;
  const key = `${aiReady ? 'ai' : 'std'}|${cacheKey(text, from, to)}`;
  if (memCache.has(key)) return memCache.get(key);

  let result;
  let lastErr;
  const base = googleHealthy
    ? [googleTranslate, mymemoryTranslate]
    : [mymemoryTranslate, googleTranslate];
  const providers = aiReady ? [geminiTranslate, ...base] : base;

  for (const fn of providers) {
    try {
      result = await fn(text, from, to);
      if (fn === googleTranslate) googleHealthy = true;
      if (fn === geminiTranslate) aiFailCount = 0;
      break;
    } catch (err) {
      lastErr = err;
      if (fn === googleTranslate) googleHealthy = false;
      if (fn === geminiTranslate) {
        aiFailCount += 1;
        if (aiFailCount >= 3) { aiCooldownUntil = Date.now() + 120000; aiFailCount = 0; } // 連續失敗休息 2 分鐘
      }
    }
  }
  if (!result) {
    throw new Error(navigator.onLine === false
      ? '目前離線，暫時無法翻譯（句庫仍可使用）'
      : `翻譯服務暫時無法使用（${lastErr?.message ?? '未知錯誤'}），請稍後再試`);
  }

  // 台灣用語守護：所有翻成中文的結果都經過在地化
  result.guarded = false;
  if (to === 'zh-TW' && settings.taiwanGuard && !skipGuard) {
    const before = result.text;
    result.text = await taiwanize(result.text);
    result.guarded = result.text !== before;
  }

  memCache.set(key, result);
  if (memCache.size > 400) memCache.delete(memCache.keys().next().value);
  return result;
}

export function detectedName(code) {
  return DETECTED_NAMES[code] || LANGS[code]?.name || code;
}
