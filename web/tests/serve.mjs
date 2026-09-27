// Playwright owns and terminates this server; no persistent background daemon.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../dist');
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (!path.startsWith('/preview/') || path.includes('..')) { res.writeHead(404).end(); return; }
  const name = path.slice('/preview/'.length) || 'index.html';
  const file = resolve(root, name);
  if (!file.startsWith(root + '/')) { res.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(file);
    const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' };
    res.writeHead(200, { 'Content-Type': types[name.split('.').pop()] || 'application/octet-stream' }).end(bytes);
  } catch { res.writeHead(404).end(); }
}).listen(4173, '127.0.0.1');
