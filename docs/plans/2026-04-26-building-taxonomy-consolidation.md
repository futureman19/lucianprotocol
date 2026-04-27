# Building Taxonomy Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate the city renderer onto one canonical building and environment taxonomy, remove dormant duplicate renderers, and keep the active scene path readable, typed, and testable.

**Architecture:** The engine-side contract in `src/types.ts` is the canonical taxonomy. The web layer should have one adapter for reading entity state, one display-only derivation layer for fallbacks and silhouettes, one active building renderer, and one active ground/road renderer. Legacy taxonomy files remain in place only until the active path has equivalent behavior, then they are deleted in a cleanup pass.

**Tech Stack:** TypeScript, React canvas rendering, Vite, Node test runner via `tsx`, Zod-backed shared types, Supabase-synced entity state.

---

## Canonical Decisions

**Keep**

- `src/types.ts` as the canonical source of `BuildingArchetype`, `Condition`, `PowerState`, `ConstructionPhase`, `DemolitionPhase`, and `LandmarkRole`
- `src/building-lifecycle.ts` as the canonical engine-side derivation logic
- `web/shared-contract.ts` as the browser adapter that reads canonical fields from `Entity`
- `web/building-archetypes.ts` as the single fallback derivation, palette, and silhouette policy for the renderer
- `web/simcity-building-render.ts` as the only active building renderer
- `web/traffic.ts` as the only active road, sidewalk, and street-furniture renderer
- `web/city-layout.ts` as the district and road layout generator

**Merge**

- Move active geometry decisions out of `web/city-layout.ts:getBuildingProfile()` into a new canonical `web/building-geometry.ts`
- Move any still-useful footprint or size heuristics out of `web/file-colors.ts` into canonical geometry/archetype modules
- Keep district prop rules in `web/district-grammar.ts`, but replace stringly-typed prop keys with a typed environment taxonomy

**Delete After Migration**

- `web/building-render.ts`
- `web/roads.ts`
- legacy taxonomy exports in `web/file-colors.ts`
- the legacy `BuildingType` union in `web/city-layout.ts`
- any orphaned renderer utilities in `web/city-renderer.ts` if the final reference audit shows they are dead

---

### Task 1: Lock the canonical building taxonomy

**Files:**

- Modify: `src/types.ts`
- Modify: `web/shared-contract.ts`
- Modify: `web/building-archetypes.ts`
- Create: `web/building-archetypes.test.ts`

**Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import type { Entity } from '../src/types';
import { deriveArchetypeFromEntity, getArchetypeProfile } from './building-archetypes';

test('deriveArchetypeFromEntity only returns canonical archetypes', () => {
  const samples: Entity[] = [
    { id: 'a', type: 'file', x: 0, y: 0, mass: 6, tick_updated: 0, name: 'app.tsx', path: 'src/app.tsx', extension: '.tsx' },
    { id: 'b', type: 'file', x: 0, y: 0, mass: 1, tick_updated: 0, name: 'package.json', path: 'package.json', extension: '.json' },
    { id: 'c', type: 'file', x: 0, y: 0, mass: 2, tick_updated: 0, name: 'button.tsx', path: 'src/components/button.tsx', extension: '.tsx' },
  ];

  const valid = new Set(['tower', 'warehouse', 'shopfront', 'campus', 'factory', 'civic', 'substation', 'landmark']);
  for (const entity of samples) {
    assert.ok(valid.has(deriveArchetypeFromEntity(entity)));
    assert.ok(valid.has(getArchetypeProfile(entity).archetype));
  }
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test web/building-archetypes.test.ts -v`

Expected: FAIL until every active fallback path uses the canonical `8`-value archetype set.

**Step 3: Write minimal implementation**

Use `web/shared-contract.ts` as the only browser-side archetype type source and remove duplicated local unions from renderer-facing modules.

```ts
export type { BuildingArchetype, LandmarkRole } from './shared-contract';

export function deriveArchetypeFromEntity(entity: Entity): BuildingArchetype {
  const explicit = getExplicitArchetype(entity);
  if (explicit) return explicit;
  // fallback heuristics only, but still return one of the canonical 8 values
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test web/building-archetypes.test.ts -v`

Expected: PASS

Then run: `npm run typecheck`

Expected: PASS for taxonomy-related modules

**Step 5: Commit**

```bash
git add src/types.ts web/shared-contract.ts web/building-archetypes.ts web/building-archetypes.test.ts
git commit -m "refactor: lock canonical building taxonomy"
```

---

### Task 2: Move active geometry off the legacy `BuildingType` path

**Files:**

- Create: `web/building-geometry.ts`
- Modify: `web/simcity-building-render.ts`
- Modify: `web/city-layout.ts`
- Create: `web/building-geometry.test.ts`

**Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import type { Entity } from '../src/types';
import { getBuildingGeometry } from './building-geometry';

test('getBuildingGeometry derives footprint and height from canonical archetype data', () => {
  const entity: Entity = {
    id: 'entry',
    type: 'file',
    x: 5,
    y: 5,
    mass: 4,
    tick_updated: 0,
    name: 'app.tsx',
    path: 'src/app.tsx',
    extension: '.tsx',
    building_archetype: 'landmark',
    importance_tier: 3,
    upgrade_level: 2,
  };

  const geometry = getBuildingGeometry(entity);
  assert.equal(geometry.archetype, 'landmark');
  assert.ok(geometry.height > 1.5);
  assert.ok(geometry.footprint.width > 0.5);
  assert.ok(geometry.footprint.depth > 0.5);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test web/building-geometry.test.ts -v`

Expected: FAIL with missing module or missing export

**Step 3: Write minimal implementation**

Create a single display-only geometry module and remove active renderer dependence on `web/city-layout.ts:getBuildingProfile()`.

```ts
export interface BuildingGeometry {
  archetype: BuildingArchetype;
  footprint: { width: number; depth: number };
  height: number;
  ornamentation: number;
}

export function getBuildingGeometry(entity: Entity): BuildingGeometry {
  const profile = getArchetypeProfile(entity);
  // derive footprint and height from canonical archetype + shared state
}
```

Update `web/simcity-building-render.ts` to use:

```ts
const geometry = getBuildingGeometry(entity);
const footprint = geometry.footprint;
const height = geometry.height;
```

Restrict `web/city-layout.ts` to layout concerns only: districts, roads, centers, water, tile helpers.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test web/building-geometry.test.ts -v`

Expected: PASS

Then run: `node --import tsx --test web/city-layout.test.ts -v`

Expected: PASS with no behavior change in road or district layout

**Step 5: Commit**

```bash
git add web/building-geometry.ts web/building-geometry.test.ts web/simcity-building-render.ts web/city-layout.ts
git commit -m "refactor: move active geometry to canonical renderer module"
```

---

### Task 3: Remove active dependence on `web/file-colors.ts`

**Files:**

- Modify: `web/simcity-building-render.ts`
- Modify: `web/building-archetypes.ts`
- Modify: `web/file-colors.ts`
- Create: `web/render-path-guard.test.ts`

**Step 1: Write the failing guard test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('active renderer does not depend on legacy file-colors taxonomy', () => {
  const source = readFileSync('web/simcity-building-render.ts', 'utf8');
  assert.equal(source.includes("from './file-colors'"), false);
  assert.equal(source.includes('getFileArchetype('), false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test web/render-path-guard.test.ts -v`

Expected: FAIL while the active renderer still imports `getFileFootprint()` from `web/file-colors.ts`

**Step 3: Write minimal implementation**

Move the remaining active footprint logic into the canonical geometry layer, then reduce `web/file-colors.ts` to one of these end states:

- temporary compatibility wrapper with deprecated exports, or
- full deletion if no active imports remain

The target state for the active renderer is:

```ts
import { getBuildingGeometry } from './building-geometry';

const geometry = getBuildingGeometry(entity);
const footprint = geometry.footprint;
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test web/render-path-guard.test.ts -v`

Expected: PASS

Then run: `npm run typecheck`

Expected: PASS with no active `file-colors` dependency in `web/simcity-building-render.ts`

**Step 5: Commit**

```bash
git add web/simcity-building-render.ts web/building-archetypes.ts web/file-colors.ts web/render-path-guard.test.ts
git commit -m "refactor: remove active renderer dependency on file-colors"
```

---

### Task 4: Normalize the environment object taxonomy

**Files:**

- Create: `web/environment-taxonomy.ts`
- Modify: `web/district-grammar.ts`
- Modify: `web/lot-props.ts`
- Modify: `web/rooftop-identity.ts`
- Create: `web/environment-taxonomy.test.ts`

**Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOT_PROP_TYPES, ROOFTOP_FEATURE_TYPES } from './environment-taxonomy';

test('district grammar only uses declared lot-prop keys', () => {
  assert.ok(LOT_PROP_TYPES.includes('bench'));
  assert.ok(LOT_PROP_TYPES.includes('dumpster'));
  assert.ok(LOT_PROP_TYPES.includes('loading'));
  assert.ok(ROOFTOP_FEATURE_TYPES.includes('antenna'));
  assert.ok(ROOFTOP_FEATURE_TYPES.includes('solar'));
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test web/environment-taxonomy.test.ts -v`

Expected: FAIL because the environment taxonomy module does not exist yet

**Step 3: Write minimal implementation**

Define explicit unions so district grammars and prop renderers cannot drift apart.

```ts
export const LOT_PROP_TYPES = [
  'bench', 'bike', 'planter', 'utility', 'parking',
  'fence', 'bush', 'mailbox', 'pallet', 'dumpster',
  'hvac', 'loading', 'art', 'container', 'crane', 'awning',
] as const;

export type LotPropType = typeof LOT_PROP_TYPES[number];
```

Then:

- type `DistrictGrammar.propMix` as `Partial<Record<LotPropType, number>>`
- either implement `container`, `crane`, and `awning` in `web/lot-props.ts`, or remove them from grammars
- type rooftop feature selection in `web/rooftop-identity.ts`

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test web/environment-taxonomy.test.ts -v`

Expected: PASS

Then run: `npm run lint`

Expected: PASS for `web/district-grammar.ts`, `web/lot-props.ts`, and `web/rooftop-identity.ts`

**Step 5: Commit**

```bash
git add web/environment-taxonomy.ts web/environment-taxonomy.test.ts web/district-grammar.ts web/lot-props.ts web/rooftop-identity.ts
git commit -m "refactor: type and normalize environment object taxonomy"
```

---

### Task 5: Delete dormant renderer and road layers

**Files:**

- Delete: `web/building-render.ts`
- Delete: `web/roads.ts`
- Modify: `web/App.tsx`
- Modify: `web/city-renderer.ts` if still referenced by anything after the audit
- Modify: `web/render-path-guard.test.ts`

**Step 1: Extend the failing guard test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('App uses only the active building and ground renderer path', () => {
  const app = readFileSync('web/App.tsx', 'utf8');
  assert.equal(app.includes("from './simcity-building-render'"), true);
  assert.equal(app.includes("from './building-render'"), false);
  assert.equal(app.includes("from './roads'"), false);
});

test('legacy renderer files are removed', () => {
  assert.equal(existsSync('web/building-render.ts'), false);
  assert.equal(existsSync('web/roads.ts'), false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test web/render-path-guard.test.ts -v`

Expected: FAIL while the dormant files still exist

**Step 3: Write minimal implementation**

- remove dead files after confirming no active imports remain
- remove stale comments like `drawStructureEntity replaced by drawBuilding from ./building-render`
- keep `web/traffic.ts` as the single active ground and road renderer

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test web/render-path-guard.test.ts -v`

Expected: PASS

Then run: `npm run lint`

Expected: PASS with no imports or comments referring to removed renderers

**Step 5: Commit**

```bash
git add web/App.tsx web/city-renderer.ts web/render-path-guard.test.ts
git rm web/building-render.ts web/roads.ts
git commit -m "refactor: remove dormant renderer and road layers"
```

---

### Task 6: Final validation and documentation cleanup

**Files:**

- Modify: `docs/LUX_PROTOCOL_RUNTIME_RUNDOWN.md` if the renderer architecture section mentions retired modules
- Modify: `web/simcity-building-render.ts`
- Modify: `web/building-archetypes.ts`
- Modify: `web/building-geometry.ts`
- Modify: `web/traffic.ts`

**Step 1: Write the failing integration check**

Use the existing guard tests and targeted module tests as the integration suite:

```bash
node --import tsx --test web/building-archetypes.test.ts -v
node --import tsx --test web/building-geometry.test.ts -v
node --import tsx --test web/environment-taxonomy.test.ts -v
node --import tsx --test web/render-path-guard.test.ts -v
```

Expected: at least one failure before final cleanup

**Step 2: Run repo validation**

Run:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

Expected: anything still failing should now be a real missed cleanup item, not taxonomy ambiguity

**Step 3: Write minimal cleanup implementation**

- remove unused imports exposed by the consolidation
- update docs if they still reference deleted files
- make sure the active render path is:
  - `web/App.tsx`
  - `web/simcity-building-render.ts`
  - `web/building-archetypes.ts`
  - `web/building-geometry.ts`
  - `web/district-grammar.ts`
  - `web/traffic.ts`

**Step 4: Re-run validation**

Run:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add docs/LUX_PROTOCOL_RUNTIME_RUNDOWN.md web
git commit -m "refactor: finalize renderer taxonomy consolidation"
```

---

## Notes For Execution

- Do this in a dedicated worktree. The current branch already has parallel frontend work in `web/*`, and this plan intentionally changes the same area.
- Do not delete `web/building-render.ts`, `web/roads.ts`, or `web/file-colors.ts` before the guard tests prove the active path no longer depends on them.
- Prefer deleting obsolete abstractions instead of keeping compatibility shims longer than one task.
- Keep commits small and reversible. This refactor touches live render code and dormant modules at the same time.

Plan complete and saved to `docs/plans/2026-04-26-building-taxonomy-consolidation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
