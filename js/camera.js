// 相機翻譯：即時取景 → 快門擷取 → OCR → 翻譯 → 原圖覆蓋譯文
import { OCR_SOURCES } from './config.js';
import { getForeign } from './store.js';
import { $, toast, progressVeil } from './ui.js';
import { toCanvas, processImage, renderVisionResult } from './vision.js';

let stream = null;
let torchOn = false;
let manualSource = false;
let busy = false;
const refs = {};

export function initCamera() {
  Object.assign(refs, {
    video: $('#camVideo'), stage: $('#camStage'),
    msg: $('#camMsg'), msgText: $('#camMsgText'),
    select: $('#camSource'), torch: $('#btnTorch'),
    shutter: $('#btnShutter'), result: $('#camResult'),
  });

  refs.select.innerHTML = OCR_SOURCES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
  syncDefaultSource();
  refs.select.addEventListener('change', () => { manualSource = true; });
  document.addEventListener('foreignchange', syncDefaultSource);

  refs.shutter.addEventListener('click', capture);
  refs.torch.addEventListener('click', toggleTorch);
  $('#btnCamToPhoto').addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('gototab', { detail: 'photo' })));

  document.addEventListener('visibilitychange', () => { if (document.hidden) stopStream(); });
}

function syncDefaultSource() {
  if (!manualSource && OCR_SOURCES.some(s => s.id === getForeign())) refs.select.value = getForeign();
}

export function onShowCamera() {
  if (refs.result.hidden) startStream();
}
export function onHideCamera() {
  stopStream();
}

async function startStream() {
  if (stream) return;
  refs.msg.hidden = true;
  if (!navigator.mediaDevices?.getUserMedia) { showCamError(null); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    refs.video.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.();
    refs.torch.hidden = !(caps && caps.torch);
    torchOn = false;
    refs.torch.classList.remove('on');
  } catch (err) {
    stream = null;
    showCamError(err);
  }
}

function stopStream() {
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

async function capture() {
  if (busy) return;
  if (!stream || !refs.video.videoWidth) { toast('相機尚未就緒', 'err'); return; }
  busy = true;
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
