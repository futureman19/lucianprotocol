import type { Entity } from '../src/types';

// ═════════════════════════════════════════════════════════════════════════════
// FIBONACCI UNIVERSE PHYSICS — Direct isomorphic mapping to codebase dynamics
// ═════════════════════════════════════════════════════════════════════════════

// The 60-digit Pisano period — computational heartbeat of the universe
// Derived from Fibonacci mod 10: 0,1,1,2,3,5,8,3,1,4,5,9,4,3,7,0,7,7,4,1,5,6,1,7,8,5,3,8,1,9,0,9,9,8,7,5,2,7,9,6,5,1,6,7,3,0,3,3,6,9,5,4,9,3,2,5,7,2,9,1
// Normalized to 0-1 range for animation
export const PISANO_60: readonly number[] = [
  0, 0.1, 0.1, 0.2, 0.3, 0.5, 0.8, 0.3, 0.1, 0.4,
  0.5, 0.9, 0.4, 0.3, 0.7, 0, 0.7, 0.7, 0.4, 0.1,
  0.5, 0.6, 0.1, 0.7, 0.8, 0.5, 0.3, 0.8, 0.1, 0.9,
  0, 0.9, 0.9, 0.8, 0.7, 0.5, 0.2, 0.7, 0.9, 0.6,
  0.5, 0.1, 0.6, 0.7, 0.3, 0, 0.3, 0.3, 0.6, 0.9,
  0.5, 0.4, 0.9, 0.3, 0.2, 0.5, 0.7, 0.2, 0.9, 0.1,
];

// Fibonacci mass tiers: file size maps to Fibonacci numbers
// Small files (1-10 lines) = F(1) = 1
// Medium files (10-50 lines) = F(3) = 2
// Large files (50-100 lines) = F(4) = 3
// Massive files (100-200 lines) = F(5) = 5
// God files (200-500 lines) = F(6) = 8
// Monoliths (500-1000 lines) = F(7) = 13
// Titans (1000-2000 lines) = F(8) = 21
// Leviathans (2000-5000 lines) = F(9) = 34
// Skyscrapers (5000-10000 lines) = F(10) = 55
// World-eaters (10000+ lines) = F(11) = 89
export const FIBONACCI_MASS: readonly number[] = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

// Chiral mass threshold: files at F(6)=8 or higher create gravity wells
export const CRITICAL_MASS_THRESHOLD = 8;

// ═════════════════════════════════════════════════════════════════════════════
// 1. 60-DIGIT PISANO WAVE — Computational heartbeat
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Get the current Pisano wave value (0-1) at a given phase.
 * Used for: window lighting rhythm, construction speed, pheromone decay rate.
 */
export function getPisanoWave(phase: number): number {
  const index = Math.floor(Math.abs(phase)) % 60;
  return PISANO_60[index] ?? 0;
}

/**
 * Get a smooth oscillation value (-1 to 1) for continuous animation.
 * The 60-step cycle creates a breathing rhythm distinct from binary on/off.
 */
export function getPisanoOscillation(phase: number): number {
  const wave = getPisanoWave(phase);
  // Map 0-1 to -1 to 1 with the characteristic Fibonacci "jitter"
  return (wave - 0.5) * 2;
}

/**
 * Get sync vs async pulse indicator.
 * When Pisano is near 0 or 1, system is in "sync" state (stable).
 * When Pisano is near 0.5, system is in "async" state (unstable/flickering).
 */
export function getSyncState(phase: number): 'stable' | 'unstable' {
  const wave = getPisanoWave(phase);
  // Near edges = stable, near middle = unstable
  return wave < 0.2 || wave > 0.8 ? 'stable' : 'unstable';
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. FIBONACCI MASS TIERS — Replace linear mass with Fibonacci sequence
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Map a file's line count to its Fibonacci mass tier.
 * Returns the Fibonacci number (1, 2, 3, 5, 8, 13, 21, 34, 55, 89).
 */
export function getFibonacciMass(lines: number): number {
  if (lines <= 10) return FIBONACCI_MASS[1]!;   // F(1) = 1
  if (lines <= 50) return FIBONACCI_MASS[2]!;   // F(2) = 1 (or 2)
  if (lines <= 100) return FIBONACCI_MASS[3]!;  // F(3) = 2
  if (lines <= 200) return FIBONACCI_MASS[4]!;  // F(4) = 3
  if (lines <= 500) return FIBONACCI_MASS[5]!;  // F(5) = 5
  if (lines <= 1000) return FIBONACCI_MASS[6]!; // F(6) = 8
  if (lines <= 2000) return FIBONACCI_MASS[7]!; // F(7) = 13
  if (lines <= 5000) return FIBONACCI_MASS[8]!; // F(8) = 21
  if (lines <= 10000) return FIBONACCI_MASS[9]!; // F(9) = 34
  if (lines <= 20000) return FIBONACCI_MASS[9]!; // F(9) = 34
  return FIBONACCI_MASS[10]!;                      // F(10) = 55 (or 89 for 20k+)
}

/**
 * Get the Fibonacci mass tier index (0-10) for a file.
 */
export function getFibonacciTier(lines: number): number {
  if (lines <= 10) return 1;
  if (lines <= 50) return 2;
  if (lines <= 100) return 3;
  if (lines <= 200) return 4;
  if (lines <= 500) return 5;
  if (lines <= 1000) return 6;
  if (lines <= 2000) return 7;
  if (lines <= 5000) return 8;
  if (lines <= 10000) return 9;
  if (lines <= 20000) return 9;
  return 10;
}

/**
 * Check if a file has reached critical mass (F ≥ 8).
 * Critical mass files become gravity wells, pulling smaller files inward.
 */
export function isCriticalFibonacciMass(lines: number): boolean {
  return getFibonacciMass(lines) >= CRITICAL_MASS_THRESHOLD;
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. 24-UNIT IMBALANCE / CHIRALITY — Temporal coupling arrow
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Get the chirality (handedness) of a file based on its line count mod 24.
 * 
 * LEFT-LEANING (lines % 24 < 12): Functional/declarative, data-flow, hooks, utilities
 *   → Buildings lean LEFT, yellow tether stress (legacy/modern mismatch)
 * 
 * RIGHT-LEANING (lines % 24 ≥ 12): Class-based/imperative, OOP, controllers, services
 *   → Buildings lean RIGHT, cyan tether harmony (same-era coupling)
 * 
 * NEUTRAL (lines % 24 = 0 or 12): Balanced files, perfect symmetry
 *   → Buildings stand straight, white glow
 */
export function getChirality(lines: number): 'left' | 'right' | 'neutral' {
  const remainder = lines % 24;
  if (remainder === 0 || remainder === 12) return 'neutral';
  if (remainder < 12) return 'left';
  return 'right';
}

/**
 * Get the chirality value as a signed number (-1 to 1).
 * Used for tilt calculations in rendering.
 */
export function getChiralityTilt(lines: number): number {
  const remainder = lines % 24;
  // Map 0-11 → -1 to 0 (left), 12-23 → 0 to 1 (right)
  if (remainder < 12) {
    return -(1 - (remainder / 12)); // -1 (at 0) to ~0 (at 11)
  }
  return (remainder - 12) / 12; // 0 (at 12) to ~1 (at 23)
}

/**
 * Get the imbalance ratio: how far from neutral (0 = perfectly balanced).
 */
export function getImbalanceRatio(lines: number): number {
  const remainder = lines % 24;
  const distanceFromNeutral = Math.min(remainder, 24 - remainder);
  return distanceFromNeutral / 12; // 0 = neutral, 1 = maximum imbalance
}

/**
 * Get tether color for a connection between two files based on chirality match.
 * Yellow = stress (cross-chirality coupling)
 * Cyan = harmony (same-chirality coupling)
 * Red = maximum conflict (left ↔ right with high imbalance)
 */
export function getTetherColor(lines1: number, lines2: number): string {
  const c1 = getChirality(lines1);
  const c2 = getChirality(lines2);
  
  if (c1 === 'neutral' || c2 === 'neutral') {
    return 'rgba(86, 217, 255, 0.35)'; // Cyan — neutral is harmonious
  }
  
  if (c1 === c2) {
    return 'rgba(86, 217, 255, 0.5)'; // Cyan — same chirality, harmonious
  }
  
  // Cross-chirality: check imbalance severity
  const imbalance1 = getImbalanceRatio(lines1);
  const imbalance2 = getImbalanceRatio(lines2);
  const severity = (imbalance1 + imbalance2) / 2;
  
  if (severity > 0.7) {
    return 'rgba(239, 68, 68, 0.6)'; // Red — maximum conflict
  }
  
  return 'rgba(253, 224, 71, 0.5)'; // Yellow — stress
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. 3-4-5 FOUNDATIONS — Quantum pixel triangular base
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Get the 3-4-5 triangular foundation offset for a building.
 * Every file sits on a triangular quantum pixel base that hints at its stability.
 * 
 * Returns the three corner points of the triangular foundation relative to building center.
 */
export function get3_4_5Foundation(
  width: number,
  depth: number,
): Array<{ x: number; y: number }> {
  // 3-4-5 right triangle: base = 3, height = 4, hypotenuse = 5
  const scale = Math.min(width, depth) / 5;
  return [
    { x: -1.5 * scale, y: 0 },        // Left corner (3 units / 2)
    { x: 1.5 * scale, y: 0 },         // Right corner (3 units / 2)
    { x: 0, y: -2 * scale },          // Top corner (4 units / 2, pointing up in iso)
  ];
}

/**
 * Get foundation color based on file stability.
 * Stable = solid cyan, In-progress = pulsing orange, Asymmetry = flickering yellow.
 */
export function getFoundationColor(nodeState: string): string {
  switch (nodeState) {
    case 'task': return 'rgba(236, 72, 153, 0.4)';
    case 'in-progress': return 'rgba(251, 146, 60, 0.5)';
    case 'asymmetry': return 'rgba(253, 224, 71, 0.6)';
    case 'verified': return 'rgba(34, 197, 94, 0.5)';
    default: return 'rgba(86, 217, 255, 0.35)';
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. VESICA PISCIS — Dependency strength lens
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Calculate Vesica Piscis lens thickness for a dependency connection.
 * 
 * Lens thickness = overlap between two temporal cycles (importing and exporting).
 * Thick lens = strong coupling (many shared imports/exports).
 * Thin lens = brittle connection (few shared, easily broken).
 * No lens = no connection.
 * 
 * @param importCount — number of imports this file makes
 * @param exportCount — number of exports this file provides
 * @returns lens thickness 0-1 (0 = no coupling, 1 = maximum coupling)
 */
export function getVesicaPiscisStrength(importCount: number, exportCount: number): number {
  if (importCount === 0 && exportCount === 0) return 0;
  
  // The lens is thickest when import and export counts are balanced
  // Unbalanced counts create a thin, brittle lens
  const total = importCount + exportCount;
  const balance = 1 - Math.abs(importCount - exportCount) / total;
  
  // Scale by total activity (more imports + exports = stronger coupling)
  const activity = Math.min(1, total / 20); // Cap at 20 total connections
  
  return balance * activity;
}

/**
 * Get the color for a Vesica Piscis lens based on strength.
 */
export function getVesicaColor(strength: number): string {
  if (strength === 0) return 'transparent';
  if (strength > 0.7) return `rgba(167, 139, 250, ${strength * 0.5})`; // Purple — strong
  if (strength > 0.3) return `rgba(86, 217, 255, ${strength * 0.4})`;  // Cyan — moderate
  return `rgba(253, 224, 71, ${strength * 0.5})`; // Yellow — weak/brittle
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. 10-SUM SYMMETRY — Balanced information packets
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Check if two files form a 10-sum pair (complementary masses summing to 10).
 * 
 * Examples: component (mass 7) + test (mass 3) = 10
 *           config (mass 2) + docs (mass 8) = 10
 * 
 * Paired files pulse in brightness opposition — when one is bright, the other is dim.
 */
export function isTenSumPair(mass1: number, mass2: number): boolean {
  return mass1 + mass2 === 10;
}

/**
 * Get the brightness for a file in a 10-sum pair at a given phase.
 * Returns 0.3-1.0 range. Paired files oscillate in opposition.
 */
export function getTenSumBrightness(mass: number, phase: number): number {
  // Files with mass closer to 5 have neutral brightness
  // Files with mass at extremes (1 or 9) have maximum oscillation
  const extremity = Math.abs(mass - 5) / 4; // 0 (at 5) to 1 (at 1 or 9)
  const oscillation = Math.sin(phase * 0.1) * extremity;
  return 0.5 + oscillation * 0.5; // 0.3 to 1.0
}

/**
 * Find all 10-sum pairs in a set of entities.
 * Returns array of paired entity IDs.
 */
export function findTenSumPairs(entities: Entity[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const checked = new Set<string>();
  
  for (let i = 0; i < entities.length; i++) {
    const e1 = entities[i];
    if (!e1 || checked.has(e1.id)) continue;
    
    const mass1 = getEntityFibonacciMass(e1);
    
    for (let j = i + 1; j < entities.length; j++) {
      const e2 = entities[j];
      if (!e2 || checked.has(e2.id)) continue;
      
      const mass2 = getEntityFibonacciMass(e2);
      
      if (isTenSumPair(mass1, mass2)) {
        pairs.push([e1.id, e2.id]);
        checked.add(e1.id);
        checked.add(e2.id);
        break;
      }
    }
  }
  
  return pairs;
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. 9-LEVEL PHASING — Files materialize through 9 levels of construction
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The 9-level construction wave: 1, 2, 3, 5, 8, 5, 3, 2, 1
 * Files don't pop into existence — they phase in through Fibonacci steps.
 */
export const CONSTRUCTION_WAVE: readonly number[] = [1, 2, 3, 5, 8, 5, 3, 2, 1];

/**
 * Get the construction phase (0-1) for a file based on its age and activity.
 * 
 * New/untouched files phase in slowly (levels 1-5).
 * Recently edited files are at peak visibility (level 5 = 8).
 * Stable old files phase out slightly (levels 6-9, but never fully disappear).
 * 
 * @param entity — the file entity
 * @param tick — current world tick
 * @returns opacity 0-1 (0 = invisible, 1 = fully visible)
 */
export function getConstructionPhase(entity: Entity, tick: number): number {
  const age = tick - (entity.tick_updated ?? 0);
  
  // Preview mode: tick is 0 or very low, show everything at full visibility
  if (tick < 10) {
    return 0.85 + (getPisanoWave(tick + entity.id.length) * 0.15);
  }
  
  // Files with recent activity (edited within last 50 ticks) are hot
  const isHot = age < 50;
  const isNew = age < 10;
  
  if (isNew) {
    // Brand new file: phase in through levels 1-4
    const newness = age / 10; // 0 to 1
    const waveIndex = Math.floor(newness * 5); // 0-4
    return (CONSTRUCTION_WAVE[Math.min(waveIndex, 4)]! ?? 1) / 8;
  }
  
  if (isHot) {
    // Recently edited: peak visibility
    const hotness = 1 - ((age - 10) / 40); // 1.0 (at 10) to 0 (at 50)
    return 0.6 + hotness * 0.4; // 1.0 to 0.6
  }
  
  // Stable old file: gentle pulse
  const stablePhase = (tick + entity.id.length) % 60;
  const waveValue = CONSTRUCTION_WAVE[stablePhase % 9]! ?? 1;
  return 0.5 + (waveValue / 8) * 0.3; // 0.5 to 0.8
}

/**
 * Get the "heat" of a file — how actively it's being edited.
 * Flickering files = hot code under active development.
 */
export function getFileHeat(entity: Entity, tick: number): number {
  const age = tick - (entity.tick_updated ?? 0);
  if (age > 100) return 0;
  if (age < 10) return 1;
  return 1 - (age / 100);
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS — Entity-specific wrappers
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Get the Fibonacci mass for an entity (file or directory).
 */
export function getEntityFibonacciMass(entity: Entity): number {
  if (entity.type === 'directory') {
    // Directory mass = sum of child masses (estimated)
    return Math.min(89, (entity.mass ?? 1) * 3);
  }
  
  const content = entity.content ?? entity.content_preview ?? '';
  const lines = content.split('\n').length;
  return getFibonacciMass(lines);
}

/**
 * Get the line count for an entity.
 */
export function getEntityLines(entity: Entity): number {
  const content = entity.content ?? entity.content_preview ?? '';
  return content.split('\n').length;
}

/**
 * Get the building height using Fibonacci mass instead of linear mass.
 * Mass 1-2 = 0.5-1.0 (small shed)
 * Mass 3-5 = 1.0-2.5 (house/office)
 * Mass 8-13 = 3.0-5.0 (mid-rise)
 * Mass 21-34 = 6.0-10.0 (skyscraper)
 * Mass 55-89 = 12.0-20.0 (world-eater)
 */
export function getFibonacciBuildingHeight(entity: Entity): number {
  if (entity.type === 'directory') return 1.2;
  if (entity.type === 'wall') return 1.5;
  if (entity.type === 'goal') return 0.3;
  
  const mass = getEntityFibonacciMass(entity);
  const tier = getFibonacciTier(getEntityLines(entity));
  
  // Height grows with Fibonacci mass:
  // mass 1 → ~1.0, mass 5 → ~1.6, mass 13 → ~2.8, mass 34 → ~6.0, mass 89 → ~14.0
  const baseHeight = 0.8 + mass * 0.15;
  const tierBoost = tier * 0.15;
  
  return Math.min(20, Math.max(0.8, baseHeight + tierBoost));
}

/**
 * Get footprint using Fibonacci mass.
 */
export function getFibonacciFootprint(entity: Entity): { depth: number; width: number } {
  if (entity.type === 'directory') {
    return { depth: 1.6, width: 1.6 };
  }
  
  const mass = getEntityFibonacciMass(entity);
  const scale = Math.min(2.0, Math.max(0.4, 0.4 + Math.sqrt(mass) / 3));
  
  if (entity.type === 'wall') {
    return { depth: 1, width: 1 };
  }
  
  // Chirality affects footprint: left-leaning files are narrower, right-leaning wider
  const lines = getEntityLines(entity);
  const chirality = getChiralityTilt(lines);
  const widthScale = 1 + chirality * 0.15; // ±15% width variation
  
  return { depth: 0.6 * scale, width: 0.6 * scale * widthScale };
}
