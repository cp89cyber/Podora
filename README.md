# Podora

A mobile progressive web app podcast player.

## Development

```bash
npm install
npm run dev
```

The Vite dev server includes a local `/api/feed` middleware that mirrors the Vercel serverless feed proxy. The app registers `public/sw.js` for app-shell offline behavior.

## Scripts

- `npm run dev` starts the mobile PWA locally.
- `npm run build` type-checks and builds the production app.
- `npm run test` runs unit tests.
- `npm run smoke` runs the Playwright mobile smoke test against a production preview.
