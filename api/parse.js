// POST /api/parse  { text | url }  (com o token de login do app)
// Lê a receita do link e devolve os campos + a foto, para o app preencher o formulário.
import { readJson, send, extractUrl, extractHandle, fetchRecipe, fetchImageDataUrl, userFromToken } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const devBypass = process.env.BUTTERCUP_DEV_NO_AUTH === '1';
    if (!devBypass && !(await userFromToken(token))) return send(res, 401, { error: 'Entre no app de novo' });

    const body = await readJson(req);
    const text = body.url || body.text || '';
    const url = extractUrl(text);
    if (!url) return send(res, 400, { error: 'Não achei um link nesse texto' });

    const recipe = await fetchRecipe(url, extractHandle(text));
    const photo = await fetchImageDataUrl(recipe.imageUrl);
    return send(res, 200, { ...recipe, photo });
  } catch (err) {
    return send(res, err.code === 'NO_RECIPE' ? 422 : 502, { error: err.message });
  }
}
