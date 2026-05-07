import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { marked } from 'marked';
import slugify from 'slugify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const POSTS_DIR = path.join(__dirname, 'content', 'posts');
const PUBLIC_DIR = path.join(__dirname, 'public');
const AUTH_COOKIE = 'boss_blog_auth';
const ADMIN_PASSWORD = process.env.BLOG_ADMIN_PASSWORD || '';

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(PUBLIC_DIR));

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout({ title, body, authed = false }) {
  return `<!doctype html>
  <html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
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

async function ensurePostsDir() {
  await fs.mkdir(POSTS_DIR, { recursive: true });
}

function normalizeMeta(slug, data = {}) {
  return {
    slug,
    title: data.title || slug,
    description: data.description || '',
    date: data.date || new Date().toISOString().slice(0, 10),
    updated: data.updated || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    visibility: ['public', 'unlisted', 'private'].includes(data.visibility) ? data.visibility : 'public',
    draft: Boolean(data.draft),
  };
}

async function getAllPosts() {
  await ensurePostsDir();
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

function makeSlug(input) {
  return slugify(input || '', { lower: true, strict: true, trim: true }) || `post-${Date.now()}`;
}

async function savePost({ originalSlug = '', title, description, date, tags, visibility, body, draft }) {
  await ensurePostsDir();
  const slug = makeSlug(title);
  if (originalSlug && originalSlug !== slug) {
    await fs.rm(path.join(POSTS_DIR, `${originalSlug}.md`), { force: true });
  }
  const file = path.join(POSTS_DIR, `${slug}.md`);
  const content = matter.stringify((body || '').trim() + '\n', {
    title,
    description,
    date,
    updated: new Date().toISOString().slice(0, 10),
    tags,
    visibility,
    draft,
  });
  await fs.writeFile(file, content, 'utf8');
  return slug;
}

function loginRequired(req, res, next) {
  if (isAuthed(req)) return next();
  const nextUrl = encodeURIComponent(req.originalUrl || '/admin');
  res.redirect(`/login?next=${nextUrl}`);
}

app.get('/', async (req, res) => {
  const posts = (await getAllPosts()).filter((post) => post.visibility === 'public' && !post.draft);
  const body = `
    <section class="hero">
      <h1>Hey 👋</h1>
      <p>Blog pribadi. Catatan, tips, dan random thoughts.</p>
    </section>
    <section>
      <h2>Recent Posts</h2>
      <div class="post-list">
        ${posts.map((post) => `
          <article class="card">
            <a href="/blog/${post.slug}">
              <div class="meta">${new Date(post.date).toLocaleDateString('id-ID')} · ${post.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</div>
              <h3>${esc(post.title)}</h3>
              <p>${esc(post.description)}</p>
            </a>
          </article>`).join('') || '<p>Belum ada post.</p>'}
      </div>
    </section>`;
  res.send(layout({ title: 'Boss Blog', body, authed: isAuthed(req) }));
});

app.get('/about', (req, res) => {
  const body = `
    <article class="prose-card">
      <h1>About</h1>
      <p>Ini blog pribadi gua. Tempat nyimpen catatan, sharing tips development, dan kadang nulis random thoughts.</p>
      <p>Ada post public, unlisted, dan private.</p>
      <ul>
        <li>Express.js</li>
        <li>Markdown files</li>
        <li>Simple built-in admin</li>
      </ul>
    </article>`;
  res.send(layout({ title: 'About — Boss Blog', body, authed: isAuthed(req) }));
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
  res.send(layout({ title: 'Login — Boss Blog', body, authed: isAuthed(req) }));
});

app.post('/login', (req, res) => {
  const { password = '', next = '/admin' } = req.body;
  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return res.redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  res.cookie(AUTH_COOKIE, '1', { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 24 * 30 });
  res.redirect(next);
});

app.post('/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE);
  res.redirect('/');
});

app.get('/blog/:slug', async (req, res) => {
  const post = await getPostBySlug(req.params.slug);
  if (!post || post.draft) return res.status(404).send(layout({ title: 'Not found', body: '<h1>404</h1><p>Post nggak ketemu.</p>', authed: isAuthed(req) }));
  if (post.visibility === 'private' && !isAuthed(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  if (post.visibility === 'unlisted' || post.visibility === 'private') {
    // accessible via direct URL only; no extra handling here
  }
  const badge = post.visibility === 'private' ? '<span class="pill red">🔒 Private</span>' : post.visibility === 'unlisted' ? '<span class="pill yellow">👁️ Unlisted</span>' : '';
  const body = `
    <article class="prose-card prose">
      ${badge}
      <h1>${esc(post.title)}</h1>
      <p class="lede">${esc(post.description)}</p>
      <div class="meta">${new Date(post.date).toLocaleDateString('id-ID')} ${post.updated ? `· Updated ${esc(post.updated)}` : ''}</div>
      <div class="tags">${post.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="content">${post.html}</div>
      <div class="actions"><a href="/">← Back</a> ${isAuthed(req) ? `<a href="/admin?slug=${post.slug}">Edit post</a>` : ''}</div>
    </article>`;
  res.send(layout({ title: post.title, body, authed: isAuthed(req) }));
});

app.get('/admin', loginRequired, async (req, res) => {
  const posts = await getAllPosts();
  const slug = String(req.query.slug || '');
  const editing = slug ? posts.find((p) => p.slug === slug) : null;
  const body = `
    <section class="admin-grid">
      <aside class="sidebar card">
        <div class="sidebar-head"><h2>Posts</h2><a href="/admin">+ New</a></div>
        <div class="sidebar-list">
          ${posts.map((post) => `<a class="sidebar-item ${editing?.slug === post.slug ? 'active' : ''}" href="/admin?slug=${post.slug}"><strong>${esc(post.title)}</strong><span>${esc(post.visibility)} · ${esc(post.date)}</span></a>`).join('')}
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
          <label><span>Description</span><input name="description" value="${esc(editing?.description || '')}" required /></label>
          <div class="grid-2">
            <label><span>Visibility</span><select name="visibility">
              ${['public','unlisted','private'].map((v) => `<option value="${v}" ${(editing?.visibility || 'public') === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select></label>
            <label><span>Tags</span><input name="tags" value="${esc((editing?.tags || []).join(', '))}" placeholder="nodejs, notes" /></label>
          </div>
          <label class="checkbox"><input type="checkbox" name="draft" ${editing?.draft ? 'checked' : ''} /> <span>Save as draft</span></label>
          <label><span>Content (Markdown)</span><textarea name="body" rows="20">${esc(editing?.body || '')}</textarea></label>
          <div class="actions"><button type="submit">Save post</button>${editing ? `<a href="/blog/${editing.slug}">Preview</a>` : ''}</div>
        </form>
      </section>
    </section>`;
  res.send(layout({ title: 'Admin — Boss Blog', body, authed: true }));
});

app.post('/admin/save', loginRequired, async (req, res) => {
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const date = String(req.body.date || '').trim();
  const visibility = ['public', 'unlisted', 'private'].includes(req.body.visibility) ? req.body.visibility : 'public';
  const tags = String(req.body.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
  const draft = req.body.draft === 'on';
  const body = String(req.body.body || '');
  const originalSlug = String(req.body.originalSlug || '');
  if (!title || !description || !date) return res.redirect('/admin');
  const slug = await savePost({ originalSlug, title, description, date, tags, visibility, body, draft });
  res.redirect(`/admin?slug=${slug}`);
});

app.listen(PORT, () => {
  console.log(`Boss Blog listening on http://localhost:${PORT}`);
});
