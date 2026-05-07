---
title: "Tips Node.js yang Gua Pake Tiap Hari"
description: "Kumpulan tips Node.js yang berguna buat daily development."
date: 2026-05-07
tags: ["nodejs", "dev", "tips"]
visibility: unlisted
---

# Tips Node.js yang Gua Pake Tiap Hari

Post ini **unlisted** — nggak muncul di homepage, tapi siapa pun yang punya link bisa baca. Cocok buat sharing ke temen tanpa publish ke publik.

## 1. Pake `--watch` biar nggak restart manual

```bash
node --watch server.js
```

## 2. `.env` tanpa library

Node.js 20+ udah support `--env-file`:

```bash
node --env-file=.env app.js
```

## 3. Quick HTTP server

```bash
npx serve .
```

---

*More tips coming soon.* 👌
