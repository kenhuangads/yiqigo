// 相機翻譯：
//   即時模式（預設）— 免按快門，畫面穩定即自動 OCR＋翻譯，譯文直接覆蓋在取景畫面上
//   快門模式 — 拍下高解析畫面細看，附原文/譯文對照清單
import { OCR_SOURCES } from './config.js';
import { settings, saveSettings, getForeign } from './store.js';
import { $, toast, progressVeil } from './ui.js';
import { toCanvas, processImage, renderVisionResult, sourceById, filterLines, drawTranslationChips } from './vision.js';
import { recognize } from './ocr.js';
import { translateText } from './translator.js';

const LIVE_MAX_DIM = 1000;  // 即時模式縮圖上限（速度優先）
const MOTION_LIMIT = 0.055; // 畫面晃動門檻（0～1，超過就等穩定再辨識）

let stream = null;
let starting = false;
let torchOn = false;
let manualSource = false;
let busy = false;       // 快門處理中
let loopActive = false; // 相機分頁顯示中（即時迴圈存活）
let liveBusy = false;   // 即時辨識進行中
let loopTimer = null;
let lastThumb = null;
let lastJoined = '';
let overlayHasContent = false;
let thumbCanvas = null;
const refs = {};

export function initCamera() {
  Object.assign(refs, {
    video: $('#camVideo'), stage: $('#camStage'), overlay: $('#camOverlay'),
    msg: $('#camMsg'), msgText: $('#camMsgText'),
    select: $('#camSource'), torch: $('#btnTorch'),
    live: $('#btnLiveMode'), status: $('#camLiveStatus'), tip: $('#camTip'),
    shutter: $('#btnShutter'), result: $('#camResult'),
    playHint: $('#camPlayHint'),
  });

  refs.select.innerHTML = OCR_SOURCES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
  syncDefaultSource();
  refs.select.addEventListener('change', () => { manualSource = true; resetLive(); });
  document.addEventListener('foreignchange', syncDefaultSource);

  refs.shutter.addEventListener('click', capture);
  refs.torch.addEventListener('click', toggleTorch);
  refs.live.addEventListener('click', () => {
    settings.camLive = !settings.camLive;
    saveSettings();
    applyLiveUI();
    resetLive();
  });
  applyLiveUI();

  $('#btnCamToPhoto').addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('gototab', { detail: 'photo' })));

  // iOS 省電模式會擋自動播放：提供「點一下啟動」的手勢後援
  refs.playHint.addEventListener('click', async () => {
    try {
      await refs.video.play();
      refs.playHint.hidden = true;
    } catch {
      toast('無法啟動相機預覽，請重新整理頁面再試', 'err');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopStream();
    } else if ($('#tab-camera').classList.contains('active') && refs.result.hidden) {
      startStream(); // 從其他 App 切回來時自動恢復取景
    }
  });
}

function syncDefaultSource() {
  if (!manualSource && OCR_SOURCES.some(s => s.id === getForeign())) refs.select.value = getForeign();
}

function applyLiveUI() {
  refs.live.classList.toggle('on', settings.camLive);
  refs.live.querySelector('span').textContent = settings.camLive ? '即時：開' : '即時：關';
  refs.tip.textContent = settings.camLive
    ? '對準文字保持穩定，自動翻成繁體中文；按快門可拍照細看'
    : '對準菜單・招牌・標示，按快門即翻成繁體中文';
  if (!settings.camLive) { clearOverlay(); setStatus(''); }
}

export function onShowCamera() {
  loopActive = true;
  scheduleLoop(400);
  if (refs.result.hidden) startStream();
}
export function onHideCamera() {
  loopActive = false;
  clearTimeout(loopTimer);
  stopStream();
}

async function startStream() {
  if (stream || starting) return; // 防止重複啟動產生沒被釋放的孤兒串流
  starting = true;
  refs.msg.hidden = true;
  refs.playHint.hidden = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) { showCamError(null); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      refs.video.srcObject = stream;
      try {
        await refs.video.play(); // iOS 需明確播放；省電模式下可能被拒
      } catch {
        refs.playHint.hidden = false;
      }
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.();
      refs.torch.hidden = !(caps && caps.torch);
      torchOn = false;
      refs.torch.classList.remove('on');
      resetLive();
    } catch (err) {
      stopStream();
      showCamError(err);
    }
  } finally {
    starting = false;
  }
}

function stopStream() {
  refs.playHint.hidden = true;
  clearOverlay();
  setStatus('');
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
  refs.video.srcObject = null;
}

async function toggleTorch() {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  try {
    torchOn = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    refs.torch.classList.toggle('on', torchOn);
  } catch { toast('此裝置不支援手電筒'); }
}

// ---------- 即時翻譯迴圈 ----------
function scheduleLoop(ms) {
  clearTimeout(loopTimer);
  if (!loopActive) return;
  loopTimer = setTimeout(liveTick, ms);
}

function setStatus(text) {
  refs.status.textContent = text;
  refs.status.hidden = !text;
}

function clearOverlay() {
  const cv = refs.overlay;
  cv.getContext('2d').setTransform(1, 0, 0, 1, 0, 0);
  cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  overlayHasContent = false;
}

function resetLive() {
  lastJoined = '';
  lastThumb = null;
  clearOverlay();
  setStatus('');
}

function measureMotion() {
  if (!thumbCanvas) {
    thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 24; thumbCanvas.height = 24;
  }
  const tctx = thumbCanvas.getContext('2d', { willReadFrequently: true });
  tctx.drawImage(refs.video, 0, 0, 24, 24);
  const d = tctx.getImageData(0, 0, 24, 24).data;
  const cur = new Uint8ClampedArray(576);
  for (let i = 0; i < 576; i++) { const j = i * 4; cur[i] = (d[j] + d[j + 1] + d[j + 2]) / 3; }
  let motion = 1;
  if (lastThumb) {
    let sum = 0;
    for (let i = 0; i < 576; i++) sum += Math.abs(cur[i] - lastThumb[i]);
    motion = sum / 576 / 255;
  }
  lastThumb = cur;
  return motion;
}

const normalize = t => t.replace(/\s+/g, '');

async function liveTick() {
  if (!loopActive) return;
  if (!settings.camLive || !stream || busy || liveBusy || document.hidden
      || !refs.result.hidden || !refs.video.videoWidth) {
    return scheduleLoop(500);
  }
  const motion = measureMotion();
  if (motion > MOTION_LIMIT) {
    clearOverlay();
    setStatus('對準文字並保持穩定…');
    lastJoined = '';
    return scheduleLoop(350);
  }
  liveBusy = true;
  try {
    const src = sourceById(refs.select.value);
    const frame = await toCanvas(refs.video, LIVE_MAX_DIM);
    const { lines } = await recognize(frame, src.ocr, src.psm, (phase, ratio) => {
      if (phase === 'load') setStatus(`下載辨識模型… ${Math.round(ratio * 100)}%`);
    });
    const good = filterLines(lines);
    if (!good.length) {
      clearOverlay();
      setStatus('未偵測到文字');
      lastJoined = '';
      return;
    }
    const joined = good.map(l => l.text).join('\n');
    if (normalize(joined) === normalize(lastJoined) && overlayHasContent) {
      setStatus('');
      return; // 畫面內容沒變，沿用現有覆蓋
    }
    const to = src.translateFrom === 'zh-TW' ? 'en' : 'zh-TW';
    const r = await translateText(joined, src.translateFrom, to, { fast: true });
    const parts = r.text.split('\n').map(s => s.trim());
    if (parts.length === good.length) {
      drawLive(good, parts, frame.width, frame.height);
    } else {
      drawBottomBand(r.text); // 行數對不齊時改以整段顯示
    }
    lastJoined = joined;
    setStatus('');
  } catch {
    setStatus(''); // 靜默重試，不打擾使用者
  } finally {
    liveBusy = false;
    scheduleLoop(900);
  }
}

// 依 object-fit: cover 的裁切關係，把 OCR 座標映射到取景畫面上
function setupOverlay() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ew = refs.stage.clientWidth, eh = refs.stage.clientHeight;
  const cv = refs.overlay;
  if (cv.width !== Math.round(ew * dpr) || cv.height !== Math.round(eh * dpr)) {
    cv.width = Math.round(ew * dpr);
    cv.height = Math.round(eh * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, ew, eh);
  return { ctx, ew, eh };
}

function drawLive(lines, parts, srcW, srcH) {
  const { ctx, ew, eh } = setupOverlay();
  const scale = Math.max(ew / srcW, eh / srcH);
  const dx = (ew - srcW * scale) / 2, dy = (eh - srcH * scale) / 2;
  const chips = [];
  for (let i = 0; i < lines.length; i++) {
    const { x0, y0, x1, y1 } = lines[i].bbox;
    chips.push({
      x: x0 * scale + dx, y: y0 * scale + dy,
      w: (x1 - x0) * scale, h: (y1 - y0) * scale,
      text: parts[i],
    });
  }
  drawTranslationChips(ctx, chips, ew);
  overlayHasContent = true;
}

function drawBottomBand(text) {
  const { ctx, ew, eh } = setupOverlay();
  const pad = 12, fs = 16, lh = 23, maxW = ew - 32 - pad * 2;
  ctx.font = `600 ${fs}px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
  const lines = [];
  let buf = '';
  for (const ch of text.replace(/\n+/g, ' ')) {
    if (ctx.measureText(buf + ch).width > maxW) {
      lines.push(buf); buf = ch;
      if (lines.length >= 3) break;
    } else buf += ch;
  }
  if (buf && lines.length < 3) lines.push(buf);
  else if (lines.length >= 3) lines[2] += '…';
  const bandH = lines.length * lh + pad * 2;
  const y = eh - bandH - 130; // 避開快門區
  ctx.fillStyle = 'rgba(13, 22, 33, 0.82)';
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(16, y, ew - 32, bandH, 12) : ctx.rect(16, y, ew - 32, bandH);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, 16 + pad, y + pad + i * lh));
  overlayHasContent = true;
}

// ---------- 快門模式 ----------
async function capture() {
  if (busy) return;
  if (!stream || !refs.video.videoWidth) { toast('相機尚未就緒', 'err'); return; }
  busy = true;
  // 等進行中的即時辨識收尾，避免與快門搶同一個 OCR worker
  for (let i = 0; i < 30 && liveBusy; i++) await new Promise(r => setTimeout(r, 100));
  const veil = progressVeil('擷取畫面…');
  try {
    const canvas = await toCanvas(refs.video);
    stopStream(); // 擷取後即關閉相機，省電也保護隱私
    const result = await processImage(canvas, refs.select.value, (s, r) => veil.set(s, r));
    if (veil.cancelled) { busy = false; startStream(); return; }
    veil.close();
    refs.stage.hidden = true;
    refs.result.hidden = false;
    renderVisionResult(refs.result, result, {
      onRetake: () => {
        refs.result.hidden = true;
        refs.result.innerHTML = '';
        refs.stage.hidden = false;
        startStream();
        scheduleLoop(600);
      },
      retakeLabel: '重新拍攝',
    });
    refs.result.scrollTop = 0;
  } catch (err) {
    veil.close();
    toast(err.message || '處理失敗，請再試一次', 'err');
    startStream();
  } finally {
    busy = false;
  }
}

function showCamError(err) {
  let text = '無法啟用相機。';
  const insecure = location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname);
  if (!navigator.mediaDevices?.getUserMedia) text = '此瀏覽器不支援相機取景，請改用「照片」上傳翻譯。';
  else if (insecure) text = '相機需要 HTTPS 安全連線才能啟用。';
  else if (err?.name === 'NotAllowedError') text = '相機權限被拒絕。請至瀏覽器的網站設定允許相機後再試。';
  else if (err?.name === 'NotFoundError') text = '找不到相機裝置。';
  else if (err) text = `無法啟用相機（${err.name || err.message}）。`;
  refs.msgText.textContent = text;
  refs.msg.hidden = false;
}
