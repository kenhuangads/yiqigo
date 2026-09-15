// 語音層：Web Speech API（語音辨識 STT ＋ 語音合成 TTS）
import { LANGS } from './config.js';
import { settings } from './store.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = !!SR;
export const ttsSupported = 'speechSynthesis' in window;

const UA = navigator.userAgent || '';
// iPadOS 13+ 會偽裝成 Mac，要靠觸控點數辨識；iOS 上所有瀏覽器都是 WebKit
export const isAppleMobile = /iP(hone|ad|od)/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(UA);
const isWebKit = isAppleMobile || (/Version\/[\d.]+.*Safari\//.test(UA) && !/Chrome|Chromium|Edg\//.test(UA));

let lastMicEnd = 0;

// ---------- 語音辨識 ----------
// 回傳控制器 { stop(), abort() }；一次辨識一句（偵測停頓自動結束）
export function listen({ lang, onInterim, onFinal, onError, onEnd }) {
  if (!SR) { onError?.('unsupported'); return null; }
  const rec = new SR();
  rec.lang = LANGS[lang]?.speech || lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) onInterim?.(interim);
  };
  rec.onerror = (e) => onError?.(e.error);
  rec.onend = () => {
    lastMicEnd = Date.now();
    if (finalText.trim()) onFinal?.(finalText.trim());
    onEnd?.();
  };
  try { rec.start(); } catch { onError?.('start-failed'); return null; }
  return {
    stop() { try { rec.stop(); } catch {} },
    abort() { finalText = ''; try { rec.abort(); } catch {} },
  };
}

// ---------- 語音清單 ----------
let voices = [];
function refreshVoices() {
  try { voices = speechSynthesis.getVoices() || []; } catch { voices = []; }
  return voices;
}
if (ttsSupported) {
  refreshVoices();
  speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
  if (!speechSynthesis.addEventListener) speechSynthesis.onvoiceschanged = refreshVoices;
}

// ===== 聲音挑選策略：開朗、親切、有好感度；避開低沉、老人、機器人與搞怪語音 =====
// Web Speech API 不提供性別與音色，只能比對 voice.name 與 voiceURI。
// 名單來自 iOS／macOS／Windows／Edge／Android 實際 getVoices() 清單與官方音色描述的交叉查證。
// 字串比對 name＋voiceURI（小寫子字串）；正規式預設也比對兩者，標 on:'name' 的只比對名稱。
// voiceURI 很重要：繁中介面的 iPhone 會把 Meijia 顯示成「美佳」、把搞怪語音名稱翻成中文，但 voiceURI 不會變。

// 各語言首選（越前面越開朗親切）。男聲依實測基頻排序：Guy（約 170 Hz）比 Brian（約 140 Hz）明亮；
// 深沉男聲（Edge 的 YunJhe 約 120 Hz 且不能調音高、Christopher、Eric、Thomas）列在避用名單。
// Google 桌面語音用完整名稱比對：ChromeOS 另有同名開頭的「Google 日本語 2 (Natural)」等男聲。
// 物件的 pitch 會覆蓋預設音高。
const googleExact = name => ({ m: new RegExp(`^google\\s${name}$`), on: 'name' });
const PREFERRED = {
  'zh-TW': {
    f: ['hsiaochen', 'hsiaoyu', googleExact('國語（臺灣）'), 'meijia', 'mei-jia', '美佳', '美嘉', 'microsoft hanhan - ', 'yating'],
    m: ['zhiwei'],
  },
  en: {
    f: ['microsoft emma', 'microsoft ava', 'microsoft jenny', 'microsoft michelle', 'microsoft aria online',
      'microsoft sonia', 'microsoft libby', 'samantha', googleExact('us english'), 'karen', 'moira', 'tessa',
      googleExact('uk english female'), 'microsoft zira', 'microsoft hazel', 'microsoft susan'],
    m: ['microsoft guy', 'microsoft brian', 'microsoft ryan', 'microsoft steffan', 'microsoft andrew', 'microsoft roger',
      { m: 'daniel', pitch: 1.1 }, { ...googleExact('uk english male'), pitch: 1.05 }, 'rishi', 'microsoft mark', 'microsoft george'],
  },
  ja: {
    f: ['nanami', googleExact('日本語'), 'kyoko', 'haruka', 'ayumi'],
    m: ['keita', 'otoya', 'ichiro'],
  },
  ko: {
    f: ['sunhi', googleExact('한국의'), 'yuna', 'heami'],
    m: ['injoon', 'hyunsu', 'minsu'],
  },
};

// 列在清單上但一播就失敗的聲音：Edge 的舊式線上語音（名稱有「Online -」但沒有「(Natural)」，如 HanHan Online）；
// Edge 150 曾把名稱回傳成 undefined
const DEAD = [/undefined/, ' online - '];

// 不在首選名單、但需要辨識性別的聲音
const GENDER_TAGS = {
  f: [/\bfemale\b/, /(^|[\s.])(flo|shelley|grandma|kathy|tingting|sinji)\b/, '婷婷', '善怡'],
  m: [/\bmale\b/, /(^|[\s.])(eddy|reed|rocko|grandpa|fred|ralph|albert|jacques|jester)\b/,
    'microsoft david', 'microsoft christopher', 'microsoft eric online', 'microsoft thomas', 'microsoft yunjhe'],
};

// 避用名單：只有在同語言沒有任何正常聲音時才會用到
const AVOID = [
  { m: 'com.apple.eloquence.', sev: 'robotic' },            // iOS 18 起加入中日韓的 Eloquence 合成音
  { m: 'com.apple.speech.synthesis.voice.', sev: 'robotic' }, // MacinTalk：Fred、Ralph 與各種效果音
  { m: /^(eddy|flo|reed|shelley|sandy|jacques|fred|junior|kathy)\b/, on: 'name', sev: 'robotic' },
  { m: /(^|[\s.])(grandma|grandpa)\b/, sev: 'elderly' },
  { m: /(^|[\s.])(rocko|ralph)\b/, sev: 'deep' },
  { m: /(^|[\s.])(albert|bad ?news|bahh|bells|boing|bubbles|cellos|good ?news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|princess)\b/, sev: 'novelty' },
  { m: 'microsoft christopher', sev: 'deep' },
  { m: 'microsoft eric online', sev: 'deep' },
  { m: 'microsoft thomas', sev: 'deep' },
  { m: 'microsoft yunjhe', sev: 'deep' },
  { m: 'microsoft ana online', sev: 'novelty' },  // 童聲
  { m: 'microsoft maisie', sev: 'novelty' },      // 童聲
  { m: 'espeak', sev: 'robotic' },
];
// 扣分刻意大於「台灣中文 vs 中國口音」的差距（450）加上性別加減分（180）：
// 只剩機器人音時，就算選了男聲，也寧可用正常的普通話聲音（如婷婷）
const AVOID_PENALTY = { robotic: 700, deep: 750, elderly: 750, novelty: 1000 };

// 瀏覽器只會露出 Edge 自然語音這類名稱標記；「增強版」等字樣在 Safari／Chrome 都看不到
const QUALITY = ['(natural)', 'neural'];

const lname = v => (v.name || '').toLowerCase();
const hay = v => `${v.name || ''} ${v.voiceURI || ''}`.toLowerCase();

function hit(entry, v) {
  if (typeof entry === 'string') return hay(v).includes(entry);
  if (entry instanceof RegExp) return entry.test(hay(v));
  const { m, on } = entry;
  if (typeof m === 'string') return (on === 'name' ? lname(v) : hay(v)).includes(m);
  return m.test(on === 'name' ? lname(v) : hay(v));
}
const rankIn = (list, v) => list.findIndex(e => hit(e, v));

function genderOf(v) {
  for (const k of Object.keys(PREFERRED)) {
    if (rankIn(PREFERRED[k].f, v) >= 0) return 'f';
    if (rankIn(PREFERRED[k].m, v) >= 0) return 'm';
  }
  if (GENDER_TAGS.f.some(e => hit(e, v))) return 'f';
  if (GENDER_TAGS.m.some(e => hit(e, v))) return 'm';
  return '';
}

function severityOf(v) {
  let worst = null;
  for (const a of AVOID) {
    if (hit(a, v) && (!worst || AVOID_PENALTY[a.sev] > AVOID_PENALTY[worst])) worst = a.sev;
  }
  return worst;
}

const isNatural = v => QUALITY.some(q => lname(v).includes(q));

// 語言標籤正規化：Android 會回報 zh_TW_#Hant、Samsung 用 en_US，ChromeOS 可能是 cmn-TW
function langParts(tag) {
  const p = String(tag || '').toLowerCase().replace(/[_#]/g, '-').split('-').filter(Boolean);
  const lang = p[0] === 'cmn' ? 'zh' : (p[0] || '');
  const rest = p.slice(1);
  return {
    lang,
    region: rest.find(x => x.length === 2 || /^\d{3}$/.test(x)) || '',
    script: rest.find(x => x.length === 4) || '',
  };
}

function langScore(voiceLang, target) {
  const v = langParts(voiceLang);
  if (v.lang !== target.lang) return -1;
  if (v.region === target.region) return 1000;
  if (!v.region) return 900;
  if (target.lang === 'en') return 998; // 英式、澳式英文一樣好懂，讓音色決定（美式只當平手時的優先）
  if (target.lang === 'zh') {
    if (v.region === 'hk' || v.region === 'mo') return -1; // 香港／澳門語音講粵語，絕不拿來唸國語
    if (v.region === 'cn' || v.region === 'sg' || v.script === 'hans') return 550;
    return 700;
  }
  return 800;
}

// 音高：研究顯示略高的男聲更親切、較不具威脅感，但超過約 +20% 會顯得緊張；女聲不需調高
function prefPitch(v) {
  for (const k of Object.keys(PREFERRED)) {
    for (const g of ['f', 'm']) {
      const e = PREFERRED[k][g].find(x => x && typeof x === 'object' && typeof x.pitch === 'number' && hit(x, v));
      if (e) return e.pitch;
    }
  }
  return null;
}

function pitchFor(v, g, sev) {
  if (isNatural(v)) return 1.0;                    // Edge 自然語音會忽略音高；神經語音維持原樣最自然
  let p = prefPitch(v);
  if (p == null) {
    if (sev === 'deep' || sev === 'elderly') p = 1.12;
    else if (g === 'f') p = 1.0;
    else if (g === 'm') {
      const n = lname(v);
      // Windows 本機語音的音高是整數量化：1.00–1.09 完全沒效果，1.1 才有一格
      p = n.startsWith('microsoft ') && !n.includes(' online') ? 1.105 : 1.08;
    } else p = settings.voiceGender === 'm' ? 1.05 : 1.0; // Android 由手機決定聲音，只能盲調
  }
  return Math.max(1.0, Math.min(1.15, p));
}

// 計分挑選（層級刻意拉開）：語言正確 ≫ 避開機器人／低沉／搞怪 ≫ 符合性別 ≫ 開朗首選 ≫ 高品質 ≫ 本機
// opts.localOnly：只考慮本機語音（離線，或線上語音失敗後的重試）；opts.list：自訂語音清單（模擬器用）
export function pickVoice(langKey, { gender = settings.voiceGender || '', localOnly = false, list } = {}) {
  const target = langParts(LANGS[langKey]?.speech || langKey);
  const pref = PREFERRED[langKey] || { f: [], m: [] };
  let best = null;
  for (const v of list || voices) {
    if (!v || !v.name || !v.lang || DEAD.some(e => hit(e, v))) continue;
    if (localOnly && v.localService === false) continue;
    let s = langScore(v.lang, target);
    if (s < 0) continue;

    const sev = severityOf(v);
    if (sev) s -= AVOID_PENALTY[sev];

    const g = genderOf(v);
    if (gender) {
      if (g === gender) s += 120;
      else if (g) s -= 60;
    }

    // 「自動」先排完女聲首選再排男聲首選：女聲整體較不具威脅感，也避免名單長短影響排名
    const fr = rankIn(pref.f, v), mr = rankIn(pref.m, v);
    const rank = gender === 'f' ? fr : gender === 'm' ? mr : (fr >= 0 ? fr : mr >= 0 ? pref.f.length + mr : -1);
    if (rank >= 0) s += 100 - Math.min(rank, 30) * 3;
    else if (gender && (fr >= 0 || mr >= 0)) s += 25; // 沒有親切的所選性別時，至少用親切的聲音
    // 首選名單已依音色與品質排好；自然語音加分只給名單外的聲音，避免蓋過排序
    if (fr < 0 && mr < 0 && isNatural(v)) s += 15;
    if (v.localService) s += 3;

    if (!best || s > best.score) best = { voice: v, score: s, gender: g, severity: sev };
  }
  if (!best) return null;
  return { ...best, pitch: pitchFor(best.voice, best.gender, best.severity) };
}

// speak() 與設定頁共用：離線只用本機語音；iPhone 只剩機器人音時不指定聲音，
// 交給系統依語言挑預設（可能是 Safari 看不到的增強版語音）
function resolveChoice(langKey) {
  const pick = pickVoice(langKey, { localOnly: navigator.onLine === false }) || pickVoice(langKey);
  if (pick?.severity && /^com\.apple\./i.test(pick.voice.voiceURI || '')) {
    return { voice: null, pitch: 1, gender: '', severity: pick.severity, systemDefault: true };
  }
  return pick;
}

// 設定頁顯示用：各語言目前會用哪個聲音
export function voiceInfo(langKey) {
  refreshVoices();
  const pick = resolveChoice(langKey);
  if (!pick) return null;
  if (pick.systemDefault) {
    return { name: '', label: '系統預設聲音', gender: '', genderLabel: '', natural: false, genderFallback: false, phoneDecides: false };
  }
  const raw = pick.voice.name || '';
  let label = raw
    .replace(/^microsoft\s+/i, '')
    .replace(/multilingual/i, '')
    .replace(/\s+online(\s*\(natural\))?/i, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s*\((english|chinese|japanese|korean)[^)]*\)+$/i, '')
    .trim() || raw;
  const wanted = settings.voiceGender || '';
  return {
    name: raw,
    label,
    gender: pick.gender,
    genderLabel: pick.gender === 'f' ? '女聲' : pick.gender === 'm' ? '男聲' : '',
    natural: isNatural(pick.voice),
    genderFallback: !!(wanted && pick.gender && pick.gender !== wanted),
    phoneDecides: isAndroid,
  };
}

export const VOICE_SAMPLES = {
  'zh-TW': '你好！很高興為你服務。',
  en: "Hi there! It's so nice to meet you.",
  ja: 'こんにちは！どうぞよろしくお願いします。',
  ko: '안녕하세요! 만나서 반가워요.',
};

// ---------- 朗讀 ----------
// 每段控制在約 10 秒內：Chrome 線上語音超過約 15 秒會被截斷
const CHUNK_CHARS = { 'zh-TW': 55, ja: 65, ko: 60, en: 170 };
const CHARS_PER_SEC = { 'zh-TW': 5.5, ja: 7, ko: 6, en: 14 };

function hardSplit(piece, max, out) {
  let rest = piece;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest.trim());
}

function splitForSpeech(text, langKey, rate) {
  const max = Math.round((CHUNK_CHARS[langKey] || 120) * Math.min(1.5, Math.max(0.8, rate)));
  const clean = text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const out = [];
  const flush = (piece) => {
    piece = piece.trim();
    if (!piece) return;
    if (piece.length <= max) { out.push(piece); return; }
    let buf = '';
    for (const part of piece.split(/(?<=[，,、；;：:])/u)) {
      if ((buf + part).length > max && buf) { out.push(buf.trim()); buf = ''; }
      if (part.length > max) hardSplit(part, max, out);
      else buf += part;
    }
    if (buf.trim()) out.push(buf.trim());
  };
  let buf = '';
  for (const s of clean.split(/(?<=[。．.!?！？\n])/u)) {
    if ((buf + s).length > max && buf) { flush(buf); buf = ''; }
    if (s.length > max) flush(s);
    else buf += s;
  }
  flush(buf);
  // 空白或純符號段落不排入佇列（Chrome 會因此卡住後續朗讀）
  return out.filter(c => { try { return /[\p{L}\p{N}]/u.test(c); } catch { return true; } });
}

function engineBusy() {
  try { return speechSynthesis.speaking || speechSynthesis.pending; } catch { return false; }
}
function cancelEngine() {
  const busy = engineBusy();
  if (busy) { try { speechSynthesis.cancel(); } catch {} }
  return busy;
}

let speakSeq = 0;
let job = null;          // { seq, resolve, overall }
let liveUtterances = []; // 保留參考，避免播完前被回收導致 onend 不觸發

function finish(seq, ok) {
  if (!job || job.seq !== seq) return;
  clearTimeout(job.overall);
  const { resolve } = job;
  job = null;
  liveUtterances = [];
  resolve(ok);
}

async function waitForVoices(ms) {
  const until = Date.now() + ms;
  while (!refreshVoices().length && Date.now() < until) {
    await new Promise(r => setTimeout(r, 150));
  }
}

export function speak(text, langKey, rate = 1) {
  const str = String(text ?? '');
  if (!ttsSupported || !str.trim()) return Promise.resolve(false);
  const chunks = splitForSpeech(str, langKey, rate);
  if (!chunks.length) return Promise.resolve(false);

  const wasBusy = cancelEngine();
  if (job) finish(job.seq, false);
  const seq = ++speakSeq;

  return new Promise((resolve) => {
    job = { seq, resolve, overall: null };
    const totalChars = chunks.reduce((n, c) => n + c.length, 0);
    const expectedMs = totalChars / (CHARS_PER_SEC[langKey] || 8) / Math.max(0.5, rate) * 1000;
    job.overall = setTimeout(() => { cancelEngine(); finish(seq, false); }, expectedMs * 2.5 + 6000);

    let choice = null;
    let retried = false;
    let attempt = 0; // 每送出一句就遞增：被取消或取代的舊句子晚到的事件一律忽略
    const current = () => seq === speakSeq && job?.seq === seq;

    // 線上語音失敗或卡住 → 改用最親切的本機語音，從這一段重播一次
    const fallbackOrFail = (i, fromWatchdog) => {
      const local = !retried && choice?.voice && choice.voice.localService === false
        ? pickVoice(langKey, { localOnly: true }) : null;
      if (local && local.voice.name !== choice.voice.name) {
        retried = true;
        choice = local;
        attempt++;
        const restarted = cancelEngine();
        setTimeout(() => play(i), restarted && isWebKit ? 90 : 0);
        return;
      }
      if (fromWatchdog) return; // 沒有替代聲音：可能只是網路慢，交給整體計時器收尾
      cancelEngine();
      finish(seq, false);
    };

    const play = (i) => {
      if (!current()) return;
      if (i >= chunks.length) return finish(seq, true);
      const my = ++attempt;
      const live = () => current() && my === attempt;
      const u = new SpeechSynthesisUtterance(chunks[i]);
      u.lang = LANGS[langKey]?.speech || langKey;
      if (choice?.voice) u.voice = choice.voice;
      u.pitch = choice ? choice.pitch : 1;
      u.rate = rate;
      let started = false;
      // Chrome 線上語音在網路不穩時可能完全沒有事件、永遠卡住；本機語音不設這個計時，避免誤殺
      const startTimer = choice?.voice && choice.voice.localService === false
        ? setTimeout(() => { if (!started && live()) fallbackOrFail(i, true); }, 3500)
        : null;
      u.onstart = () => { started = true; clearTimeout(startTimer); };
      u.onend = () => {
        clearTimeout(startTimer);
        if (live()) play(i + 1);
      };
      u.onerror = (e) => {
        clearTimeout(startTimer);
        if (!live()) return; // 自己取消的（Safari 會把所有錯誤都報成 canceled，只能靠序號判斷）
        if (e.error === 'not-allowed') return finish(seq, false);
        fallbackOrFail(i, false);
      };
      liveUtterances.push(u);
      try { speechSynthesis.speak(u); } catch { finish(seq, false); }
    };

    const begin = () => {
      if (!current()) return;
      refreshVoices();
      choice = resolveChoice(langKey);
      play(0);
    };

    // Safari 在 cancel() 後立刻 speak() 可能吞掉新的一句；iOS 剛關麥克風時朗讀可能沒聲音，都稍等再播
    let delay = wasBusy && isWebKit ? 90 : 0;
    if (isAppleMobile) delay = Math.max(delay, 450 - (Date.now() - lastMicEnd));
    const go = () => {
      if (voices.length || refreshVoices().length) begin();
      else waitForVoices(1500).then(begin); // 清單還沒載入：最多等 1.5 秒，仍沒有就只指定語言
    };
    if (delay > 0) setTimeout(go, delay);
    else go();
  });
}

export function stopSpeaking() {
  speakSeq++;
  cancelEngine();
  if (job) {
    const { resolve } = job;
    clearTimeout(job.overall);
    job = null;
    liveUtterances = [];
    resolve(false);
  }
}

if (ttsSupported) {
  // iOS 規定第一次朗讀必須直接由點擊觸發；對話翻譯是非同步完成才朗讀，第一次會被靜默丟掉。
  // 在第一次點擊時先念一個幾乎無聲的字解鎖。
  if (isAppleMobile) {
    let primed = false;
    const prime = () => {
      if (primed) return;
      primed = true;
      document.removeEventListener('touchend', prime, true);
      document.removeEventListener('click', prime, true);
      if (engineBusy()) return;
      try {
        const u = new SpeechSynthesisUtterance('.');
        u.volume = 0.01;
        u.rate = 1.5;
        speechSynthesis.speak(u);
      } catch {}
    };
    document.addEventListener('touchend', prime, { capture: true, passive: true });
    document.addEventListener('click', prime, { capture: true, passive: true });
  }
  // 切到背景時主動停止，避免 iOS 語音引擎卡住、Android 分頁隱藏時中斷後狀態錯亂
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopSpeaking(); });
  window.addEventListener('pagehide', () => stopSpeaking());
}

export function sttErrorMessage(code) {
  switch (code) {
    case 'unsupported': return '此瀏覽器不支援語音辨識，建議改用 Chrome、Edge 或 Safari';
    case 'not-allowed':
    case 'service-not-allowed': return '麥克風權限被拒絕，請到瀏覽器設定開啟';
    case 'no-speech': return '沒有聽到聲音，請再試一次';
    case 'audio-capture': return '找不到麥克風裝置';
    case 'network': return '語音辨識需要網路連線';
    default: return `語音辨識發生問題（${code}）`;
  }
}
