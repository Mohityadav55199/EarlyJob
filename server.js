'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb, createRepo, seed, ValidationError } = require('./db');

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
};

function createServer(repo) {
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
  });

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
    const m = req.method;
    if (parts[0] === 'health') return send(res, 200, { ok: true });
    if (parts[0] === 'metrics' && m === 'GET') return send(res, 200, repo.metrics());
    if (parts[0] === 'meta' && m === 'GET') return send(res, 200, { stages: repo.stages, roles: repo.roles() });
    if (parts[0] === 'candidates') {
      if (parts.length === 1) {
        if (m === 'GET') return send(res, 200, repo.list(Object.fromEntries(url.searchParams)));
        if (m === 'POST') return send(res, 201, repo.create(await readBody(req)));
      } else if (parts.length === 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) return send(res, 400, { error: 'Invalid id' });
        if (m === 'GET') { const c = repo.get(id); return c ? send(res, 200, c) : send(res, 404, { error: 'Not found' }); }
        if (m === 'PATCH' || m === 'PUT') {
          const c = repo.update(id, await readBody(req));
          return c ? send(res, 200, c) : send(res, 404, { error: 'Not found' });
        }
        if (m === 'DELETE') return repo.remove(id) ? send(res, 204) : send(res, 404, { error: 'Not found' });
      }
    }
    return send(res, 404, { error: 'Not found' });
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      if (e instanceof ValidationError) return send(res, 400, { error: e.message, errors: e.errors });
      if (e.status) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Internal server error' });
    }
  });
}

if (require.main === module) {
  const repo = createRepo(openDb());
  if (process.env.SEED !== '0') seed(repo);
  const port = process.env.PORT || 3000;
  createServer(repo).listen(port, () => console.log(`Mini ATS running on http://localhost:${port}`));
}

module.exports = { createServer };
