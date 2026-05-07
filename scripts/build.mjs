import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

for (const name of ['server.js', 'public', 'content']) {
  await fs.cp(path.join(root, name), path.join(dist, name), { recursive: true });
}

console.log('Built dist/ for Hostinger');
