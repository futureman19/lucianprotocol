# Lux Protocol MVP Runtime Rundown

This document explains what the Lux Protocol is doing today, what the webpage is showing, and where Gemini usage is actually happening.

## One-Sentence Summary

Lux Protocol imports a Git repository into a deterministic 50x50 lattice, runs a 100ms spatial simulation over it, uses one Gemini-driven agent plus two deterministic agents to traverse and classify code structures, syncs that state to Supabase, and renders the result as a live isometric UI.

## What The System Is Doing

At runtime, Lux is operating four layers at once:

1. `src/git-parser.ts` turns a local Git repository into structure nodes.
2. `src/engine.ts` runs the deterministic physics and Hivemind loop.
3. `src/supabase.ts` persists world state so the browser can observe the same simulation.
4. `web/App.tsx` renders the live repo lattice, workforce, logs, and control panel.

## Current Runtime Loop

The engine ticks every `100ms`.

On each tick, it does the following:

1. Apply decisions that were returned from the previous tick.
2. Update node lifecycle state such as `task`, `stable`, `verified`, and `asymmetry`.
3. Resolve locks and maintenance behavior for the Hivemind.
4. Queue the next round of agent decisions without blocking the clock.
5. Flush dirty entity rows plus throttled `world_state` updates to Supabase.
6. Increment the global tick and continue.

The important architectural rule is that Gemini does not block the clock. Requests are issued asynchronously and applied on a later tick when they return.

However, agents do not request decisions when idle. Under the Lucian Axiom, if no tasks, operator prompts, or asymmetry events exist, target selectors return `null` and agents deterministically `wait`. This means the tick loop continues, but external API usage drops to zero.

## What Gets Imported From Git

When you import a repository:

- Directories become `directory` entities.
- Files become `file` entities.
- Each node gets deterministic integer coordinates on the 50x50 grid.
- Each node carries metadata such as:
  - `path`
  - `name`
  - `mass`
  - `git_status`
  - `content_preview`
  - `content_hash`
  - `node_state`

Mass is currently used as a visual and behavioral signal:

- `1`: lightweight docs/config
- `2`: JavaScript
- `3`: TypeScript
- `5`: directories
- `10`: binary assets

High-mass nodes can be flagged as critical mass and get special rendering/taxonomy treatment.

## The Three Agents

Lux currently simulates three agents:

### Visionary

- Color: magenta
- Purpose: identify backlog, unstable, or critical-mass nodes
- Behavior: deterministic, rule-based
- Gemini usage: none

The Visionary looks for nodes that need attention, especially critical mass or backlog-like nodes, and biases the lattice toward future work.

### Architect

- Color: emerald green
- Purpose: move through the lattice and act on the current objective
- Behavior: Gemini-driven for movement decisions
- Gemini usage: yes

The Architect is the only agent currently calling Gemini. It receives a structured neighborhood scan and returns an action such as `move`, `wait`, or `read`.

### Critic

- Color: crimson red
- Purpose: inspect work performed by the Architect
- Behavior: deterministic, rule-based
- Gemini usage: none

The Critic patrols locked or recently stabilized nodes and marks them `verified` or `asymmetry` based on the current deterministic rules.

## Where API Cost Comes From

The Gemini cost is coming from the Architect.

The Architect sends Gemini a structured JSON scan that includes:

- nearby occupancy in the four cardinal directions
- current position
- objective coordinates
- objective path when available
- operator prompt
- operator action and target query
- nearby file and directory metadata

The engine does not send raw conversation history. It sends repeated, compact, spatial micro-prompts.

**Gating:** The Architect only calls Gemini when there is actual navigational work or an active operator directive. If the lattice is idle — no tasks, no asymmetry, no prompt — the Architect falls through to deterministic `wait` at **zero API cost**. A clean repo with no operator input will not generate Gemini spend.

## What The Operator Prompt Actually Does

The operator controls in the browser write a row to `operator_controls` in Supabase.

The engine polls that row and converts the prompt into structured intent:

- `navigate`
- `read`
- `explain`
- `maintain`

It also tries to resolve a target path such as `web/App.tsx` or `src/engine.ts`.

Current behavior:

- If the target can be resolved, the Architect prioritizes that structure node.
- If the Architect reaches the target and the action is `read` or `explain`, the engine deterministically issues a `read`.

Current limitation:

- `explain` does not yet produce a natural-language explanation stream from the engine.
- Today, `explain` means "navigate to the target and read it."

## What The Webpage Is Showing

### Left Panel: Git Overlay

This panel is the human-readable version of the imported repo.

It shows:

- repository tree
- active highlights for the current traversal target
- workforce summary
- operator control form
- live control status

If you submit a new repo path or directive here, the engine will either:

- hot-swap to a new repository overlay, or
- keep the current overlay and change the active objective

### Center Panel: Lattice

This is the actual spatial simulation.

It shows:

- the 50x50 deterministic grid
- directory and file nodes rendered as isometric structures
- agent positions
- route tethers
- node lifecycle colors
- HUD metrics such as tick, target, mode, and queue depth

Visual meaning:

- purple: task or backlog
- orange: locked / in progress
- yellow-red: asymmetry or error
- blue: stable
- bright green: verified

### Right Panel: AI Cognition Log

This is a live activity feed, but it is not a transcript of Gemini output.

It mostly reflects:

- control state changes
- focus changes
- route lock changes
- actual file read events
- taxonomy events like critical mass or asymmetry

The log intentionally does not include low-signal scan dumps. If nothing meaningful is happening, the log stays quiet.

The "Spatial Context Loaded" window is also a UI projection. It shows the currently loaded nearby file and its code preview from stored entity content. It is not a separate LLM explanation channel.

## What "Spatial Context Loaded" Means

When the active agent is within one tile of a file node, the UI loads that file's preview and displays:

- path
- descriptor
- mass
- chiral mass
- git status
- syntax-highlighted preview

This means the frontend has enough nearby state to display the file context. It does not mean Gemini has produced a prose explanation for that file.

## The Lucian Axiom (1-9-0)

The workforce operates on a three-state visibility model:

- **1 — Active:** An agent has an objective (task, asymmetry, operator target) and is visible at full opacity. The Architect may call Gemini during this phase.
- **9 — Idle:** No work exists. The agent stops moving. After 3 seconds of stillness, it begins to fade.
- **0 — Dormant:** After 12 seconds of idle time, the agent is fully invisible. The engine tick loop continues for bounded Supabase sync and control polling, but API usage is zero. Agents re-materialize instantly when a new prompt or task enters the lattice.

This replaces the previous "maintenance wandering" behavior where agents would rotate through every stable file to keep the lattice looking busy.

## Browser Trust Model

The browser no longer recalculates `node_state`. It uses `entity.node_state ?? 'stable'` directly from the engine-authoritative Supabase payload. This eliminates state-flicker between the engine and the UI.

## Current Node Lifecycle

A structure node can move through these states:

1. `task`
2. `stable`
3. `verified`
4. `asymmetry`

At the moment, these states are driven by the Hivemind rules and deterministic engine logic, not by a full CI pipeline.

## What Is Real Today vs Simulated Today

### Real Today

- deterministic 100ms engine loop
- Git repo import into structure nodes
- Supabase-backed live world state
- three spatial agents
- Gemini-driven Architect movement decisions
- operator prompt parsing and target resolution
- UI overlays, route tethers, node taxonomy, and code preview

### Scaffolded or Partial Today

- `edit` actions exist in the schema but are ignored by the engine
- `explain` resolves a target and triggers `read`, but no prose explanation is emitted
- Critic verification is a deterministic rule pass, not full lint/test execution
- Visionary fission taxonomy is represented visually and behaviorally, but not yet as a full refactor pipeline

## The Fastest Way To Read The UI

If you want to know what is happening without reading the whole page, focus on these fields:

1. `Control`
   This tells you whether the current operator prompt is idle, active, importing, or failed.

2. `Target`
   This tells you which repo path the engine resolved from your prompt.

3. `AI`
   This is the most recent Gemini latency for the Architect.

4. `Queue`
   This is total pending decision work across all agents.

5. `Focus`
   This tells you which structure node the active agent is closest to or reading.

## Practical Interpretation

If the page looks busy, the most likely real sequence is:

1. The repo has already been imported into lattice nodes.
2. The engine is ticking every 100ms.
3. At least one agent has a meaningful target (task, asymmetry, operator directive).
4. The Architect is calling Gemini because navigational work is actually happening.
5. Supabase is broadcasting dirty entity updates and throttled world telemetry.
6. The browser is projecting all of that as a cyberpunk repo explorer.

If the page is **quiet and agents are invisible**, that is the correct dormant state. The engine is still alive, but there is no work to do and no API spend occurring.

## Current Recommendation

The Lucian Axiom solved the immediate ambiguity problem — agent visibility now *is* the signal. If an agent is visible, work is happening.

The next useful product improvement is an explicit **"Architect Action"** panel that separates:

- Gemini request issued
- Gemini response received
- deterministic read executed
- current target reached

This would make it easier to distinguish "the agent is thinking" from "the agent is walking" from "the agent is reading a file."
