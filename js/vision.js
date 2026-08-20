// 影像翻譯管線（相機＆照片共用）：
// 縮放 → OCR → 整段合併翻譯 → 原圖上覆蓋譯文（AR 風格）＋ 原文/譯文對照清單
import { OCR_SOURCES } from './config.js';
import { recognize } from './ocr.js';
import { translateText, geminiVision } from './translator.js';
import { taiwanize } from './taiwanize.js';
import { settings } from './store.js';
import { el, icon, toast, copyText, bigDisplay } from './ui.js';
import { speak, stopSpeaking } from './speech.js';

const MAX_DIM = 1600;

export function sourceById(id) {
  return OCR_SOURCES.find(s => s.id === id) || OCR_SOURCES[0];
}

// 圖片解碼：明確套用 EXIF 方向（手機直拍照片若被當橫圖辨識會全滅），多層備援
async function decodeImage(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch {}
  try { return await createImageBitmap(blob); } catch {}
  // 最後手段：<img>（現代瀏覽器繪製時會自動套用 EXIF 方向）
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('圖片解碼失敗（HEIC 請先轉成 JPG）')); };
    img.src = url;
  });
}

// 各種輸入（video、img、blob）統一轉為 canvas 並限制最大邊長
export async function toCanvas(source, maxDim = MAX_DIM) {
  let bmp = source;
  if (source instanceof Blob) bmp = await decodeImage(source);
  const sw = bmp.videoWidth || bmp.naturalWidth || bmp.width;
  const sh = bmp.videoHeight || bmp.naturalHeight || bmp.height;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// OCR 前處理：灰階＋2%/98% 對比拉伸；深色背景（招牌類）自動反轉成黑字白底
// 回傳 { canvas, mean }，mean 為原圖平均亮度（可用來提示開手電筒）
export function preprocessForOCR(canvas) {
  const w = canvas.width, h = canvas.height, n = w * h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8ClampedArray(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const g = (d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114) | 0;
    gray[i] = g; sum += g;
  }
  const mean = sum / n;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]]++;
  // 0.4% 絕對裁切求亮度範圍；區間過窄（大面積留白＋少量文字的退化情況）就不拉伸
  const clip = Math.max(32, n * 0.004);
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= clip) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= clip) { hi = v; break; } }
  if (hi - lo < 30) { lo = 0; hi = 255; } // 原圖對比已足夠或分布退化 → 原樣通過
  const range = Math.max(1, hi - lo);
  const invert = mean < 90;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const oimg = octx.createImageData(w, h);
  const od = oimg.data;
  for (let i = 0; i < n; i++) {
    let v = (gray[i] - lo) * 255 / range;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    if (invert) v = 255 - v;
    const j = i * 4;
    od[j] = od[j + 1] = od[j + 2] = v;
    od[j + 3] = 255;
  }
  octx.putImageData(oimg, 0, 0);
  return { canvas: out, mean };
}

const CJK_SPACE = (() => {
  try { return new RegExp('(?<=[\\u2E80-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF])[ \\t]+(?=[\\u2E80-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF])', 'g'); }
  catch { return null; }
})();
function cleanLine(text) {
  let t = text.replace(/[ \t]+/g, ' ').trim();
  if (CJK_SPACE) t = t.replace(CJK_SPACE, ''); // Tesseract 常在 CJK 字元間插入空白
  return t;
}
function isNoise(text) {
  if (!text) return true;
  try { return /^[^\p{L}\p{N}]+$/u.test(text); } catch { return false; }
}

function letterCount(text) {
  try { return (text.match(/[\p{L}\p{N}]/gu) || []).length; }
  catch { return text.length; }
}

// 清洗 OCR 線段：去雜訊、去 CJK 間空白、過濾低信心與符號比例過高的行（快門與即時模式共用）
export function filterLines(rawLines) {
  return rawLines
    .map(l => ({ ...l, text: cleanLine(l.text) }))
    .filter(l => {
      if (isNoise(l.text) || l.confidence < 45) return false;
      const letters = letterCount(l.text);
      if (letters === 0) return false;
      if (letters <= 1 && l.confidence < 70) return false; // 單一字元又低信心＝多半是雜訊
      const dense = l.text.replace(/\s/g, '').length;
      if (dense > 0 && letters / dense < 0.5) return false; // 過半是符號的行捨棄
      return true;
    });
}

// 主管線
// 路徑一（啟用 AI 引擎時優先）：Gemini 視覺模型單次完成 OCR＋翻譯（含位置座標），品質最佳
// 路徑二（備援）：影像前處理 → Tesseract OCR → 快速引擎翻譯
export async function processImage(canvas, sourceId, onProgress) {
  const src = sourceById(sourceId);
  const targetLang = src.translateFrom === 'zh-TW' ? null : 'zh-TW'; // 中文原文時由使用者另選方向
  const to = targetLang || 'en';

  if (settings.aiEngine && (settings.geminiKey || '').trim()) {
    try {
      onProgress?.('AI 視覺辨識翻譯中…', 0.3);
      const { items } = await geminiVision(canvas, src.label, to);
      onProgress?.('整理結果…', 0.85);
      const pairs = [];
      let guarded = false;
      for (const it of items) {
        let dst = it.dst;
        if (to === 'zh-TW' && settings.taiwanGuard && dst) {
          const g = await taiwanize(dst);
          if (g !== dst) guarded = true;
          dst = g;
        }
        pairs.push({ src: it.src, dst, bbox: it.bbox });
      }
      const withBox = pairs.some(p => p.bbox && p.dst);
      return {
        canvas: withBox ? drawOverlay(canvas, pairs) : canvas,
        pairs,
        fullSrc: pairs.map(p => p.src).filter(Boolean).join('\n'),
        fullDst: pairs.map(p => p.dst).filter(Boolean).join('\n'),
        provider: 'Gemini AI 視覺',
        guarded, src, aligned: withBox, empty: false,
      };
    } catch {
      onProgress?.('AI 視覺不可用，改用一般辨識…', 0.1);
    }
  }

  onProgress?.('影像前處理…', 0.03);
  const pre = preprocessForOCR(canvas);
  const { lines: rawLines } = await recognize(pre.canvas, src.ocr, src.psm, (phase, ratio) => {
    if (phase === 'load') onProgress?.('下載／載入辨識模型…', ratio * 0.35);
    else onProgress?.('辨識文字中…', 0.35 + ratio * 0.4);
  });

  const lines = filterLines(rawLines);

  if (!lines.length) {
    return { canvas, pairs: [], fullSrc: '', fullDst: '', src, empty: true };
  }

  onProgress?.('翻譯中…', 0.8);
  const joined = lines.map(l => l.text).join('\n');
  // 走到這裡代表 AI 視覺不可用，翻譯直接用快速引擎，不再重試 AI
  const result = await translateText(joined, src.translateFrom, to, { fast: true });
  let parts = result.text.split('\n').map(s => s.trim());
  const aligned = parts.length === lines.length;

  const pairs = aligned
    ? lines.map((l, i) => ({ src: l.text, dst: parts[i], bbox: l.bbox }))
    : [{ src: joined, dst: result.text, bbox: null }];

  onProgress?.('繪製結果…', 0.95);
  const annotated = aligned ? drawOverlay(canvas, pairs) : canvas;

  return {
    canvas: annotated,
    pairs,
    fullSrc: joined,
    fullDst: aligned ? parts.join('\n') : result.text,
    provider: result.provider,
    guarded: result.guarded,
    src,
    aligned,
    empty: false,
  };
}

// 譯文圖塊繪製（快門覆蓋圖與即時模式共用）
// chips: [{ x, y, w, h, text }]，座標以目前 ctx 的座標系為準
export function drawTranslationChips(ctx, chips, boundW) {
  ctx.textBaseline = 'middle';
  const setFont = (size) => {
    ctx.font = `600 ${size}px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
  };
  for (const c of chips) {
    if (!c.text || c.w < 8 || c.h < 8) continue;
    let fontSize = Math.min(Math.max(c.h * 0.72, 11), 64);
    setFont(fontSize);
    let tw = ctx.measureText(c.text).width;
    const maxW = Math.max(c.w * 1.15, 60);
    while (tw > maxW && fontSize > 10) {
      fontSize -= 1;
      setFont(fontSize);
      tw = ctx.measureText(c.text).width;
    }
    const padX = fontSize * 0.35, boxH = Math.max(c.h, fontSize * 1.3);
    const boxW = Math.min(tw + padX * 2, boundW - c.x);
    const ry = c.y + (c.h - boxH) / 2;
    ctx.fillStyle = 'rgba(13, 22, 33, 0.78)';
    roundRect(ctx, c.x, ry, boxW, boxH, Math.min(8, boxH / 3));
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(c.text, c.x + padX, ry + boxH / 2 + fontSize * 0.04, boxW - padX * 2);
  }
}

// 在原圖上覆蓋譯文（半透明底＋自動縮放字級）
function drawOverlay(canvas, pairs) {
  const out = document.createElement('canvas');
  out.width = canvas.width; out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const chips = pairs
    .filter(p => p.bbox && p.dst)
    .map(p => ({ x: p.bbox.x0, y: p.bbox.y0, w: p.bbox.x1 - p.bbox.x0, h: p.bbox.y1 - p.bbox.y0, text: p.dst }));
  drawTranslationChips(ctx, chips, out.width);
  return out;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 結果畫面（相機＆照片共用）
export function renderVisionResult(container, result, { onRetake, retakeLabel = '重新拍攝' } = {}) {
  container.innerHTML = '';
  stopSpeaking();

  if (result.empty) {
    container.appendChild(el(`
      <div class="vr-empty">
        <p style="font-size:2rem">🔍</p>
        <p><strong>沒有辨識到文字</strong></p>
        <p class="small">請靠近一點、對焦清楚、光線充足，再試一次。<br>直式日文請將原文語言切換為「日文（直式）」。</p>
      </div>`));
    if (onRetake) {
      const btn = el(`<button class="btn primary" style="width:100%;margin-top:12px">${icon('retake')} ${retakeLabel}</button>`);
      btn.addEventListener('click', onRetake);
      container.appendChild(btn);
    }
    return;
  }

  const wrap = el(`<div class="vr-canvaswrap"></div>`);
  result.canvas.style.width = '100%';
  wrap.appendChild(result.canvas);
  container.appendChild(wrap);

  const actions = el(`<div class="vr-actions"></div>`);
  if (onRetake) {
    const b = el(`<button class="btn ghost">${icon('retake')} ${retakeLabel}</button>`);
    b.addEventListener('click', onRetake);
    actions.appendChild(b);
  }
  const bSpeak = el(`<button class="btn ghost">${icon('speaker')} 朗讀譯文</button>`);
  bSpeak.addEventListener('click', () => speak(result.fullDst, result.src.translateFrom === 'zh-TW' ? 'en' : 'zh-TW', settings.rate));
  const bCopy = el(`<button class="btn ghost">${icon('copy')} 複製譯文</button>`);
  bCopy.addEventListener('click', () => copyText(result.fullDst));
  const bBig = el(`<button class="btn ghost">${icon('expand')} 大字展示</button>`);
  bBig.addEventListener('click', () => bigDisplay({
    text: result.fullDst,
    lang: result.src.translateFrom === 'zh-TW' ? 'en' : 'zh-TW',
  }));
  actions.append(bSpeak, bCopy, bBig);
  container.appendChild(actions);

  const list = el(`<div class="vr-pairs"></div>`);
  for (const p of result.pairs) {
    const item = el(`<button class="vr-pair" title="點一下大字展示"></button>`);
    item.appendChild(el(`<div class="src"></div>`)).textContent = p.src;
    item.appendChild(el(`<div class="dst"></div>`)).textContent = p.dst;
    item.addEventListener('click', () => bigDisplay({
      text: p.dst, lang: result.src.translateFrom === 'zh-TW' ? 'en' : 'zh-TW',
      subText: p.src,
    }));
    list.appendChild(item);
  }
  container.appendChild(list);

  const noteBits = [];
  if (result.provider) noteBits.push(`翻譯來源：${result.provider}`);
  if (result.guarded) noteBits.push('已套用台灣用語守護 ✓');
  if (!result.aligned) noteBits.push('版面較複雜，已改用整段對照顯示');
  if (noteBits.length) {
    container.appendChild(el(`<p class="muted small vr-note">${noteBits.join('　·　')}</p>`));
  }
}
