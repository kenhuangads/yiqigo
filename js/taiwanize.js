// 台灣用語守護：解決「一簡對多繁」與中國大陸用語滲入的問題
// 1) OpenCC s2twp（簡體 → 台灣正體＋台灣慣用詞彙）
// 2) 自建台灣詞典補強（OpenCC 未涵蓋的生活用語）
import { CDN } from './config.js';

let converter = null;
let loadPromise = null;

function loadOpenCC() {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CDN.opencc;
    s.onload = () => {
      try {
        converter = window.OpenCC.Converter({ from: 'cn', to: 'twp' });
        resolve();
      } catch (e) { reject(e); }
    };
    s.onerror = () => reject(new Error('OpenCC 載入失敗'));
    document.head.appendChild(s);
  }).catch(err => { loadPromise = null; throw err; });
  return loadPromise;
}

// 自建詞典（鍵為正體字形；在 OpenCC 之後套用，補其不足）
const TW_FIX = [
  // 3C／網路
  ['充電寶', '行動電源'], ['移動電源', '行動電源'], ['數據線', '傳輸線'],
  ['智能手機', '智慧型手機'], ['人工智能', '人工智慧'],
  ['筆記本電腦', '筆記型電腦'], ['平板電腦', '平板電腦'],
  ['視頻', '影片'], ['音頻', '音訊'], ['屏幕', '螢幕'], ['觸摸屏', '觸控螢幕'],
  ['軟件', '軟體'], ['硬件', '硬體'], ['網絡', '網路'], ['寬帶', '寬頻'],
  ['鼠標', '滑鼠'], ['U盤', '隨身碟'], ['優盤', '隨身碟'], ['硬盤', '硬碟'], ['內存', '記憶體'],
  ['打印', '列印'], ['複印', '影印'], ['數碼', '數位'],
  ['鏈接', '連結'], ['郵箱', '電子信箱'], ['默認', '預設'], ['短信', '簡訊'],
  ['二維碼', 'QR Code'], ['掃碼', '掃 QR Code'],
  ['移動支付', '行動支付'], ['充值', '儲值'],
  // 交通
  ['出租車', '計程車'], ['的士', '計程車'], ['打車', '叫車'], ['打的', '搭計程車'],
  ['公交車', '公車'], ['公交', '公車'], ['自行車', '腳踏車'],
  ['摩托車', '機車'], ['電單車', '機車'], ['大巴', '巴士'],
  ['立交橋', '交流道'], ['站台', '月台'], ['站臺', '月台'], ['高峰期', '尖峰時段'],
  ['充電樁', '充電站'],
  // 住宿／生活
  ['賓館', '旅館'], ['前台', '櫃檯'], ['前臺', '櫃檯'], ['服務員', '服務生'],
  ['衛生間', '洗手間'], ['空調', '冷氣'], ['塑料', '塑膠'],
  ['圓珠筆', '原子筆'], ['創可貼', 'OK繃'], ['方便麵', '泡麵'],
  ['行李寄存', '行李寄放'], ['網吧', '網咖'],
  ['一次性筷子', '免洗筷'], ['一次性餐具', '免洗餐具'],
  ['網盤', '雲端硬碟'], ['雲盤', '雲端硬碟'],
  ['視頻通話', '視訊通話'], ['視頻會議', '視訊會議'],
  // 飲食
  ['酸奶', '優格'], ['奶酪', '起司'], ['芝士', '起司'],
  ['三文魚', '鮭魚'], ['金槍魚', '鮪魚'], ['吞拿魚', '鮪魚'],
  ['土豆', '馬鈴薯'], ['西紅柿', '番茄'], ['菠蘿', '鳳梨'], ['獼猴桃', '奇異果'],
  ['橙汁', '柳橙汁'], ['橙子', '柳橙'], ['聖女果', '小番茄'], ['車厘子', '櫻桃'],
  ['冰激凌', '冰淇淋'], ['冰激淩', '冰淇淋'],
  // 美妝／購物
  ['洗面奶', '洗面乳'], ['防曬霜', '防曬乳'], ['質量', '品質'],
  ['小票', '收據'], ['砍價', '殺價'],
  // 貨幣
  ['日元', '日圓'],
];

let fixRegex = null;
let fixMap = null;
function applyFix(text) {
  if (!fixRegex) {
    fixMap = new Map(TW_FIX);
    const keys = TW_FIX.map(([k]) => k).sort((a, b) => b.length - a.length);
    fixRegex = new RegExp(keys.join('|'), 'g');
  }
  return text.replace(fixRegex, m => fixMap.get(m) ?? m);
}

// 主函式：任何「翻譯成中文」的結果都會經過這裡
export async function taiwanize(text) {
  let out = text;
  try {
    await loadOpenCC();
    if (converter) out = converter(out);
  } catch { /* OpenCC 載入失敗時仍套用自建詞典 */ }
  return applyFix(out);
}

// 同步版本（OpenCC 尚未載入時只跑自建詞典），供句庫等即時場景使用
export function taiwanizeSync(text) {
  let out = text;
  if (converter) { try { out = converter(out); } catch {} }
  return applyFix(out);
}
