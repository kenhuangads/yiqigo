# 一起GO 翻譯神器 🇹🇼

> **真正懂台灣人的出國翻譯神器** — 即時對話・相機翻譯・輸入翻譯・照片翻譯・旅遊句庫

專為台灣旅客打造的免安裝網頁 App（PWA），預設支援 **繁體中文・英文・日文・韓文** 四種語言，內建「台灣用語守護」，翻譯結果不再出現「充電寶、視頻、軟件」這類非台灣用語。

## ✨ 五大核心功能

| 功能 | 說明 |
| --- | --- |
| 🎤 **即時對話** | 分割畫面雙向語音翻譯：你說中文、對方說外語，各自看到自己語言的字幕，翻譯完成自動朗讀給對方聽。支援「面對面模式」（上半部旋轉 180°）。 |
| 📷 **相機翻譯** | **即時模式**：免按快門，對準文字保持穩定即自動翻譯，譯文直接覆蓋在取景畫面上（AR 風格）；**快門模式**：拍下高解析畫面細看，附原文／譯文對照清單。支援直式日文。 |
| ⌨️ **輸入翻譯** | 打字停頓即自動翻譯，支援語言自動偵測、雙向交換、朗讀、複製、分享，以及「全螢幕大字展示」直接把手機拿給對方看。 |
| 🖼️ **照片翻譯** | 上傳／拖曳／貼上照片（菜單、藥妝成分表、文件截圖），整頁辨識翻譯成繁體中文。 |
| 📖 **旅遊句庫** | 7 大情境 × 58 句人工校對的四語常用句（基本、交通、點餐、購物、住宿、緊急、實用），**完全離線可用**，點一句即可全螢幕展示＋朗讀。 |

## 🛡️ 台灣在地化（本產品的靈魂）

國際翻譯模型的訓練語料九成以上是簡體中文，直接使用常出現「一簡對多繁」錯字與中國大陸用語。本專案內建雙層防護：

1. **OpenCC `s2twp`**：簡體 → 台灣正體，含詞彙級轉換（軟件→軟體、網絡→網路…）
2. **自建台灣詞典**：補強 OpenCC 未涵蓋的生活用語（充電寶→行動電源、出租車→計程車、酸奶→優格、三文魚→鮭魚…共 60+ 條，持續擴充）

所有「翻譯成中文」的結果都會經過這條管線，並在介面上顯示「台灣用語守護 ✓」徽章。

## 🚀 快速開始

線上使用（GitHub Pages 部署後）：`https://kenhuangads.github.io/yiqigo/`

本機執行（純靜態網站，任一 HTTP 伺服器皆可）：

```bash
npx http-server -p 8642 .
```

```bash
python -m http.server 8642
```

開啟 `http://localhost:8642` 即可。**語音與相機功能需要 HTTPS 或 localhost**。

## 🧱 技術架構

**零後端、預設零金鑰、零成本**，全部在瀏覽器內完成：

- **翻譯引擎（動態路由）**：預設 Google 免費端點為主、MyMemory 自動備援；可於設定啟用 **Gemini AI 引擎**（自備免費金鑰）——對話／輸入／照片走 LLM 翻譯（通順度大幅提升＋台灣用語提示詞），即時相機自動路由到快速引擎，AI 失敗時無縫退回一般引擎
- **語音辨識／朗讀**：Web Speech API（Chrome / Edge / Safari），支援 zh-TW、en-US、ja-JP、ko-KR
- **OCR**：Tesseract.js（延遲載入；`chi_tra`、`jpn`、`jpn_vert`、`kor`、`eng` 模型，下載後由 Service Worker 快取）
- **繁中在地化**：opencc-js（s2twp）＋ 自建詞典
- **PWA**：可安裝到主畫面；App 殼層、OCR 模型、重複翻譯查詢皆可離線快取
- **無建置流程**：原生 ES Modules，clone 下來就能跑

```
index.html
├── css/style.css          介面樣式（行動優先、深色模式）
├── js/
│   ├── app.js             主程式（分頁、設定、PWA）
│   ├── config.js          語言設定（新增語言只要改這裡）
│   ├── translator.js      雙引擎翻譯＋容錯
│   ├── taiwanize.js       台灣用語守護
│   ├── speech.js          語音辨識＋朗讀
│   ├── ocr.js / vision.js OCR＋影像翻譯管線（覆蓋譯文）
│   ├── conversation.js    即時對話
│   ├── camera.js / photo.js / text.js / phrasebook.js
│   └── data/phrases.js    離線句庫（四語人工校對）
├── sw.js                  Service Worker（離線快取策略）
└── manifest.webmanifest   PWA 設定
```

## 🗺️ 發展藍圖

依《[2026 產品發展計畫](docs/product-plan.md)》分四階段推進，本版為第一階段 MVP：

- ✅ **MVP（本版）**：五大功能、四語支援、台灣用語守護、PWA 離線句庫
- 🔜 **語音品質**：接入端到端即時語音 API（OpenAI Realtime / Gemini Live），延遲壓至 300ms 內並保留語氣情感；台灣國語／晶晶體辨識微調（參考 Breeze-ASR、TAIDE）
- 🔜 **離線翻譯**：整合 whisper.cpp / llama.cpp 端側推理，無網路也能完整翻譯
- 🔜 **深度解析**：藥妝成分過敏原警示（Payke 模式）、PDF／Word 文件翻譯、東南亞語系（泰、越）

競品研究與功能對應請見 [docs/RESEARCH.md](docs/RESEARCH.md)。

## 🔒 隱私

- 翻譯歷史、設定只存在你的裝置（localStorage），無任何後端伺服器
- 雲端翻譯文字送至 Google／MyMemory 處理；語音辨識由瀏覽器內建服務處理
- 句庫、介面、已快取內容完全離線運作

## 部署到 GitHub Pages

Repo 已附 GitHub Actions 工作流程（`.github/workflows/deploy-pages.yml`）。到 **Settings → Pages → Source** 選擇 **GitHub Actions**，之後每次 push 到 `main` 就會自動部署。（注意：免費方案的 private repo 無法使用 Pages，需將 repo 設為 public。）

---

Made with ❤️ for Taiwanese travelers｜授權與商用規劃請洽 repo 擁有者
