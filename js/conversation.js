// 即時雙向語音對話：上半部給對方（外語）、下半部給自己（中文）
// 各自點麥克風說話 → 即時辨識 → 翻譯 → 顯示雙語字幕 → 自動朗讀給對方聽
import { LANGS } from './config.js';
import { settings, saveSettings, getForeign } from './store.js';
import { listen, speak, stopSpeaking, sttSupported, sttErrorMessage } from './speech.js';
import { translateText } from './translator.js';
import { $, el, icon, toast, bigDisplay } from './ui.js';

const THEM_HINTS = {
  en: 'Tap the mic below and speak English.\nIt will be translated into Chinese.',
  ja: '下のマイクをタップして日本語で話してください。\n中国語に翻訳されます。',
  ko: '아래 마이크를 누르고 한국어로 말해 주세요.\n중국어로 번역됩니다.',
};

const messages = []; // { id, side:'me'|'them', srcLang, dstLang, src, dst, error }
let active = null;   // { side, ctrl }
let nextId = 1;
const refs = {};

export function initTalk() {
  Object.assign(refs, {
    wrap: $('#talkWrap'),
    logMe: $('#logMe'), logThem: $('#logThem'),
    interimMe: $('#interimMe'), interimThem: $('#interimThem'),
    micMe: $('#micMe'), micThem: $('#micThem'),
    micThemLabel: $('#micThemLabel'),
    hint: $('#talkHint'),
  });

  refs.micMe.addEventListener('click', () => toggleListen('me'));
  refs.micThem.addEventListener('click', () => toggleListen('them'));

  $('#btnFlip').addEventListener('click', (e) => {
    refs.wrap.classList.toggle('face-mode');
    e.currentTarget.classList.toggle('on', refs.wrap.classList.contains('face-mode'));
  });

  const btnAuto = $('#btnAutoSpeak');
  btnAuto.classList.toggle('on', settings.autoSpeak);
  btnAuto.addEventListener('click', () => {
    settings.autoSpeak = !settings.autoSpeak; saveSettings();
    btnAuto.classList.toggle('on', settings.autoSpeak);
    toast(settings.autoSpeak ? '已開啟自動朗讀' : '已關閉自動朗讀');
  });

  $('#btnClearTalk').addEventListener('click', () => {
    messages.length = 0;
    stopSpeaking();
    render();
  });

  document.addEventListener('foreignchange', () => { updateLabels(); render(); });
  updateLabels();
  render();
}

function updateLabels() {
  refs.micThemLabel.textContent = LANGS[getForeign()].micLabel;
}

function toggleListen(side) {
  if (!sttSupported) { toast(sttErrorMessage('unsupported'), 'err'); return; }
  if (navigator.onLine === false) { toast('語音辨識需要網路連線', 'err'); return; }

  if (active) {
    const same = active.side === side;
    active.ctrl?.stop();
    if (same) return; // 再點一次＝結束這句
  }
  stopSpeaking();

  const lang = side === 'me' ? 'zh-TW' : getForeign();
  const interimEl = side === 'me' ? refs.interimMe : refs.interimThem;
  const btn = side === 'me' ? refs.micMe : refs.micThem;

  const ctrl = listen({
    lang,
    onInterim: (t) => { interimEl.hidden = false; interimEl.textContent = t; },
    onFinal: (finalText) => handleFinal(side, lang, finalText),
    onError: (code) => {
      if (code === 'aborted') return;
      toast(sttErrorMessage(code), code === 'no-speech' ? '' : 'err');
    },
    onEnd: () => {
      if (active?.ctrl === ctrl) active = null;
      btn.classList.remove('listening');
      interimEl.hidden = true; interimEl.textContent = '';
    },
  });
  if (!ctrl) return;
  active = { side, ctrl };
  btn.classList.add('listening');
}

async function handleFinal(side, srcLang, text) {
  const dstLang = side === 'me' ? getForeign() : 'zh-TW';
  const msg = { id: nextId++, side, srcLang, dstLang, src: text, dst: null, error: null };
  messages.push(msg);
  if (messages.length > 60) messages.shift();
  render();
  try {
    const r = await translateText(text, srcLang, dstLang);
    msg.dst = r.text;
  } catch (err) {
    msg.error = err.message;
  }
  render();
  if (msg.dst && settings.autoSpeak) speak(msg.dst, dstLang, settings.rate);
}

function render() {
  renderPanel(refs.logMe, 'me');
  renderPanel(refs.logThem, 'them');
}

function renderPanel(log, panelSide) {
  log.innerHTML = '';
  if (!messages.length) {
    if (panelSide === 'me') {
      log.appendChild(refs.hint);
    } else {
      const hint = el(`<div class="talk-hint"></div>`);
      hint.textContent = THEM_HINTS[getForeign()] || '';
      hint.style.whiteSpace = 'pre-line';
      log.appendChild(hint);
    }
    return;
  }

  for (const msg of messages) {
    // 每個面板都以「自己的語言」為主字，對方語言為副字
    const main = panelSide === 'me'
      ? (msg.side === 'me' ? msg.src : msg.dst)
      : (msg.side === 'them' ? msg.src : msg.dst);
    const sub = panelSide === 'me'
      ? (msg.side === 'me' ? msg.dst : msg.src)
      : (msg.side === 'them' ? msg.dst : msg.src);
    const mainLang = panelSide === 'me'
      ? (msg.side === 'me' ? msg.srcLang : msg.dstLang)
      : (msg.side === 'them' ? msg.srcLang : msg.dstLang);

    const own = msg.side === panelSide;
    const bub = el(`<div class="bub ${own ? 'own' : 'other'}"></div>`);
    const mainEl = el(`<div class="bub-main"></div>`);
    mainEl.textContent = main ?? '…';
    mainEl.setAttribute('lang', LANGS[mainLang]?.speech || '');
    bub.appendChild(mainEl);

    const subEl = el(`<span class="sub"></span>`);
    subEl.textContent = msg.error ? `⚠ ${msg.error}` : (sub ?? '翻譯中…');
    bub.appendChild(subEl);

    if (main) {
      const tools = el(`<div class="bub-tools">
        <button title="朗讀">${icon('speaker')}</button>
        <button title="全螢幕展示">${icon('expand')}</button>
      </div>`);
      const [bSpeak, bBig] = tools.querySelectorAll('button');
      bSpeak.addEventListener('click', (e) => { e.stopPropagation(); speak(main, mainLang, settings.rate); });
      bBig.addEventListener('click', (e) => {
        e.stopPropagation();
        bigDisplay({ text: main, lang: mainLang, subText: sub || '' });
      });
      bub.appendChild(tools);
    }
    log.appendChild(bub);
  }
  log.scrollTop = log.scrollHeight;
}
