// Armazenamento das receitas.
// - Com Supabase configurado (config.js): a nuvem é a fonte da verdade e o IndexedDB
//   do aparelho vira um cache (abre rápido e funciona para leitura sem internet).
// - Sem configuração: tudo fica só no aparelho, como antes.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const cloud = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const LIST_COLS = 'id,name,labels,ingredients,steps,notes,source,thumb,has_photo,favorite,diary,created_at,updated_at';
const MIGRATED_KEY = 'buttercup-migrated';

/* ---------------- IndexedDB (cache local) ---------------- */
const DB_NAME = 'buttercup';
const STORE = 'recipes';
let idbPromise;

function idb() {
  idbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idbPromise;
}

async function run(mode, fn) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const local = {
  all: () => run('readonly', (s) => s.getAll()),
  get: (id) => run('readonly', (s) => s.get(id)),
  put: (r) => run('readwrite', (s) => s.put(r)),
  remove: (id) => run('readwrite', (s) => s.delete(id)),
  replaceAll: (list) => run('readwrite', (s) => { s.clear(); list.forEach((r) => s.put(r)); }),
};

/* ---------------- Supabase ---------------- */
let clientPromise;
function client() {
  clientPromise ||= import(SUPABASE_JS).then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    }));
  return clientPromise;
}

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function toRow(r, withPhoto) {
  const row = {
    id: r.id,
    name: r.name,
    labels: r.labels || [],
    ingredients: r.ingredients || [],
    steps: r.steps || [],
    notes: r.notes || '',
    source: r.source || '',
    thumb: r.thumb || null,
    favorite: !!r.favorite,
    diary: r.diary || [],
    created_at: new Date(r.createdAt || Date.now()).toISOString(),
    updated_at: new Date(r.updatedAt || Date.now()).toISOString(),
  };
  if (withPhoto) row.photo = r.photo || null;
  return row;
}

function fromRow(row) {
  return {
    id: row.id,
    name: row.name,
    labels: row.labels || [],
    ingredients: row.ingredients || [],
    steps: row.steps || [],
    notes: row.notes || '',
    source: row.source || '',
    thumb: row.thumb,
    hasPhoto: !!row.has_photo,
    favorite: !!row.favorite,
    diary: row.diary || [],
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

function flag(get, value) {
  try { return get ? localStorage.getItem(MIGRATED_KEY) : localStorage.setItem(MIGRATED_KEY, value); } catch { return null; }
}

/* ---------------- API usada pelo app ---------------- */
export const auth = {
  async session() {
    if (!cloud) return true;
    const sb = await client();
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  async signIn(email, password) {
    const sb = await client();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signOut() {
    const sb = await client();
    await sb.auth.signOut();
  },
};

export const db = {
  // o que já está no aparelho (abre na hora, mesmo offline)
  async cached() {
    const list = (await local.all()) || [];
    return list.map((r) => ({ ...r, hasPhoto: r.hasPhoto ?? !!r.photo }));
  },

  // busca a versão da nuvem; na primeira vez, envia as receitas que já estavam no aparelho
  async sync() {
    if (!cloud) return this.cached();
    const sb = await client();
    const { data, error } = await sb.from('recipes').select(LIST_COLS);
    if (error) throw error;
    const remote = data.map(fromRow);
    const cachedList = await local.all();
    const cachedById = new Map(cachedList.map((r) => [r.id, r]));

    if (!flag(true)) {
      const ids = new Set(remote.map((r) => r.id));
      for (const r of cachedList) {
        if (ids.has(r.id)) continue;
        const rec = { ...r, id: isUuid(r.id) ? r.id : crypto.randomUUID() };
        const { error: upErr } = await sb.from('recipes').upsert(toRow(rec, true));
        if (upErr) throw upErr;
        remote.push({ ...rec, hasPhoto: !!rec.photo });
        cachedById.set(rec.id, rec);
      }
      flag(false, '1');
    }

    // mantém no cache as fotos grandes que já foram baixadas (se a receita não mudou)
    const merged = remote.map((r) => {
      const c = cachedById.get(r.id);
      return c?.photo && c.updatedAt === r.updatedAt ? { ...r, photo: c.photo } : r;
    });
    await local.replaceAll(merged);
    return merged;
  },

  // salva a receita. A foto grande só é enviada quando withPhoto = true (nova ou trocada).
  async put(r, { withPhoto = false } = {}) {
    if (cloud) {
      const sb = await client();
      const { error } = await sb.from('recipes').upsert(toRow(r, withPhoto));
      if (error) throw error;
    }
    const prev = await local.get(r.id);
    const photo = withPhoto ? r.photo : (r.photo ?? prev?.photo);
    await local.put({ ...r, photo: photo || undefined, hasPhoto: withPhoto ? !!r.photo : (r.hasPhoto ?? !!photo) });
  },

  async remove(id) {
    if (cloud) {
      const sb = await client();
      const { error } = await sb.from('recipes').delete().eq('id', id);
      if (error) throw error;
    }
    await local.remove(id);
  },

  // foto grande: do cache, ou baixa da nuvem e guarda no cache
  async photo(id) {
    const c = await local.get(id);
    if (c?.photo || !cloud) return c?.photo || null;
    const sb = await client();
    const { data, error } = await sb.from('recipes').select('photo').eq('id', id).single();
    if (error) throw error;
    if (c && data.photo) await local.put({ ...c, photo: data.photo });
    return data.photo;
  },
};

// Pede ao navegador para não apagar o cache quando faltar espaço.
export function requestPersistence() {
  try { navigator.storage?.persist?.(); } catch { /* ok */ }
}
