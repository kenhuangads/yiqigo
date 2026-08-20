// 共用 UI：toast、底部彈窗、全螢幕大字展示、DOM 小工具
import { LANGS } from './config.js';
import { settings } from './store.js';
import { speak, stopSpeaking } from './speech.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function icon(name, cls = 'i') {
  return `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
}

let toastTimer = new Map();
export function toast(msg, type = '') {
  const root = $('#toast-root');
  const node = el(`<div class="toast ${type}"></div>`);
  node.textContent = msg;
  root.appendChild(node);
  const t = setTimeout(() => node.remove(), 2600);
  toastTimer.set(node, t);
}

export function copyText(text) {
  return navigator.clipboard?.writeText(text)
    .then(() => toast('已複製 ✓'))
    .catch(() => toast('複製失敗', 'err'));
}

// ---------- 底部彈窗 ----------
export function openSheet(title, bodyEl) {
  const root = $('#modal-root');
  root.innerHTML = '';
  const veil = el(`
    <div class="sheet-veil">
      <div class="sheet" role="dialog" aria-label="${title}">
        <div class="sheet-grab"></div>
        <h3><span>${title}</span><button class="iconbtn sheet-close" aria-label="關閉">${icon('close')}</button></h3>
      </div>
    </div>`);
  veil.querySelector('.sheet').appendChild(bodyEl);
  veil.addEventListener('click', e => { if (e.target === veil) close(); });
  veil.querySelector('.sheet-close').addEventListener('click', close);
  function close() { veil.remove(); }
  root.appendChild(veil);
  return { close };
}

// ---------- 全螢幕大字展示（給對方看） ----------
export function bigDisplay({ text, lang, subText = '', subLang = '' }) {
  const root = $('#big-root');
  root.innerHTML = '';
  const langMeta = LANGS[lang];
  const veil = el(`
    <div class="big-veil" role="dialog" aria-label="全螢幕展示">
      <div class="big-top">
        <span class="big-sub">${langMeta ? langMeta.flag + ' ' + langMeta.name : ''}</span>
        <button class="iconbtn big-close" aria-label="關閉">${icon('close')}</button>
      </div>
      <div class="big-main">
        <div class="big-text" lang="${langMeta?.speech || ''}"></div>
        ${subText ? '<div class="big-sub big-subtext"></div>' : ''}
      </div>
      <div class="big-actions">
        <button class="btn big-speak">${icon('speaker')} 朗讀</button>
        <button class="btn big-rotate">${icon('flip')} 轉向</button>
      </div>
    </div>`);
  const bigText = veil.querySelector('.big-text');
  bigText.textContent = text;
  // 依字數調整字級：越短越大
  const len = [...text].length;
  bigText.style.fontSize = len <= 10 ? 'clamp(38px, 11vw, 84px)'
    : len <= 30 ? 'clamp(30px, 8vw, 60px)'
    : len <= 80 ? 'clamp(22px, 5.5vw, 42px)'
    : 'clamp(18px, 4vw, 30px)';
  if (subText) veil.querySelector('.big-subtext').textContent = subText;
  veil.querySelector('.big-close').addEventListener('click', () => { stopSpeaking(); veil.remove(); });
  veil.querySelector('.big-speak').addEventListener('click', () => speak(text, lang, settings.rate));
  veil.querySelector('.big-rotate').addEventListener('click', () => veil.classList.toggle('rot'));
  root.appendChild(veil);
}

// ---------- 進度遮罩（OCR／翻譯用） ----------
export function progressVeil(initialStage = '處理中…') {
  const veil = el(`
    <div class="progress-veil">
      <div class="stage"></div>
      <div class="progress-track"><div class="progress-fill"></div></div>
      <div class="hint">首次使用會下載辨識模型（約 10–20 MB），之後會快取加速</div>
      <button class="btn ghost pv-cancel">取消</button>
    </div>`);
  const stageEl = veil.querySelector('.stage');
  const fillEl = veil.querySelector('.progress-fill');
  stageEl.textContent = initialStage;
  let cancelled = false;
  veil.querySelector('.pv-cancel').addEventListener('click', () => { cancelled = true; veil.remove(); });
  document.body.appendChild(veil);
  return {
    set(stage, ratio) {
      stageEl.textContent = stage;
      if (typeof ratio === 'number') fillEl.style.width = `${Math.round(ratio * 100)}%`;
    },
    close() { veil.remove(); },
    get cancelled() { return cancelled; },
  };
}
