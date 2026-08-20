// 本機儲存：設定、語言配對、翻譯歷史
const K = {
  settings: 'yiqigo.settings.v1',
  pair: 'yiqigo.pair.v1',
  textHistory: 'yiqigo.hist.text.v1',
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch { return { ...fallback }; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 無痕模式等情況直接忽略 */ }
}

export const settings = load(K.settings, {
  rate: 1,            // 語音速度
  autoSpeak: true,    // 對話自動朗讀
  taiwanGuard: true,  // 台灣用語守護
  autoTranslate: true // 輸入停頓自動翻譯
});
export function saveSettings() { save(K.settings, settings); }

const pair = load(K.pair, { foreign: 'ja' });
export function getForeign() { return pair.foreign; }
export function setForeign(code) { pair.foreign = code; save(K.pair, pair); }

export function getTextHistory() {
  try { return JSON.parse(localStorage.getItem(K.textHistory) || '[]'); } catch { return []; }
}
export function pushTextHistory(entry) {
  const list = getTextHistory().filter(e => !(e.src === entry.src && e.to === entry.to));
  list.unshift(entry);
  try { localStorage.setItem(K.textHistory, JSON.stringify(list.slice(0, 30))); } catch {}
}
export function clearTextHistory() {
  try { localStorage.removeItem(K.textHistory); } catch {}
}
