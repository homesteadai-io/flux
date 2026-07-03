# Flux

Flux is a Windows-first transparent desktop capture tool built with Electron, React, TypeScript, and Vite.

Phase 0 sets up the transparent frameless shell and repo hygiene. Phase 1 owns the glass look.

## Run

```bash
npm install
npm run dev
```

## YouTube Captions

Flux uses `yt-dlp` to pull native YouTube captions without downloading video:

```bash
npm run watch -- "<youtube-url>"
```

The same caption-only engine powers the desktop URL bar.

## Secrets

Copy `.env.example` to `.env.local` and set `OPENAI_API_KEY` plus the model config values when AI phases begin.

The key must stay in the main process only. Do not commit `.env.local`.
