// 旅遊句庫：分類瀏覽＋搜尋，點句子全螢幕展示，完全離線可用
import { LANGS } from './config.js';
import { settings, getForeign } from './store.js';
import { PHRASE_CATEGORIES } from './data/phrases.js';
import { $, el, icon, bigDisplay } from './ui.js';
import { speak } from './speech.js';

const refs = {};
let activeCat = 'all';
let query = '';

export function initPhrases() {
  Object.assign(refs, {
    search: $('#phraseSearch'), cats: $('#phraseCats'), list: $('#phraseList'),
  });
  refs.search.addEventListener('input', () => { query = refs.search.value.trim().toLowerCase(); renderList(); });
  document.addEventListener('foreignchange', renderList);
  renderCats();
  renderList();
}

function renderCats() {
  refs.cats.innerHTML = '';
  const all = el(`<button class="chip active">全部</button>`);
  all.addEventListener('click', () => selectCat('all', all));
  refs.cats.appendChild(all);
  for (const cat of PHRASE_CATEGORIES) {
    const chip = el(`<button class="chip">${cat.emoji} ${cat.name}</button>`);
    chip.addEventListener('click', () => selectCat(cat.id, chip));
    refs.cats.appendChild(chip);
  }
}

function selectCat(id, chip) {
  activeCat = id;
  refs.cats.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  renderList();
}

function renderList() {
  const foreign = getForeign();
  refs.list.innerHTML = '';
  let count = 0;
  for (const cat of PHRASE_CATEGORIES) {
    if (activeCat !== 'all' && cat.id !== activeCat) continue;
    for (const item of cat.items) {
      const fText = item[foreign];
      if (query && ![item.zh, item.en, fText].some(t => t?.toLowerCase().includes(query))) continue;
      count++;
      const card = el(`
        <button class="phrase-card" title="點一下全螢幕展示">
          <span class="p-cat">${cat.emoji}</span>
          <span class="p-txt">
            <span class="p-zh"></span>
            <span class="p-f" lang="${LANGS[foreign].speech}"></span>
          </span>
          <span class="p-play">${icon('speaker')}</span>
        </button>`);
      card.querySelector('.p-zh').textContent = item.zh;
      card.querySelector('.p-f').textContent = fText;
      card.querySelector('.p-play').addEventListener('click', (e) => {
        e.stopPropagation();
        speak(fText, foreign, settings.rate);
      });
      card.addEventListener('click', () => bigDisplay({ text: fText, lang: foreign, subText: item.zh }));
      refs.list.appendChild(card);
    }
  }
  if (!count) {
    refs.list.appendChild(el(`<div class="vr-empty">找不到符合「${query}」的句子</div>`));
  }
}
