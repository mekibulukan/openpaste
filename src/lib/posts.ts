import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import slugify from 'slugify';

export type Visibility = 'public' | 'unlisted' | 'private';

export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  tags: string[];
  visibility: Visibility;
  draft?: boolean;
}

export interface Post extends PostMeta {
  body: string;
  html: string;
}

const POSTS_DIR = path.join(process.cwd(), 'content', 'posts');

async function ensurePostsDir() {
  await fs.mkdir(POSTS_DIR, { recursive: true });
}

function normalizeMeta(slug: string, data: Record<string, any>): PostMeta {
  return {
    slug,
    title: data.title || slug,
    description: data.description || '',
    date: data.date || new Date().toISOString().slice(0, 10),
    updated: data.updated,
    tags: Array.isArray(data.tags) ? data.tags : [],
    visibility: ['public', 'unlisted', 'private'].includes(data.visibility) ? data.visibility : 'public',
    draft: Boolean(data.draft),
  };
}

export async function getAllPosts() {
  await ensurePostsDir();
  const files = (await fs.readdir(POSTS_DIR)).filter((file) => file.endsWith('.md'));
  const posts = await Promise.all(
    files.map(async (file) => {
      const slug = file.replace(/\.md$/, '');
      const raw = await fs.readFile(path.join(POSTS_DIR, file), 'utf8');
      const parsed = matter(raw);
      const meta = normalizeMeta(slug, parsed.data as Record<string, any>);
      return {
        ...meta,
        body: parsed.content.trim(),
        html: await marked.parse(parsed.content),
      } as Post;
    }),
  );

  return posts.sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

export async function getPostBySlug(slug: string) {
  const posts = await getAllPosts();
  return posts.find((post) => post.slug === slug);
}

export function makeSlug(input: string) {
  return slugify(input, { lower: true, strict: true, trim: true }) || `post-${Date.now()}`;
}

export async function savePost(input: {
  slug?: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  visibility: Visibility;
  body: string;
  draft?: boolean;
}) {
  await ensurePostsDir();
  const slug = makeSlug(input.slug || input.title);
  const file = path.join(POSTS_DIR, `${slug}.md`);
  const frontmatter = matter.stringify(input.body.trim() + '\n', {
    title: input.title,
    description: input.description,
    date: input.date,
    updated: new Date().toISOString().slice(0, 10),
    tags: input.tags,
    visibility: input.visibility,
    draft: Boolean(input.draft),
  });
  await fs.writeFile(file, frontmatter, 'utf8');
  return slug;
}
