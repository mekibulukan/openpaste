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
const POSTS_DIR = path.join(__dirname, 'content', 'posts');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(APP_ROOT, 'uploads');
const DEBUG_LOG = path.join(APP_ROOT, 'debug.log');
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

async function boot() {
  await fs.mkdir(POSTS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await writeDebug('Boot complete', { APP_ROOT, POSTS_DIR, PUBLIC_DIR, UPLOADS_DIR, DEBUG_LOG });

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

  function normalizeMeta(slug, data = {}) {
    return {
      slug,
      title: data.title || slug,
      description: data.description || '',
      date: data.date || new Date().toISOString().slice(0, 10),
      updated: data.updated || '',
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

  async function savePost({ originalSlug = '', title, description, date, tags, visibility, featureImage, body, draft }) {
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
      featureImage: safeUrl(featureImage),
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

  function renderFeatureImage(url, alt = '') {
    const safe = safeUrl(url);
    if (!safe) return '';
    return `<img class="feature-image" src="${esc(safe)}" alt="${esc(alt)}" loading="lazy" />`;
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
                ${renderFeatureImage(post.featureImage, post.title)}
                <div class="meta">${new Date(post.date).toLocaleDateString('id-ID')} · ${post.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</div>
                <h3>${esc(post.title)}</h3>
                <p>${esc(post.description)}</p>
              </a>
            </article>`).join('') || '<p>Belum ada post.</p>'}
        </div>
      </section>`;
    res.send(layout({ title: 'Boss Blog', body, authed: isAuthed(req) }));
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
    res.send(layout({ title: 'About — Boss Blog', body, authed: false }));
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

  app.post('/logout', (_req, res) => {
    res.clearCookie(AUTH_COOKIE);
    res.redirect('/');
  });

  app.get('/blog/:slug', async (req, res) => {
    const post = await getPostBySlug(req.params.slug);
    if (!post || post.draft) return res.status(404).send(layout({ title: 'Not found', body: '<h1>404</h1><p>Post nggak ketemu.</p>', authed: isAuthed(req) }));
    if (post.visibility === 'private' && !isAuthed(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const badge = post.visibility === 'private' ? '<span class="pill red">🔒 Private</span>' : post.visibility === 'unlisted' ? '<span class="pill yellow">👁️ Unlisted</span>' : '';
    const body = `
      <article class="prose-card prose">
        ${badge}
        ${renderFeatureImage(post.featureImage, post.title)}
        <h1>${esc(post.title)}</h1>
        <p class="lede">${esc(post.description)}</p>
        <div class="meta">${new Date(post.date).toLocaleDateString('id-ID')} ${post.updated ? `· Updated ${esc(post.updated)}` : ''}</div>
        <div class="tags">${post.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <div class="content">${post.html}</div>
        <div class="actions"><a href="/">← Back</a> ${isAuthed(req) ? `<a href="/admin?slug=${post.slug}">Edit post</a>` : ''}</div>
      </article>`;
    res.send(layout({ title: post.title, body, authed: isAuthed(req) }));
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
              <label><span>Visibility</span><select name="visibility">${['public','unlisted','private'].map((v) => `<option value="${v}" ${(editing?.visibility || 'public') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
              <label><span>Tags</span><input name="tags" value="${esc((editing?.tags || []).join(', '))}" placeholder="nodejs, notes" /></label>
            </div>
            <label><span>Feature image URL</span><input name="featureImage" value="${esc(editing?.featureImage || '')}" placeholder="/uploads/example.jpg atau https://..." /></label>
            <div class="upload-box">
              <div><strong>Upload image</strong><p class="muted">Upload gambar lokal. Hasil upload akan kasih URL yang bisa lu tempel ke markdown pakai format <code>![alt text](/uploads/nama-file.jpg)</code>. Feature image juga bisa pakai external URL.</p></div>
              <div class="upload-row"><input id="imageUpload" name="image" type="file" accept="image/*" /><button id="uploadButton" class="ghost-btn" type="button" onclick="return window.uploadBossImage?.(event)">Upload</button></div>
              <div id="uploadResult" class="muted small"></div>
              <div id="uploadDebug" class="muted small"></div>
              <div class="upload-library">
                <div class="sidebar-head"><h3>Image Library</h3><span class="muted small">${uploads.length} file · latest ${recentUploads.length}</span></div>
                <div class="sidebar-list" style="max-height: 320px; overflow: auto;">
                  ${recentUploads.map((image) => `<div class="sidebar-item"><strong>${esc(image.name)}</strong><span><a href="${esc(image.url)}" target="_blank" rel="noreferrer">Open</a> · <button type="button" class="ghost-btn small-btn" data-action="insert" data-image-url="${esc(image.url)}" data-image-name="${esc(image.name)}">Insert</button> · <button type="button" class="ghost-btn small-btn" data-action="use" data-image-url="${esc(image.url)}" data-image-name="${esc(image.name)}">Use</button></span></div>`).join('') || '<p class="muted small">Belum ada gambar di library, bos.</p>'}
                </div>
              </div>
            </div>
            <label class="checkbox"><input type="checkbox" name="draft" ${editing?.draft ? 'checked' : ''} /> <span>Save as draft</span></label>
            <label><span>Content (Markdown)</span><textarea id="bodyField" name="body" rows="20">${esc(editing?.body || '')}</textarea></label>
            <div class="actions"><button type="submit">Save post</button>${editing ? `<a href="/blog/${editing.slug}">Preview</a>` : ''}</div>
          </form>
        </section>
      </section>
      <script>
        const uploadInput = document.getElementById('imageUpload');
        const uploadButton = document.getElementById('uploadButton');
        const uploadResult = document.getElementById('uploadResult');
        const uploadDebug = document.getElementById('uploadDebug');
        const featureImageField = document.querySelector('input[name="featureImage"]');
        const bodyField = document.getElementById('bodyField');

        function insertMarkdown(markdown) {
          if (!bodyField) return;
          const start = bodyField.selectionStart ?? bodyField.value.length;
          const end = bodyField.selectionEnd ?? bodyField.value.length;
          bodyField.value = bodyField.value.slice(0, start) + markdown + bodyField.value.slice(end);
          bodyField.focus();
          const pos = start + markdown.length;
          bodyField.setSelectionRange(pos, pos);
        }

        function renderUploadResult(name, url) {
          const markdown = '![alt text](' + url + ')';
          uploadResult.innerHTML = 'Markdown: <code>' + markdown + '</code><br><button type="button" class="ghost-btn small-btn" id="insertUploadedImage">Insert to post</button> <button type="button" class="ghost-btn small-btn" id="useUploadedImage">Use as featured</button> <a href="' + url + '" target="_blank" rel="noreferrer">Open</a>';
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
    res.send(layout({ title: 'Admin — Boss Blog', body, authed: true }));
  });

  app.post('/admin/save', loginRequired, async (req, res) => {
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const date = String(req.body.date || '').trim();
    const visibility = ['public', 'unlisted', 'private'].includes(req.body.visibility) ? req.body.visibility : 'public';
    const tags = String(req.body.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
    const featureImage = safeUrl(req.body.featureImage || '');
    const draft = req.body.draft === 'on';
    const body = String(req.body.body || '');
    const originalSlug = String(req.body.originalSlug || '');
    if (!title || !description || !date) return res.redirect('/admin');
    const slug = await savePost({ originalSlug, title, description, date, tags, visibility, featureImage, body, draft });
    res.redirect(`/admin?slug=${slug}`);
  });

  app.listen(PORT, () => console.log(`Boss Blog listening on http://localhost:${PORT}`));
}

boot().catch((error) => {
  console.error('Failed to boot Boss Blog:', error);
  process.exit(1);
});
