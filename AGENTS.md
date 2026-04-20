# AGENTS

## Build Instructions
```bash
npm run build
npm run typecheck
npm run lint
```

## System Rules

- **Engine Restart**: After running `import-git`, you must restart the engine to pick up new overlays.
- **Sacred Constraints**: 
  - The engine runs on a strict **60-tick clock**.
  - All physics calculations use **integer physics only**.
  - The **async AI queue pattern must never block** the engine ticking.

## Database Note

> **Warning**
> The `supabase/schema.sql` file was removed. It is stale. Migrations in `supabase/migrations/` are the absolute source of truth.
