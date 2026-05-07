# Boss Blog

Simple personal blog with built-in admin, running as a plain Express app.

## Features

- Public / unlisted / private posts
- Password login for private posts + admin
- Built-in Markdown editor
- Local image upload into markdown
- Feature image URL (local or external)
- File-based content in `content/posts/*.md`
- Uploads stored in `uploads/`

## Environment variable

- `BLOG_ADMIN_PASSWORD` = your admin password
- `UPLOADS_DIR` = optional custom uploads directory

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
