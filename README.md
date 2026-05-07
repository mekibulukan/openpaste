# Boss Blog

Personal blog built with Astro.

## Features

- Public / unlisted / private posts
- Password-protected login for private posts + admin
- Simple built-in Markdown editor
- Dark / light mode

## Local dev

```bash
npm install
BLOG_ADMIN_PASSWORD=your-password npm run dev
```

## Production env

Set this in your hosting panel:

- `BLOG_ADMIN_PASSWORD` = your secret admin password

## Build & run

```bash
npm run build
npm run start
```

## Content storage

Posts are saved to `content/posts/*.md` on the server.
