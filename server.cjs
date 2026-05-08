const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');
const matter = require('gray-matter');
const { marked } = require('marked');
const slugify = require('slugify');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_ROOT = path.basename(__dirname) === 'dist' ? path.join(__dirname, '..') : __dirname;
const PERSIST_ROOT = process.env.PERSIST_ROOT || path.join(APP_ROOT, '..', 'blog-data');
const LEGACY_POSTS_DIR = path.join(__dirname, 'content', 'posts');
const LEGACY_DATA_DIR = path.join(APP_ROOT, 'data');
const LEGACY_PERSIST_POSTS_DIR = path.join(LEGACY_DATA_DIR, 'posts');
const LEGACY_UPLOADS_DIR = path.join(APP_ROOT, 'uploads');
const DATA_DIR = process.env.DATA_DIR || PERSIST_ROOT;
const POSTS_DIR = process.env.POSTS_DIR || path.join(DATA_DIR, 'posts');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(PERSIST_ROOT, 'uploads');
const DEBUG_LOG = path.join(PERSIST_ROOT, 'debug.log');
const SITE_URL = (process.env.SITE_URL || 'https://dev.openpaste.my.id').replace(/\/$/, '');
const DEFAULT_DESCRIPTION_TONE = ['formal', 'santai', 'nakal'].includes(process.env.DEFAULT_DESCRIPTION_TONE) ? process.env.DEFAULT_DESCRIPTION_TONE : 'santai';
const AUTH_COOKIE = 'boss_blog_auth';
const ADMIN_PASSWORD = process.env.BLOG_ADMIN_PASSWORD || '';

async function writeDebug(message, meta = {}) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    message,
    ...meta,
  }) + '\n';
  try {
    await fs.appendFile(DEBUG_LOG, line, 'utf8');
  } catch (error) {
    console.error('Failed to write debug log:', error);
  }
}

async function migrateFiles(candidates, targetDir, filterFn) {
  const currentFiles = await fs.readdir(targetDir).catch(() => []);
  if (currentFiles.length) return;
  for (const sourceDir of candidates) {
    const sourceFiles = await fs.readdir(sourceDir).catch(() => []);
    const selected = sourceFiles.filter(filterFn);
    if (!selected.length) continue;
    await Promise.all(selected.map((file) => fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file))));
    return { from: sourceDir, files: selected.length };
  }
  return null;
}

async function migrateLegacyData() {
  const postMigration = await migrateFiles(
    [LEGACY_PERSIST_POSTS_DIR, LEGACY_POSTS_DIR],
    POSTS_DIR,
    (file) => file.endsWith('.md'),
  );
  if (postMigration) {
    await writeDebug('Migrated legacy posts to persistent directory', {
      from: postMigration.from,
      to: POSTS_DIR,
      files: postMigration.files,
    });
  }

  const uploadMigration = await migrateFiles(
    [LEGACY_UPLOADS_DIR],
    UPLOADS_DIR,
    (file) => !file.startsWith('.'),
  );
  if (uploadMigration) {
    await writeDebug('Migrated legacy uploads to persistent directory', {
      from: uploadMigration.from,
      to: UPLOADS_DIR,
      files: uploadMigration.files,
    });
  }
}

async function boot() {
  await fs.mkdir(PERSIST_ROOT, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(POSTS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await migrateLegacyData();
  await writeDebug('Boot complete', { APP_ROOT, PERSIST_ROOT, DATA_DIR, POSTS_DIR, PUBLIC_DIR, UPLOADS_DIR, DEBUG_LOG });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      const base = slugify(path.basename(file.originalname || 'image', ext), { lower: true, strict: true, trim: true }) || 'image';
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
  });

  app.use(express.urlencoded({ extended: true, limit: '4mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use(express.static(PUBLIC_DIR));

  function esc(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeUrl(value = '') {
    const str = String(value || '').trim();
    if (!str) return '';
    if (str.startsWith('/')) return str;
    if (/^https?:\/\//i.test(str)) return str;
    return '';
  }

  function makeAbsoluteUrl(input = '/') {
    if (!input) return SITE_URL;
    if (/^https?:\/\//i.test(input)) return input;
    return `${SITE_URL}${input.startsWith('/') ? input : `/${input}`}`;
  }

  function layout({ title, body, description = '', canonicalPath = '/', ogImage = '/placeholder/feature.svg?topic=general&variant=0&title=Boss%20Blog', authed = false }) {
    const metaDescription = esc((description || '').trim() || 'Boss Blog — catatan, tips, dan random thoughts.');
    const canonicalUrl = esc(makeAbsoluteUrl(canonicalPath));
    const socialImage = esc(makeAbsoluteUrl(ogImage));
    return `<!doctype html>
    <html lang="id">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${esc(title)}</title>
      <meta name="description" content="${metaDescription}" />
      <link rel="canonical" href="${canonicalUrl}" />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Boss Blog" />
      <meta property="og:title" content="${esc(title)}" />
      <meta property="og:description" content="${metaDescription}" />
      <meta property="og:url" content="${canonicalUrl}" />
      <meta property="og:image" content="${socialImage}" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="${esc(title)}" />
      <meta name="twitter:description" content="${metaDescription}" />
      <meta name="twitter:image" content="${socialImage}" />
      <link rel="icon" href="/favicon.svg" />
      <link rel="stylesheet" href="/style.css" />
      <script>
        const theme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.dataset.theme = theme;
      </script>
    </head>
    <body>
      <header class="site-header">
        <div class="wrap nav">
          <a href="/" class="brand">📝 Boss Blog</a>
          <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="${authed ? '/admin' : '/login'}">${authed ? 'Admin' : 'Login'}</a>
            <button id="themeToggle" class="ghost-btn" type="button">🌓</button>
          </nav>
        </div>
      </header>
      <main class="wrap main">${body}</main>
      <footer class="wrap footer">© ${new Date().getFullYear()} Boss Blog. Built with ❤️ by Bro Claw 👌</footer>
      <script>
        document.getElementById('themeToggle')?.addEventListener('click', () => {
          const current = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
          document.documentElement.dataset.theme = current;
          localStorage.setItem('theme', current);
        });
      </script>
    </body>
    </html>`;
  }

  function isAuthed(req) {
    return req.cookies[AUTH_COOKIE] === '1';
  }

  function formatDisplayDate(dateInput) {
    const dateObj = new Date(dateInput || new Date().toISOString().slice(0, 10));
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${day}/${month}/${year}`;
  }

  function normalizeTone(value = '') {
    return ['formal', 'santai', 'nakal'].includes(value) ? value : DEFAULT_DESCRIPTION_TONE;
  }

  function getDefaultDescription(title, date, tone = DEFAULT_DESCRIPTION_TONE) {
    const displayDate = formatDisplayDate(date);
    const templateMap = {
      formal: [
        `Openpaste ${displayDate} membahas ${title}. Simpan halaman ini dan bookmark Openpaste.my.id untuk update berikutnya.`,
        `${title} dipublikasikan di Openpaste pada ${displayDate}. Kunjungi kembali Openpaste.my.id untuk panduan dan catatan terbaru.`,
        `Catatan Openpaste edisi ${displayDate}: ${title}. Untuk mengikuti update selanjutnya, silakan subscribe atau bookmark Openpaste.my.id.`,
      ],
      santai: [
        `Openpaste ${displayDate}, ${title}. Untuk berlangganan silahkan Subscribe atau Bookmark Openpaste.my.id.`,
        `${title} tayang di Openpaste ${displayDate}. Simpan dulu link-nya dan balik lagi kalau butuh panduan yang nggak muter-muter.`,
        `Openpaste ${displayDate} bahas ${title}. Kalau cocok, bookmark Openpaste.my.id biar next kali nggak nyasar cari ulang.`,
        `${title} — catatan Openpaste edisi ${displayDate}. Buat update berikutnya, subscribe atau bookmark Openpaste.my.id dulu bos.`,
      ],
      nakal: [
        `Openpaste ${displayDate} lagi ngulik ${title}. Kalau bahasannya bikin nagih, bookmark Openpaste.my.id dulu bos biar gampang lanjut ronde berikutnya.`,
        `${title} nongol di Openpaste ${displayDate}. Jangan cuma lewat, simpan link-nya dan balik lagi kalau butuh yang lebih greget.`,
        `Catatan Openpaste ${displayDate}: ${title}. Kalau cocok di kepala, subscribe atau bookmark Openpaste.my.id biar hubungan kita nggak putus di tengah jalan.`,
      ],
    };
    const templates = templateMap[normalizeTone(tone)] || templateMap.santai;
    const seed = String(title || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) + String(date || '').length;
    return templates[seed % templates.length];
  }

  function normalizeMeta(slug, data = {}) {
    const title = data.title || slug;
    const date = data.date || new Date().toISOString().slice(0, 10);
    const descriptionTone = normalizeTone(data.descriptionTone || data.description_tone || '');
    const description = (data.description || '').trim() || getDefaultDescription(title, date, descriptionTone);
    return {
      slug,
      title,
      description,
      date,
      updated: data.updated || '',
      descriptionTone,
      tags: Array.isArray(data.tags) ? data.tags : [],
      visibility: ['public', 'unlisted', 'private'].includes(data.visibility) ? data.visibility : 'public',
      featureImage: safeUrl(data.featureImage || data.feature_image || ''),
      draft: Boolean(data.draft),
    };
  }

  async function getAllPosts() {
    const files = (await fs.readdir(POSTS_DIR)).filter((file) => file.endsWith('.md'));
    const posts = await Promise.all(files.map(async (file) => {
      const slug = file.replace(/\.md$/, '');
      const raw = await fs.readFile(path.join(POSTS_DIR, file), 'utf8');
      const parsed = matter(raw);
      const meta = normalizeMeta(slug, parsed.data);
      return {
        ...meta,
        body: parsed.content.trim(),
        html: marked.parse(parsed.content),
      };
    }));
    return posts.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }

  async function getPostBySlug(slug) {
    const posts = await getAllPosts();
    return posts.find((post) => post.slug === slug);
  }

  async function getUploadedImages() {
    const files = await fs.readdir(UPLOADS_DIR, { withFileTypes: true }).catch(() => []);
    const images = await Promise.all(files
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const fullPath = path.join(UPLOADS_DIR, entry.name);
        const stat = await fs.stat(fullPath).catch(() => null);
        return stat ? {
          name: entry.name,
          url: `/uploads/${entry.name}`,
          mtimeMs: stat.mtimeMs,
        } : null;
      }));
    return images.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  function makeMarkdownImage(name, url) {
    return `![${name}](${url})`;
  }

  function makeSlug(input) {
    return slugify(input || '', { lower: true, strict: true, trim: true }) || `post-${Date.now()}`;
  }

  async function savePost({ originalSlug = '', title, description, date, descriptionTone, tags, visibility, featureImage, body, draft }) {
    const slug = makeSlug(title);
    if (originalSlug && originalSlug !== slug) {
      await fs.rm(path.join(POSTS_DIR, `${originalSlug}.md`), { force: true });
    }
    const file = path.join(POSTS_DIR, `${slug}.md`);
    const finalTone = normalizeTone(descriptionTone || '');
    const finalDescription = String(description || '').trim() || getDefaultDescription(title, date, finalTone);
    const content = matter.stringify((body || '').trim() + '\n', {
      title,
      description: finalDescription,
      date,
      updated: new Date().toISOString().slice(0, 10),
      descriptionTone: finalTone,
      tags,
      visibility,
      featureImage: safeUrl(featureImage),
      draft,
    });
    await fs.writeFile(file, content, 'utf8');
    return slug;
  }

  function normalizeImportItem(item = {}) {
    const title = String(item.title || '').trim();
    if (!title) throw new Error('title wajib ada');
    const date = String(item.date || '').trim() || new Date().toISOString().slice(0, 10);
    const descriptionTone = normalizeTone(item.descriptionTone || item.description_tone || '');
    return {
      originalSlug: '',
      title,
      description: String(item.description || '').trim() || getDefaultDescription(title, date, descriptionTone),
      date,
      descriptionTone,
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean) : String(item.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean),
      visibility: ['public', 'unlisted', 'private'].includes(item.visibility) ? item.visibility : 'public',
      featureImage: safeUrl(item.featureImage || item.feature_image || ''),
      body: String(item.body || item.content || '').trim(),
      draft: Boolean(item.draft),
    };
  }

  function loginRequired(req, res, next) {
    if (isAuthed(req)) return next();
    const nextUrl = encodeURIComponent(req.originalUrl || '/admin');
    res.redirect(`/login?next=${nextUrl}`);
  }

  function hashString(input = '') {
    return Array.from(String(input)).reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 7);
  }

  function pickPlaceholderTopic(post = {}) {
    const tags = (post.tags || []).map((tag) => String(tag).toLowerCase());
    const joined = `${post.title || ''} ${(post.description || '')}`.toLowerCase();
    if (post.visibility === 'private') return 'private';
    if (tags.some((tag) => ['python', 'django', 'flask'].includes(tag)) || joined.includes('python')) return 'python';
    if (tags.some((tag) => ['php', 'laravel', 'wordpress'].includes(tag)) || joined.includes('php')) return 'php';
    if (tags.some((tag) => ['node', 'nodejs', 'javascript', 'js', 'express'].includes(tag)) || joined.includes('node')) return 'node';
    if (tags.some((tag) => ['crypto', 'bitcoin', 'ethereum', 'web3'].includes(tag)) || joined.includes('crypto')) return 'crypto';
    if (tags.some((tag) => ['tutorial', 'guide', 'internet', 'seo', 'blog'].includes(tag))) return 'tutorial';
    return 'general';
  }

  function getDefaultFeatureUrl(post = {}) {
    const topic = pickPlaceholderTopic(post);
    const seed = hashString(`${post.slug || post.title || 'post'}:${topic}`) % 10;
    const title = encodeURIComponent(post.title || 'Boss Blog');
    return `/placeholder/feature.svg?topic=${encodeURIComponent(topic)}&variant=${seed}&title=${title}`;
  }

  function renderFeatureImage(post = {}, mode = 'default') {
    const safe = safeUrl(post.featureImage || '');
    const src = safe || getDefaultFeatureUrl(post);
    return `<img class="feature-image ${mode === 'card' ? 'feature-image-card' : ''}" src="${esc(src)}" alt="${esc(post.title || 'feature image')}" loading="lazy" />`;
  }

  function renderTagChips(tags = []) {
    return tags.map((tag) => `<span class="tag-chip">${esc(tag)}</span>`).join('');
  }

  app.get('/placeholder/feature.svg', (req, res) => {
    const topic = String(req.query.topic || 'general').toLowerCase();
    const variant = Math.abs(Number(req.query.variant || 0)) % 10;
    const title = String(req.query.title || 'Boss Blog').slice(0, 42);
    const paletteMap = {
      python: ['#1b1332', '#3d2f82', '#ffd43b', '#4b8bbe'],
      php: ['#17142b', '#4f46e5', '#c4b5fd', '#8b5cf6'],
      node: ['#0f1720', '#166534', '#86efac', '#22c55e'],
      crypto: ['#150f2b', '#7c3aed', '#f59e0b', '#f97316'],
      tutorial: ['#18122b', '#6d28d9', '#f9a8d4', '#fb7185'],
      private: ['#140f1f', '#6b21a8', '#f472b6', '#f5d0fe'],
      general: ['#130f25', '#7237a7', '#c084fc', '#f59e0b'],
    };
    const [bg, panel, accent, accent2] = paletteMap[topic] || paletteMap.general;
    const labelMap = {
      python: 'PYTHON',
      php: 'PHP',
      node: 'NODE',
      crypto: 'CRYPTO',
      tutorial: 'TUTORIAL',
      private: 'PRIVATE',
      general: 'DEV BLOG',
    };
    const label = labelMap[topic] || labelMap.general;
    const offset = 40 + (variant * 18);
    const mono = label.replace(/[^A-Z]/g, '').slice(0, 4) || 'DEV';
    res.type('image/svg+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-label="${esc(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${panel}"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.0"/>
      <stop offset="50%" stop-color="${accent}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${accent2}" stop-opacity="0.0"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="675" rx="36" fill="url(#bg)"/>
  <circle cx="940" cy="122" r="170" fill="${accent}" opacity="0.14"/>
  <circle cx="260" cy="582" r="180" fill="${accent2}" opacity="0.12"/>
  <path d="M0 ${470 + variant * 4} C 180 ${390 + variant * 2}, 320 ${560 - variant * 3}, 520 ${450 + variant * 4} S 860 ${520 - variant * 2}, 1200 ${350 + variant * 5}" stroke="url(#glow)" stroke-width="4" fill="none" opacity="0.9"/>
  <path d="M0 ${520 + variant * 3} C 220 ${460 - variant * 2}, 340 ${620 - variant * 3}, 620 ${520 + variant * 2} S 920 ${600 - variant * 2}, 1200 ${430 + variant * 4}" stroke="${accent2}" stroke-width="2" fill="none" opacity="0.4"/>
  <g opacity="0.9">
    <rect x="72" y="72" width="170" height="44" rx="22" fill="rgba(255,255,255,0.08)"/>
    <text x="157" y="100" text-anchor="middle" fill="#fff" font-size="21" font-family="Arial, sans-serif" font-weight="700">${label}</text>
  </g>
  <g transform="translate(475 160)">
    <rect x="0" y="0" width="250" height="250" rx="36" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.14)"/>
    <circle cx="125" cy="125" r="82" fill="rgba(0,0,0,0.24)" stroke="${accent}" stroke-width="6"/>
    <text x="125" y="145" text-anchor="middle" fill="#fff" font-size="74" font-family="Arial, sans-serif" font-weight="800">${mono}</text>
  </g>
  <g fill="none" stroke="${accent2}" stroke-width="2" opacity="0.35">
    <path d="M72 ${offset} H260" />
    <path d="M72 ${offset + 22} H220" />
    <path d="M72 ${offset + 44} H290" />
    <path d="M72 ${offset + 66} H210" />
    <path d="M920 ${offset + 8} H1110" />
    <path d="M960 ${offset + 30} H1120" />
    <path d="M900 ${offset + 52} H1085" />
  </g>
  <text x="600" y="510" text-anchor="middle" fill="#ffffff" font-size="54" font-family="Georgia, serif" font-weight="700">${esc(title)}</text>
  <text x="600" y="560" text-anchor="middle" fill="rgba(255,255,255,0.72)" font-size="24" font-family="Arial, sans-serif">admin males nyari gambar, jadi sistem yang bantuin 😏</text>
</svg>`);
  });

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', async (_req, res) => {
    const posts = (await getAllPosts()).filter((post) => post.visibility === 'public' && !post.draft);
    const urls = [
      { loc: `${SITE_URL}/`, lastmod: new Date().toISOString() },
      { loc: `${SITE_URL}/about`, lastmod: new Date().toISOString() },
      ...posts.map((post) => ({
        loc: `${SITE_URL}/blog/${post.slug}`,
        lastmod: new Date(post.updated || post.date || Date.now()).toISOString(),
      })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((entry) => `  <url><loc>${esc(entry.loc)}</loc><lastmod>${entry.lastmod}</lastmod></url>`).join('\n')}\n</urlset>`;
    res.type('application/xml').send(xml);
  });

  app.get('/', async (req, res) => {
    const posts = (await getAllPosts()).filter((post) => post.visibility === 'public' && !post.draft);
    const featured = posts[0] || null;
    const body = `
      <section class="hero hero-compact">
        <div>
          <p class="eyebrow">Boss Blog</p>
          <h1>Catatan, tips, dan random thoughts yang enak dibaca.</h1>
          <p>Frontpage kita bikin editorial dikit bos — portrait cards, tag lebih ceria, dan fallback image kalau admin lagi males nyari gambar 😏</p>
        </div>
        ${featured ? `<a class="hero-feature card" href="/blog/${featured.slug}">
          ${renderFeatureImage(featured, 'card')}
          <div class="hero-feature-copy">
            <div class="meta-row"><span class="meta">${new Date(featured.date).toLocaleDateString('id-ID')}</span></div>
            <h2>${esc(featured.title)}</h2>
            <p>${esc(featured.description)}</p>
          </div>
        </a>` : ''}
      </section>
      <section>
        <div class="section-head"><h2>Recent Posts</h2><p class="muted">Portrait cards dulu biar rapi, nanti orientasi manual bisa kita tambah dari admin.</p></div>
        <div class="post-grid">
          ${posts.map((post) => `
            <article class="post-card">
              <a href="/blog/${post.slug}">
                ${renderFeatureImage(post, 'card')}
                <div class="post-card-body">
                  <div class="meta-row"><span class="meta">${new Date(post.date).toLocaleDateString('id-ID')}</span></div>
                  <h3>${esc(post.title)}</h3>
                  <p>${esc(post.description)}</p>
                  <div class="tag-row">${renderTagChips(post.tags)}</div>
                </div>
              </a>
            </article>`).join('') || '<p>Belum ada post.</p>'}
        </div>
      </section>`;
    res.send(layout({ title: 'Boss Blog', body, description: 'Blog pribadi berisi catatan, tips, dan random thoughts yang enak dibaca.', canonicalPath: '/', authed: isAuthed(req) }));
  });

  app.get('/about', (_req, res) => {
    const body = `
      <article class="prose-card">
        <h1>About</h1>
        <p>Ini blog pribadi gua. Tempat nyimpen catatan, sharing tips development, dan kadang nulis random thoughts.</p>
        <p>Ada post public, unlisted, dan private.</p>
        <ul>
          <li>Express.js</li>
          <li>Markdown files</li>
          <li>Simple built-in admin</li>
          <li>Local image upload + external feature image URL</li>
        </ul>
      </article>`;
    res.send(layout({ title: 'About — Boss Blog', body, description: 'Tentang Boss Blog, blog pribadi dengan catatan, tips development, dan random thoughts.', canonicalPath: '/about', authed: false }));
  });

  app.get('/login', (req, res) => {
    const next = esc(req.query.next || '/admin');
    const body = `
      <section class="auth-card">
        <h1>Boss Login 🔐</h1>
        <p>Login buat buka post private dan admin editor.</p>
        ${!ADMIN_PASSWORD ? '<div class="notice">Set dulu env <code>BLOG_ADMIN_PASSWORD</code> di hosting.</div>' : ''}
        <form method="post" action="/login" class="form-stack">
          <input type="hidden" name="next" value="${next}" />
          <input name="password" type="password" placeholder="Password" required />
          <button ${!ADMIN_PASSWORD ? 'disabled' : ''}>Login</button>
        </form>
      </section>`;
    res.send(layout({ title: 'Login — Boss Blog', body, description: 'Login admin Boss Blog untuk mengelola post dan konten private.', canonicalPath: '/login', authed: isAuthed(req) }));
  });

  app.post('/login', (req, res) => {
    const { password = '', next = '/admin' } = req.body;
    if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
      return res.redirect(`/login?next=${encodeURIComponent(next)}`);
    }
    res.cookie(AUTH_COOKIE, '1', { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 24 * 30 });
    res.redirect(next);
  });

  app.post('/logout', (_req, res) => {
    res.clearCookie(AUTH_COOKIE);
    res.redirect('/');
  });

  app.get('/blog/:slug', async (req, res) => {
    const post = await getPostBySlug(req.params.slug);
    if (!post || post.draft) return res.status(404).send(layout({ title: 'Not found', body: '<h1>404</h1><p>Post nggak ketemu.</p>', description: 'Halaman tidak ditemukan di Boss Blog.', canonicalPath: '/404', authed: isAuthed(req) }));
    if (post.visibility === 'private' && !isAuthed(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const allPosts = (await getAllPosts()).filter((item) => item.slug !== post.slug && item.visibility === 'public' && !item.draft);
    const relatedPosts = allPosts.filter((item) => item.tags.some((tag) => post.tags.includes(tag))).slice(0, 4);
    const badge = post.visibility === 'private' ? '<span class="pill red">🔒 Private</span>' : post.visibility === 'unlisted' ? '<span class="pill yellow">👁️ Unlisted</span>' : '';
    const body = `
      <section class="post-layout">
        <article class="prose-card prose post-main">
          ${badge}
          ${renderFeatureImage(post)}
          <h1>${esc(post.title)}</h1>
          <p class="lede">${esc(post.description)}</p>
          <div class="meta">${new Date(post.date).toLocaleDateString('id-ID')} ${post.updated ? `· Updated ${esc(post.updated)}` : ''}</div>
          <div class="tags tag-row">${renderTagChips(post.tags)}</div>
          <div class="content">${post.html}</div>
          <div class="actions"><a href="/">← Back</a> ${isAuthed(req) ? `<a href="/admin?slug=${post.slug}">Edit post</a>` : ''}</div>
        </article>
        <aside class="post-side">
          <div class="card side-card">
            <h3>Tags</h3>
            <div class="tag-row">${renderTagChips(post.tags) || '<span class="muted">Belum ada tag.</span>'}</div>
          </div>
          <div class="card side-card">
            <h3>Related Posts</h3>
            <div class="sidebar-list">
              ${relatedPosts.map((item) => `<a class="sidebar-item" href="/blog/${item.slug}"><strong>${esc(item.title)}</strong><span>${new Date(item.date).toLocaleDateString('id-ID')}</span></a>`).join('') || '<p class="muted small">Belum ada related post yang cocok, bos.</p>'}
            </div>
          </div>
          <div class="card side-card">
            <h3>Elsewhere</h3>
            <div class="sidebar-list compact-list">
              <a class="sidebar-item" href="https://x.com" target="_blank" rel="noreferrer"><strong>X / Twitter</strong><span>Buat share kalau nanti mau.</span></a>
              <a class="sidebar-item" href="https://instagram.com" target="_blank" rel="noreferrer"><strong>Instagram</strong><span>Masih placeholder, gampang diganti nanti.</span></a>
            </div>
          </div>
          <div class="card side-card ad-card">
            <h3>Ads / Promo Slot</h3>
            <p class="muted">Tempat iklan, CTA, affiliate, atau banner receh bos. Masih dummy dulu.</p>
          </div>
        </aside>
      </section>`;
    res.send(layout({ title: post.title, body, description: post.description, canonicalPath: `/blog/${post.slug}`, ogImage: post.featureImage || getDefaultFeatureUrl(post), authed: isAuthed(req) }));
  });

  app.post('/admin/import-json', loginRequired, async (req, res) => {
    try {
      const payload = Array.isArray(req.body) ? req.body : Array.isArray(req.body.items) ? req.body.items : null;
      if (!payload || !payload.length) return res.status(400).json({ ok: false, error: 'JSON harus berupa array post atau { items: [...] }' });
      const imported = [];
      for (const item of payload) {
        const normalized = normalizeImportItem(item);
        const slug = await savePost(normalized);
        imported.push({ slug, title: normalized.title });
      }
      await writeDebug('Imported JSON posts', { count: imported.length });
      return res.json({ ok: true, count: imported.length, imported });
    } catch (error) {
      console.error('Import JSON error:', error);
      await writeDebug('Import JSON error', { error: error.message, stack: error.stack || '' });
      return res.status(400).json({ ok: false, error: error.message || 'Import gagal' });
    }
  });

  app.post('/admin/upload-image', loginRequired, (req, res) => {
    writeDebug('Upload request received', {
      contentType: req.headers['content-type'] || '',
      contentLength: req.headers['content-length'] || '',
      cookiePresent: Boolean(req.headers.cookie),
    });
    upload.single('image')(req, res, async (error) => {
      if (error) {
        console.error('Upload image error:', error);
        await writeDebug('Upload image error', {
          error: error.message,
          code: error.code || '',
          field: error.field || '',
          stack: error.stack || '',
        });
        return res.status(400).json({ ok: false, error: error.message || 'Upload failed' });
      }
      if (!req.file) {
        await writeDebug('Upload image missing file', {});
        return res.status(400).json({ ok: false, error: 'No image uploaded or file type is not supported' });
      }
      await writeDebug('Upload image success', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        filename: req.file.filename,
        destination: req.file.destination,
      });
      res.json({ ok: true, url: `/uploads/${req.file.filename}`, filename: req.file.filename });
    });
  });

  app.get('/admin', loginRequired, async (req, res) => {
    const posts = await getAllPosts();
    const uploads = await getUploadedImages();
    const recentUploads = uploads.slice(0, 24);
    const slug = String(req.query.slug || '');
    const editing = slug ? posts.find((p) => p.slug === slug) : null;
    const body = `
      <section class="admin-grid">
        <aside class="sidebar card">
          <div class="sidebar-head"><h2>Posts</h2><a href="/admin">+ New</a></div>
          <div class="sidebar-list">
            ${posts.map((post) => `<a class="sidebar-item ${editing?.slug === post.slug ? 'active' : ''}" href="/admin?slug=${post.slug}"><strong>${esc(post.title)}</strong></a>`).join('')}
          </div>
          <form method="post" action="/logout"><button class="ghost-btn">Logout</button></form>
        </aside>
        <section class="card editor">
          <h1>${editing ? 'Edit Post' : 'New Post'}</h1>
          <p class="muted">Simple built-in editor. Markdown, cepat, gampang dideploy.</p>
          <form method="post" action="/admin/save" class="form-stack">
            <input type="hidden" name="originalSlug" value="${esc(editing?.slug || '')}" />
            <div class="grid-2">
              <label><span>Title</span><input name="title" value="${esc(editing?.title || '')}" required /></label>
              <label><span>Date</span><input type="date" name="date" value="${esc(editing?.date || new Date().toISOString().slice(0,10))}" required /></label>
            </div>
            <label><span>Description</span><input id="descriptionField" name="description" value="${esc(editing?.description || '')}" placeholder="Kosongin aja kalau mau auto-template" /></label>
            <div class="grid-2">
              <label><span>Description tone</span><select name="descriptionTone">${['formal','santai','nakal'].map((tone) => `<option value="${tone}" ${(editing?.descriptionTone || DEFAULT_DESCRIPTION_TONE) === tone ? 'selected' : ''}>${tone}</option>`).join('')}</select></label>
              <label><span>Visibility</span><select name="visibility">${['public','unlisted','private'].map((v) => `<option value="${v}" ${(editing?.visibility || 'public') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            </div>
            <div class="grid-2">
              <label><span>Tags</span><input name="tags" value="${esc((editing?.tags || []).join(', '))}" placeholder="nodejs, notes" /></label>
              <div></div>
            </div>
            <label><span>Feature image URL</span><input id="featureImageField" name="featureImage" value="${esc(editing?.featureImage || '')}" placeholder="/uploads/example.jpg atau https://..." /></label>
            <p class="muted small">Tip: remote image paling aman pakai direct URL <code>.jpg</code> / <code>.png</code>. <code>.webp</code> kadang gagal kalau source-nya redirect, hotlink-protected, atau header-nya aneh. Kalau ngambek, upload lokal aja biar aman.</p>
            <div class="upload-box">
              <div><strong>Upload image</strong><p class="muted">Upload gambar lokal. Hasil upload akan kasih URL yang bisa lu tempel ke markdown pakai format <code>![alt text](/uploads/nama-file.jpg)</code>. Feature image juga bisa pakai external URL.</p></div>
              <div class="upload-row"><input id="imageUpload" name="image" type="file" accept="image/*" /><button id="uploadButton" class="ghost-btn" type="button" onclick="return window.uploadBossImage?.(event)">Upload</button></div>
              <div id="uploadResult" class="muted small"></div>
              <details id="uploadDebugWrap" class="debug-panel"><summary>Debug</summary><div id="uploadDebug" class="muted small"></div></details>
              <div class="upload-library">
                <div class="sidebar-head"><h3>Image Library</h3><span class="muted small">${uploads.length} file · latest ${recentUploads.length}</span></div>
                <label class="library-search-wrap"><span class="muted small">Search image</span><input id="librarySearch" type="search" placeholder="Cari nama file..." autocomplete="off" /></label>
                <div class="library-scroll sidebar-list">
                  ${recentUploads.map((image) => `<div class="sidebar-item library-item" data-image-search="${esc(image.name).toLowerCase()}"><strong>${esc(image.name)}</strong><span class="library-actions"><a href="${esc(image.url)}" target="_blank" rel="noreferrer">Open</a><button type="button" class="ghost-btn small-btn" data-action="insert" data-image-url="${esc(image.url)}" data-image-name="${esc(image.name)}">Insert</button><button type="button" class="ghost-btn small-btn" data-action="use" data-image-url="${esc(image.url)}" data-image-name="${esc(image.name)}">Use</button></span></div>`).join('') || '<p class="muted small">Belum ada gambar di library, bos.</p>'}
                </div>
                <div id="libraryEmpty" class="muted small" hidden>Nggak ada file yang cocok, bos.</div>
              </div>
            </div>
            <label class="checkbox"><input type="checkbox" name="draft" ${editing?.draft ? 'checked' : ''} /> <span>Save as draft</span></label>
            <label><span>Content (Markdown)</span><textarea id="bodyField" name="body" rows="20">${esc(editing?.body || '')}</textarea></label>
            <div class="ai-helper card">
              <div class="sidebar-head"><h3>Admin Malas Helper</h3><span class="muted small">Prompt helper dulu biar nggak generik</span></div>
              <p class="muted small">Belum full auto, tapi ini bantu lu bikin prompt yang lebih natural buat AI luar. Tinggal copy lalu tempel ke tool/model favorit.</p>
              <div class="helper-actions">
                <button type="button" class="ghost-btn small-btn" id="copyDescriptionPrompt">Copy Description Prompt</button>
                <button type="button" class="ghost-btn small-btn" id="copyArticlePrompt">Copy Full Article Prompt</button>
              </div>
              <textarea id="promptOutput" rows="8" placeholder="Prompt siap copy bakal nongol di sini..."></textarea>
            </div>
            <div class="ai-helper card">
              <div class="sidebar-head"><h3>JSON Import</h3><span class="muted small">Bulk post buat admin pemalas</span></div>
              <p class="muted small">Paste array JSON atau object <code>{"items": [...]}</code>. Field aman: <code>title</code>, <code>description</code>, <code>date</code>, <code>tags</code>, <code>visibility</code>, <code>draft</code>, <code>featureImage</code>, <code>body</code>.</p>
              <textarea id="jsonImportInput" rows="10" placeholder='[{"title":"Judul post","description":"Deskripsi","date":"2026-05-07","tags":["nodejs"],"visibility":"public","draft":false,"featureImage":"/uploads/sample.jpg","body":"# Isi markdown"}]'></textarea>
              <div class="helper-actions">
                <button type="button" class="ghost-btn small-btn" id="importJsonButton">Import JSON</button>
              </div>
              <div id="jsonImportResult" class="muted small"></div>
            </div>
            <details class="feature-preview-box" id="featurePreviewBox">
              <summary class="sidebar-head"><h3>Feature Preview</h3><span id="featureImageStatus" class="muted small">Belum ada gambar</span></summary>
              <div class="feature-preview-body">
                <img id="featureImagePreview" class="feature-preview-image" alt="Feature preview" hidden />
                <div id="featureImageFallback" class="feature-image feature-image-fallback feature-preview-fallback"><span>admin males nyari gambar</span></div>
              </div>
            </details>
            <div class="actions"><button type="submit">Save post</button>${editing ? `<a href="/blog/${editing.slug}">Preview</a>` : ''}</div>
          </form>
        </section>
      </section>
      <script>
        const uploadInput = document.getElementById('imageUpload');
        const uploadButton = document.getElementById('uploadButton');
        const uploadResult = document.getElementById('uploadResult');
        const uploadDebug = document.getElementById('uploadDebug');
        const featureImageField = document.getElementById('featureImageField');
        const titleField = document.querySelector('input[name="title"]');
        const descriptionField = document.getElementById('descriptionField');
        const tagsField = document.querySelector('input[name="tags"]');
        const bodyField = document.getElementById('bodyField');
        const librarySearch = document.getElementById('librarySearch');
        const libraryEmpty = document.getElementById('libraryEmpty');
        const promptOutput = document.getElementById('promptOutput');
        const jsonImportInput = document.getElementById('jsonImportInput');
        const jsonImportResult = document.getElementById('jsonImportResult');

        function insertMarkdown(markdown) {
          if (!bodyField) return;
          const start = bodyField.selectionStart ?? bodyField.value.length;
          const end = bodyField.selectionEnd ?? bodyField.value.length;
          bodyField.value = bodyField.value.slice(0, start) + markdown + bodyField.value.slice(end);
          bodyField.focus();
          const pos = start + markdown.length;
          bodyField.setSelectionRange(pos, pos);
        }

        function buildDescriptionPrompt() {
          const title = titleField?.value?.trim() || 'Tanpa judul';
          const tags = tagsField?.value?.trim() || '-';
          const body = bodyField?.value?.trim() || '';
          return [
            'Bikin deskripsi blog pendek dalam Bahasa Indonesia yang natural, bukan gaya AI generik.',
            'Aturan:',
            '- Maksimal 2 kalimat',
            '- Nada santai, hangat, manusiawi',
            '- Hindari pembuka template seperti "Artikel ini membahas" atau "Dalam artikel ini"',
            '- Fokus pada manfaat/angle paling menarik',
            '',
            'Judul: ' + title,
            'Tags: ' + tags,
            'Isi artikel:',
            body || '[kosong]'
          ].join('\\n');
        }

        function buildArticlePrompt() {
          const title = titleField?.value?.trim() || 'Tanpa judul';
          const tags = tagsField?.value?.trim() || '-';
          const desc = descriptionField?.value?.trim() || '-';
          return [
            'Tulis artikel blog dalam Bahasa Indonesia yang natural dan terasa seperti tulisan manusia, bukan AI generik.',
            'Aturan:',
            '- Jangan pakai kalimat template dan basa-basi berlebihan',
            '- Kasih contoh konkret, opini ringan, dan detail praktis',
            '- Struktur markdown rapi dengan heading seperlunya',
            '- Panjang sedang, enak dibaca, tidak muter-muter',
            '- Boleh sedikit santai, tapi tetap informatif',
            '',
            'Topik/Judul: ' + title,
            'Tags: ' + tags,
            'Angle/deskripsi awal: ' + desc,
            '',
            'Tambahkan juga di akhir:',
            '1. deskripsi singkat 1-2 kalimat',
            '2. 5 tag yang relevan',
            '3. prompt featured image yang cocok'
          ].join('\\n');
        }

        const featureImagePreview = document.getElementById('featureImagePreview');
        const featureImageFallback = document.getElementById('featureImageFallback');
        const featureImageStatus = document.getElementById('featureImageStatus');
        const featurePreviewBox = document.getElementById('featurePreviewBox');

        function refreshFeaturePreview(url) {
          const safeUrl = (url || '').trim();
          if (!safeUrl) {
            if (featureImagePreview) {
              featureImagePreview.hidden = true;
              featureImagePreview.removeAttribute('src');
            }
            if (featureImageFallback) featureImageFallback.hidden = false;
            if (featureImageStatus) featureImageStatus.textContent = 'Belum ada gambar';
            if (featurePreviewBox) featurePreviewBox.open = false;
            return;
          }
          if (featureImageStatus) featureImageStatus.textContent = 'Mencoba load image...';
          if (!featureImagePreview) return;
          featureImagePreview.hidden = false;
          featureImagePreview.onload = () => {
            if (featureImageFallback) featureImageFallback.hidden = true;
            if (featureImageStatus) featureImageStatus.textContent = 'Image OK';
            if (featurePreviewBox) featurePreviewBox.open = false;
          };
          featureImagePreview.onerror = () => {
            featureImagePreview.hidden = true;
            featureImagePreview.removeAttribute('src');
            if (featureImageFallback) featureImageFallback.hidden = false;
            if (featureImageStatus) featureImageStatus.textContent = 'Image gagal dimuat — coba JPG/PNG atau upload lokal';
            if (featurePreviewBox) featurePreviewBox.open = true;
          };
          featureImagePreview.src = safeUrl;
        }

        function renderUploadResult(name, url) {
          const markdown = '![alt text](' + url + ')';
          uploadResult.innerHTML = 'Markdown: <code>' + markdown + '</code><br><div class="helper-actions"><button type="button" class="ghost-btn small-btn" id="copyUploadedMarkdown">Copy Markdown</button><button type="button" class="ghost-btn small-btn" id="copyUploadedUrl">Copy URL</button><button type="button" class="ghost-btn small-btn" id="insertUploadedImage">Insert to post</button> <button type="button" class="ghost-btn small-btn" id="useUploadedImage">Use as featured</button> <a href="' + url + '" target="_blank" rel="noreferrer">Open</a></div>';
          document.getElementById('copyUploadedMarkdown')?.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(markdown);
              uploadDebug.textContent = 'Debug: copied markdown';
            } catch {
              uploadDebug.textContent = 'Debug: markdown ready di layar';
            }
          });
          document.getElementById('copyUploadedUrl')?.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(url);
              uploadDebug.textContent = 'Debug: copied url';
            } catch {
              uploadDebug.textContent = 'Debug: url ready di layar';
            }
          });
          document.getElementById('insertUploadedImage')?.addEventListener('click', () => {
            insertMarkdown(markdown);
            uploadDebug.textContent = 'Debug: inserted uploaded image into post';
          });
          document.getElementById('useUploadedImage')?.addEventListener('click', () => {
            if (featureImageField) featureImageField.value = url;
            uploadDebug.textContent = 'Debug: set uploaded image as featured';
          });
        }

        window.uploadBossImage = async (event) => {
          event?.preventDefault?.();
          const file = uploadInput?.files?.[0];
          if (!file) { uploadResult.textContent = 'Pilih file dulu boss.'; return false; }
          uploadButton.disabled = true;
          uploadResult.textContent = 'Uploading...';
          uploadDebug.textContent = 'Debug: ' + [file.name, file.type || 'no-mime', file.size + ' bytes'].join(' | ');
          try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await fetch('/admin/upload-image', {
              method: 'POST',
              body: formData,
              headers: { Accept: 'application/json' },
              credentials: 'same-origin'
            });
            const contentType = res.headers.get('content-type') || '';
            const payload = contentType.includes('application/json') ? await res.json() : { ok: false, error: await res.text() };
            if (!res.ok || !payload.ok) throw new Error(payload.error || 'Upload failed');
            if (featureImageField) featureImageField.value = payload.url;
            renderUploadResult(payload.filename || 'image', payload.url);
            uploadDebug.textContent = 'Debug: success';
            uploadInput.value = '';
          } catch (err) {
            console.error('Upload gagal:', err);
            uploadResult.textContent = err.message || 'Upload gagal';
            uploadDebug.textContent = 'Debug: ' + (err?.stack || err?.message || String(err));
          } finally {
            uploadButton.disabled = false;
          }
          return false;
        };
        uploadButton?.addEventListener('click', window.uploadBossImage);
        featureImageField?.addEventListener('input', () => refreshFeaturePreview(featureImageField.value));
        refreshFeaturePreview(featureImageField?.value || '');

        function filterLibrary() {
          const query = (librarySearch?.value || '').trim().toLowerCase();
          const items = Array.from(document.querySelectorAll('.library-item'));
          let visibleCount = 0;
          items.forEach((item) => {
            const haystack = item.getAttribute('data-image-search') || '';
            const match = !query || haystack.includes(query);
            item.hidden = !match;
            if (match) visibleCount += 1;
          });
          if (libraryEmpty) libraryEmpty.hidden = visibleCount > 0;
        }

        librarySearch?.addEventListener('input', filterLibrary);
        filterLibrary();

        document.getElementById('copyDescriptionPrompt')?.addEventListener('click', async () => {
          const prompt = buildDescriptionPrompt();
          if (promptOutput) promptOutput.value = prompt;
          try {
            await navigator.clipboard.writeText(prompt);
            uploadDebug.textContent = 'Debug: description prompt copied';
          } catch {
            uploadDebug.textContent = 'Debug: description prompt ready di box';
          }
        });

        document.getElementById('copyArticlePrompt')?.addEventListener('click', async () => {
          const prompt = buildArticlePrompt();
          if (promptOutput) promptOutput.value = prompt;
          try {
            await navigator.clipboard.writeText(prompt);
            uploadDebug.textContent = 'Debug: article prompt copied';
          } catch {
            uploadDebug.textContent = 'Debug: article prompt ready di box';
          }
        });

        document.getElementById('importJsonButton')?.addEventListener('click', async () => {
          const raw = jsonImportInput?.value?.trim() || '';
          if (!raw) {
            if (jsonImportResult) jsonImportResult.textContent = 'Paste JSON dulu boss.';
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            if (jsonImportResult) jsonImportResult.textContent = 'Importing...';
            const res = await fetch('/admin/import-json', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify(parsed)
            });
            const payload = await res.json();
            if (!res.ok || !payload.ok) throw new Error(payload.error || 'Import gagal');
            if (jsonImportResult) jsonImportResult.innerHTML = 'Imported <strong>' + payload.count + '</strong> post. Reload admin kalau mau lihat list terbaru.';
          } catch (error) {
            if (jsonImportResult) jsonImportResult.textContent = error.message || 'Import gagal';
          }
        });

        document.querySelectorAll('[data-image-url]').forEach((button) => {
          button.addEventListener('click', () => {
            const url = button.getAttribute('data-image-url') || '';
            const name = button.getAttribute('data-image-name') || 'image';
            const action = button.getAttribute('data-action') || 'use';
            const markdown = '![' + name + '](' + url + ')';
            if (action === 'insert') {
              insertMarkdown(markdown);
              uploadResult.innerHTML = 'Selected markdown: <code>' + markdown + '</code>';
              uploadDebug.textContent = 'Debug: reused existing image in post';
              return;
            }
            if (featureImageField) featureImageField.value = url;
            uploadResult.innerHTML = 'Featured image: <a href="' + url + '" target="_blank" rel="noreferrer">' + url + '</a>';
            uploadDebug.textContent = 'Debug: reused existing image as featured';
          });
        });
      </script>`;
    res.send(layout({ title: 'Admin — Boss Blog', body, description: 'Dashboard admin Boss Blog untuk mengelola post, image upload, dan prompt helper.', canonicalPath: '/admin', authed: true }));
  });

  app.post('/admin/save', loginRequired, async (req, res) => {
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const date = String(req.body.date || '').trim();
    const visibility = ['public', 'unlisted', 'private'].includes(req.body.visibility) ? req.body.visibility : 'public';
    const descriptionTone = normalizeTone(String(req.body.descriptionTone || ''));
    const tags = String(req.body.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
    const featureImage = safeUrl(req.body.featureImage || '');
    const draft = req.body.draft === 'on';
    const body = String(req.body.body || '');
    const originalSlug = String(req.body.originalSlug || '');
    if (!title || !date) return res.redirect('/admin');
    const slug = await savePost({ originalSlug, title, description, date, descriptionTone, tags, visibility, featureImage, body, draft });
    res.redirect(`/admin?slug=${slug}`);
  });

  app.listen(PORT, () => console.log(`Boss Blog listening on http://localhost:${PORT}`));
}

boot().catch((error) => {
  console.error('Failed to boot Boss Blog:', error);
  process.exit(1);
});
