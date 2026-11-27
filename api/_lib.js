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
    if (x.itemListElement) { if (x.name) out.push(`# ${clean(x.name)}`); walk(x.itemListElement); return; }
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

// ReciMe guarda as divisões (Massa, Recheio, Cobertura…) num JSON embutido da página,
// que não aparece no schema.org. Lê de lá quando existir.
function nextFlight(html) {
  let f = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { f += JSON.parse(m[1]); } catch { /* ignora */ }
  }
  return f;
}

function jsonArrayAfter(text, key) {
  const k = text.indexOf(`"${key}":[{`);
  if (k < 0) return null;
  const start = text.indexOf('[', k);
  let depth = 0, inStr = false, esc = false;
  for (let p = start; p < text.length; p++) {
    const c = text[p];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) { try { return JSON.parse(text.slice(start, p + 1)); } catch { return null; } }
    }
  }
  return null;
}

function withSections(items, textKey) {
  if (!Array.isArray(items) || !items.length) return null;
  const out = [...items]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((x) => (x.heading ? `# ${clean(x.heading)}` : clean(x[textKey] ?? x.text ?? '')))
    .filter((t) => t && t !== '#');
  return out.length ? out : null;
}

// "Massa" escrito como 1º ingrediente (sem número) numa receita que tem seções = também é seção
function promoteFirst(list) {
  if (list.length > 1 && list.some((t) => t.startsWith('# ')) && !list[0].startsWith('# ')
      && !/\d/.test(list[0]) && list[0].split(/\s+/).length <= 3) {
    return [`# ${list[0].replace(/:$/, '')}`, ...list.slice(1)];
  }
  return list;
}

// linhas curtas terminando em ":" ("Recheio:") viram seção
const colonSections = (list) => list.map((t) => (/^[^\d]{2,40}:$/.test(t) ? `# ${t.slice(0, -1).trim()}` : t));

/* ---------------- TikTok: receita escrita na legenda ---------------- */
const isTikTok = (url) => /(^|\.)tiktok\.com$/i.test(new URL(url).hostname);

// acha o objeto do vídeo (itemStruct) nos JSONs embutidos da página
function tiktokItem(html) {
  for (const m of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!m[1].includes('"itemStruct"')) continue;
    try {
      const found = (function walk(o) {
        if (!o || typeof o !== 'object') return null;
        if (o.itemStruct?.desc != null) return o.itemStruct;
        for (const v of Object.values(o)) { const r = walk(v); if (r) return r; }
        return null;
      })(JSON.parse(m[1]));
      if (found) return found;
    } catch { /* ignora */ }
  }
  return null;
}

const NUM_WORDS = 'meia|meio|uma|um|duas|dois|três|tres|quatro|cinco|seis|pitada|half|one|two|three';
const BULLET = '[-–•*·▪✔✅🔸🔹]';
const QTY_START = new RegExp(`^(${BULLET}+\\s*)?(\\d|[½⅓⅔¼¾⅛]|(${NUM_WORDS})\\b)`, 'iu');
const NO_SPLIT_AFTER = /^(e|a|à|de|do|da|por|com|até|em|x|ou|and|or|of|to|at|for|=|\+)$/i;
const SECTION_WORDS = /^(massa|recheio|cobertura|calda|creme|base|bolo|ganache|montagem|brigadeiro|molho|farofa|crosta|topping|frosting|filling|dough|sauce)$/i;
const CTA = /gostou\?|quer\s+aprender|marque\s|siga\s|segue\s|me\s+segue|comenta|compartilh|salva\s+(esse|essa|o\s+v)|link\s+na\s+(minha\s+)?bio|link\s+in\s+bio|clique|aulas?\s+gratuitas|acesso\s+(exclusivo|vital)|follow\s+for|save\s+this/i;

// "5 ovos grandes 130g de açúcar 30g de amido" → ["5 ovos grandes", "130g de açúcar", "30g de amido"]
function splitIngredients(line) {
  const words = line.split(/\s+/);
  const out = [];
  let cur = [], depth = 0;
  words.forEach((w, i) => {
    const prev = words[i - 1] || '';
    if (cur.length && depth === 0 && QTY_START.test(w) && !NO_SPLIT_AFTER.test(prev) && !/[\/x×(]$/.test(prev)) {
      out.push(cur.join(' ')); cur = [];
    }
    cur.push(w);
    depth = Math.max(0, depth + (w.match(/\(/g) || []).length - (w.match(/\)/g) || []).length);
  });
  if (cur.length) out.push(cur.join(' '));
  return out.map((t) => t.replace(new RegExp(`^${BULLET}+\\s*|\\s*${BULLET}+$`, 'gu'), '').trim()).filter(Boolean);
}

// títulos "Recheio:", "Modo de Preparo:", "Ingredientes usados na receita:".
// Palavras conhecidas valem em qualquer caixa; fora isso, só UMA palavra com maiúscula antes do ":".
const ci = (w) => w.replace(/[a-zà-ÿ]/g, (c) => `[${c}${c.toUpperCase()}]`);
const KNOWN_HEADS = ['modo de preparo', 'modo de fazer', 'como fazer', 'passo a passo', 'preparo', 'recheio', 'massa', 'cobertura', 'calda', 'creme', 'ganache', 'montagem', 'obs', 'dica', 'dicas']
  .map((w) => ci(w).replace(/ /g, '\\s+')).join('|');
const HEADING = new RegExp(`(^|[\\s*])((?:${ci('ingredientes')}|${ci('ingrediente')}|${ci('ingredients')})[^:\\n]{0,40}|${KNOWN_HEADS}|[A-ZÀ-Ý][a-zà-ÿ()]+|[A-ZÀ-Ý]{2,})\\s*:(?=\\s|$)`, 'gu');
const ING_HEAD = /^(ingredientes?|ingredients?)\b/i;
const STEP_HEAD = /^(modo\s+de\s+(preparo|fazer)|preparo|como\s+fazer|instru[cç][oõ]es|instructions?|method|directions|passo\s+a\s+passo)\b/i;
const NOTE_HEAD = /^(obs|observa[cç][aã]o|observa[cç][oõ]es|dicas?|nota|tips?|rende|rendimento)\b/i;
const sentenceCase = (t) => (t === t.toUpperCase() && /[A-ZÀ-Ý]/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t);
const capFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const looksLikeStep = (t) => !QTY_START.test(t) && (/[.!]$/.test(t) || t.split(/\s+/).length > 7);
const isAside = (t) => /^(x[íi]cara|copo|colher)[^=]{0,20}=|^forma\b|^forno\b|^\(.*\)$/i.test(t);

export function parseCaption(desc) {
  let text = String(desc || '')
    .replace(/[⁣​﻿]+/g, '  ')                 // separadores invisíveis = quebra de linha
    .replace(/#[^\s#]+/g, ' ')                               // hashtags
    .replace(/(\s\.){2,}/g, ' ')                             // ". . . . ."
    .replace(/\r/g, '');
  // quebras de linha (no TikTok viram 2+ espaços)
  text = text.replace(/[ \t]{2,}/g, '\n');
  // passos numerados "1 – … 2 – …"
  text = text.replace(/\s(?=\d{1,2}\s?[–\-.)]\s+[A-ZÀ-Ý])/g, '\n');
  // marcadores "- item - item" em linhas próprias
  if ((text.match(/(?<!\d)\s[-•]\s/g) || []).length >= 2) text = text.replace(/(?<!\d)\s[-•]\s/g, '\n');
  // "Modo de preparo no vídeo" no meio do texto
  text = text.replace(/\s*((modo\s+de\s+)?preparo\s+(completo\s+)?(no|in the)\s+v[ií]deo[^\n.!]*[.!]?)\s*/gi, '\n$1\n');
  // títulos "Recheio:" em linhas próprias
  text = text.replace(HEADING, (m, sp, h) => `${sp === '*' ? '' : sp}\n${h.trim()}:\n`);
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => /[\p{L}\d]/u.test(l));

  const intro = [], ingredients = [], steps = [], notes = [];
  let mode = 'intro';
  for (let line of lines) {
    // tira frases de propaganda ("Gostou? Marque quem…", "link na bio")
    if (CTA.test(line)) line = line.split(/(?<=[.!?])\s+/).filter((x) => !CTA.test(x)).join(' ').trim();
    if (!/[\p{L}\d]/u.test(line)) continue;
    const head = line.match(/^(.{1,50}):$/)?.[1].trim();
    if (head) {
      if (ING_HEAD.test(head)) {
        mode = 'ing';
        const rest = head.replace(ING_HEAD, '').replace(/^(usad[oa]s|d[aoe]s?|para|pro|pra)\b.*/i, '').trim();
        if (rest && rest.split(/\s+/).length <= 3) ingredients.push(`# ${capFirst(sentenceCase(rest))}`);
        continue;
      }
      if (STEP_HEAD.test(head)) { mode = 'steps'; continue; }
      if (NOTE_HEAD.test(head)) { mode = 'notes'; continue; }
      if (mode === 'steps') steps.push(`# ${capFirst(sentenceCase(head))}`);
      else { mode = 'ing'; ingredients.push(`# ${capFirst(sentenceCase(head))}`); }
      continue;
    }
    if (/no v[ií]deo|in the video/i.test(line)) { notes.push(line); if (mode !== 'intro') mode = 'notes'; continue; }
    if (mode === 'intro') {
      if (intro.length && QTY_START.test(line) && splitIngredients(line).length > 1) mode = 'ing';
      else { intro.push(line); continue; }
    }
    if (mode === 'ing') {
      // "massa 4 Ovos …" logo depois de "Ingredientes:" → seção "Massa"
      const sec = line.match(/^([A-Za-zÀ-ÿ]+)\s+(?=\S)/);
      if (sec && SECTION_WORDS.test(sec[1]) && QTY_START.test(line.slice(sec[0].length))) {
        ingredients.push(`# ${capFirst(sec[1].toLowerCase())}`);
        line = line.slice(sec[0].length);
      }
      if (isAside(line)) { notes.push(line); continue; }
      if (looksLikeStep(line)) mode = 'steps';
    }
    if (mode === 'ing') ingredients.push(...splitIngredients(line));
    else if (mode === 'steps') {
      steps.push(...line.replace(/^\d{1,2}\s?[–\-.)]\s+/, '').split(/(?<=[.!])\s+(?=[A-ZÀ-Ý])/).map((x) => x.trim()).filter(Boolean));
    } else notes.push(line);
  }

  // nome: primeira frase da introdução, sem emojis
  const first = (intro[0] || '').split(/(?<=[.!?])\s|[|•]/)[0];
  const name = sentenceCase(first.replace(/\p{Extended_Pictographic}|️|[\u{1F3FB}-\u{1F3FF}]/gu, '').replace(/\s+/g, ' ').replace(/[!:.\s]+$/, '').trim()).slice(0, 80);
  notes.unshift(...intro.slice(1));
  return {
    name,
    ingredients: ingredients.filter((t, i, a) => !(t.startsWith('# ') && (a[i + 1] ?? '# ').startsWith('# '))),
    steps: steps.filter((t, i, a) => !(t.startsWith('# ') && (a[i + 1] ?? '# ').startsWith('# '))),
    notes: notes.join('\n'),
  };
}

async function fetchTikTok(url, html) {
  const item = tiktokItem(html);
  const desc = item?.desc || clean(html.match(/<meta[^>]+(?:property|name)=["'](?:og:)?description["'][^>]+content=["']([^"']*)/i)?.[1]);
  const parsed = parseCaption(desc);
  if (!parsed.ingredients.some((t) => !t.startsWith('# '))) {
    const err = new Error('Não achei a receita na legenda desse TikTok');
    err.code = 'NO_RECIPE';
    throw err;
  }
  const user = item?.author?.uniqueId || url.match(/@([\w.]+)/)?.[1];
  const id = item?.id || url.match(/video\/(\d+)/)?.[1];
  const link = user && id ? `https://www.tiktok.com/@${user}/video/${id}` : url;
  return {
    name: parsed.name || 'Receita do TikTok',
    labels: [],
    ingredients: parsed.ingredients,
    steps: parsed.steps,
    notes: parsed.notes,
    source: `TikTok${user ? ` · @${user}` : ''} — ${link}`,
    imageUrl: item?.video?.originCover || item?.video?.cover || null,
  };
}

export async function fetchRecipe(url, handle) {
  const { buf } = await fetchLimited(url, MAX_HTML, 'text/html,application/xhtml+xml');
  const html = buf.toString('utf8');
  if (isTikTok(url) || html.includes('"itemStruct"')) return fetchTikTok(url, html);

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

  let ingredients = [].concat(recipe.recipeIngredient || recipe.ingredients || []).map(clean).filter(Boolean);
  let stepList = steps(recipe.recipeInstructions);
  const flight = html.includes('self.__next_f') ? nextFlight(html) : '';
  if (flight) {
    ingredients = withSections(jsonArrayAfter(flight, 'ingredients'), 'rawText') || ingredients;
    stepList = withSections(jsonArrayAfter(flight, 'instructions'), 'text') || stepList;
  }
  ingredients = promoteFirst(colonSections(ingredients));
  stepList = colonSections(stepList);

  return {
    name,
    labels,
    ingredients,
    steps: stepList,
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
