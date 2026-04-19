# Lux Protocol MVP

Deterministic spatial operating system prototype for autonomous AI orchestration.

## Stack

- Node.js + TypeScript strict mode
- React + Vite canvas visualizer
- Supabase for shared state and realtime
- Gemini 2.5 Flash-Lite for micro-prompt navigation

## Project Layout

```text
src/
  ai.ts
  engine.ts
  seed.ts
  supabase.ts
  types.ts
supabase/
  schema.sql
web/
  App.tsx
  iso.ts
  main.tsx
```

## Environment

Replace the placeholder values in `.env` with:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `LUX_SEED`
- `LUX_LOOP`
- `LUX_RESTART_DELAY_MS`

## Supabase Setup

Run the SQL in `supabase/schema.sql` against your Supabase project. It creates:

- `entities`
- `world_state`
- public read policies for the browser
- realtime publication entries for both tables

## Commands

```bash
npm install
npm run engine
npm run engine -- --max-ticks=5
npm run dev
npm run build
```

## Runtime Notes

- Engine ticks at `100ms` and never blocks on Gemini responses.
- AI decisions are queued and applied on the next available tick.
- Grid physics stay integer-only in the engine.
- Browser interpolation uses float lerp only for rendering smooth motion.
- With `LUX_LOOP=true`, the engine automatically restarts after `goal-reached` or `stalled` so the demo remains observable.
