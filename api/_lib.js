// Funções compartilhadas pelas rotas /api (rodam na Vercel, não no navegador).
// Lê receitas de qualquer site que publique o formato padrão schema.org/Recipe
// (ReciMe, TudoGostoso, Panelinha, a maioria dos blogs de receita…).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../public/config.js';

export { SUPABASE_URL, SUPABASE_ANON_KEY };

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MAX_HTML = 3_000_000;
const MAX_IMAGE = 4_000_000;

/* ---------------- HTTP helpers (funcionam na Vercel e no servidor local) ---------------- */
export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 100_000) throw new Error('Pedido grande demais');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { text: raw }; } // Atalhos pode mandar texto puro
}

export function send(res, status, data) {
  res.statusCode = status;
  if (typeof data === 'string') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(data);
  } else {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
  }
}

/* ---------------- link ---------------- */
// Acha o primeiro link num texto como "Check out @fulana's BOLO on ReciMe 🙌. https://…"
export function extractUrl(text = '') {
  const m = String(text).match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  const url = m[0].replace(/[.,;:!?)\]]+$/, '');
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i.test(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}

// "@gabibrandt" no texto compartilhado pelo ReciMe = autora da receita
export function extractHandle(text = '') {
  return String(text).match(/@([\w.]{2,30})/)?.[1] || null;
}

async function fetchLimited(url, max, accept) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error(`O site respondeu ${res.status}`);
    const len = +res.headers.get('content-length') || 0;
    if (len > max) throw new Error('Arquivo grande demais');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new Error('Arquivo grande demais');
    return { buf, type: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- leitura da receita ---------------- */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function clean(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const isRecipe = (n) => n && [].concat(n['@type'] || []).some((t) => String(t).toLowerCase() === 'recipe');

function findRecipe(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n); if (r) return r; } return null; }
  if (isRecipe(node)) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage']) {
    const r = findRecipe(node[key]);
    if (r) return r;
  }
  return null;
}

function steps(instr) {
  const out = [];
  const walk = (x) => {
    if (!x) return;
    if (typeof x === 'string') { x.split(/\r?\n+/).map(clean).filter(Boolean).forEach((s) => out.push(s)); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.itemListElement) { if (x.name) out.push(`— ${clean(x.name)} —`); walk(x.itemListElement); return; }
    if (x.text) out.push(clean(x.text));
    else if (x.name) out.push(clean(x.name));
  };
  walk(instr);
  return out.filter(Boolean);
}

function imageUrl(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return imageUrl(img[0]);
  return img.url || img.contentUrl || null;
}

function list(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.flatMap(list);
  return String(v).split(',').map(clean).filter(Boolean);
}

function yieldText(y) {
  if (y == null || y === '') return '';
  const v = Array.isArray(y) ? y[0] : y;
  return /^\d+$/.test(String(v).trim()) ? `${v} porções` : clean(v);
}

export async function fetchRecipe(url, handle) {
  const { buf } = await fetchLimited(url, MAX_HTML, 'text/html,application/xhtml+xml');
  const html = buf.toString('utf8');

  let recipe = null;
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { recipe = findRecipe(JSON.parse(m[1].trim())); } catch { /* bloco inválido: ignora */ }
    if (recipe) break;
  }
  const og = (p) => clean(html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']*)`, 'i'))?.[1]);
  if (!recipe) {
    const err = new Error('Não encontrei uma receita nesse link');
    err.code = 'NO_RECIPE';
    throw err;
  }

  const host = new URL(url).hostname.replace(/^www\./, '');
  const site = host.startsWith('recime.app') ? 'ReciMe' : host;
  const author = handle ? `@${handle}` : clean(recipe.author?.name || [].concat(recipe.author || [])[0]?.name || '');
  const notes = [
    yieldText(recipe.recipeYield) && `Rende: ${yieldText(recipe.recipeYield)}`,
    clean(recipe.description) && clean(recipe.description) !== 'Check out this recipe on ReciMe.' ? clean(recipe.description) : '',
  ].filter(Boolean).join('\n');

  const labels = [...new Set([...list(recipe.recipeCategory), ...list(recipe.recipeCuisine), ...list(recipe.keywords)]
    .map((l) => l.toLowerCase()))].slice(0, 6);

  let name = clean(recipe.name) || og('title') || 'Receita importada';
  if (name === name.toUpperCase() && /[A-ZÀ-Ý]/.test(name)) name = name.charAt(0) + name.slice(1).toLowerCase(); // "CINNAMON ROLL" → "Cinnamon roll"

  return {
    name,
    labels,
    ingredients: [].concat(recipe.recipeIngredient || recipe.ingredients || []).map(clean).filter(Boolean),
    steps: steps(recipe.recipeInstructions),
    notes,
    source: [site + (author && !/^[a-z]+-[a-z]+-\d+$/.test(author) ? ` · ${author}` : ''), url].join(' — '),
    imageUrl: imageUrl(recipe.image) || og('image') || null,
  };
}

export async function fetchImageDataUrl(url) {
  if (!url) return null;
  try {
    const { buf, type } = await fetchLimited(new URL(url).href, MAX_IMAGE, 'image/*');
    const mime = type.split(';')[0].trim();
    if (!mime.startsWith('image/')) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/* ---------------- Supabase (lado do servidor) ---------------- */
// confere se quem chamou está logado no app (token da sessão do Supabase)
export async function userFromToken(token) {
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return res.ok ? res.json() : null;
}

function adminHeaders() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('Falta SUPABASE_SECRET_KEY nas variáveis da Vercel');
  // chaves novas (sb_secret_…) vão só no apikey; as antigas (service_role JWT) vão nos dois
  return key.startsWith('sb_')
    ? { apikey: key, 'Content-Type': 'application/json' }
    : { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function ownerId() {
  if (process.env.BUTTERCUP_USER_ID) return process.env.BUTTERCUP_USER_ID;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=50`, { headers: adminHeaders() });
  if (!res.ok) throw new Error(`Não consegui ler os usuários (${res.status})`);
  const { users = [] } = await res.json();
  if (users.length !== 1) throw new Error('Há mais de um usuário: defina BUTTERCUP_USER_ID na Vercel');
  return users[0].id;
}

export async function insertRecipe(recipe, photoDataUrl) {
  const small = photoDataUrl && photoDataUrl.length < 250_000;
  const row = {
    user_id: await ownerId(),
    name: recipe.name,
    labels: recipe.labels,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    notes: recipe.notes,
    source: recipe.source,
    photo: photoDataUrl || null,
    thumb: small ? photoDataUrl : null, // foto grande: o app gera a miniatura sozinho
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/recipes`, {
    method: 'POST',
    headers: { ...adminHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json())[0];
}
