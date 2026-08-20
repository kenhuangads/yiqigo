// 語言設定：預設四語（繁中／英／日／韓），未來擴充只需在此新增
export const APP_VERSION = '1.3.0';

export const LANGS = {
  'zh-TW': {
    code: 'zh-TW', name: '中文（台灣）', shortName: '中文', nativeName: '中文',
    flag: '🇹🇼', speech: 'zh-TW', google: 'zh-TW', mymemory: 'zh-TW', ocr: 'chi_tra',
    micLabel: '點一下・說中文',
  },
  'en': {
    code: 'en', name: '英文', shortName: '英文', nativeName: 'English',
    flag: '🇺🇸', speech: 'en-US', google: 'en', mymemory: 'en', ocr: 'eng',
    micLabel: 'Tap to speak English',
  },
  'ja': {
    code: 'ja', name: '日文', shortName: '日文', nativeName: '日本語',
    flag: '🇯🇵', speech: 'ja-JP', google: 'ja', mymemory: 'ja', ocr: 'jpn',
    micLabel: 'タップして日本語で話す',
  },
  'ko': {
    code: 'ko', name: '韓文', shortName: '韓文', nativeName: '한국어',
    flag: '🇰🇷', speech: 'ko-KR', google: 'ko', mymemory: 'ko', ocr: 'kor',
    micLabel: '눌러서 한국어로 말하기',
  },
};

export const FOREIGN_LANGS = ['en', 'ja', 'ko'];

// 相機／照片 OCR 可選的原文語言（直式日文用專屬模型）
export const OCR_SOURCES = [
  { id: 'ja',      label: '日文',        ocr: 'jpn',      translateFrom: 'ja' },
  { id: 'ja-vert', label: '日文（直式）', ocr: 'jpn_vert', translateFrom: 'ja', psm: '5' },
  { id: 'ko',      label: '韓文',        ocr: 'kor',      translateFrom: 'ko' },
  { id: 'en',      label: '英文',        ocr: 'eng',      translateFrom: 'en' },
  { id: 'zh-TW',   label: '中文',        ocr: 'chi_tra',  translateFrom: 'zh-TW' },
];

export const DETECTED_NAMES = {
  'zh-TW': '中文（台灣）', 'zh-CN': '中文（簡體）', 'zh': '中文',
  'en': '英文', 'ja': '日文', 'ko': '韓文',
  'th': '泰文', 'vi': '越南文', 'fr': '法文', 'de': '德文', 'es': '西班牙文', 'id': '印尼文',
};

export const CDN = {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  opencc: 'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js',
};

// 選用的 AI 翻譯引擎（使用者自備免費金鑰，金鑰只存在裝置上）
// model 只是預設值：模型被 Google 汰換時會自動透過 ListModels 探索可用的最新 flash 模型
export const AI = {
  model: 'gemini-3.6-flash',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
  keyUrl: 'https://aistudio.google.com/apikey',
};
