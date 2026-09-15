// 語音挑選模擬器：把各平台實際的 speechSynthesis.getVoices() 清單（tools/voice-fixtures.json）
// 餵給 js/speech.js 的 pickVoice()，列出每個平台 × 語言 × 性別會挑到哪個聲音，並自動檢查：
//   1. 同語言只要有正常聲音，就不能挑到機器人／低沉／老人／搞怪語音
//   2. 同語言有親切的所選性別聲音時，必須挑那個性別
//   3. 音高在 1.00–1.15 之間
// 用法：node tools/voice-sim.mjs        （列表＋檢查，失敗時結束代碼為 1）
//       node tools/voice-sim.mjs --json （輸出 JSON）
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, 'voice-fixtures.json'), 'utf8'));

let current = [];
const voicesChanged = [];
globalThis.window = globalThis;
globalThis.addEventListener ??= () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true, userAgent: 'node', maxTouchPoints: 0 }, configurable: true,
});
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.speechSynthesis = {
  getVoices: () => current,
  addEventListener(type, fn) { if (type === 'voiceschanged') voicesChanged.push(fn); },
  removeEventListener() {},
  cancel() {}, speak() {}, speaking: false, pending: false,
};

const speech = await import(pathToFileURL(join(here, '..', 'js', 'speech.js')).href);
const { settings } = await import(pathToFileURL(join(here, '..', 'js', 'store.js')).href);

const LANG_KEYS = ['zh-TW', 'en', 'ja', 'ko'];
const GENDERS = [['', '自動'], ['f', '女聲'], ['m', '男聲']];
const report = [];
const failures = [];

for (const fx of fixtures.platforms) {
  current = fx.voices.map(v => ({ default: false, voiceURI: v.name, ...v }));
  voicesChanged.forEach(fn => fn());
  const rows = [];
  for (const lang of LANG_KEYS) {
    // 逐一分類這個語言可用的每個聲音（單一聲音清單丟進 pickVoice 取得它的性別與避用等級）
    const pool = current
      .map(v => ({ v, info: speech.pickVoice(lang, { list: [v], gender: '' }) }))
      .filter(x => x.info);
    // 「正常聲音」＝沒被避用、且語言吻合（台灣中文不算中國／香港口音；英文各地區都算）
    const clean = pool.filter(x => !x.info.severity && x.info.score >= 900);
    // 只剩機器人音時可接受的替代：同語言非粵語的正常聲音（例如用普通話的婷婷代替台灣 Eloquence）
    const isCantonese = v => /(^|[-_])(hk|mo)\b|^yue/i.test(v.lang);
    const acceptable = pool.filter(x => !x.info.severity && !isCantonese(x.v));
    const exactRobotic = pool.filter(x => x.info.severity === 'robotic' && x.info.score >= 900 - 700);
    for (const [g, gLabel] of GENDERS) {
      settings.voiceGender = g;
      const pick = speech.pickVoice(lang);
      const offline = speech.pickVoice(lang, { localOnly: true });
      const row = {
        lang, gender: gLabel,
        voice: pick ? pick.voice.name : null,
        voiceLang: pick ? pick.voice.lang : null,
        detectedGender: pick?.gender || '',
        avoided: pick?.severity || null,
        pitch: pick ? Number(pick.pitch.toFixed(3)) : null,
        offlineVoice: offline ? offline.voice.name : null,
      };
      rows.push(row);
      const where = `${fx.platform}｜${lang}｜${gLabel}`;
      if (!pick && pool.length) failures.push(`${where}：有 ${pool.length} 個可用聲音卻沒挑到任何一個`);
      if (pick && pick.severity && (clean.length || acceptable.length)) {
        failures.push(`${where}：挑到避用語音 ${pick.voice.name}（${pick.severity}），但有正常聲音可用`);
      }
      if (pick && ['deep', 'elderly', 'novelty'].includes(pick.severity) && exactRobotic.length) {
        failures.push(`${where}：挑到 ${pick.voice.name}（${pick.severity}），但有較不嚇人的機器人音可用`);
      }
      if (pick && isCantonese(pick.voice) && pool.some(x => !isCantonese(x.v))) {
        failures.push(`${where}：挑到粵語語音 ${pick.voice.name}，但有國語／其他語音可用`);
      }
      if (pick && g && clean.some(x => x.info.gender === g) && pick.gender !== g) {
        failures.push(`${where}：有親切的${gLabel}可用，卻挑到 ${pick.voice.name}`);
      }
      if (pick && (pick.pitch < 1 || pick.pitch > 1.15)) {
        failures.push(`${where}：音高 ${pick.pitch} 超出 1.00–1.15`);
      }
    }
  }
  report.push({ platform: fx.platform, rows });
}
settings.voiceGender = '';

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ report, failures }, null, 1));
} else {
  for (const p of report) {
    console.log(`\n=== ${p.platform} ===`);
    for (const r of p.rows) {
      const flag = r.avoided ? `  ⚠ ${r.avoided}` : '';
      const off = r.offlineVoice && r.offlineVoice !== r.voice ? `  （離線改用 ${r.offlineVoice}）` : '';
      console.log(`${r.lang.padEnd(5)} ${r.gender}  →  ${r.voice ?? '（無）'} [${r.voiceLang ?? '-'}] ${r.detectedGender || '?'} pitch ${r.pitch ?? '-'}${flag}${off}`);
    }
  }
  console.log(failures.length ? `\n✗ ${failures.length} 項檢查失敗：\n- ${failures.join('\n- ')}` : '\n✓ 全部檢查通過');
}
process.exitCode = failures.length ? 1 : 0;
