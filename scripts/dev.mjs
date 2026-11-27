// Servidor local: serve public/ e as rotas de api/ (igual à Vercel).
// Uso: npm run dev   → http://localhost:4173
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = +process.env.PORT || 4173;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (pathname.startsWith('/api/') && !pathname.includes('_')) {
      const mod = await import(join(ROOT, 'api', pathname.slice(5).replace(/\W/g, '') + '.js'));
      return await mod.default(req, res);
    }
    const file = normalize(join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
    const data = await readFile(file);
    res.setHeader('Content-Type', (TYPES[extname(file)] || 'application/octet-stream') + '; charset=utf-8');
    res.end(data);
  } catch (err) {
    res.statusCode = err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500;
    res.end(String(err.message));
  }
}).listen(PORT, () => console.log(`Buttercup em http://localhost:${PORT}`));
