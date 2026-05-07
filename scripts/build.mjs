import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

for (const name of ['server.cjs', 'public', 'content']) {
  await fs.cp(path.join(root, name), path.join(dist, name), { recursive: true });
}

await fs.writeFile(
  path.join(dist, 'package.json'),
  JSON.stringify(
    {
      name: 'boss-blog-dist',
      private: true
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

console.log('Built dist/ for Hostinger');
