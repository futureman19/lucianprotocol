# Lux Protocol MVP

Deterministic spatial operating system prototype for autonomous AI orchestration.

## Stack

- Node.js + TypeScript strict mode
- React + Vite canvas visualizer
- Supabase for shared state and realtime
- Gemini 2.5 Flash-Lite for micro-prompt navigation

## Docs

- [Lux Protocol Runtime Rundown](docs/LUX_PROTOCOL_RUNTIME_RUNDOWN.md)

## Project Layout

```text
src/
  ai.ts
  engine.ts
  git-parser.ts
  hivemind.ts
  import-git.ts
  mass-mapper.ts
  seed.ts
  supabase.ts
  types.ts
supabase/
  migrations/
web/
  App.tsx
  git-tree.ts
  highlight.tsx
  iso.ts
  main.tsx
  styles.css
  vite-env.d.ts
```

## AI Workforce

The engine coordinates a three-agent Hivemind:
- **Visionary**: Proposes broad goals and explores possibilities.
- **Architect**: Designs structural solutions and plans implementation.
- **Critic**: Evaluates constraints, reviews plans, and identifies flaws.

## Operator Controls

The system supports real-time operator intervention. Operators can submit directives via the browser form, which writes to Supabase. The engine picks up these updates to hot-swap repos and adjust AI behaviors seamlessly.

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

Initialize the database by applying migrations from `supabase/migrations/` in timestamp order against your Supabase project. This creates all necessary tables (`entities`, `world_state`, `operator_controls`, etc.), row level security policies, and realtime publications.

## Quick Start & Commands

```bash
# 1. Install dependencies
npm install

# 2. Import local project into the grid
npm run import-git -- .

# 3. Start the deterministic engine
npm run engine

# 4. In a separate terminal, launch the visualizer
npm run dev
```

Other commands:
```bash
npm run engine -- --max-ticks=5
npm run build
```

## Runtime Notes

- Engine ticks at `100ms` and never blocks on Gemini responses.
- AI decisions are queued and applied on the next available tick.
- Grid physics stay integer-only in the engine.
- Browser interpolation uses float lerp only for rendering smooth motion.
- With `LUX_LOOP=true`, the engine automatically restarts after `goal-reached` or `stalled` so the demo remains observable.
