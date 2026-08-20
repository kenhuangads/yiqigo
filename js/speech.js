// 語音層：Web Speech API（語音辨識 STT ＋ 語音合成 TTS）
import { LANGS } from './config.js';
import { settings } from './store.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = !!SR;
export const ttsSupported = 'speechSynthesis' in window;

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
    if (finalText.trim()) onFinal?.(finalText.trim());
    onEnd?.();
  };
  try { rec.start(); } catch { onError?.('start-failed'); return null; }
  return {
    stop() { try { rec.stop(); } catch {} },
    abort() { finalText = ''; try { rec.abort(); } catch {} },
  };
}

// ---------- 語音合成 ----------
let voices = [];
function refreshVoices() { voices = speechSynthesis.getVoices(); }
if (ttsSupported) {
  refreshVoices();
  speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
}

// Web Speech API 沒有性別欄位，用常見語音名稱資料庫推測（涵蓋 iOS／Android／Windows 中英日韓語音）
const FEMALE_NAMES = [
  '女聲', '女声',
  // 中文
  'mei-jia', 'meijia', 'hsiaochen', 'hsiaoyu', 'hanhan', 'yating', 'ya-ting',
  'xiaoxiao', 'xiaoyi', 'xiaochen', 'xiaohan', 'xiaomeng', 'xiaomo', 'xiaoqiu', 'xiaorui',
  'xiaoshuang', 'xiaoxuan', 'xiaoyan', 'xiaozhen', 'tingting', 'ting-ting', 'hiugaai', 'hiumaan', 'sin-ji', 'sinji',
  // 日文
  'kyoko', 'nanami', 'mayu', 'aoi', 'shiori', 'haruka', 'ayumi', 'sayaka', 'o-ren', 'hina',
  // 韓文
  'yuna', 'sunhi', 'sun-hi', 'jimin', 'ji-min', 'seoyeon', 'sora', 'heami', 'yujin',
  // 英文
  'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'allison', 'ava', 'susan',
  'zoe', 'nicky', 'aria', 'jenny', 'michelle', 'emma', 'olivia', 'libby', 'sonia', 'zira',
  'hazel', 'joanna', 'salli', 'kimberly', 'ivy', 'kendra', 'amy', 'serena', 'martha', 'kate',
  'stephanie', 'catherine', 'linda', 'heather',
];
const MALE_NAMES = [
  '男聲', '男声',
  // 中文
  'yunjhe', 'yun-jhe', 'yunxi', 'yunyang', 'yunjian', 'yunye', 'yunfeng', 'yunhao',
  'kangkang', 'zhiwei', 'wan-lung', 'wanlung', 'danny',
  // 日文
  'otoya', 'hattori', 'ichiro', 'keita', 'daichi', 'naoki', 'tomoki',
  // 韓文
  'injoon', 'in-joon', 'minsu', 'min-su', 'hyunsu', 'gookmin', 'gook-min', 'jinho',
  // 英文
  'daniel', 'alex', 'fred', 'aaron', 'arthur', 'gordon', 'guy', 'davis', 'tony', 'eric',
  'andrew', 'brian', 'christopher', 'matthew', 'david', 'mark', 'james', 'oliver', 'rishi',
  'ryan', 'thomas', 'george', 'william', 'sean', 'russell', 'kyle', 'nathan', 'justin',
];

function voiceGender(v) {
  const n = v.name.toLowerCase();
  if (n.includes('female') || FEMALE_NAMES.some(f => n.includes(f))) return 'f';
  if (n.includes('male') || MALE_NAMES.some(m => n.includes(m))) return 'm';
  return '';
}

// 計分挑選：語言正確性最優先（避免為了性別挑到 zh-CN／zh-HK 發音），
// 其次符合使用者選的性別，再偏好本機語音（品質通常較穩定）
export function pickVoice(langKey) {
  const target = (LANGS[langKey]?.speech || langKey).toLowerCase();
  const prefix = target.split('-')[0];
  const gender = settings.voiceGender || '';
  const norm = v => v.lang.toLowerCase().replace('_', '-');
  let best = null, bestScore = -1;
  for (const v of voices) {
    const vl = norm(v);
    let s = 0;
    if (vl === target) s += 8;
    else if (vl.startsWith(prefix)) {
      s += 4;
      if (prefix === 'zh' && vl.includes('cn')) s -= 2;
      if (prefix === 'zh' && vl.includes('hk')) s -= 3;
    } else continue;
    if (gender && voiceGender(v) === gender) s += 3;
    if (v.localService) s += 1;
    if (s > bestScore) { bestScore = s; best = v; }
  }
  return best;
}

export function speak(text, langKey, rate = 1) {
  if (!ttsSupported || !text) return Promise.resolve(false);
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANGS[langKey]?.speech || langKey;
    const v = pickVoice(langKey);
    if (v) u.voice = v;
    u.rate = rate;
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (ttsSupported) speechSynthesis.cancel();
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
