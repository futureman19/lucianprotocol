# The Vibe Coder — Primary Market Persona for Repocity

## Who They Are

The Vibe Coder is the fastest-growing segment of software creators. They didn't go to a coding bootcamp. They didn't study computer science. They don't dream in ASCII.

They are:
- Designers who learned to ship
- Product managers who got tired of waiting for dev teams
- Founders building MVPs on weekends
- Creatives using AI to bridge the gap between idea and execution
- Anyone who says "I can't code, but I can vibe"

## The Problem

### Raw Code is Meaningless
```typescript
export const useEffect = (fn: EffectCallback, deps?: DependencyList): void => {
  const hook = nextHook();
  if (hook === null) throw new Error('Rendered more hooks than during the previous render.');
  // ... 47 more lines of abstract nonsense
};
```

To a Vibe Coder, this is not just hard to read — it's **not even language**. It's noise. Symbols without semantic grounding. Even with AI explaining it line by line, it's like reading a recipe in a foreign language when you've never tasted the food.

### Current Tools Assume Dev Literacy
- **VS Code**: "Just open the file tree!" — It's a wall of meaningless names
- **GitHub**: "Read the diff!" — Green and red lines tell you nothing about impact
- **Terminal**: "Run this command!" — You don't know what it does and you're scared to break something
- **Code Review**: "This function is too long" — How long is "too long"? Why does it matter?

### The AI Dependency Trap
Vibe Coders rely on AI because they have no mental model of the codebase. They ask AI to "fix this" or "add that" but:
- They can't verify if the AI understood the architecture
- They can't tell if a change broke something elsewhere
- They end up with spaghetti code because they couldn't see the structure
- They know something is wrong but can't articulate what

## What They Need

### 1. A City, Not a Tree

**They don't see:**
```
src/
  components/
    Button.tsx
    Card.tsx
    Modal.tsx
  utils/
    helpers.ts
    format.ts
  api/
    routes.ts
```

**They see:**
- A garden district with pink pavilions (UI components)
- A steel industrial zone with antenna arrays (API routes)  
- A purple data silo dome (database logic)
- **Bridges** connecting them (dependencies)
- **Glowing red bridges** where something is broken
- **Yellow buildings** that are too big and need splitting

**The spatial map IS their understanding.** They don't need to know what `useEffect` does. They need to know: "The UI building connects to the API building through this bridge. If I change the bridge, both sides might break."

### 2. Agents They Can Watch, Not Black Boxes

**Current AI tools:**
- You type a prompt
- AI "thinks" in a spinner
- Code appears
- You paste it
- It maybe works

**Vibe Coders feel:** Lost, dependent, anxious. They don't know what happened or why.

**Repocity:**
- You drag a prompt onto a building
- A scout drone spawns, buzzes around, explores
- Drops pheromone waypoints
- Builder drones swarm
- You **watch** the building renovate in real-time
- Critic drones verify — green checkmark means it's safe

**Vibe Coders feel:** In control. They're not "using AI" — they're **managing a city**. The agents work for them. They can see what's happening.

### 3. "Click to Understand" Instead of "Read to Understand"

**Current:** Read 500 lines of code to understand a module.

**Repocity:** Click a building. See:
```
🏬 User Authentication Tower
  Purpose: Handles login, signup, password reset
  Status: ✅ Verified (critic approved)
  Size: Mass 5 — healthy (Fibonacci tier)
  Connections: 
    → Database Silo (strong tether, 8 imports)
    → API Gateway (medium tether, 3 imports)
    → UI Components (loose tether, 1 import)
  Chirality: Right-handed (stateful, session management)
  ⚠️ Warning: No test pair found (orphan building)
```

They understand the **role** and **relationships** without reading the code. The code is there if they want it, but they don't need it to make architectural decisions.

### 4. The "Game Loop" of Development

Vibe Coders think in games. They understand:
- Resources (energy, materials, currency)
- Workers (units, NPCs, automation)
- Territory (zones, districts, expansion)
- Upgrades (leveling up buildings)
- Quests (objectives, missions)

**Repocity maps directly:**
- Resources → Code quality (clean = high resources, spaghetti = drained)
- Workers → AI agents (scout, builder, critic, miner)
- Territory → Codebase districts (auth zone, UI zone, API zone)
- Upgrades → Refactoring (mass 8 building → split into two mass 5 buildings)
- Quests → Tasks ("Add OAuth" = build the auth district)

**Development becomes:** A strategy game where the goal is a healthy, growing city. Not a scary text puzzle where one wrong move breaks everything.

### 5. Safety Through Visibility

Vibe Coders are afraid of breaking things. They don't have the intuition of what a change will affect.

**Repocity makes consequences visible:**
- Hover over a building → all connected tethers light up
- Planning to delete a file? The tether turns **red** and **pulses** — "this will break 4 other buildings"
- Want to refactor? Scout drone shows the impact zone before you commit
- Agents warn: "This change affects the database silo — proceed?"

**They gain confidence because they can SEE the impact.** Not because they read the code.

## The "Vibe Coder" Experience

### Hour 0: First Import
```bash
npx repocity import .
```

A city appears. Even if it's messy, it's **theirs**. They can point at things.

"That's my login stuff. That's the UI. That's... wait, what's that giant black thing in the middle?"

Click. `monolith.ts`, 12,000 lines.

"Oh. That's the problem."

They don't need a senior dev to tell them. They can see it.

### Hour 1: First Change

They need to add a new feature. In VS Code: panic. In RepoCity:

1. Zoom to the right district (they know where things live spatially)
2. Drag prompt: "Add a user profile page"
3. Watch scout drone find the spot
4. Watch builder construct the building
5. See new tethers form automatically
6. Critic drone checks — green light

They didn't write code. They **directed construction.** They understand what happened because they watched it.

### Day 1: Confidence

A bug report comes in: "Login doesn't work for Google users."

In VS Code: grep "google", read 20 files, get lost.

In RepoCity: "The auth district has a red tether. Let me click it."

The auth building shows:
```
⚠️ Broken tether to Google OAuth module
  Error: Module not found (deleted in commit abc123)
  Suggested fix: Re-link or rebuild OAuth
```

They understand the problem in 30 seconds. They didn't read code. They **read the city.**

### Week 1: Ownership

They've been making changes. The city evolves:
- New districts (features they added)
- Renovated buildings (refactored code)
- Removed scaffolding (committed changes)
- Paired buildings (wrote tests — they can see the dimming partner)

They show their friend: "Look at my codebase!"

It's not a folder of files. It's a **city they built.**

## Why This Persona is the Future

### The Numbers
- 2024: GitHub Copilot has 1.3M paid subscribers (many are not traditional devs)
- 2025: "Vibe coding" becomes a recognized term
- 2026: AI-native IDEs (Cursor, Windsurf) see massive growth from non-traditional users
- The segment is growing **exponentially** faster than traditional developer population

### The Gap
Current AI tools assume the user is a developer who just wants help. They show code, diffs, terminals — the same tools, just AI-assisted.

**Vibe Coders don't want better coding tools. They want to NOT code while still shipping.**

RepoCity is the first tool built from the ground up for people who:
- Can't read code fluently
- Don't think in files and functions
- Do think in spaces, objects, relationships, games
- Want to manage, not implement

### The Lock-In
Once a Vibe Coder uses RepoCity:
- Raw repos become scary and meaningless again
- They can't work without spatial grounding
- They become dependent on the visualization
- Traditional tools feel like working blind

**The switching cost is understanding itself.**

## Messaging for This Market

**Don't say:**
- "IDE with AI agents"
- "Visual code editor"
- "Git visualization tool"
- "For developers"

**Do say:**
- "Your codebase as a city you can explore"
- "Manage your project like a strategy game"
- "You don't need to read code to ship code"
- "Build software without touching the terminal"
- "The city is alive — agents work while you watch"

**The tagline:**
> "You don't code. You build cities."

## Feature Implications

### Must-Have for Vibe Coders
- [ ] **No terminal required** — everything visual, clickable, draggable
- [ ] **Natural language only** — no config files, no CLI, no setup
- [ ] **Agents explain what they did** — in plain English, not commit messages
- [ ] **Undo as time travel** — slider to rewind the city, see what changed
- [ ] **Share as screenshot** — the city IS the documentation
- [ ] **Mobile view** — check your city from anywhere

### Anti-Features (Don't Build)
- [ ] **Raw file tree view** — they don't want to see files
- [ ] **Terminal integration** — scary, breaks the illusion
- [ ] **Diff view** — green/red lines are meaningless; show building renovation instead
- [ ] **Code editor** — they don't write code, they direct agents
- [ ] **Complex configuration** — if it needs a config file, it doesn't exist

## Conclusion

The Vibe Coder is not a "lesser" developer. They're a **different kind of creator**. They think spatially, not textually. They manage, not implement. They explore, not read.

Repocity isn't making coding accessible. It's making **software creation feel natural** for people whose brains don't map to text files.

The senior dev is a secondary market. The Vibe Coder is the primary market.

Andrew is the first one. There are millions more.
