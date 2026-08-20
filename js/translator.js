// 翻譯引擎：Google（非官方 gtx 端點）為主、MyMemory 備援
// 翻成中文時自動套用「台灣用語守護」（OpenCC s2twp＋台灣詞典）
import { LANGS, DETECTED_NAMES } from './config.js';
import { settings } from './store.js';
import { taiwanize } from './taiwanize.js';

const memCache = new Map(); // 本次工作階段的記憶體快取
let googleHealthy = true;

function cacheKey(text, from, to) { return `${from}|${to}|${text}`; }

async function fetchWithTimeout(url, options = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: options.signal ?? ctrl.signal });
  } finally { clearTimeout(timer); }
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
export async function translateText(rawText, from, to, { skipGuard = false } = {}) {
  const text = rawText.trim();
  if (!text) return { text: '', detected: from, provider: '' };
  if (from === to) return { text, detected: from, provider: '原文' };

  const key = cacheKey(text, from, to);
  if (memCache.has(key)) return memCache.get(key);

  let result;
  let lastErr;
  const providers = googleHealthy
    ? [googleTranslate, mymemoryTranslate]
    : [mymemoryTranslate, googleTranslate];

  for (const fn of providers) {
    try {
      result = await fn(text, from, to);
      if (fn === googleTranslate) googleHealthy = true;
      break;
    } catch (err) {
      lastErr = err;
      if (fn === googleTranslate) googleHealthy = false;
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
