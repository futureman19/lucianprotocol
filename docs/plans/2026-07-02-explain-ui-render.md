# Explain-UI Rendering Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Render the explanation stream from the engine onto the UI so operator prompts of `explain` produce a visible prose response, not a silent read.

**Architecture:** The engine side is already complete (explanation status, text, and error flow into `world_state` via `createWorldState` at `src/engine.ts:4272`, broadcast to Supabase, schema columns at `supabase/migrations/20260420153000_add_explanation_fields.sql`). The UI side needs to consume those fields and render them with the `.explanation-frame` CSS that already exists in `web/styles.css:1684-1739`. `docs/LUX_PROTOCOL_RUNTIME_RUNDOWN.md` also claims explain produces no prose; that needs updating to reflect reality.

**Tech Stack:** TypeScript, React 19, Supabase Realtime subscription via `world_state` row updates, Zod schema already in scope (`WorldStateSchema` at `src/types.ts:354`).

---

## Canonical Decisions

**Keep**

- `src/engine.ts` `maybeExplainTarget` (`src/engine.ts:2916-2955`), `runExplanationRequest` (`src/engine.ts:2994-3085`), `explanationState` (`src/engine.ts:132 interface`, `:202 createEmptyExplanationState`, `:406 storage`), `createWorldState` explanation fields (`:4306-4310`).
- `src/ai.ts` `EXPLAIN_SYSTEM_PROMPT` (`src/ai.ts:129-136`).
- `src/types.ts` `ExplainStatus` (`src/types.ts:320`) and `WorldStateSchema` explanation fields (`:365-371`).
- `supabase/migrations/20260420153000_add_explanation_fields.sql` as the schema source of truth.
- `web/styles.css` `.explanation-frame` + `.explanation-status.pending/streaming/complete/error` + `.explanation-body` + `.explanation-placeholder` (`web/styles.css:1684-1739`) — already styled, currently unused.
- `src/engine.test.ts:1480` `Explain reads stream and cache explanation text` as the engine-side acceptance gate.

**Modify**

- `web/App.tsx`: consume `parsedWorldState.explanation_*` fields in the world-state subscription (around `web/App.tsx:3236` and `web/App.tsx:3313-3315`), render an explanation panel that reflects the four states.
- `docs/LUX_PROTOCOL_RUNTIME_RUNDOWN.md` lines 130-131 and 242: remove the "explain produces no prose" claim and replace with what the engine actually does today.

**Do not touch**

- Anything in `src/engine.ts` related to explanations.
- Anything in `src/ai.ts` (the prompt is good).
- `supabase/migrations/` — schema is already correct and live on remote (verified via `supabase db query --linked` 2026-07-02 against `oappcvzenpqryymvqjuc`).

---

### Task 1: Make `ExplanationState` type exportable from `engine.ts`

**Objective:** Allow `web/App.tsx` to consume a typed `ExplanationState`. Currently the interface is module-private (`src/engine.ts:132`).

**Files:**
- Modify: `src/engine.ts:132` (interface declaration) — add `export`
- Modify: `src/engine.ts:202` (function) — add `export`
- Test: `src/engine.test.ts` — add an import-level smoke test

**Step 1: Write a failing import-side test**

Open `src/engine.test.ts`, near the top of the file (after the existing imports), add:

```ts
import type { ExplanationState } from './engine';
import { createEmptyExplanationState } from './engine';

test('ExplanationState is exported and createEmptyExplanationState is callable', () => {
  const state = createEmptyExplanationState();
  assert.equal(state.status, 'idle');
  assert.equal(state.text, null);
  assert.equal(state.error, null);
});
```

**Step 2: Run to verify failure**

Run: `npm test -- --test-name-pattern="ExplanationState is exported"`
Expected: FAIL — "has no exported member 'ExplanationState'" or similar.

**Step 3: Make the exports**

In `src/engine.ts`, change:
- Line 132: `interface ExplanationState {` → `export interface ExplanationState {`
- Line 202: `function createEmptyExplanationState(): ExplanationState {` → `export function createEmptyExplanationState(): ExplanationState {`

**Step 4: Run to verify pass**

Run: `npm test` — must report 77 passing tests (76 + the new one).
Run: `npm run typecheck` — must exit 0.
Run: `npm run lint` — must exit 0.

**Step 5: Commit**

```bash
git add src/engine.ts src/engine.test.ts
git commit -m "refactor(engine): export ExplanationState type and factory for UI consumption"
```

---

### Task 2: Render the explanation frame in `App.tsx`

**Objective:** The engine produces an explanation; the UI displays it. Subscribe to the existing `world_state` realtime channel, surface the four explanation states in an `<aside>` panel using the existing `.explanation-frame` CSS.

**Files:**
- Modify: `web/App.tsx` — add an explanation selector and a render block (see Step 3)
- Test: `web/` currently has no `web/**/*.test.ts` test infrastructure for App.tsx beyond `web/city-layout.test.ts`. SKIP a new JSX test; rely on typecheck + manual verification via `npm run build`.

**Step 1: Read the existing world-state subscription**

Open `web/App.tsx:3236` (the `parsedWorldState = WorldStateSchema.safeParse(worldRow)` line) and `:3313-3315` (the realtime handler). Confirm:
- `parsedWorldState` is parsed into a local variable in scope.
- Either store it on a `useState<WorldState | null>` or add a sibling `useState` for `explanation` derived state.

**Step 2: Add a derived explanation state**

Add a `useState<ExplanationState | null>(null)` at the top of the `App` component (near other state hooks). In the world-state subscription handler (`:3313-3315`) and the initial fetch (`:3236`), set the derived state from `parsedWorldState` mapping:

```ts
setExplanation({
  status: parsedWorldState.explanation_status ?? 'idle',
  targetPath: parsedWorldState.explanation_target_path ?? null,
  agentId: parsedWorldState.explanation_agent_id ?? null,
  contentHash: parsedWorldState.explanation_content_hash ?? null,
  text: parsedWorldState.explanation_text ?? null,
  error: parsedWorldState.explanation_error ?? null,
  updatedAtTick: parsedWorldState.explanation_updated_at_tick ?? null,
});
```

**Step 3: Add a render block**

Locate the right-side panel that holds "Spatial Context Loaded" / advisor council, and add a NEW panel below it:

```tsx
{/* Explanations Panel */}
{explanation && explanation.status !== 'idle' && (
  <aside className="explanation-frame">
    <header className="explanation-header">
      <span className={`explanation-status status-${explanation.status}`}>
        {explanation.status}
      </span>
      {explanation.targetPath && (
        <span className="explanation-target">{explanation.targetPath}</span>
      )}
    </header>
    {explanation.error ? (
      <p className="explanation-placeholder is-error">{explanation.error}</p>
    ) : explanation.text ? (
      <div className="explanation-body">{explanation.text}</div>
    ) : explanation.status === 'streaming' || explanation.status === 'pending' ? (
      <p className="explanation-placeholder">Generating explanation…</p>
    ) : null}
  </aside>
)}
```

**Step 4: Verify typecheck**

Run: `npm run typecheck` — must exit 0. The `ExplanationState` import must resolve because of Task 1's export.

**Step 5: Verify lint**

Run: `npm run lint` — must exit 0.

**Step 6: Verify all existing tests still pass**

Run: `npm test` — must report 77 passing (the new test from Task 1 + the original 76).

**Step 7: Verify production build**

Run: `npm run build` — `npm run build` runs `lint && typecheck && vite build`. All three gates must pass.

**Step 8: Commit**

```bash
git add web/App.tsx
git commit -m "feat(web): render explanation frame from world_state"
```

---

### Task 3: Truth-up the runtime doc

**Objective:** `docs/LUX_PROTOCOL_RUNTIME_RUNTIME_RUNDOWN.md` lines 130-131 and 242 still claim "explain produces no prose." Update them to reflect that the engine now streams prose via the `EXPLAIN_SYSTEM_PROMPT` and the UI renders it.

**Files:**
- Modify: `docs/LUX_PROTOCOL_RUNTIME_RUNDOWN.md`

**Step 1: Read the affected lines**

Lines 130-131 currently read:
> `explain` does not yet produce a natural-language explanation stream from the engine.
> Today, `explain` means "navigate to the target and read it."

Line 242 currently reads:
> `explain` resolves a target and triggers `read`, but no prose explanation is emitted

**Step 2: Replace with the current behavior**

Replace lines 130-131 with:
> `explain` produces a natural-language explanation stream. When the Architect reaches the file target on an `explain` directive, the engine dispatches a Gemini Flash call (using the `EXPLAIN_SYSTEM_PROMPT` at `src/ai.ts:129`) which streams prose into `explanationState.text`. Status flows `pending → streaming → complete` (or `error` on failure) and is broadcast to `world_state` for the UI to consume.

Replace line 242 with:
> `explain` reaches the file target and emits a Gemini Flash explanation stream, surfaced in the UI's `.explanation-frame` panel.

**Step 3: Commit**

```bash
git add docs/LUX_PROTOCOL_RUNTIME_RUNDOWN.md
git commit -m "docs: explain now streams prose via EXPLAIN_SYSTEM_PROMPT"
```

---

## Verification Checklist

- [ ] `npm test` reports 77/77 passing (existing 76 + 1 new type-export test).
- [ ] `npm run typecheck` exit 0.
- [ ] `npm run lint` exit 0.
- [ ] `npm run build` exit 0 (covers the three above + Vite build).
- [ ] `git log --oneline -3` shows three separate commits, each scoped to one task.
- [ ] Manual: launch dev server, submit an operator prompt of "Explain src/engine.ts," observe the explanation frame switches `pending → streaming → complete` and displays prose. (This step is structural UI verification; do **not** declare success solely from build pipelines.)

## Risks & Open Questions

- **Risk:** `ExplanationState` interface internal fields may include `cacheKey` and `fullText` which we don't want to ship to the UI. Mitigation: the UI only maps the 7 fields listed in Task 2 Step 2; it does not spread the full object. If a future field with sensitive content appears in `ExplanationState`, the explicit-map approach will not leak it.
- **Risk:** Engine test at `src/engine.test.ts:1480` depends on `harness.advanceExplanationStream()` which is harness-only. The streaming behavior of `runExplanationRequest` against a real Gemini call is not exercised in CI. The engine path is tested for caching and decision-bound behavior; the actual streaming-rate of Gemini is observability, not correctness, and is out of scope here.
- **Open question:** Should the explanation frame be dismissable / persistable across sessions? Out of scope for this pass; the engine caches by `prompt × path × contentHash` for 60s by default, so user refresh shows the cached value via `explanationCache.get(cacheKey)`.
