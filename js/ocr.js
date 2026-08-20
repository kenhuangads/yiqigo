// OCR 層：Tesseract.js（延遲載入，模型下載後由 Service Worker 快取供離線使用）
import { CDN } from './config.js';

let scriptPromise = null;
let worker = null;
let workerLang = null;
let progressCb = null;

function loadScript() {
  if (window.Tesseract) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CDN.tesseract;
    s.onload = resolve;
    s.onerror = () => reject(new Error('OCR 引擎載入失敗，請確認網路連線'));
    document.head.appendChild(s);
  }).catch(err => { scriptPromise = null; throw err; });
  return scriptPromise;
}

async function getWorker(ocrLang, psm) {
  await loadScript();
  if (worker && workerLang !== ocrLang) {
    await worker.terminate().catch(() => {});
    worker = null;
  }
  if (!worker) {
    worker = await window.Tesseract.createWorker(ocrLang, 1, {
      logger: (m) => {
        if (!progressCb) return;
        if (m.status === 'recognizing text') progressCb('recognize', m.progress ?? 0);
        else if (/loading|download/i.test(m.status || '')) progressCb('load', m.progress ?? 0);
      },
    });
    workerLang = ocrLang;
  }
  await worker.setParameters({
    tessedit_pageseg_mode: psm || '3',
    preserve_interword_spaces: '1',
  });
  return worker;
}

// 辨識圖片，回傳 { text, lines: [{ text, confidence, bbox }] }
export async function recognize(canvas, ocrLang, psm, onProgress) {
  progressCb = onProgress || null;
  try {
    const w = await getWorker(ocrLang, psm);
    const { data } = await w.recognize(canvas);
    const lines = (data.lines || []).map(l => ({
      text: (l.text || '').replace(/\s+$/g, ''),
      confidence: l.confidence ?? 0,
      bbox: l.bbox,
    }));
    return { text: data.text || '', lines };
  } finally {
    progressCb = null;
  }
}

export async function disposeWorker() {
  if (worker) { await worker.terminate().catch(() => {}); worker = null; workerLang = null; }
}
