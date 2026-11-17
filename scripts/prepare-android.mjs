import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const webDir = new URL('android-web/', root);
const assets = [
  'styles.css', 'app.js', 'training.js',
  'app.webmanifest', 'icon-192.png', 'icon-512.png',
];

await mkdir(webDir, { recursive:true });
const html = await readFile(new URL('index.html', root), 'utf8');
// Let Capacitor fit the Android WebView inside the system bars, including on newer WebViews.
await Promise.all([
  writeFile(new URL('index.html', webDir), html.replace(', viewport-fit=cover', '')),
  ...assets.map(asset => copyFile(new URL(asset, root), new URL(asset, webDir))),
]);
