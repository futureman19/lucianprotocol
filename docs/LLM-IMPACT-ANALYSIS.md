# Fibonacci Physics — LLM Impact Analysis

## What LLMs Actually See

From `ai.ts`, the LLM receives a `NeighborhoodScan` every tick:

```json
{
  "current_tick": 23,
  "agent_role": "architect",
  "agent": {"x": 5, "y": 7, "z": 0},
  "current": {
    "occupant": "file",
    "name": "engine.ts",
    "path": "src/engine.ts",
    "mass": 3,
    "node_state": "stable",
    "git_status": "modified",
    "extension": ".ts"
  },
  "north": {"occupant": "empty"},
  "pheromones": [],
  "agent_memory": {"files_read": {}, "lessons": []}
}
```

**Sparse. Low-dimensional.** The LLM knows there's a file north/east/south/west, its mass, and its state. That's it.

---

## What Fibonacci Physics Adds to LLM Context

### 1. Fibonacci Mass Tiers — Natural Complexity Breakpoints

**Current:** `mass: 3` — arbitrary linear scale. A 10,000-line file and a 50-line file can both be mass 3.

**New:** `mass: 5` (Fibonacci tier F₅). Mass follows: 1, 1, 2, 3, 5, **8**, 13, 21...

**Why it helps LLMs:**
- `mass >= 8` is a **naturally occurring Fibonacci breakpoint**, not an arbitrary threshold
- LLM system prompt: *"Files at mass 8 (F₆) or higher are unstable. Split them into smaller modules at mass 3-5."*
- LLM learns a **logarithmic scale** — mass 21 is not "7x bigger" than mass 3, it's "4 Fibonacci tiers higher" — a structural difference, not just quantitative

**Concrete automation win:** The LLM can now prioritize refactoring by mass tier, not just line count. A mass 34 file is a structural disaster that demands immediate attention.

---

### 2. Chirality — File Personality Taxonomy

**Current:** No handedness information. All files are neutral blobs.

**New:** `chirality: "left" | "right" | "neutral"` derived from `lines % 24`.

**Why it helps LLMs:**
- LLM system prompt: *"Left-handed files (declarative, functional, small) pair well with left-handed utilities. Right-handed files (imperative, class-based, stateful) need right-handed adapters. Cross-chirality imports create tension."*
- The LLM gains a **binary classifier** for every file — simpler than learning patterns from raw code
- When the LLM plans a refactor, it can ask: *"Does this new file match the chirality of its neighbors?"*

**Concrete automation win:** The LLM avoids creating mismatched dependencies. It won't suggest importing a functional utility into a class-heavy module without an adapter — because it sees the chirality conflict in the scan.

---

### 3. Materialization Phase — Preventing Race Conditions

**Current:** Files appear instantly. Agent A creates a file, Agent B edits it immediately — race conditions.

**New:** `materialization_phase: 1-9` — files phase in over 9 ticks.

**Why it helps LLMs:**
- Phase 1-3: Ghost/scaffolding — LLM sees `phase: 2` and knows: *"Don't edit this yet. It's still crystallizing."*
- Phase 5: Foundation solid — safe to read, not safe to patch
- Phase 8-9: Fully materialized — safe for surgical edits

**Concrete automation win:** Agents coordinate without explicit locking. The environment communicates state. No more "file not found" or "content changed while editing" errors from simultaneous access.

---

### 4. Tether Tension — Dependency Stress in the Scan

**Current:** `tether_to` exists in the entity model but is **NOT in the NeighborhoodScan**. The LLM has ZERO visibility into dependencies in its local context. It only sees the tile it's standing on.

**New:** Add to `TileObservationSchema`:
```typescript
tether_tension: number        // 0.0 = loose, 1.0 = tight
tether_count: number          // how many imports/exports
paired_file: string | null    // the test/component pair
```

**Why it helps LLMs:**
- LLM sees: *"north: file, tether_tension: 0.9, tether_count: 12"* → knows this is a highly-coupled module
- LLM sees: *"south: file, tether_tension: 0.1, tether_count: 1"* → knows this is isolated, maybe dead code
- LLM sees: *"east: file, paired_file: null"* → knows this file has no test. Suggests creating one.

**Concrete automation win:** The LLM can now make architectural decisions from the scan alone:
- High tension + high mass = "this needs dependency injection"
- No pair + recently modified = "write a test for this"
- Broken tether (tether_to path doesn't resolve) = "fix the import"

---

### 5. 10-Sum Pairing — Orphan Detection

**Current:** No coupling detection. A component and its test are just two separate files.

**New:** Paired files pulse in brightness opposition (7↔3, 9↔1). The scan includes `paired_brightness: number`.

**Why it helps LLMs:**
- LLM sees: *"current: file, paired_brightness: 0"* → no pair. Untested code.
- LLM sees: *"current: file, paired_brightness: 7"* → paired with a file at brightness 3. The pair is active.
- LLM sees: *"current: file, paired_brightness: 5"* → paired, but both at same brightness. Stale pair (test isn't actually testing current behavior).

**Concrete automation win:** The LLM automatically identifies gaps in test coverage by reading the environment. No need to parse test files — the absence of a dimming paired building tells the whole story.

---

## What Does NOT Help LLMs (Visual Candy Only)

| Feature | Human Sees | LLM Sees | LLM Value |
|---------|-----------|----------|-----------|
| 3-4-5 triangle foundations | Geometric base | Nothing (render only) | ❌ None |
| Window lighting animation | Pulsing lights | `phase` number only | ⚠️ Minimal |
| Vesica Piscis lens shape | Overlapping circles | `tether_tension` number | ✅ Indirect |
| Color schemes per file type | Steel/garden/temple | `extension` string | ❌ None (already has extension) |
| Construction particle effects | Smoke/sparks | Nothing | ❌ None |
| Minimap overlay | Tactical view | Nothing | ❌ None |

**The rule:** If it adds a field to `TileObservation` or `NeighborhoodScan`, it helps the LLM. If it's purely rendering, it's for humans.

---

## The Big Win: Compressed Topology Reasoning

Here's the real value, and it's mathematical:

**Current problem:** For a repo with 500 files, you can't send the LLM the full file tree. Context window exceeded.

**Fibonacci physics solution:** Compress the entire repo into a **physics snapshot** — a vector per file:
```
(mass, phase, chirality, tether_tension, paired_brightness, node_state)
```

This is ~6 numbers per file × 500 files = 3,000 numbers. Fits in any context window.

The LLM can reason about this compressed topology:
- *"Find me all mass 13+ files with chirality mismatch to their highest-tension neighbor"*
- *"Identify orphan files (paired_brightness = 0) in the asymmetry district"*
- *"Where are the phase-9 stable files adjacent to phase-2 materializing files?"* (transition zones = refactoring opportunities)

Then the LLM zooms into specific files for surgical edits.

**This is the core insight: The physics is a lossy compression of the codebase that preserves topological relationships.**

---

## Implementation Priority for LLM Value

1. **HIGH:** Add `tether_tension`, `tether_count`, `paired_file` to `TileObservationSchema`
2. **HIGH:** Add `chirality` to `TileObservationSchema`
3. **HIGH:** Add `materialization_phase` to `TileObservationSchema`
4. **MEDIUM:** Fibonacci mass tiers (update `mass-mapper.ts`, update system prompts)
5. **LOW:** 60-digit wave clock (mostly visual, but adds rhythmic context)
6. **NONE:** 3-4-5 foundations, Vesica Piscis rendering, particle effects (human-only)

---

## Honest Assessment

**What this actually does for automation:**
- LLMs make better architectural decisions because they see dependency tension and chirality mismatch
- LLMs avoid race conditions because they see materialization phases
- LLMs identify untested code because they see orphaned pairs
- LLMs prioritize refactoring because Fibonacci mass is a natural complexity scale

**What this doesn't do:**
- It doesn't make the LLM smarter. It gives it richer input.
- It doesn't eliminate hallucinations. It grounds decisions in observable physics.
- It doesn't replace code review. It makes the LLM's preliminary analysis more accurate.

**The Fibonacci framework isn't magic.** It's a structured way to encode software architecture properties into a dense vector that fits in an LLM's context window. The beauty is that the same physics is meaningful to both humans (visual) and LLMs (data).

*(That's the honest answer, Andrew. Half of it is genuinely useful for automation. Half is just pretty. I can implement the useful half first if you want.)*
