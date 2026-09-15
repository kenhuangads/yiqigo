// 一起GO 翻譯神器 — 主程式
import { LANGS, FOREIGN_LANGS, APP_VERSION, AI } from './config.js';
import { settings, saveSettings, getForeign, setForeign, clearTextHistory } from './store.js';
import { $, $$, el, icon, toast, openSheet } from './ui.js';
import { testAIEngine } from './translator.js';
import { speak, voiceInfo, VOICE_SAMPLES, sttSupported, ttsSupported, isAppleMobile, isAndroid } from './speech.js';
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

// LINE／Facebook／Instagram 的內建瀏覽器常常無法朗讀、辨識語音或開相機（Android 版尤其嚴重）
function inAppBrowserName() {
  const ua = navigator.userAgent || '';
  if (/\bLine\//i.test(ua)) return 'LINE';
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  return '';
}

function initSupportBanner() {
  const banner = $('#supportBanner');
  const problems = [];
  const inApp = inAppBrowserName();
  if (inApp) problems.push(`你正在 ${inApp} 的內建瀏覽器中，語音與相機可能無法使用。請點右上角選單，改用 Safari 或 Chrome 開啟`);
  else if (!window.isSecureContext) problems.push('目前非 HTTPS 安全連線，語音與相機功能無法使用');
  else if (!ttsSupported) problems.push('此瀏覽器無法朗讀，建議改用 Safari、Chrome 或 Edge 開啟');
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
        <div class="set-txt">朗讀聲音<small>自動挑選開朗親切的聲音，避開低沉、老人、機器人音；該語言沒有所選性別時，改用最親切的聲音</small></div>
        <div class="seg" id="setVoiceGender">
          <button data-v="">自動</button>
          <button data-v="f">女聲</button>
          <button data-v="m">男聲</button>
        </div>
      </div>
      <div class="set-row set-col">
        <div class="set-txt">各語言目前的聲音<small id="setVoiceHint">點 ▶ 試聽</small></div>
        <div class="voice-list" id="setVoiceList"></div>
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
      <div class="set-sec">🤖 AI 翻譯引擎（選用・品質大幅提升）</div>
      <div class="set-row">
        <div class="set-txt">啟用 Gemini AI 翻譯<small>對話、輸入、照片、快門翻譯改走 AI 引擎，語句更通順道地；即時相機仍用快速引擎。AI 失敗時自動退回一般引擎</small></div>
        <label class="switch"><input type="checkbox" id="setAI"><span class="knob"></span></label>
      </div>
      <div class="set-row set-col">
        <div class="set-txt">Gemini API 金鑰<small>免費申請：<a href="${AI.keyUrl}" target="_blank" rel="noopener">aistudio.google.com/apikey</a>（登入 Google 帳號 → Create API key）。金鑰只儲存在你的裝置，僅用於直接呼叫 Google API</small></div>
        <div class="set-keyrow">
          <input type="password" id="setAIKey" placeholder="貼上 AIza 開頭的金鑰" autocomplete="off">
          <button class="btn ghost" id="setAITest">測試</button>
        </div>
      </div>
      <div class="set-row">
        <div class="set-txt">親友共用連結<small>把金鑰打包成連結傳給親友，點開即自動啟用 AI 翻譯。連結內含你的金鑰，只分享給信任的人</small></div>
        <button class="btn ghost" id="setAIShare" style="min-height:38px">產生連結</button>
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

  body.querySelector('#setVoiceHint').textContent = isAppleMobile
    ? '點 ▶ 試聽。iPhone 沒聲音時，請確認機身側邊的靜音開關沒有打開'
    : isAndroid
      ? '點 ▶ 試聽。Android 的男女聲與音色由手機「設定 → 文字轉語音」決定；日文、韓文需先在那裡下載語音資料'
      : '點 ▶ 試聽';
  const voiceList = body.querySelector('#setVoiceList');
  const renderVoiceList = () => {
    voiceList.innerHTML = '';
    if (!ttsSupported) {
      voiceList.appendChild(el(`<div class="muted small">此瀏覽器不支援語音朗讀</div>`));
      return;
    }
    for (const lang of Object.keys(LANGS)) {
      const info = voiceInfo(lang);
      const row = el(`
        <div class="voice-row">
          <span class="voice-lang">${LANGS[lang].flag} ${LANGS[lang].shortName}</span>
          <span class="voice-name"><span class="voice-main"></span><small class="voice-note"></small></span>
          <button class="iconbtn voice-play" aria-label="試聽${LANGS[lang].shortName}">${icon('speaker')}</button>
        </div>`);
      const wantedLabel = settings.voiceGender === 'm' ? '男聲' : '女聲';
      row.querySelector('.voice-main').textContent = info
        ? `${info.label}${info.genderLabel ? `・${info.genderLabel}` : ''}${info.natural ? '・自然語音' : ''}`
        : '裝置沒有這個語言的語音';
      row.querySelector('.voice-note').textContent = !info ? ''
        : info.phoneDecides ? '聲音由手機「文字轉語音」設定決定'
        : info.genderFallback ? `這台裝置沒有親切的${wantedLabel}，改用${info.genderLabel}`
        : '';
      row.querySelector('.voice-play').addEventListener('click', () =>
        speak(VOICE_SAMPLES[lang], lang, settings.rate));
      voiceList.appendChild(row);
    }
  };
  renderVoiceList();
  // 語音清單常在開啟設定後才載入完成（尤其 iOS／Edge），載入後重畫；面板關閉後自動解除監聽
  const onVoicesChanged = () => {
    if (!voiceList.isConnected) {
      speechSynthesis.removeEventListener?.('voiceschanged', onVoicesChanged);
      return;
    }
    renderVoiceList();
  };
  if (ttsSupported) speechSynthesis.addEventListener?.('voiceschanged', onVoicesChanged);

  const segWrap = body.querySelector('#setVoiceGender');
  const applySeg = () => segWrap.querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', (b.dataset.v || '') === (settings.voiceGender || '')));
  applySeg();
  segWrap.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.voiceGender = b.dataset.v || '';
    saveSettings();
    applySeg();
    renderVoiceList();
    if (ttsSupported) speak(VOICE_SAMPLES['zh-TW'], 'zh-TW', settings.rate);
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
  bindSwitch('#setAI', 'aiEngine', (on) => {
    if (on && !settings.geminiKey) toast('請貼上 Gemini API 金鑰後才會生效');
  });

  const keyInput = body.querySelector('#setAIKey');
  keyInput.value = settings.geminiKey || '';
  keyInput.addEventListener('change', () => {
    settings.geminiKey = keyInput.value.trim();
    saveSettings();
  });
  body.querySelector('#setAIShare').addEventListener('click', async () => {
    const aiKey = (settings.geminiKey || '').trim();
    if (!aiKey) { toast('請先貼上並測試金鑰', 'err'); return; }
    const encoded = btoa(aiKey).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // openExternalBrowser=1：LINE 會直接用 Safari／Chrome 開啟，避開無法朗讀的內建瀏覽器
    const url = `${location.origin}${location.pathname}?openExternalBrowser=1#ai=${encoded}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: '一起GO 翻譯神器', text: '點開連結即可直接使用 AI 翻譯 🤖', url });
        return;
      } catch { /* 使用者取消分享就改走複製 */ }
    }
    navigator.clipboard?.writeText(url)
      .then(() => toast('共用連結已複製，貼給親友即可 ✓'))
      .catch(() => toast('複製失敗', 'err'));
  });

  body.querySelector('#setAITest').addEventListener('click', async (e) => {
    settings.geminiKey = keyInput.value.trim();
    saveSettings();
    if (!settings.geminiKey) { toast('請先貼上金鑰', 'err'); return; }
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '測試中…';
    try {
      const r = await testAIEngine();
      settings.aiEngine = true; saveSettings();
      body.querySelector('#setAI').checked = true;
      toast(`✓ AI 引擎已啟用（${r.model}）：「${r.text.slice(0, 24)}…」`);
    } catch (err) {
      toast(`測試失敗：${err.message}`, 'err');
    }
    btn.disabled = false; btn.textContent = '測試';
  });

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

// 親友共用連結：網址 #ai=<base64url 金鑰> → 自動存入本機並啟用 AI 引擎
// 金鑰只存在 URL 片段（不會送到伺服器、不會進 GitHub），讀取後立即從網址列移除
function importSharedKey() {
  const params = new URLSearchParams(location.search);
  const hadExternalFlag = params.has('openExternalBrowser');
  params.delete('openExternalBrowser');
  const m = location.hash.match(/[#&]ai=([A-Za-z0-9\-_]+)/);
  if (m) {
    try {
      const key = atob(m[1].replace(/-/g, '+').replace(/_/g, '/')).trim();
      if (key) {
        settings.geminiKey = key;
        settings.aiEngine = true;
        saveSettings();
        setTimeout(() => toast('🤖 AI 翻譯引擎已啟用（親友共用連結）'), 600);
      }
    } catch { /* 連結格式不對就略過 */ }
  }
  // 在 LINE 等內建瀏覽器裡保留原網址：使用者改用 Safari／Chrome 開啟時金鑰才會一起帶過去
  if ((m || hadExternalFlag) && !inAppBrowserName()) {
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
  }
}

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;
  navigator.serviceWorker.register('./sw.js').catch(err =>
    console.warn('Service Worker 註冊失敗：', err));
}

// ---------- 啟動 ----------
importSharedKey();
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
