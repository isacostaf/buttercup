import { db, auth, cloud, requestPersistence } from './db.js';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

const state = {
  recipes: [],
  filter: null,       // label selecionada ('__fav' = favoritas)
  query: '',          // busca
  checks: new Map(),  // marcações temporárias (ingredientes/passos) por receita
  scale: new Map(),   // porção escolhida por receita (0.5 = metade)
  diaryOpen: new Set(), // receitas com a aba Diary aberta
  writing: null,      // id da receita com o formulário do diary aberto
};

/* ---------- ícones (traço fino, como na referência) ---------- */
const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  chevron: svg('<path d="M9 18l6-6-6-6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>'),
  heartFill: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" fill="currentColor"/>'),
  basket: svg('<path d="M4 10h16l-1.5 9a1 1 0 01-1 .8h-11a1 1 0 01-1-.8z"/><path d="M8 10l3-6M16 10l-3-6M9 14v3M15 14v3"/>'),
  steps: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>'),
  tag: svg('<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  x: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
  star: svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="currentColor"/>', 'stroke-width="1.5"'),
  link: svg('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>'),
  external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>'),
  asterisk: svg('<path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3L5.3 18.7"/>', 'stroke-width="2.6"'),
  book: svg('<path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M5 17a3 3 0 013-3h11M9 8h6"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
};

const DOT = '<i class="dot"></i>';
const OWNER_NAME = 'Marta';

// Fundo do topo da tela inicial: foto escolhida pela pessoa (guardada só neste aparelho).
// A foto é reduzida para ~720px antes de salvar (umas dezenas de KB) e o desfoque é feito no CSS.
const BG_KEY = 'buttercup-header-bg';
const getHeaderBg = () => { try { return localStorage.getItem(BG_KEY); } catch { return null; } };
const setHeaderBg = (v) => {
  try { v ? localStorage.setItem(BG_KEY, v) : localStorage.removeItem(BG_KEY); return true; } catch { return false; }
}; // nome da saudação na tela inicial

const FOOD = ['🍲', '🥗', '🍰', '🍝', '🥘', '🍳', '🥞', '🍪'];

/* ---------- utilitários ---------- */
const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const uid = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

function hash(text) {
  let h = 2166136261; // FNV-1a
  for (const ch of text.toLowerCase()) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
const hue = (text) => hash(text) % 6; // 6 cores pastel no CSS (.tone-0 … .tone-5)
const foodEmoji = (text) => FOOD[hash(text) % FOOD.length];

const tagHTML = (label) => `<span class="tag tone-${hue(label)}">${esc(label)}</span>`;
const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Fonte: transforma endereços de site em links clicáveis (abrem fora do app)
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|com\.br|br|net|org|io|app|blog|co|info|me|tv)(?:\/[^\s<>"']*)?)/gi;
function linkify(text) {
  let out = '', last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0].replace(/[.,;:!?)\]]+$/, '');
    const href = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    let shown = raw;
    try { const u = new URL(href); shown = u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? '/…' : ''); } catch { continue; }
    out += esc(text.slice(last, m.index));
    out += `<a class="source__link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(shown)}${ICON.external}</a>`;
    last = m.index + raw.length;
  }
  return out + esc(text.slice(last));
}

const plural = (n, one, many) => `<strong>${n}</strong>${n === 1 ? one : many}`;

// Seções ("Massa", "Recheio"…) ficam na própria lista como itens que começam com "# "
const SECTION = '# ';
const isSection = (t) => typeof t === 'string' && (t.startsWith(SECTION) || /^— .+ —$/.test(t));
const sectionName = (t) => t.startsWith(SECTION) ? t.slice(SECTION.length).trim() : t.replace(/^— | —$/g, '').trim();
const countItems = (arr) => arr.filter((t) => !isSection(t)).length;

const madeCount = (r) => (r.diary || []).length;
const avgStars = (r) => {
  const d = r.diary || [];
  return d.length ? d.reduce((a, e) => a + e.stars, 0) / d.length : 0;
};
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const starsHTML = (n) =>
  `<span class="stars" aria-label="${n} de 5 estrelas">${[1, 2, 3, 4, 5].map((i) => `<span class="${i <= n ? 'on' : ''}">${ICON.star}</span>`).join('')}</span>`;

function allLabels() {
  const map = new Map();
  for (const r of state.recipes) for (const l of r.labels) map.set(l.toLowerCase(), l);
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function go(path, replace = false) {
  if (replace) location.replace('#' + path);
  else location.hash = path;
}

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('is-on'), 2200);
}

/* ---------- imagens: reduz a foto antes de salvar ---------- */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida')); };
    img.src = url;
  });
}

function resize(img, max, quality) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', quality);
}

async function processPhoto(file) {
  const img = await loadImage(file);
  return { photo: resize(img, 1400, 0.82), thumb: resize(img, 280, 0.8) };
}

/* ---------- porções: multiplica as quantidades dos ingredientes ---------- */
const PORTIONS = [
  { v: 0.25, label: '¼' }, { v: 1 / 3, label: '⅓' }, { v: 0.5, label: '½' },
  { v: 1, label: '1×' }, { v: 2, label: '2×' }, { v: 3, label: '3×' },
];
const UNI = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const FRACS = [[0, ''], [0.125, '⅛'], [1 / 6, '⅙'], [0.25, '¼'], [0.375, '⅜'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾'], [1, '']];
// "1 1/2", "1½", "1/2", "½", "1,5", "0.5", "3"
const QTY = /(\d+\s+\d+\/\d+|\d+\s*[¼½¾⅓⅔⅛]|\d+\/\d+|[¼½¾⅓⅔⅛]|\d+(?:[.,]\d+)?)/g;

function parseQty(t) {
  t = t.trim();
  let m;
  if ((m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
  if ((m = t.match(/^(\d+)\s*([¼½¾⅓⅔⅛])$/))) return +m[1] + UNI[m[2]];
  if ((m = t.match(/^(\d+)\/(\d+)$/))) return m[2] === '0' ? NaN : m[1] / m[2];
  if (UNI[t] != null) return UNI[t];
  return parseFloat(t.replace(',', '.'));
}

function formatQty(v) {
  if (v >= 20) return String(Math.round(v));
  if (v >= 10) return String(Math.round(v * 10) / 10).replace('.', ',');
  const whole = Math.floor(v);
  const frac = v - whole;
  let best = FRACS[0];
  for (const f of FRACS) if (Math.abs(frac - f[0]) < Math.abs(frac - best[0])) best = f;
  if (Math.abs(frac - best[0]) <= 0.04) {
    const w = whole + (best[0] === 1 ? 1 : 0);
    if (!best[1]) return String(w);
    return w ? `${w}${best[1]}` : best[1];
  }
  return String(Math.round(v * 100) / 100).replace('.', ',');
}

// devolve HTML do ingrediente com as quantidades multiplicadas (destacadas)
// quantidades sempre em negrito (com a unidade colada: "85g", "100 ml");
// texto entre parênteses fica mais discreto
const UNIT = /^\s?(?:kg|g|mg|ml|l|cl|oz|lb)\b/i;
function scaleText(text, k) {
  let out = '', last = 0;
  for (const m of text.matchAll(QTY)) {
    const v = parseQty(m[0]);
    if (!Number.isFinite(v)) continue;
    const unit = text.slice(m.index + m[0].length).match(UNIT)?.[0] || '';
    out += esc(text.slice(last, m.index));
    out += `<b class="qty${k !== 1 ? ' qty--scaled' : ''}">${k === 1 ? esc(m[0]) : formatQty(v * k)}${esc(unit)}</b>`;
    last = m.index + m[0].length + unit.length;
  }
  out += esc(text.slice(last));
  return out.replace(/\(([^()]*)\)/g, '<span class="aside">($1)</span>');
}

/* ---------- roteamento (hash, sem recarregar = continua em tela cheia) ---------- */
function route() {
  const [, a, b] = (location.hash.slice(1) || '/').split('/');
  if (a === 'r' && b) renderDetail(b);
  else if (a === 'nova') renderForm(null);
  else if (a === 'editar' && b) renderForm(b);
  else renderHome();
  document.body.dataset.page = a === 'r' ? 'detail' : a || 'home';
  window.scrollTo(0, 0);
}

/* ================================================================
   TELA INICIAL
   ================================================================ */
function renderHome() {
  const labels = allLabels();
  const hasFav = state.recipes.some((r) => r.favorite);
  if (state.filter === '__fav' && !hasFav) state.filter = null;
  if (state.filter && state.filter !== '__fav' && !labels.some((l) => l.toLowerCase() === state.filter.toLowerCase())) state.filter = null;

  const chip = (value, text, extra = '') =>
    `<button class="chip ${(state.filter || '') === value ? 'is-active' : ''}" data-filter="${esc(value)}">${extra}${esc(text)}</button>`;

  $app.innerHTML = `
    <header class="home-hero ${getHeaderBg() ? 'home-hero--photo' : ''}">
      ${getHeaderBg() ? `<div class="home-hero__bg" style="background-image:url('${getHeaderBg()}')"></div>` : ''}
      <div class="wrap">
        <div class="home-hero__top">
          <span class="home-hero__mark" aria-hidden="true">${ICON.asterisk}</span>
          ${state.recipes.length ? `<button class="glass-btn" id="search-toggle" aria-label="Buscar receita">${ICON.search}</button>` : ''}
        </div>
        <h1 class="home-hero__title">Hi, ${esc(OWNER_NAME)}</h1>
        <p class="home-hero__sub">Welcome to your cookbook</p>
        ${state.recipes.length ? `
          <label class="search search--glass" id="search-box" ${state.query ? '' : 'hidden'}>
            ${ICON.search}
            <input type="search" id="search" placeholder="Buscar receita" value="${esc(state.query)}" enterkeyhint="search" autocomplete="off">
          </label>` : ''}
      </div>
      ${state.recipes.length ? `
        <nav class="filters filters--glass" aria-label="Filtrar por label">
          ${chip('', 'Todas')}
          ${hasFav ? chip('__fav', 'Favoritas', ICON.heartFill) : ''}
          ${labels.map((l) => chip(l, l)).join('')}
        </nav>` : ''}
    </header>

    <div class="wrap" id="list-area"></div>

    <footer class="home-footer">
      <label class="bg-btn">
        <input type="file" accept="image/*" class="sr-only" id="bg-input">
        ${ICON.camera}Trocar fundo
      </label>
      ${getHeaderBg() ? `<button class="bg-reset" id="bg-reset">Voltar ao azul</button>` : ''}
      ${cloud && state.user ? `<p class="account">Conectada como ${esc(state.user)} · <button class="account__out" id="logout">Sair</button></p>` : ''}
    </footer>

    <button class="fab" id="fab" aria-label="Adicionar receita">${ICON.plus}</button>
  `;

  drawList();
  $app.querySelector('#bg-input').onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const img = await loadImage(file);
      if (!setHeaderBg(resize(img, 720, 0.72))) return toast('Não consegui salvar o fundo 😕');
      renderHome();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('Fundo trocado ✓');
    } catch {
      toast('Não consegui abrir essa foto 😕');
    }
  };
  const bgReset = $app.querySelector('#bg-reset');
  if (bgReset) bgReset.onclick = () => { setHeaderBg(null); renderHome(); toast('Fundo azul de volta'); };

  const logout = $app.querySelector('#logout');
  if (logout) logout.onclick = async () => {
    if (!confirm('Sair da sua conta neste aparelho?')) return;
    await auth.signOut();
    location.reload();
  };

  $app.querySelector('#fab').onclick = () => go('/nova');
  const searchToggle = $app.querySelector('#search-toggle');
  if (searchToggle) searchToggle.onclick = () => {
    const box = $app.querySelector('#search-box');
    box.hidden = !box.hidden;
    if (!box.hidden) box.querySelector('input').focus();
    else if (state.query) { state.query = ''; box.querySelector('input').value = ''; drawList(); }
  };
  $app.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.onclick = () => {
      state.filter = btn.dataset.filter || null;
      $app.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-active', b === btn));
      drawList();
    };
  });
  const search = $app.querySelector('#search');
  if (search) {
    search.addEventListener('input', () => { state.query = search.value; drawList(); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') search.blur(); });
  }
}

function drawList() {
  const area = $app.querySelector('#list-area');
  if (!state.recipes.length) {
    area.innerHTML = `
      <div class="empty">
        <div class="empty__art" aria-hidden="true">🥣</div>
        <h2 class="empty__title">Nenhuma receita ainda</h2>
        <p class="empty__text">Toque no <strong>+</strong> lá embaixo para guardar a primeira.</p>
      </div>`;
    return;
  }
  const q = norm(state.query.trim());
  const f = state.filter;
  const list = state.recipes
    .filter((r) => !f || (f === '__fav' ? r.favorite : r.labels.some((l) => l.toLowerCase() === f.toLowerCase())))
    .filter((r) => !q || norm([r.name, ...r.labels, ...r.ingredients].join(' ')).includes(q))
    .sort(byName);

  area.innerHTML = list.length
    ? `<ul class="recipe-list">${list.map(cardHTML).join('')}</ul>`
    : `<div class="empty"><div class="empty__art" aria-hidden="true">🔍</div><h2 class="empty__title">Nada encontrado</h2><p class="empty__text">Tente outra palavra ou filtro.</p></div>`;
}

function cardHTML(r) {
  const photo = r.thumb
    ? `<img src="${r.thumb}" alt="" loading="lazy">`
    : foodEmoji(r.name);
  return `
    <li>
      <a class="card" href="#/r/${r.id}">
        <div class="thumb tone-${hue(r.name)}">${photo}</div>
        <div class="card__body">
          <h2 class="card__name">${esc(r.name)}${r.favorite ? `<span class="card__fav">${ICON.heartFill}</span>` : ''}</h2>
          ${r.labels.length
            ? `<div class="tags">${r.labels.map(tagHTML).join('')}</div>`
            : `<span class="card__nolabel">Sem labels</span>`}
          ${madeCount(r) ? `<p class="card__made">feita ${madeCount(r)} ${madeCount(r) === 1 ? 'vez' : 'vezes'}</p>` : ''}
        </div>
        <span class="card__chev">${ICON.chevron}</span>
      </a>
    </li>`;
}

/* ================================================================
   RECEITA ABERTA
   ================================================================ */
function renderDetail(id) {
  const r = state.recipes.find((x) => x.id === id);
  if (!r) return go('/', true);

  if (!state.checks.has(id)) state.checks.set(id, { ing: new Set(), step: new Set() });
  const checks = state.checks.get(id);
  const k = state.scale.get(id) || 1;
  const tone = hue(r.name);
  // número de cada passo, pulando as seções (1, 2, 3… seguido)
  const stepNum = {};
  let n = 0;
  r.steps.forEach((t, i) => { if (!isSection(t)) stepNum[i] = ++n; });

  $app.innerHTML = `
    <div class="hero tone-${tone}">
      ${r.photo || r.hasPhoto
        ? `<img id="hero-img" src="${r.photo || r.thumb || ''}" alt="Foto de ${esc(r.name)}" class="${r.photo ? '' : 'is-loading'}">`
        : foodEmoji(r.name)}
      <div class="hero__bar">
        <button class="circle-btn" id="back" aria-label="Voltar">${ICON.back}</button>
        <button class="circle-btn ${r.favorite ? 'is-fav' : ''}" id="fav" aria-label="Favoritar" aria-pressed="${!!r.favorite}">${ICON.heart}</button>
      </div>
    </div>

    <article class="wrap detail">
      <h1 class="detail__name">${esc(r.name)}</h1>
      ${r.labels.length ? `<div class="tags tags--lg">${r.labels.map(tagHTML).join('')}</div>` : ''}

      <div class="stats">
        <div class="stat">${ICON.basket}<span class="stat__label">Ingredientes</span><span class="stat__value">${plural(countItems(r.ingredients), 'item', 'itens')}</span></div>
        <div class="stat">${ICON.steps}<span class="stat__label">Preparo</span><span class="stat__value">${plural(countItems(r.steps), 'passo', 'passos')}</span></div>
        <button class="stat stat--btn" id="made-stat">${ICON.book}<span class="stat__label">Já fiz</span><span class="stat__value">${plural(madeCount(r), 'vez', 'vezes')}</span></button>
      </div>

      ${r.ingredients.length ? `
        <div class="portions portions--top">
          <span class="portions__label">Quanto da receita?</span>
          <div class="portions__opts" role="group" aria-label="Quanto da receita">
            ${PORTIONS.map((p) => `<button class="portion ${Math.abs(p.v - k) < 1e-9 ? 'is-active' : ''}" data-portion="${p.v}" aria-pressed="${Math.abs(p.v - k) < 1e-9}">${p.label}</button>`).join('')}
          </div>
          ${k !== 1 ? `<p class="portions__note">Quantidades ajustadas para <strong>${k < 1 ? PORTIONS.find((p) => Math.abs(p.v - k) < 1e-9).label + ' da receita' : k + '× a receita'}</strong>. Confira tempos e forma de assar.</p>` : ''}
        </div>
      ` : ''}

      ${r.ingredients.length ? `
        <h2 class="section-title">Ingredientes (${countItems(r.ingredients)}) <small id="ing-count"></small></h2>
        <ul class="items">
          ${r.ingredients.map((t, i) => isSection(t) ? `<li class="items__section">${esc(sectionName(t))}</li>` : `
            <li class="${r.ingredients.slice(0, i).some(isSection) ? 'in-section' : ''}"><button class="item tone-${(tone + i) % 6} ${checks.ing.has(i) ? 'is-done' : ''}" data-ing="${i}" aria-pressed="${checks.ing.has(i)}">
              <span class="item__mark">${checks.ing.has(i) ? ICON.check : DOT}</span><span class="item__text">${scaleText(t, k)}</span>
            </button></li>`).join('')}
        </ul>` : ''}

      ${r.steps.length ? `
        <h2 class="section-title">Modo de preparo (${countItems(r.steps)}) <small id="step-count"></small></h2>
        <ol class="items">
          ${r.steps.map((t, i) => isSection(t) ? `<li class="items__section">${esc(sectionName(t))}</li>` : `
            <li><button class="item item--step ${checks.step.has(i) ? 'is-done' : ''}" data-step="${i}" aria-pressed="${checks.step.has(i)}">
              <span class="item__mark">${stepNum[i]}</span><span class="item__text">${esc(t)}</span>
            </button></li>`).join('')}
        </ol>` : ''}

      ${r.notes.trim() ? `
        <h2 class="section-title">Observações</h2>
        <p class="notes">${esc(r.notes)}</p>` : ''}

      ${r.source?.trim() ? `
        <h2 class="section-title">Fonte</h2>
        <div class="source"><span class="source__icon">${ICON.link}</span><p class="source__text">${linkify(r.source)}</p></div>` : ''}

      <button class="link-btn" id="reset" hidden>Desmarcar tudo</button>

      ${diaryHTML(r)}
    </article>

    <div class="bottom-bar">
      <button class="btn-dark" id="edit">${ICON.edit}Editar receita</button>
    </div>
  `;

  const $ = (s) => $app.querySelector(s);
  const updateCounts = () => {
    if ($('#ing-count')) $('#ing-count').textContent = checks.ing.size ? `${checks.ing.size} ${checks.ing.size === 1 ? 'separado' : 'separados'}` : '';
    if ($('#step-count')) $('#step-count').textContent = checks.step.size ? `${checks.step.size} ${checks.step.size === 1 ? 'feito' : 'feitos'}` : '';
    $('#reset').hidden = !(checks.ing.size || checks.step.size);
  };
  updateCounts();

  $app.querySelectorAll('[data-portion]').forEach((btn) => {
    btn.onclick = () => {
      const y = window.scrollY;
      state.scale.set(id, +btn.dataset.portion);
      renderDetail(id);
      window.scrollTo(0, y);
    };
  });

  bindDiary(r);

  if (!r.photo && r.hasPhoto) {
    db.photo(r.id).then((p) => {
      if (!p) return;
      r.photo = p;
      const img = $('#hero-img');
      if (img) { img.src = p; img.classList.remove('is-loading'); }
    }).catch(() => {});
  }

  $('#back').onclick = () => go('/');
  $('#edit').onclick = () => go(`/editar/${id}`);
  $('#reset').onclick = () => { checks.ing.clear(); checks.step.clear(); renderDetail(id); };
  $('#fav').onclick = async () => {
    r.favorite = !r.favorite;
    const btn = $('#fav');
    btn.classList.toggle('is-fav', r.favorite);
    btn.setAttribute('aria-pressed', r.favorite);
    try { await db.put(r); toast(r.favorite ? 'Adicionada às favoritas ♥' : 'Removida das favoritas'); }
    catch { toast('Não consegui salvar 😕'); }
  };

  const bindToggle = (attr, set, label, keepLabel = false) => {
    $app.querySelectorAll(`[data-${attr}]`).forEach((btn) => {
      btn.onclick = () => {
        const i = +btn.dataset[attr];
        set.has(i) ? set.delete(i) : set.add(i);
        const done = set.has(i);
        btn.classList.toggle('is-done', done);
        btn.setAttribute('aria-pressed', done);
        btn.querySelector('.item__mark').innerHTML = done && !keepLabel ? ICON.check : label(i);
        updateCounts();
      };
    });
  };
  bindToggle('ing', checks.ing, () => DOT);
  bindToggle('step', checks.step, (i) => stepNum[i], true);
}

/* ---------- Diary: relatos de cada vez que a receita foi feita ---------- */
function diaryHTML(r) {
  const open = state.diaryOpen.has(r.id);
  const n = madeCount(r);
  const entries = [...(r.diary || [])].sort((a, b) => b.date.localeCompare(a.date));
  const avg = avgStars(r);
  return `
    <section class="diary ${open ? 'is-open' : ''}" id="diary">
      <button class="diary__tab" id="diary-toggle" aria-expanded="${open}">
        <span class="diary__icon">${ICON.book}</span>
        <span class="diary__title">Diary<small>${n ? `${n} ${n === 1 ? 'relato' : 'relatos'}` : 'Nenhum relato ainda'}</small></span>
        ${n ? `<span class="diary__avg">${ICON.star}${avg.toFixed(1).replace('.', ',')}</span>` : ''}
        <span class="diary__chev">${ICON.chevron}</span>
      </button>
      ${open ? `
        <div class="diary__body">
          ${state.writing === r.id ? `
            <form class="entry-form" id="entry-form">
              <p class="entry-form__date">${fmtDate(new Date().toISOString())}</p>
              <p class="entry-form__q">Como ficou?</p>
              <div class="star-pick" id="star-pick" role="radiogroup" aria-label="Estrelas">
                ${[1, 2, 3, 4, 5].map((i) => `<button type="button" class="star-btn" data-star="${i}" role="radio" aria-checked="false" aria-label="${i} ${i === 1 ? 'estrela' : 'estrelas'}">${ICON.star}</button>`).join('')}
              </div>
              <p class="field__error" id="star-error">Escolha quantas estrelas</p>
              <textarea class="input textarea" id="entry-text" rows="4" placeholder="Como foi? Mudou algo? O que faria diferente?"></textarea>
              <div class="entry-form__actions">
                <button type="button" class="add-row" id="entry-cancel">Cancelar</button>
                <button type="submit" class="btn-dark btn-dark--sm">${ICON.check}Salvar</button>
              </div>
            </form>`
          : `<button class="add-row add-row--dark" id="entry-new">${ICON.plus}Fiz hoje! Escrever no diary</button>`}
          ${entries.length ? `
            <ul class="entries">
              ${entries.map((e) => `
                <li class="entry">
                  <div class="entry__head">
                    ${starsHTML(e.stars)}
                    <span class="entry__date">${fmtDate(e.date)}</span>
                  </div>
                  ${e.text ? `<p class="entry__text">${esc(e.text)}</p>` : ''}
                  <button class="entry__del" data-del-entry="${e.id}" aria-label="Apagar relato">${ICON.trash}</button>
                </li>`).join('')}
            </ul>` : (state.writing === r.id ? '' : '<p class="diary__empty">Quando fizer a receita, conte aqui como foi.</p>')}
        </div>` : ''}
    </section>`;
}

function bindDiary(r) {
  const $ = (s) => $app.querySelector(s);
  const rerender = (scrollToDiary = false) => {
    const y = window.scrollY;
    renderDetail(r.id);
    if (scrollToDiary) $('#diary').scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo(0, y);
  };

  $('#diary-toggle').onclick = () => {
    if (state.diaryOpen.has(r.id)) { state.diaryOpen.delete(r.id); if (state.writing === r.id) state.writing = null; }
    else state.diaryOpen.add(r.id);
    rerender();
  };
  $('#made-stat').onclick = () => { state.diaryOpen.add(r.id); rerender(true); };

  const newBtn = $('#entry-new');
  if (newBtn) newBtn.onclick = () => {
    state.writing = r.id;
    rerender();
    $('#entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const form = $('#entry-form');
  if (form) {
    let stars = 0;
    const btns = [...form.querySelectorAll('[data-star]')];
    btns.forEach((b) => b.onclick = () => {
      stars = +b.dataset.star;
      btns.forEach((x) => {
        const on = +x.dataset.star <= stars;
        x.classList.toggle('on', on);
        x.setAttribute('aria-checked', +x.dataset.star === stars);
      });
      $('#star-error').style.display = 'none';
    });
    $('#entry-cancel').onclick = () => { state.writing = null; rerender(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!stars) { $('#star-error').style.display = 'block'; return; }
      const entry = { id: uid(), date: new Date().toISOString(), stars, text: $('#entry-text').value.trim() };
      r.diary = [...(r.diary || []), entry];
      try {
        await db.put(r);
        state.writing = null;
        toast('Anotado no diary ✓');
        rerender();
      } catch {
        r.diary = r.diary.filter((x) => x.id !== entry.id);
        toast('Não consegui salvar 😕');
      }
    };
  }

  $app.querySelectorAll('[data-del-entry]').forEach((b) => b.onclick = async () => {
    if (!confirm('Apagar este relato do diary?')) return;
    r.diary = (r.diary || []).filter((x) => x.id !== b.dataset.delEntry);
    await db.put(r);
    rerender();
  });
}

/* ================================================================
   NOVA / EDITAR RECEITA
   ================================================================ */
function renderForm(id) {
  const existing = id ? state.recipes.find((x) => x.id === id) : null;
  if (id && !existing) return go('/', true);

  const f = {
    labels: existing ? [...existing.labels] : [],
    photo: existing?.photo || null,
    thumb: existing?.thumb || null,
    hasPhoto: !!(existing?.photo || existing?.hasPhoto),
    changed: false, // a foto foi trocada/removida?
  };
  let dirty = false;

  $app.innerHTML = `
    <header class="wrap form-head">
      <button class="circle-btn" id="cancel" aria-label="Cancelar">${ICON.back}</button>
      <h1 class="page-title">${existing ? 'Editar receita' : 'Nova receita'}</h1>
      <span></span>
    </header>

    <form class="wrap form" id="form" novalidate autocomplete="off">
      ${!existing && cloud ? `
        <div class="import" id="import">
          <div class="import__head">
            <span class="import__icon">${ICON.link}</span>
            <div><p class="import__title">Importar de um link</p><p class="import__sub">ReciMe ou site de receitas: preenche tudo sozinho</p></div>
          </div>
          <div class="import__row">
            <input class="input" id="import-url" placeholder="Cole o link aqui" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
            <button type="button" class="btn-dark btn-dark--sm" id="import-btn">Importar</button>
          </div>
          <p class="field__error" id="import-error"></p>
        </div>` : ''}
      <label class="photo-picker">
        <input type="file" accept="image/*" class="sr-only" id="photo-input">
        <div class="photo-picker__inner" id="photo-preview"></div>
      </label>

      <div class="field" id="name-field">
        <label class="field__label" for="name">Nome</label>
        <input class="input" id="name" placeholder="Ex.: Bolo de cenoura da vó" value="${esc(existing?.name || '')}" enterkeyhint="next" autocapitalize="sentences">
        <p class="field__error">Dê um nome para a receita</p>
      </div>

      <div class="field">
        <span class="field__label">Labels</span>
        <div class="labels-box">
          <div class="tags tags--edit" id="label-chips"></div>
          <input class="input" id="label-input" placeholder="Digite e toque em OK (ex.: doce)" enterkeyhint="done" autocapitalize="none">
        </div>
        <div class="suggest" id="label-suggest"></div>
      </div>

      <div class="field">
        <span class="field__label">Ingredientes</span>
        <div class="rows" id="ing-rows"></div>
        <div class="add-btns">
          <button type="button" class="add-row" id="add-ing">${ICON.plus}Ingrediente</button>
          <button type="button" class="add-row add-row--section" id="add-ing-sec">${ICON.plus}Seção</button>
        </div>
      </div>

      <div class="field">
        <span class="field__label">Modo de preparo</span>
        <div class="rows rows--steps" id="step-rows"></div>
        <div class="add-btns">
          <button type="button" class="add-row" id="add-step">${ICON.plus}Passo</button>
          <button type="button" class="add-row add-row--section" id="add-step-sec">${ICON.plus}Seção</button>
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="notes">Observações</label>
        <textarea class="input textarea" id="notes" rows="3" placeholder="Dicas, substituições, rendimento…">${esc(existing?.notes || '')}</textarea>
      </div>

      <div class="field">
        <label class="field__label" for="source">Fonte</label>
        <input class="input" id="source" placeholder="Site, livro, quem te passou…" value="${esc(existing?.source || '')}" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done">
        <p class="field__hint">Se for um site, cole o link — ele vira clicável.</p>
      </div>

      ${existing ? `<button type="button" class="danger-btn" id="delete">${ICON.trash}Excluir receita</button>` : ''}
    </form>

    <div class="bottom-bar">
      <button class="btn-dark" id="save" type="submit" form="form">${ICON.check}Salvar receita</button>
    </div>
  `;

  const $ = (s) => $app.querySelector(s);
  const form = $('#form');
  form.addEventListener('input', () => { dirty = true; });

  /* --- foto --- */
  const preview = $('#photo-preview');
  const drawPhoto = () => {
    preview.innerHTML = f.hasPhoto
      ? `<img src="${f.photo || f.thumb}" alt="Foto da receita">
         <div class="photo-picker__actions">
           <span class="pill">${ICON.camera}Trocar</span>
           <button type="button" class="pill" id="photo-remove">${ICON.x}Remover</button>
         </div>`
      : `<div class="photo-picker__empty">${ICON.camera}<strong>Adicionar foto</strong><span>Câmera ou galeria</span></div>`;
    const rm = $('#photo-remove');
    if (rm) rm.onclick = (e) => { e.preventDefault(); e.stopPropagation(); f.photo = f.thumb = null; f.hasPhoto = false; f.changed = true; dirty = true; drawPhoto(); };
  };
  drawPhoto();
  if (existing && f.hasPhoto && !f.photo) {
    db.photo(existing.id).then((p) => { if (p && !f.changed) { f.photo = p; drawPhoto(); } }).catch(() => {});
  }
  $('#photo-input').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    preview.classList.add('is-loading');
    try {
      Object.assign(f, await processPhoto(file), { hasPhoto: true, changed: true });
      dirty = true;
      drawPhoto();
    } catch {
      toast('Não consegui abrir essa foto 😕');
    } finally {
      preview.classList.remove('is-loading');
      e.target.value = '';
    }
  };

  /* --- labels --- */
  const chips = $('#label-chips');
  const labelInput = $('#label-input');
  const suggest = $('#label-suggest');
  const drawLabels = () => {
    chips.innerHTML = f.labels.map((l, i) =>
      `<button type="button" class="tag tone-${hue(l)} tag--removable" data-rm="${i}" aria-label="Remover ${esc(l)}">${esc(l)}${ICON.x}</button>`).join('');
    const chosen = new Set(f.labels.map((l) => l.toLowerCase()));
    const opts = allLabels().filter((l) => !chosen.has(l.toLowerCase()));
    suggest.innerHTML = opts.length
      ? `<span class="suggest__hint">Já usadas:</span>${opts.map((l) => `<button type="button" class="tag tone-${hue(l)} tag--add" data-add="${esc(l)}">+ ${esc(l)}</button>`).join('')}`
      : '';
    chips.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { f.labels.splice(+b.dataset.rm, 1); dirty = true; drawLabels(); });
    suggest.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => addLabel(b.dataset.add));
  };
  const addLabel = (raw) => {
    const l = raw.trim().replace(/\s+/g, ' ');
    if (l && !f.labels.some((x) => x.toLowerCase() === l.toLowerCase())) { f.labels.push(l); dirty = true; }
    drawLabels();
  };
  labelInput.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && !e.isComposing) {
      e.preventDefault();
      addLabel(labelInput.value);
      labelInput.value = '';
    }
  });
  labelInput.addEventListener('input', () => {
    if (labelInput.value.includes(',')) {
      labelInput.value.split(',').slice(0, -1).forEach(addLabel);
      labelInput.value = labelInput.value.split(',').pop();
    }
  });
  labelInput.addEventListener('blur', () => { if (labelInput.value.trim()) { addLabel(labelInput.value); labelInput.value = ''; } });
  drawLabels();

  /* --- listas: ingredientes e passos --- */
  const ingRows = $('#ing-rows');
  const stepRows = $('#step-rows');
  const markDirty = () => { dirty = true; };
  (existing?.ingredients.length ? existing.ingredients : ['']).forEach((v) => addRow(ingRows, 'ing', v, null, markDirty));
  (existing?.steps.length ? existing.steps : ['']).forEach((v) => addRow(stepRows, 'step', v, null, markDirty));
  $('#add-ing').onclick = () => addRow(ingRows, 'ing', '', null, markDirty, true);
  $('#add-step').onclick = () => addRow(stepRows, 'step', '', null, markDirty, true);
  $('#add-ing-sec').onclick = () => addRow(ingRows, 'ing', SECTION, null, markDirty, true);
  $('#add-step-sec').onclick = () => addRow(stepRows, 'step', SECTION, null, markDirty, true);

  /* --- importar de link --- */
  const importBox = $('#import');
  if (importBox) {
    const urlInput = $('#import-url');
    const btn = $('#import-btn');
    const err = $('#import-error');
    const fail = (msg) => { err.textContent = msg; err.style.display = 'block'; };
    const run = async () => {
      const text = urlInput.value.trim();
      if (!/https?:\/\//i.test(text)) return fail('Cole um link que comece com https://');
      err.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Lendo…';
      try {
        const res = await fetch('/api/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await auth.token()}` },
          body: JSON.stringify({ text }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Não consegui importar');

        $('#name').value = data.name || '';
        f.labels = [];
        (data.labels || []).forEach(addLabel);
        ingRows.innerHTML = '';
        stepRows.innerHTML = '';
        (data.ingredients?.length ? data.ingredients : ['']).forEach((v) => addRow(ingRows, 'ing', v, null, markDirty));
        (data.steps?.length ? data.steps : ['']).forEach((v) => addRow(stepRows, 'step', v, null, markDirty));
        $('#notes').value = data.notes || '';
        $('#source').value = data.source || '';
        if (data.photo) {
          const blob = await (await fetch(data.photo)).blob();
          Object.assign(f, await processPhoto(blob), { hasPhoto: true, changed: true });
          drawPhoto();
        }
        dirty = true;
        importBox.remove();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('Receita importada — confira e salve ✓');
      } catch (ex) {
        fail(ex.message === 'Failed to fetch' ? 'Sem internet?' : ex.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Importar';
      }
    };
    btn.onclick = run;
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    urlInput.addEventListener('paste', () => setTimeout(run, 50)); // colou → já importa
  }

  $('#name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); labelInput.focus(); }
  });

  /* --- salvar / cancelar / excluir --- */
  $('#cancel').onclick = () => {
    if (dirty && !confirm('Sair sem salvar? As alterações serão perdidas.')) return;
    go(existing ? `/r/${existing.id}` : '/', true);
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (labelInput.value.trim()) { addLabel(labelInput.value); labelInput.value = ''; }
    const name = $('#name').value.trim();
    const nameField = $('#name-field');
    if (!name) {
      nameField.classList.remove('has-error');
      void nameField.offsetWidth; // reinicia a animação
      nameField.classList.add('has-error');
      $('#name').focus();
      nameField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const readRows = (box) => [...box.querySelectorAll('.row')].map((row) => {
      const v = row.querySelector('.row__input').value.trim();
      return v && row.classList.contains('row--section') ? SECTION + v : v;
    }).filter(Boolean);
    const now = Date.now();
    const recipe = {
      id: existing?.id || uid(),
      name,
      labels: f.labels,
      ingredients: readRows(ingRows),
      steps: readRows(stepRows),
      notes: $('#notes').value.trim(),
      source: $('#source').value.trim(),
      photo: f.photo || undefined,
      thumb: f.thumb,
      hasPhoto: f.hasPhoto,
      favorite: existing?.favorite || false,
      diary: existing?.diary || [],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const btn = $('#save');
    btn.disabled = true;
    try {
      await db.put(recipe, { withPhoto: f.changed || !existing });
      state.recipes = state.recipes.filter((r) => r.id !== recipe.id).concat(recipe);
      state.checks.delete(recipe.id);
      toast(existing ? 'Receita atualizada ✓' : 'Receita salva ✓');
      go(`/r/${recipe.id}`, true);
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      toast('Não consegui salvar. Tente de novo.');
    }
  };

  const del = $('#delete');
  if (del) del.onclick = async () => {
    if (!confirm(`Excluir "${existing.name}"? Isso não pode ser desfeito.`)) return;
    try { await db.remove(existing.id); } catch (err) { console.error(err); toast('Não consegui excluir. Está sem internet?'); return; }
    state.recipes = state.recipes.filter((r) => r.id !== existing.id);
    toast('Receita excluída');
    go('/', true);
  };

  if (!existing) setTimeout(() => $('#name').focus({ preventScroll: true }), 50);
}

/* Linha editável de lista. Enter cria a próxima; apagar numa linha vazia remove;
   colar várias linhas de uma vez divide em vários itens. */
function addRow(box, kind, value = '', after = null, onChange = () => {}, focus = false) {
  const section = isSection(value);
  if (section) value = sectionName(value);
  const isStep = kind === 'step' && !section;
  const row = document.createElement('div');
  row.className = section ? 'row row--section' : 'row';
  row.innerHTML = `
    <span class="row__mark" aria-hidden="true"></span>
    ${section
      ? `<input class="input row__input" placeholder="Nome da seção (ex.: Recheio)" enterkeyhint="next" autocapitalize="sentences">`
      : isStep
      ? `<textarea class="input row__input" rows="1" placeholder="Descreva o passo" enterkeyhint="next" autocapitalize="sentences"></textarea>`
      : `<input class="input row__input" placeholder="Ex.: 2 xícaras de farinha" enterkeyhint="next" autocapitalize="sentences">`}
    <button type="button" class="row__del" aria-label="Remover">${ICON.x}</button>`;
  const input = row.querySelector('.row__input');
  input.value = value;

  const grow = () => { if (isStep) { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; } };

  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      addRow(box, kind, '', row, onChange, true);
    } else if (e.key === 'Backspace' && input.value === '' && box.children.length > 1) {
      e.preventDefault();
      const prev = row.previousElementSibling || row.nextElementSibling;
      row.remove();
      onChange();
      prev?.querySelector('.row__input')?.focus();
    }
  });
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || '';
    const lines = text.split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-•*·]|\d+[.)-])\s*/, '').trim())
      .filter(Boolean)
      .map((l) => (/^[^\d]{2,40}:$/.test(l) ? SECTION + l.slice(0, -1).trim() : l)); // "Recheio:" vira seção
    if (lines.length < 2) return;
    e.preventDefault();
    input.value = (input.value ? input.value + ' ' : '') + (isSection(lines[0]) ? sectionName(lines[0]) : lines[0]);
    grow();
    let last = row;
    for (const l of lines.slice(1)) last = addRow(box, kind, l, last, onChange);
    onChange();
  });
  row.querySelector('.row__del').onclick = () => {
    if (box.children.length > 1) row.remove();
    else input.value = '';
    onChange();
  };

  if (after) after.after(row); else box.appendChild(row);
  requestAnimationFrame(grow);
  if (focus) input.focus();
  return row;
}

/* ---------- início ---------- */
function renderLogin() {
  $app.innerHTML = `
    <div class="wrap login">
      <span class="circle-btn circle-btn--logo" aria-hidden="true">🌼</span>
      <h1 class="page-title">Buttercup</h1>
      <p class="login__sub">Entre para ver suas receitas</p>
      <form class="login__form" id="login" novalidate>
        <input class="input" id="email" type="email" placeholder="E-mail" autocomplete="username" autocapitalize="off" inputmode="email" required>
        <input class="input" id="password" type="password" placeholder="Senha" autocomplete="current-password" required>
        <p class="field__error" id="login-error"></p>
        <button class="btn-dark" type="submit" id="login-btn">Entrar</button>
      </form>
    </div>`;
  const form = $app.querySelector('#login');
  const err = $app.querySelector('#login-error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $app.querySelector('#login-btn');
    btn.disabled = true;
    err.style.display = 'none';
    try {
      await auth.signIn($app.querySelector('#email').value.trim(), $app.querySelector('#password').value);
      location.reload();
    } catch (ex) {
      err.textContent = /invalid/i.test(ex.message) ? 'E-mail ou senha incorretos.' : 'Não consegui entrar. Verifique a internet.';
      err.style.display = 'block';
      btn.disabled = false;
    }
  };
}

async function start() {
  requestPersistence();

  if (cloud) {
    let session = null;
    try { session = await auth.session(); } catch (err) { console.error(err); }
    if (!session) return renderLogin();
    state.user = session.user?.email || '';
  }

  // 1) mostra na hora o que já está no aparelho
  try { state.recipes = await db.cached(); } catch (err) { console.error(err); }
  window.addEventListener('hashchange', route);
  route();

  // 2) atualiza com a nuvem (sem atrapalhar quem está no formulário)
  if (cloud) {
    try {
      state.recipes = await db.sync();
      const onForm = /^#\/(nova|editar)/.test(location.hash);
      if (!onForm) { const y = window.scrollY; route(); window.scrollTo(0, y); }
      fixThumbs();
    } catch (err) {
      console.error(err);
      toast('Sem conexão — mostrando o que está salvo no aparelho');
    }
  }
}

// Receitas salvas pelo Atalho do iPhone podem chegar sem miniatura: o app gera e salva.
async function fixThumbs() {
  for (const r of state.recipes.filter((x) => x.hasPhoto && !x.thumb)) {
    try {
      const photo = await db.photo(r.id);
      if (!photo) continue;
      const img = await loadImage(await (await fetch(photo)).blob());
      r.photo = photo;
      r.thumb = resize(img, 280, 0.8);
      await db.put(r);
      if (!location.hash || location.hash === '#/') drawList();
    } catch (err) { console.error(err); }
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

start();
