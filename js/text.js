// 手動輸入翻譯：停頓自動翻譯、雙向交換、朗讀／複製／大字展示／分享、翻譯歷史
import { LANGS, FOREIGN_LANGS } from './config.js';
import { settings, getForeign, getTextHistory, pushTextHistory, clearTextHistory } from './store.js';
import { translateText, detectedName } from './translator.js';
import { $, el, icon, toast, copyText, bigDisplay } from './ui.js';
import { speak } from './speech.js';

const refs = {};
let debounceTimer = null;
let lastDetected = 'en';
let current = null; // { src, dst, from, to, detected, provider, guarded }
let seq = 0;

export function initText() {
  Object.assign(refs, {
    from: $('#txtFrom'), to: $('#txtTo'), swap: $('#txtSwap'),
    input: $('#txtInput'), count: $('#txtCount'),
    go: $('#btnTxtGo'), clear: $('#btnTxtClear'), status: $('#txtStatus'),
    result: $('#txtResult'), resultMeta: $('#txtResultMeta'), resultText: $('#txtResultText'),
    speak: $('#btnTxtSpeak'), copy: $('#btnTxtCopy'), big: $('#btnTxtBig'), share: $('#btnTxtShare'),
    history: $('#txtHistory'),
  });

  const opt = code => `<option value="${code}">${LANGS[code].flag} ${LANGS[code].name}</option>`;
  refs.from.innerHTML = `<option value="auto">🌐 自動偵測</option>` + Object.keys(LANGS).map(opt).join('');
  refs.to.innerHTML = Object.keys(LANGS).map(opt).join('');
  refs.from.value = 'zh-TW';
  refs.to.value = getForeign();

  refs.from.addEventListener('change', () => { avoidSamePair('from'); scheduleTranslate(0); });
  refs.to.addEventListener('change', () => { avoidSamePair('to'); scheduleTranslate(0); });
  document.addEventListener('foreignchange', (e) => {
    if (refs.to.value !== 'zh-TW' && FOREIGN_LANGS.includes(refs.to.value)) refs.to.value = e.detail;
    else if (refs.from.value !== 'zh-TW' && FOREIGN_LANGS.includes(refs.from.value)) refs.from.value = e.detail;
  });

  refs.input.addEventListener('input', () => {
    refs.count.textContent = `${refs.input.value.length}/3000`;
    if (settings.autoTranslate) scheduleTranslate(900);
  });
  refs.input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doTranslate(); }
  });
  refs.go.addEventListener('click', doTranslate);
  refs.clear.addEventListener('click', () => {
    refs.input.value = '';
    refs.count.textContent = '0/3000';
    refs.result.hidden = true;
    refs.status.hidden = true;
    current = null;
    refs.input.focus();
  });
  refs.swap.addEventListener('click', swapLangs);

  refs.speak.addEventListener('click', () => current && speak(current.dst, current.to, settings.rate));
  refs.copy.addEventListener('click', () => current && copyText(current.dst));
  refs.big.addEventListener('click', () => current && bigDisplay({ text: current.dst, lang: current.to, subText: current.src }));
  refs.share.addEventListener('click', shareResult);

  renderHistory();
}

function avoidSamePair(changed) {
  if (refs.from.value !== refs.to.value) return;
  if (changed === 'from') refs.to.value = refs.from.value === 'zh-TW' ? getForeign() : 'zh-TW';
  else refs.from.value = refs.to.value === 'zh-TW' ? getForeign() : 'zh-TW';
}

function scheduleTranslate(delay) {
  clearTimeout(debounceTimer);
  if (!refs.input.value.trim()) return;
  debounceTimer = setTimeout(doTranslate, delay);
}

async function doTranslate() {
  clearTimeout(debounceTimer);
  const text = refs.input.value.trim();
  if (!text) return;
  const from = refs.from.value, to = refs.to.value;
  const my = ++seq;
  refs.status.hidden = false;
  refs.status.textContent = '翻譯中…';
  try {
    const r = await translateText(text, from, to);
    if (my !== seq) return;
    current = { src: text, dst: r.text, from, to, detected: r.detected, provider: r.provider, guarded: r.guarded };
    if (from === 'auto' && r.detected && LANGS[r.detected]) lastDetected = r.detected;
    refs.status.hidden = true;
    renderResult();
    pushTextHistory({ src: text, dst: r.text, from, to, t: Date.now() });
    renderHistory();
  } catch (err) {
    if (my !== seq) return;
    refs.status.textContent = `⚠ ${err.message}`;
  }
}

function renderResult() {
  const { to, from, detected, provider, guarded } = current;
  const badges = [`<span class="badge">${LANGS[to].flag} ${LANGS[to].name}</span>`];
  if (from === 'auto' && detected) badges.push(`<span class="badge">偵測：${detectedName(detected)}</span>`);
  if (provider) badges.push(`<span class="badge">${provider}</span>`);
  if (guarded) badges.push(`<span class="badge tw">台灣用語守護 ✓</span>`);
  refs.resultMeta.innerHTML = badges.join('');
  refs.resultText.textContent = current.dst;
  refs.resultText.setAttribute('lang', LANGS[to]?.speech || '');
  refs.result.hidden = false;
}

function swapLangs() {
  let from = refs.from.value, to = refs.to.value;
  if (from === 'auto') from = (LANGS[lastDetected] && lastDetected !== to) ? lastDetected : (to === 'zh-TW' ? getForeign() : 'zh-TW');
  refs.from.value = to;
  refs.to.value = from;
  if (current?.dst) refs.input.value = current.dst;
  refs.count.textContent = `${refs.input.value.length}/3000`;
  if (refs.input.value.trim()) doTranslate();
}

async function shareResult() {
  if (!current) return;
  const payload = `${current.src}\n→ ${current.dst}`;
  if (navigator.share) {
    try { await navigator.share({ text: payload }); } catch { /* 使用者取消 */ }
  } else {
    copyText(payload);
  }
}

function renderHistory() {
  const list = getTextHistory();
  refs.history.innerHTML = '';
  if (!list.length) return;
  const title = el(`<div class="hist-title"><span>最近翻譯</span><button>清除歷史</button></div>`);
  title.querySelector('button').addEventListener('click', () => {
    clearTextHistory(); renderHistory(); toast('已清除歷史');
  });
  refs.history.appendChild(title);
  for (const item of list.slice(0, 8)) {
    const node = el(`<button class="hist-item"><div class="h-dst"></div><div class="h-src"></div></button>`);
    node.querySelector('.h-dst').textContent = item.dst;
    node.querySelector('.h-src').textContent = `${LANGS[item.from]?.name ?? '自動'} → ${LANGS[item.to]?.name ?? ''}｜${item.src}`;
    node.addEventListener('click', () => {
      refs.input.value = item.src;
      if (item.from === 'auto' || LANGS[item.from]) refs.from.value = item.from;
      if (LANGS[item.to]) refs.to.value = item.to;
      refs.count.textContent = `${item.src.length}/3000`;
      doTranslate();
      window.scrollTo({ top: 0 });
    });
    refs.history.appendChild(node);
  }
}
