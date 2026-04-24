# Developer Experience Vision — RepoCity Onboarding

## Persona: Alex, Senior Full-Stack Developer

Alex has 8 years of experience. Uses VS Code, GitHub, linear.app. Has seen 20+ codebases. Hates onboarding. Hates code review where they can't see the forest for the trees. Curious about AI tools but skeptical.

---

## Scenario A: New Project (Greenfield)

### Day 0: The Spark

Alex starts a new side project — a habit tracker app. Usually they'd `npm create vite`, open VS Code, stare at empty files, and lose momentum.

This time:
```bash
npx repocity init habit-tracker
```

A browser tab opens. Not a file tree. A **foggy landscape**. In the center: a small platform with a beacon (the command center). Around it: empty grid, dimly lit.

Alex drags a prompt onto the fog:
> "Create a React habit tracker with local storage, daily streaks, and a weekly chart"

**The "holy shit" moment:**
- A scout drone spawns, buzzes into the fog
- Fog clears in a expanding circle as it explores
- Scout drops pheromone waypoints: `api/`, `components/`, `hooks/`, `utils/`
- Builder drones spawn from the command center, swarm to the waypoints
- Buildings phase in: steel industrial structures for API routes, pink pavilions for components, purple silos for storage logic
- Each building grows floor by floor as code is written
- The city is alive. Alex is watching their app **grow like a coral reef**

### Day 1-3: The Flow

Alex opens RepoCity instead of VS Code. The city is now a small town:
- Industrial district (north): API routes, steel buildings with antenna arrays
- Garden district (east): UI components, pink peaked roofs
- Temple (southwest): README and documentation, white monument

Alex needs to add OAuth. They don't grep for "auth." They **look at the map** — where's the authentication district? There isn't one. The API buildings are directly exposed.

Alex drops a prompt on the industrial district:
> "Add Google OAuth login with JWT sessions"

The agents respond:
- Scout finds the right spot (between API and a new "auth" district)
- Builder constructs `auth/google.ts`, `auth/jwt.ts`
- Purple data silo spawns: `sessions.json` schema
- Tethers draw between auth buildings and API buildings — Vesica Piscis lenses pulse

Alex watches the new district crystallize. They commit by clicking the command center, selecting "Commit changes." The scaffolding fades. Buildings solidify.

### Week 2: The Hook

Alex has never committed so fast. Not because they're working harder — because **they can SEE when something is done.**
- Scaffolding on a building = uncommitted changes
- Glowing green = verified by critic agent
- Yellow warning = asymmetry detected (function too long, mass over 8)
- Red pulse = broken tether (import points to deleted file)

Alex fixes the yellow warning before it becomes technical debt. They see the problem visually before the linter complains.

**The realization:** *"I used to maintain code by memory. Now I maintain it by landscape. I remember where things are, not what they're called."*

---

## Scenario B: Existing Project (Brownfield)

### The First Hour: The Awe

Alex joins a new team. The repo has 400 files, 3 years of history. Normally: read README, grep around, ask colleagues, feel lost for a week.

This time:
```bash
cd legacy-project
npx repocity import .
```

RepoCity loads. Alex holds their breath.

A **city appears**. Not generic blocks. A living landscape:
- A massive black skyscraper in the center: `monolith.ts`, 8,200 lines, mass 89
- Around it: smaller buildings pulled toward it like satellites (gravity wells)
- A broken bridge glowing red: `import { helper } from '../utils/helpers'` — helpers was deleted
- A cluster of 20 tiny buildings, all orange, all untested: the `/legacy/` folder
- A clean district in the northeast: newer code, green verified checkmarks

Alex clicks the black skyscraper. Info panel:
```
monolith.ts
- Mass: 89 (Fibonacci tier F₁₁) — CRITICAL
- Chirality: Right-handed (imperative, class-based)
- Lines: 8,247
- Dependencies: 34 imports in, 12 exports out
- Last commit: 8 months ago
- Agents: None assigned
- Status: Asymmetry (mass exceeds critical threshold)
```

Alex drops a prompt on the skyscraper:
> "Break this into smaller modules: auth, database, API routes, middleware"

The agents swarm. Scout drones map the internal structure. Builder drones extract functions. Critic drones verify each new building. Over 20 minutes, the skyscraper dissolves and 6 smaller buildings rise in its place. Tethers re-route. The red warnings fade.

**The team lead walks by Alex's screen:** "What the hell is that?"

Alex: "The codebase. I'm refactoring it."

Team lead: "You just started today."

Alex: "I can see it."

### Week 1: The Superpower

Alex is now the team's architecture expert. Not because they read every file — because they **navigate the city**.

A junior asks: "Where do I add the new payment feature?"

Alex zooms out. Points:
- "See the industrial district? That's API routes."
- "See the gap between it and the data silos? That's where payment logic goes."
- "Drop your prompt there. The agents will scaffold it."

The junior does. A new building phases in. The junior sees their code become architecture in real-time.

**Code review is different now.** Alex opens a PR in RepoCity:
- Changed files glow with scaffolding overlay
- New buildings are semi-transparent (phasing in)
- Tether changes pulse: new connections = cyan, broken = red
- Critic agent has already reviewed — green checkmarks on verified files

Alex reviews by **walking through the city**, not reading diffs line by line.

### Month 1: The Conversion

The team starts every standup with RepoCity open. The city is the single source of truth:
- "The auth district has a yellow warning — someone fix that asymmetry"
- "New buildings in the API district need tests — they're orphans"
- "The gravity well around `database.ts` is pulling too many modules — we need an abstraction layer"

The PM uses screenshots of the city in stakeholder meetings:
- "This is our current architecture. The red lines are tech debt. The green is verified."
- "Our velocity is up because agents handle scaffolding while humans handle logic."

---

## What Makes RepoCity Sticky

### 1. Spatial Memory Beats Name Memory

Developers don't remember `src/utils/helpers/formatDate.ts`. They remember:
- "The purple silo in the utility district, second from the left"
- "The building with the peaked roof next to the temple"

Human brains evolved for spatial navigation, not filesystem trees. RepoCity matches your brain.

### 2. Agents Work While You Sleep

Alex assigns a task at 6pm: "Add TypeScript strict mode to the entire project."

They go home. Overnight:
- Builder drones migrate `.js` to `.ts`
- Critic drones fix type errors
- The city updates — steel buildings gain a blue tint (TypeScript verified)

Alex checks their phone at breakfast. The city looks different. They zoom in. Changelog: "42 files migrated, 127 type errors resolved, 3 manual reviews needed."

**RepoCity is the only IDE that works while you're not using it.**

### 3. The Physics Is Honest

A massive building can't hide. A broken tether can't be ignored. An untested file is visually lonely — you feel the absence.

Current tools: You run `npm test` and see a percentage. You ignore it.

RepoCity: You see an orphan building with no paired dimming partner. It **feels wrong**. You write the test.

### 4. Onboarding = Exploration

New hire doesn't read docs. They **tour the city**:
- Click a building → see the code
- Follow a tether → trace dependencies
- Watch agent trails → see where work happens
- Read pheromone messages → see what other agents discovered

New hire understands the architecture in **hours**, not weeks.

### 5. Git History = Time Travel

Alex drags the timeline slider. The city rewinds:
- 3 months ago: The monolith is even bigger
- 6 months ago: The auth district doesn't exist
- 1 year ago: Half the city is fog (unexplored code)

Alex sees the evolution. They understand **why** things are the way they are. They don't blame the previous developer — they see the constraints that shaped the city.

### 6. The Killer Feature Nobody Else Has

Every AI coding tool (Copilot, Cursor, etc.) has the same flaw:
- LLM writes code → you read it → you paste it → you test it → you iterate
- The LLM works in a black box. You work in your editor. They're disconnected.

RepoCity:
- LLM works **in the same space you see**
- When an agent says "I refactored auth," you see the building get renovated
- When an agent gets stuck, you see it circling, broadcasting pheromones for help
- When an agent makes a mistake, you see the tether break and glow red

**The explanation and the execution are visually coupled.**

---

## Feature Checklist: What Gets Them Hooked

### Must-Have (First Hour)
- [x] One-command import (`npx repocity import .`)
- [x] Real-time git sync (file changes = building changes)
- [x] Click building → see code (no separate editor needed)
- [x] Drag prompt → spawn agents (the magic moment)
- [x] Agent activity visible (drones moving = work happening)

### Must-Have (First Week)
- [x] Visual diff (PR = temporary construction zone)
- [x] Search → zoom to building (spatial search, not grep)
- [x] GitHub integration (PRs, issues, commits visible in city)
- [x] Mobile view (check agent progress from anywhere)
- [x] Team multiplayer (see colleagues' cursors, collaborative prompts)

### Nice-to-Have (First Month)
- [ ] Architecture linting (auto-detect circular deps, god classes)
- [ ] Performance heatmap (hot buildings = most imported/edited)
- [ ] Time travel (scroll through git history, watch city evolve)
- [ ] Export screenshots (for READMEs, stakeholder decks)
- [ ] Plugin system (custom building styles, custom agents)

### The Vision (Year 1)
- [ ] Global city (all your repos visible as districts in one world)
- [ ] Cross-repo dependencies (shared libraries = bridges between cities)
- [ ] Marketplace (buy/sell agent behaviors, building styles, city templates)
- [ ] RepoCity as OS (not an app — the layer between you and your filesystem)

---

## The Ultimate Pitch

> "VS Code shows you files. GitHub shows you history. RepoCity shows you the truth."
>
> Your codebase is not a list of paths. It's a living system with gravity, tension, growth, decay. You can't see that in a tree view. You can't feel it in a terminal.
>
> RepoCity makes the invisible visible. And once you see it, you can't unsee it.
>
> Every project you touch — you'll want to see it as a city.
