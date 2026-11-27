// POST /api/share  { text, token }
// Usado pelo Atalho do iPhone (folha de compartilhamento): importa e já salva a receita.
// Responde em texto curto, que o Atalho mostra como notificação.
import { timingSafeEqual } from 'node:crypto';
import { readJson, send, extractUrl, extractHandle, fetchRecipe, fetchImageDataUrl, insertRecipe } from './_lib.js';

function sameToken(a = '', b = '') {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, 'Use POST');
  try {
    const expected = process.env.BUTTERCUP_IMPORT_TOKEN;
    if (!expected) return send(res, 500, '⚠️ Falta BUTTERCUP_IMPORT_TOKEN nas variáveis da Vercel');

    const body = await readJson(req);
    const token = body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!sameToken(token, expected)) return send(res, 401, '⚠️ Código do atalho incorreto');

    const text = [body.text, body.url].filter(Boolean).join(' ');
    const url = extractUrl(text);
    if (!url) return send(res, 400, '⚠️ Não achei um link para importar');

    const recipe = await fetchRecipe(url, extractHandle(text));
    const photo = await fetchImageDataUrl(recipe.imageUrl);
    await insertRecipe(recipe, photo);
    return send(res, 200, `🌼 "${recipe.name}" salva no Buttercup`);
  } catch (err) {
    return send(res, err.code === 'NO_RECIPE' ? 422 : 502, `⚠️ ${err.message}`);
  }
}
