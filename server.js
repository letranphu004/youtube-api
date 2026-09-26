'use strict';

// Local dev server (Node 11+, no dependencies). On Vercel, public/ is served statically
// and api/channels.js handles the API instead.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

loadDotEnv(path.join(__dirname, '.env'));

const youtube = require('./lib/youtube');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

// ---------- http ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

http.createServer(function (req, res) {
  const u = url.parse(req.url, true);

  if (u.pathname === '/api/channels') {
    youtube.getPayload(u.query.force === '1').then(function (payload) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    }).catch(function (e) {
      console.error('[api]', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file.indexOf(PUBLIC_DIR) !== 0) { res.writeHead(403); return res.end(); }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, function () {
  console.log('YouTube Live Grid → http://localhost:' + PORT);
  console.log('Data source: ' + (youtube.apiKey() ? 'YouTube Data API v3' : 'public YouTube pages (set YOUTUBE_API_KEY for the API)'));
});
