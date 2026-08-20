// 語音層：Web Speech API（語音辨識 STT ＋ 語音合成 TTS）
import { LANGS } from './config.js';

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

function pickVoice(langKey) {
  const target = (LANGS[langKey]?.speech || langKey).toLowerCase();
  const prefix = target.split('-')[0];
  const norm = v => v.lang.toLowerCase().replace('_', '-');
  // 優先完整符合（zh-TW），其次同語系；同分時偏好本機（品質通常較穩定）
  return voices.find(v => norm(v) === target && v.localService)
      || voices.find(v => norm(v) === target)
      || voices.find(v => norm(v).startsWith(prefix) && (prefix !== 'zh' || !norm(v).includes('cn')))
      || voices.find(v => norm(v).startsWith(prefix))
      || null;
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
