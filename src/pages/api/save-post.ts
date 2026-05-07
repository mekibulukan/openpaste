import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isAuthenticated } from '../../lib/auth';
import { makeSlug, savePost } from '../../lib/posts';

const POSTS_DIR = path.join(process.cwd(), 'content', 'posts');

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!isAuthenticated(cookies)) {
    return redirect('/login?next=/admin');
  }

  const form = await request.formData();
  const title = String(form.get('title') || '').trim();
  const description = String(form.get('description') || '').trim();
  const date = String(form.get('date') || '').trim();
  const visibility = String(form.get('visibility') || 'public') as 'public' | 'unlisted' | 'private';
  const body = String(form.get('body') || '');
  const originalSlug = String(form.get('originalSlug') || '').trim();
  const tags = String(form.get('tags') || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const draft = form.get('draft') === 'on';

  if (!title || !description || !date) {
    return redirect('/admin');
  }

  const nextSlug = makeSlug(title);

  if (originalSlug && originalSlug !== nextSlug) {
    await fs.rm(path.join(POSTS_DIR, `${originalSlug}.md`), { force: true });
  }

  const savedSlug = await savePost({
    slug: nextSlug,
    title,
    description,
    date,
    visibility,
    tags,
    body,
    draft,
  });

  return redirect(`/admin?slug=${savedSlug}`);
};
