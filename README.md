# Boss Blog

Simple personal blog with built-in admin, running as a plain Express app.

## Features

- Public / unlisted / private posts
- Password login for private posts + admin
- Built-in Markdown editor
- Local image upload into markdown
- Feature image URL (local or external)
- File-based content in persistent `../blog-data/posts/*.md`
- Uploads stored in persistent `../blog-data/uploads/`

## Environment variable

- `BLOG_ADMIN_PASSWORD` = your admin password
- `SITE_URL` = public site URL for canonical/OG/sitemap (default: `https://dev.openpaste.my.id`)
- `PERSIST_ROOT` = optional persistent root directory outside deploy folder
- `UPLOADS_DIR` = optional custom uploads directory
- `POSTS_DIR` = optional custom posts directory
- `DATA_DIR` = optional base directory for persistent app data

## Hostinger settings

Use the Express preset with:

- Package manager: `npm`
- Entry file: `server.cjs`
- Node version: `22.x`
- Build command: leave empty if Hostinger allows it
- Root directory: `./`

## Local run

```bash
npm install
BLOG_ADMIN_PASSWORD=your-password npm start
```
