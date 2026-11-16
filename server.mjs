import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const assets = new Map([
  ['index.html', 'text/html'], ['styles.css', 'text/css'],
  ['app.js', 'text/javascript'], ['training.js', 'text/javascript'],
  ['sw.js', 'text/javascript'], ['app.webmanifest', 'application/manifest+json'],
  ['icon-192.png', 'image/png'], ['icon-512.png', 'image/png'],
]);

const server = createServer(async (request, response) => {
  const path = (request.url ?? '/').split('?')[0];
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!assets.has(file)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(new URL(file, import.meta.url));
    response.writeHead(200, { 'Content-Type': assets.get(file), 'Cache-Control': 'no-cache' });
    response.end(body);
  } catch {
    response.writeHead(500).end('Unable to read app asset');
  }
});

const port = Number(process.env.PORT ?? 4173);
server.listen(port, '127.0.0.1', () => {
  console.log('Training Log · http://localhost:' + port);
});
