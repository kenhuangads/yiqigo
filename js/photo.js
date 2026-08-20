// 照片翻譯：選檔／拖曳／貼上 → OCR → 翻譯 → 覆蓋譯文＋對照清單
import { OCR_SOURCES } from './config.js';
import { getForeign } from './store.js';
import { $, toast, progressVeil } from './ui.js';
import { toCanvas, processImage, renderVisionResult } from './vision.js';

const refs = {};
let manualSource = false;
let busy = false;

export function initPhoto() {
  Object.assign(refs, {
    drop: $('#photoDrop'), input: $('#photoInput'), pick: $('#btnPhotoPick'),
    select: $('#photoSource'), result: $('#photoResult'),
  });

  refs.select.innerHTML = OCR_SOURCES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
  syncDefaultSource();
  refs.select.addEventListener('change', () => { manualSource = true; });
  document.addEventListener('foreignchange', syncDefaultSource);

  refs.pick.addEventListener('click', () => refs.input.click());
  refs.drop.addEventListener('click', (e) => {
    if (e.target === refs.pick || refs.select.contains(e.target) || e.target.tagName === 'LABEL') return;
    refs.input.click();
  });
  refs.input.addEventListener('change', () => {
    const file = refs.input.files?.[0];
    refs.input.value = '';
    if (file) handleFile(file);
  });

  ['dragover', 'dragenter'].forEach(ev => refs.drop.addEventListener(ev, (e) => {
    e.preventDefault(); refs.drop.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(ev => refs.drop.addEventListener(ev, (e) => {
    e.preventDefault(); refs.drop.classList.remove('dragover');
  }));
  refs.drop.addEventListener('drop', (e) => {
    const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
    if (file) handleFile(file);
    else toast('請放入圖片檔案', 'err');
  });

  document.addEventListener('paste', (e) => {
    if (!$('#tab-photo').classList.contains('active')) return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); handleFile(item.getAsFile()); }
  });
}

function syncDefaultSource() {
  if (!manualSource && OCR_SOURCES.some(s => s.id === getForeign())) refs.select.value = getForeign();
}

async function handleFile(file) {
  if (!file || busy) return;
  busy = true;
  const veil = progressVeil('讀取圖片…');
  try {
    const canvas = await toCanvas(file);
    const result = await processImage(canvas, refs.select.value, (s, r) => veil.set(s, r));
    if (veil.cancelled) { busy = false; return; }
    veil.close();
    refs.drop.hidden = true;
    refs.result.hidden = false;
    renderVisionResult(refs.result, result, {
      onRetake: () => {
        refs.result.hidden = true;
        refs.result.innerHTML = '';
        refs.drop.hidden = false;
      },
      retakeLabel: '換一張照片',
    });
  } catch (err) {
    veil.close();
    toast(err?.message?.includes('createImageBitmap') || err?.name === 'InvalidStateError'
      ? '不支援的圖片格式（HEIC 請先轉成 JPG）' : (err.message || '處理失敗'), 'err');
  } finally {
    busy = false;
  }
}
