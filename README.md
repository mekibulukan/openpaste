# Boss Blog

Simple personal blog with built-in admin, made to deploy easily on basic Node hosting.

## Features

- Public / unlisted / private posts
- Password login for private posts + admin
- Built-in Markdown editor
- File-based content in `content/posts/*.md`
- Hostinger-friendly dist build output

## Environment variable

- `BLOG_ADMIN_PASSWORD` = your admin password

## Hostinger settings

- Build command: `npm run build`
- Output directory: `dist`
- Entry file: `server.js`
- Node version: `22.x`

## Local run

```bash
npm install
BLOG_ADMIN_PASSWORD=your-password npm start
```
