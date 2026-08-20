// 一起GO 翻譯神器 — 主程式
import { LANGS, FOREIGN_LANGS, APP_VERSION } from './config.js';
import { settings, saveSettings, getForeign, setForeign, clearTextHistory } from './store.js';
import { $, $$, el, toast, openSheet } from './ui.js';
import { speak, sttSupported, ttsSupported } from './speech.js';
import { initTalk } from './conversation.js';
import { initCamera, onShowCamera, onHideCamera } from './camera.js';
import { initText } from './text.js';
import { initPhoto } from './photo.js';
import { initPhrases } from './phrasebook.js';

let deferredInstallPrompt = null;

function initPairSelector() {
  const sel = $('#pairForeign');
  sel.innerHTML = FOREIGN_LANGS
    .map(code => `<option value="${code}">${LANGS[code].flag} ${LANGS[code].name}</option>`)
    .join('');
  sel.value = getForeign();
  sel.addEventListener('change', () => {
    setForeign(sel.value);
    document.dispatchEvent(new CustomEvent('foreignchange', { detail: sel.value }));
  });
}

function initTabs() {
  const buttons = $$('.tabbtn');
  function activate(name) {
    $$('.tab').forEach(s => s.classList.toggle('active', s.id === `tab-${name}`));
    buttons.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'camera') onShowCamera(); else onHideCamera();
  }
  buttons.forEach(b => b.addEventListener('click', () => activate(b.dataset.tab)));
  document.addEventListener('gototab', (e) => activate(e.detail));
}

function initNetworkBanner() {
  const banner = $('#netBanner');
  const update = () => { banner.hidden = navigator.onLine !== false; };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function initSupportBanner() {
  const banner = $('#supportBanner');
  const problems = [];
  if (!window.isSecureContext) problems.push('目前非 HTTPS 安全連線，語音與相機功能無法使用');
  else if (!sttSupported) problems.push('此瀏覽器不支援語音辨識（「對話」功能受限），建議使用 Chrome、Edge 或 Safari');
  if (problems.length) {
    banner.textContent = `⚠️ ${problems.join('；')}`;
    banner.hidden = false;
    banner.style.cursor = 'pointer';
    banner.title = '點一下隱藏';
    banner.addEventListener('click', () => { banner.hidden = true; }, { once: true });
  }
}

function openSettings() {
  const body = el(`
    <div>
      <div class="set-row">
        <div class="set-txt">語音速度<small>朗讀翻譯結果的語速</small></div>
        <input type="range" id="setRate" min="0.5" max="1.5" step="0.1">
        <button class="btn ghost" id="setRateTry" style="min-height:36px;padding:4px 12px">試聽</button>
      </div>
      <div class="set-row">
        <div class="set-txt">對話自動朗讀<small>翻譯完成後自動唸給對方聽</small></div>
        <label class="switch"><input type="checkbox" id="setAutoSpeak"><span class="knob"></span></label>
      </div>
      <div class="set-row">
        <div class="set-txt">停頓自動翻譯<small>輸入文字停頓約 1 秒即自動翻譯</small></div>
        <label class="switch"><input type="checkbox" id="setAutoTranslate"><span class="knob"></span></label>
      </div>
      <div class="set-row">
        <div class="set-txt">台灣用語守護<small>自動把「充電寶、視頻、軟件」等用語轉為台灣慣用詞，並修正簡繁轉換</small></div>
        <label class="switch"><input type="checkbox" id="setTaiwanGuard"><span class="knob"></span></label>
      </div>
      <div class="set-row" id="setInstallRow" hidden>
        <div class="set-txt">安裝到主畫面<small>像 App 一樣使用，支援離線句庫</small></div>
        <button class="btn primary" id="setInstall" style="min-height:38px">安裝</button>
      </div>
      <div class="set-row">
        <div class="set-txt">清除翻譯歷史<small>移除「輸入」頁的最近翻譯紀錄</small></div>
        <button class="btn ghost" id="setClearHist" style="min-height:38px">清除</button>
      </div>
      <p class="about">
        一起GO 翻譯神器 v${APP_VERSION}｜為台灣人量身打造 🇹🇼<br>
        雲端翻譯由 Google／MyMemory 提供，語音辨識與朗讀由瀏覽器提供；<br>
        「句庫」完全離線可用，翻譯歷史只儲存在你的裝置上。<br>
        <a href="https://github.com/kenhuangads/yiqigo" target="_blank" rel="noopener">GitHub 原始碼</a>
      </p>
    </div>`);

  const rate = body.querySelector('#setRate');
  rate.value = settings.rate;
  rate.addEventListener('change', () => { settings.rate = parseFloat(rate.value); saveSettings(); });
  body.querySelector('#setRateTry').addEventListener('click', () => {
    settings.rate = parseFloat(rate.value); saveSettings();
    if (ttsSupported) speak('你好，很高興認識你！', 'zh-TW', settings.rate);
    else toast('此瀏覽器不支援語音朗讀', 'err');
  });

  const bindSwitch = (id, key, onChange) => {
    const input = body.querySelector(id);
    input.checked = settings[key];
    input.addEventListener('change', () => {
      settings[key] = input.checked; saveSettings(); onChange?.(input.checked);
    });
  };
  bindSwitch('#setAutoSpeak', 'autoSpeak', (on) =>
    $('#btnAutoSpeak')?.classList.toggle('on', on));
  bindSwitch('#setAutoTranslate', 'autoTranslate');
  bindSwitch('#setTaiwanGuard', 'taiwanGuard');

  if (deferredInstallPrompt) {
    body.querySelector('#setInstallRow').hidden = false;
    body.querySelector('#setInstall').addEventListener('click', async () => {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') { toast('安裝完成 🎉'); deferredInstallPrompt = null; }
    });
  }

  body.querySelector('#setClearHist').addEventListener('click', () => {
    clearTextHistory(); toast('已清除翻譯歷史');
  });

  openSheet('設定', body);
}

function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });
}

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;
  navigator.serviceWorker.register('./sw.js').catch(err =>
    console.warn('Service Worker 註冊失敗：', err));
}

// ---------- 啟動 ----------
initPairSelector();
initTabs();
initNetworkBanner();
initSupportBanner();
initInstallPrompt();
initServiceWorker();
$('#btnSettings').addEventListener('click', openSettings);

initTalk();
initCamera();
initText();
initPhoto();
initPhrases();
