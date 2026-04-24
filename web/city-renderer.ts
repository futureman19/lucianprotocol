import type { Entity } from '../src/types';
import type { IsoLayout, ScreenPoint } from './iso';
import { toScreen, createPrismProjection, traceFace } from './iso';
import { getBuildingStyle, getDroneStyle, getNodeStatePalette, getFileFootprint, getBuildingHeight } from './building-styles';
import { ParticleSystem } from './particles';
import {
  getPisanoWave,
  getPisanoOscillation,
  getSyncState,
  getFibonacciMass,
  getFibonacciTier,
  getChirality,
  getChiralityTilt,
  getImbalanceRatio,
  get3_4_5Foundation,
  getFoundationColor,
  getConstructionPhase,
  getFileHeat,
  getEntityFibonacciMass,
  getEntityLines,
  getFibonacciBuildingHeight,
  getFibonacciFootprint,
  isCriticalFibonacciMass,
} from './fibonacci-physics';

// Drawing helpers
function withAlpha(hexColor: string, alpha: number): string {
  const normalized = hexColor.replace('#', '');
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function fillFace(
  context: CanvasRenderingContext2D,
  points: ScreenPoint[],
  color: string,
  stroke: string,
): void {
  traceFace(context, points);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = 1;
  context.stroke();
}

// Draw a window on a building face
function drawWindow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  glow: string,
  lit: boolean,
): void {
  context.save();
  if (lit) {
    context.shadowBlur = 6;
    context.shadowColor = glow;
    context.fillStyle = color;
  } else {
    context.fillStyle = withAlpha(color, 0.25);
  }
  context.fillRect(x, y, width, height);
  // Window frame
  context.strokeStyle = withAlpha(color, 0.4);
  context.lineWidth = 0.5;
  context.strokeRect(x, y, width, height);
  context.restore();
}

// Draw windows on building faces
function drawBuildingWindows(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  style: ReturnType<typeof getBuildingStyle>,
  height: number,
  phase: number,
  entity: Entity,
): void {
  const { left, right, top } = projection;

  // Skip windows for tiny buildings
  if (height < 1.2) return;

  const windowRows = Math.max(1, Math.floor(height * 1.5));
  const windowColsLeft = 2;
  const windowColsRight = 2;

  // Animate window lighting based on phase
  const lightPhase = (phase % 20) / 20;

  // Left face windows
  for (let row = 0; row < windowRows; row++) {
    for (let col = 0; col < windowColsLeft; col++) {
      const t = (row * windowColsLeft + col) / (windowRows * windowColsLeft);
      const lit = Math.abs(t - lightPhase) < 0.15 || entity.node_state === 'in-progress';

      // Interpolate position on left face
      const topY = left[1].sy + (left[0].sy - left[1].sy) * ((row + 0.3) / (windowRows + 0.5));
      const bottomY = left[1].sy + (left[0].sy - left[1].sy) * ((row + 0.7) / (windowRows + 0.5));
      const leftX = left[1].sx + (left[0].sx - left[1].sx) * ((col + 0.25) / windowColsLeft);
      const rightX = left[1].sx + (left[0].sx - left[1].sx) * ((col + 0.75) / windowColsLeft);

      const ww = Math.max(2, (rightX - leftX) * 0.6);
      const wh = Math.max(2, (bottomY - topY) * 0.5);
      const wx = leftX + (rightX - leftX) * 0.2;
      const wy = topY + (bottomY - topY) * 0.25;

      drawWindow(context, wx, wy, ww, wh, style.windowColor, style.windowGlow, lit);
    }
  }

  // Right face windows
  for (let row = 0; row < windowRows; row++) {
    for (let col = 0; col < windowColsRight; col++) {
      const t = (row * windowColsRight + col + 5) / (windowRows * windowColsRight + 10);
      const lit = Math.abs(t - lightPhase) < 0.15 || entity.node_state === 'in-progress';

      const topY = right[1].sy + (right[0].sy - right[1].sy) * ((row + 0.3) / (windowRows + 0.5));
      const bottomY = right[1].sy + (right[0].sy - right[1].sy) * ((row + 0.7) / (windowRows + 0.5));
      const leftX = right[1].sx + (right[0].sx - right[1].sx) * ((col + 0.25) / windowColsRight);
      const rightX = right[1].sx + (right[0].sx - right[1].sx) * ((col + 0.75) / windowColsRight);

      const ww = Math.max(2, (rightX - leftX) * 0.6);
      const wh = Math.max(2, (bottomY - topY) * 0.5);
      const wx = leftX + (rightX - leftX) * 0.2;
      const wy = topY + (bottomY - topY) * 0.25;

      drawWindow(context, wx, wy, ww, wh, style.windowColor, style.windowGlow, lit);
    }
  }
}

// Draw roof based on style
function drawRoof(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  style: ReturnType<typeof getBuildingStyle>,
  layout: IsoLayout,
): void {
  const { roofStyle, trim } = style;
  const { top, center } = projection;

  if (roofStyle === 'none') return;

  context.save();
  context.strokeStyle = trim;
  context.lineWidth = 1.5;
  context.shadowBlur = 8;
  context.shadowColor = style.glow;

  if (roofStyle === 'flat') {
    // Antenna / communication pole
    const poleHeight = layout.tileHeight * 0.4;
    context.beginPath();
    context.moveTo(center.sx, center.sy);
    context.lineTo(center.sx, center.sy - poleHeight);
    context.stroke();
    // Blinking light
    context.fillStyle = '#ff4444';
    context.beginPath();
    context.arc(center.sx, center.sy - poleHeight, 2, 0, Math.PI * 2);
    context.fill();
  } else if (roofStyle === 'peaked') {
    // Peaked roof
    const peakHeight = layout.tileHeight * 0.35;
    const peak = { sx: center.sx, sy: center.sy - peakHeight };
    context.beginPath();
    context.moveTo(top[0].sx, top[0].sy);
    context.lineTo(peak.sx, peak.sy);
    context.lineTo(top[2].sx, top[2].sy);
    context.closePath();
    context.fillStyle = withAlpha(style.left, 0.8);
    context.fill();
    context.stroke();
  } else if (roofStyle === 'dome') {
    // Dome
    const domeRadius = layout.tileWidth * 0.25;
    context.beginPath();
    context.ellipse(center.sx, center.sy, domeRadius, domeRadius * 0.5, 0, Math.PI, 0);
    context.fillStyle = withAlpha(style.top, 0.9);
    context.fill();
    context.stroke();
  } else if (roofStyle === 'antenna') {
    // Tall antenna array
    const antennaHeight = layout.tileHeight * 0.6;
    context.beginPath();
    context.moveTo(center.sx, center.sy);
    context.lineTo(center.sx, center.sy - antennaHeight);
    context.stroke();
    // Cross bars
    const barY = center.sy - antennaHeight * 0.7;
    context.beginPath();
    context.moveTo(center.sx - 4, barY);
    context.lineTo(center.sx + 4, barY);
    context.stroke();
    // Top beacon
    context.fillStyle = '#56d9ff';
    context.shadowBlur = 10;
    context.shadowColor = 'rgba(86, 217, 255, 0.8)';
    context.beginPath();
    context.arc(center.sx, center.sy - antennaHeight, 2.5, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

// ═════════════════════════════════════════════════════════════════════════════
// FIBONACCI PHYSICS DRAWING — Building with universe dynamics
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Draw a building with full Fibonacci Universe physics:
 * - Fibonacci mass tiers (height)
 * - 24-unit chirality (left/right tilt)
 * - 3-4-5 triangular foundation
 * - 9-level construction phasing (opacity)
 * - 60-digit Pisano window lighting
 * - File heat flickering
 */
export function drawBuilding(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  layout: IsoLayout,
  phase: number,
  nodeState: string,
): void {
  const style = getBuildingStyle(entity);
  const statePalette = getNodeStatePalette(nodeState);
  
  // ── Fibonacci physics calculations ──
  const lines = getEntityLines(entity);
  const fibMass = getEntityFibonacciMass(entity);
  const fibTier = getFibonacciTier(lines);
  const chirality = getChirality(lines);
  const chiralityTilt = getChiralityTilt(lines);
  const imbalance = getImbalanceRatio(lines);
  const isCritical = isCriticalFibonacciMass(lines);
  
  // Construction phasing: files don't pop — they phase in
  const constructionOpacity = getConstructionPhase(entity, phase);
  const fileHeat = getFileHeat(entity, phase);
  
  // 10-sum brightness: files with complementary mass pulse
  const tenSumBrightness = 0.5 + (getPisanoWave(phase + fibMass) * 0.5);
  
  // Pisano wave for window lighting (60-step rhythm, not binary)
  const pisanoLight = getPisanoWave(phase + fibTier);
  const syncState = getSyncState(phase + fibTier);
  
  // Fibonacci-based footprint and height
  const footprint = getFibonacciFootprint(entity);
  const height = getFibonacciBuildingHeight(entity);

  // Apply chirality tilt to footprint
  const tiltedWidth = footprint.width * (1 + chiralityTilt * 0.1);
  const tiltedDepth = footprint.depth * (1 - chiralityTilt * 0.05);

  // Use state palette if it's a warning state
  const isWarning = statePalette.warning || nodeState === 'in-progress' || nodeState === 'task';
  const palette = isWarning
    ? { ...style, accent: statePalette.accent, glow: statePalette.glow, left: statePalette.left, right: statePalette.right, top: statePalette.top }
    : style;

  const pulsing = nodeState === 'in-progress' || nodeState === 'asymmetry';
  const highlighted = pulsing || nodeState === 'task' || nodeState === 'verified';

  // ── 3-4-5 Triangular Foundation ──
  // Every file sits on a quantum pixel base
  const foundation = get3_4_5Foundation(tiltedWidth, tiltedDepth);
  const f0 = foundation[0]!;
  const f1 = foundation[1]!;
  const f2 = foundation[2]!;
  const groundCenter = toScreen(displayX + 0.5, displayY + 0.5, 0, layout);
  
  context.save();
  context.globalAlpha = constructionOpacity;
  
  // Draw triangular foundation
  context.beginPath();
  context.moveTo(groundCenter.sx + f0.x * layout.tileWidth, groundCenter.sy + f0.y * layout.tileHeight);
  context.lineTo(groundCenter.sx + f1.x * layout.tileWidth, groundCenter.sy + f1.y * layout.tileHeight);
  context.lineTo(groundCenter.sx + f2.x * layout.tileWidth, groundCenter.sy + f2.y * layout.tileHeight);
  context.closePath();
  context.fillStyle = getFoundationColor(nodeState);
  context.fill();
  context.strokeStyle = withAlpha(palette.accent, 0.3 + imbalance * 0.3);
  context.lineWidth = 0.8;
  context.stroke();

  // ── Main Building Prism ──
  const projection = createPrismProjection(
    displayX + ((1 - tiltedWidth) / 2),
    displayY + ((1 - tiltedDepth) / 2),
    0,
    tiltedWidth,
    tiltedDepth,
    height,
    layout,
  );

  context.lineWidth = entity.type === 'directory' ? 1.6 : 1.2;

  // Chirality affects glow: imbalanced files flicker more
  const imbalanceGlow = imbalance * 8;
  if (highlighted || imbalance > 0.5) {
    context.shadowBlur = pulsing ? 16 + ((phase % 12) * 0.8) : 14 + imbalanceGlow;
    context.shadowColor = palette.glow;
  }

  // Draw faces with 10-sum brightness modulation
  const brightness = tenSumBrightness * (0.7 + fileHeat * 0.3);
  fillFace(context, projection.left, withAlpha(palette.left, brightness), withAlpha(palette.trim, 0.18));
  fillFace(context, projection.right, withAlpha(palette.right, brightness), withAlpha(palette.trim, 0.22));
  fillFace(context, projection.top, withAlpha(palette.top, brightness), palette.accent);

  // Draw trim line on top edges
  context.strokeStyle = withAlpha(palette.trim, 0.4 + (imbalance * 0.3));
  context.lineWidth = 0.8;
  context.beginPath();
  context.moveTo(projection.top[0].sx, projection.top[0].sy);
  context.lineTo(projection.top[1].sx, projection.top[1].sy);
  context.lineTo(projection.top[2].sx, projection.top[2].sy);
  context.lineTo(projection.top[3].sx, projection.top[3].sy);
  context.closePath();
  context.stroke();

  // ── Windows with Pisano 60-digit wave lighting ──
  if (height >= 1.2) {
    const windowRows = Math.max(1, Math.floor(height * 1.5));
    const windowCols = Math.max(1, Math.min(3, fibTier));
    
    // Left face windows — Pisano-driven, not linear
    for (let row = 0; row < windowRows; row++) {
      for (let col = 0; col < windowCols; col++) {
        const windowIndex = row * windowCols + col;
        const pisanoOffset = (windowIndex * 7) % 60; // Prime step for variety
        const lightValue = getPisanoWave(phase + pisanoOffset);
        
        // Sync state affects window behavior:
        // stable = smooth pulse, unstable = flickering
        const flicker = syncState === 'unstable' ? (Math.random() - 0.5) * 0.3 : 0;
        const lit = lightValue > 0.5 + flicker || entity.node_state === 'in-progress';
        
        // Window dims when file is cold
        const windowOpacity = 0.3 + (fileHeat * 0.7) + (lightValue * 0.3);

        // Interpolate position on left face
        const topY = projection.left[1].sy + (projection.left[0].sy - projection.left[1].sy) * ((row + 0.3) / (windowRows + 0.5));
        const bottomY = projection.left[1].sy + (projection.left[0].sy - projection.left[1].sy) * ((row + 0.7) / (windowRows + 0.5));
        const leftX = projection.left[1].sx + (projection.left[0].sx - projection.left[1].sx) * ((col + 0.25) / windowCols);
        const rightX = projection.left[1].sx + (projection.left[0].sx - projection.left[1].sx) * ((col + 0.75) / windowCols);

        const ww = Math.max(2, (rightX - leftX) * 0.6);
        const wh = Math.max(2, (bottomY - topY) * 0.5);
        const wx = leftX + (rightX - leftX) * 0.2;
        const wy = topY + (bottomY - topY) * 0.25;

        drawWindow(context, wx, wy, ww, wh, 
          withAlpha(style.windowColor, windowOpacity), 
          style.windowGlow, 
          lit
        );
      }
    }

    // Right face windows — offset phase for asymmetry
    for (let row = 0; row < windowRows; row++) {
      for (let col = 0; col < windowCols; col++) {
        const windowIndex = row * windowCols + col + 50; // Offset for right face
        const pisanoOffset = (windowIndex * 7) % 60;
        const lightValue = getPisanoWave(phase + pisanoOffset + 30); // 30-step offset
        
        const flicker = syncState === 'unstable' ? (Math.random() - 0.5) * 0.3 : 0;
        const lit = lightValue > 0.5 + flicker || entity.node_state === 'in-progress';
        const windowOpacity = 0.3 + (fileHeat * 0.7) + (lightValue * 0.3);

        const topY = projection.right[1].sy + (projection.right[0].sy - projection.right[1].sy) * ((row + 0.3) / (windowRows + 0.5));
        const bottomY = projection.right[1].sy + (projection.right[0].sy - projection.right[1].sy) * ((row + 0.7) / (windowRows + 0.5));
        const leftX = projection.right[1].sx + (projection.right[0].sx - projection.right[1].sx) * ((col + 0.25) / windowCols);
        const rightX = projection.right[1].sx + (projection.right[0].sx - projection.right[1].sx) * ((col + 0.75) / windowCols);

        const ww = Math.max(2, (rightX - leftX) * 0.6);
        const wh = Math.max(2, (bottomY - topY) * 0.5);
        const wx = leftX + (rightX - leftX) * 0.2;
        const wy = topY + (bottomY - topY) * 0.25;

        drawWindow(context, wx, wy, ww, wh,
          withAlpha(style.windowColor, windowOpacity),
          style.windowGlow,
          lit
        );
      }
    }
  }

  // Draw roof
  drawRoof(context, projection, style, layout);

  // ── Directory label on ground ──
  if (entity.type === 'directory' && entity.name) {
    context.save();
    context.fillStyle = withAlpha(palette.accent, 0.8);
    context.font = `600 ${Math.max(8, layout.tileWidth * 0.12)}px "IBM Plex Mono", monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowBlur = 8;
    context.shadowColor = palette.glow;
    context.fillText(entity.name.slice(0, 12), groundCenter.sx, groundCenter.sy + layout.tileHeight * 0.8);
    context.restore();
  }

  // ── Fibonacci Critical Mass Gravity Well ──
  if (isCritical) {
    const pulse = 0.5 + (getPisanoWave(phase * 2) * 0.5); // Double-speed pulse
    context.save();
    context.beginPath();
    context.ellipse(
      projection.center.sx,
      projection.center.sy,
      layout.tileWidth * (0.35 + fibTier * 0.02),
      layout.tileHeight * (0.3 + fibTier * 0.015),
      0,
      0,
      Math.PI * 2,
    );
    context.strokeStyle = `rgba(236, 72, 153, ${pulse})`;
    context.lineWidth = 1.6 + (fibTier * 0.15);
    context.shadowBlur = 16 + fibTier * 2;
    context.shadowColor = 'rgba(236, 72, 153, 0.62)';
    context.stroke();
    
    // Gravity well indicator: concentric rings for massive files
    if (fibTier >= 7) {
      context.beginPath();
      context.ellipse(
        projection.center.sx,
        projection.center.sy,
        layout.tileWidth * (0.45 + fibTier * 0.03),
        layout.tileHeight * (0.38 + fibTier * 0.02),
        0,
        0,
        Math.PI * 2,
      );
      context.strokeStyle = `rgba(236, 72, 153, ${pulse * 0.5})`;
      context.lineWidth = 0.8;
      context.stroke();
    }
    context.restore();
  }

  // ── Chirality indicator ──
  if (chirality !== 'neutral') {
    context.save();
    const tiltIndicator = chirality === 'left' ? '◀' : '▶';
    context.fillStyle = withAlpha(palette.accent, 0.5 + imbalance * 0.5);
    context.font = `${Math.max(8, layout.tileWidth * 0.1)}px "IBM Plex Mono", monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(
      tiltIndicator,
      projection.center.sx + (chirality === 'left' ? -layout.tileWidth * 0.25 : layout.tileWidth * 0.25),
      projection.center.sy - layout.tileHeight * 0.3,
    );
    context.restore();
  }

  // ── Scaffolding for in-progress (with Fibonacci phase) ──
  if (nodeState === 'in-progress') {
    context.save();
    context.strokeStyle = 'rgba(251, 146, 60, 0.4)';
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    const padding = layout.tileWidth * 0.1;
    const scaffoldPhase = getPisanoWave(phase * 3); // Rapid pulse for construction
    context.globalAlpha = 0.3 + scaffoldPhase * 0.7;
    context.strokeRect(
      projection.center.sx - layout.tileWidth * 0.35 - padding,
      projection.center.sy - layout.tileHeight * height * 0.3 - padding,
      (layout.tileWidth * 0.35 + padding) * 2,
      layout.tileHeight * height * 0.6 + padding * 2,
    );
    context.restore();
  }

  // ── File heat flicker ──
  if (fileHeat > 0.3) {
    context.save();
    context.globalAlpha = fileHeat * 0.15;
    context.fillStyle = palette.accent;
    context.fillRect(
      projection.center.sx - layout.tileWidth * 0.4,
      projection.center.sy - layout.tileHeight * height * 0.4,
      layout.tileWidth * 0.8,
      layout.tileHeight * height * 0.8,
    );
    context.restore();
  }

  context.restore(); // Restore globalAlpha from construction phasing
}

// Draw a drone/agent with distinct shapes
export function drawDrone(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  layout: IsoLayout,
  phase: number,
  tick: number,
): void {
  const style = getDroneStyle(entity);
  const center = toScreen(displayX + 0.5, displayY + 0.5, 0.85, layout);
  const radius = layout.tileHeight * 0.55;
  const pulse = 0.72 + ((phase % 10) * 0.04);

  const idleTicks = tick - entity.tick_updated;
  const hasObjective = entity.objective_path != null;
  let opacity = pulse;
  // In preview mode (tick 0), keep agents fully visible
  if (tick > 0 && !hasObjective && idleTicks > 30) {
    opacity = pulse * Math.max(0.3, 1 - (idleTicks - 30) / 90);
  }

  if (opacity <= 0.01) {
    return;
  }

  context.save();

  // Drone body based on shape
  if (style.shape === 'scout' || style.shape === 'command') {
    // Diamond shape - fast, angular
    context.beginPath();
    context.moveTo(center.sx, center.sy - radius);
    context.lineTo(center.sx + (radius * 0.95), center.sy);
    context.lineTo(center.sx, center.sy + radius);
    context.lineTo(center.sx - (radius * 0.95), center.sy);
    context.closePath();
  } else if (style.shape === 'miner') {
    // Circle with cross - industrial
    context.beginPath();
    context.arc(center.sx, center.sy, radius * 0.85, 0, Math.PI * 2);
  } else if (style.shape === 'hauler') {
    // Square - sturdy
    const r = radius * 0.75;
    context.beginPath();
    context.rect(center.sx - r, center.sy - r, r * 2, r * 2);
  } else {
    // Default builder - rounded diamond
    context.beginPath();
    context.moveTo(center.sx, center.sy - radius);
    context.lineTo(center.sx + (radius * 0.9), center.sy - radius * 0.2);
    context.lineTo(center.sx + (radius * 0.8), center.sy + radius * 0.6);
    context.lineTo(center.sx, center.sy + radius * 0.9);
    context.lineTo(center.sx - (radius * 0.8), center.sy + radius * 0.6);
    context.lineTo(center.sx - (radius * 0.9), center.sy - radius * 0.2);
    context.closePath();
  }

  context.fillStyle = withAlpha(style.fill, opacity);
  context.shadowBlur = 24;
  context.shadowColor = style.glow;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = withAlpha(style.stroke, opacity);
  context.stroke();

  // Core glow
  context.beginPath();
  context.arc(center.sx, center.sy, radius * 0.25, 0, Math.PI * 2);
  context.fillStyle = withAlpha(style.core, opacity * 0.9);
  context.shadowBlur = 12;
  context.shadowColor = style.glow;
  context.fill();

  // Propulsion trail when moving
  if (hasObjective) {
    const trailLength = radius * 1.5;
    context.beginPath();
    context.moveTo(center.sx, center.sy + radius * 0.5);
    context.lineTo(center.sx - 3, center.sy + trailLength);
    context.lineTo(center.sx + 3, center.sy + trailLength);
    context.closePath();
    context.fillStyle = withAlpha(style.fill, opacity * 0.3);
    context.fill();
  }

  context.restore();
}

// Draw ground-level goal marker
export function drawGoal(
  context: CanvasRenderingContext2D,
  entity: Entity,
  layout: IsoLayout,
  phase: number,
): void {
  const center = toScreen(entity.x + 0.5, entity.y + 0.5, 0.15, layout);
  const pulse = 0.7 + ((phase % 15) * 0.04);
  const radius = layout.tileHeight * 0.65;

  context.save();

  // Outer glow ring
  context.beginPath();
  context.arc(center.sx, center.sy, radius * 1.3, 0, Math.PI * 2);
  context.strokeStyle = `rgba(255, 166, 0, ${pulse * 0.3})`;
  context.lineWidth = 2;
  context.shadowBlur = 20;
  context.shadowColor = 'rgba(255, 166, 0, 0.4)';
  context.stroke();

  // Main ring
  context.beginPath();
  context.arc(center.sx, center.sy, radius, 0, Math.PI * 2);
  context.strokeStyle = `rgba(255, 166, 0, ${pulse * 0.8})`;
  context.lineWidth = 2.5;
  context.shadowBlur = 24;
  context.shadowColor = 'rgba(255, 166, 0, 0.6)';
  context.stroke();

  // Inner dot
  context.beginPath();
  context.arc(center.sx, center.sy, radius * 0.3, 0, Math.PI * 2);
  context.fillStyle = `rgba(255, 200, 50, ${pulse})`;
  context.fill();

  context.restore();
}

// Draw pheromone signal as a ripple
export function drawPheromone(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  layout: IsoLayout,
  phase: number,
): void {
  const ttl = entity.ttl_ticks ?? 0;
  const maxTtl = 30;
  const life = ttl / maxTtl;
  if (life <= 0) {
    return;
  }

  const center = toScreen(displayX + 0.5, displayY + 0.5, 0.1, layout);
  const baseRadius = layout.tileHeight * 0.9;
  const pulse = 1 + ((phase % 8) * 0.03);
  const radius = baseRadius * pulse;
  const alpha = life * 0.35;

  context.save();

  // Outer ripple
  context.strokeStyle = `rgba(167, 139, 250, ${alpha})`;
  context.lineWidth = 1.5;
  context.shadowBlur = 10 * life;
  context.shadowColor = `rgba(167, 139, 250, ${alpha * 0.6})`;
  context.beginPath();
  context.arc(center.sx, center.sy, radius, 0, Math.PI * 2);
  context.stroke();

  // Inner ripple
  context.strokeStyle = `rgba(167, 139, 250, ${alpha * 0.5})`;
  context.lineWidth = 1;
  context.beginPath();
  context.arc(center.sx, center.sy, radius * 0.6, 0, Math.PI * 2);
  context.stroke();

  // Center dot
  context.fillStyle = `rgba(167, 139, 250, ${alpha * 0.8})`;
  context.beginPath();
  context.arc(center.sx, center.sy, 3 * life, 0, Math.PI * 2);
  context.fill();

  // Label
  if (entity.message && life > 0.5) {
    context.fillStyle = `rgba(200, 190, 255, ${alpha * 0.9})`;
    context.font = `500 ${Math.max(8, layout.tileWidth * 0.1)}px "IBM Plex Mono", monospace`;
    context.textAlign = 'center';
    context.fillText(entity.message.slice(0, 20), center.sx, center.sy - radius - 6);
  }

  context.restore();
}

// Draw command center (where prompts land)
export function drawCommandCenter(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  layout: IsoLayout,
  phase: number,
): void {
  const center = toScreen(displayX + 0.5, displayY + 0.5, 0.3, layout);
  const pulse = 0.75 + ((phase % 12) * 0.04);
  const radius = layout.tileHeight * 1.2;

  context.save();

  // Base platform
  context.beginPath();
  context.ellipse(center.sx, center.sy, radius, radius * 0.5, 0, 0, Math.PI * 2);
  context.fillStyle = `rgba(236, 72, 153, ${0.15 * pulse})`;
  context.fill();
  context.strokeStyle = `rgba(236, 72, 153, ${0.5 * pulse})`;
  context.lineWidth = 2;
  context.shadowBlur = 20;
  context.shadowColor = 'rgba(236, 72, 153, 0.5)';
  context.stroke();

  // Concentric rings
  for (let i = 1; i <= 3; i++) {
    const ringRadius = radius * (0.3 + i * 0.25);
    context.beginPath();
    context.ellipse(center.sx, center.sy, ringRadius, ringRadius * 0.5, 0, 0, Math.PI * 2);
    context.strokeStyle = `rgba(236, 72, 153, ${0.2 * pulse * (1 - i * 0.2)})`;
    context.lineWidth = 1;
    context.stroke();
  }

  // Beacon tower
  const towerHeight = layout.tileHeight * 1.5;
  context.beginPath();
  context.moveTo(center.sx, center.sy);
  context.lineTo(center.sx, center.sy - towerHeight);
  context.strokeStyle = `rgba(255, 176, 220, ${0.7 * pulse})`;
  context.lineWidth = 2;
  context.stroke();

  // Beacon light
  context.beginPath();
  context.arc(center.sx, center.sy - towerHeight, 5 * pulse, 0, Math.PI * 2);
  context.fillStyle = `rgba(255, 255, 255, ${0.9 * pulse})`;
  context.shadowBlur = 30;
  context.shadowColor = 'rgba(236, 72, 153, 0.9)';
  context.fill();

  // Signal waves emanating upward
  for (let i = 0; i < 3; i++) {
    const waveY = center.sy - towerHeight - 8 - (i * 12) - ((phase % 20) * 0.8);
    if (waveY < center.sy - towerHeight) {
      const waveAlpha = Math.max(0, 1 - (center.sy - towerHeight - waveY) / 50) * 0.4 * pulse;
      context.beginPath();
      context.ellipse(center.sx, waveY, 8 + i * 4, 3, 0, 0, Math.PI * 2);
      context.strokeStyle = `rgba(255, 176, 220, ${waveAlpha})`;
      context.lineWidth = 1.5;
      context.stroke();
    }
  }

  // Prompt text
  if (entity.message) {
    context.fillStyle = `rgba(255, 200, 230, ${0.85 * pulse})`;
    context.font = `600 ${Math.max(9, layout.tileWidth * 0.13)}px "IBM Plex Mono", monospace`;
    context.textAlign = 'center';
    context.fillText(entity.message.slice(0, 30), center.sx, center.sy + radius * 0.7);
  }

  context.restore();
}

// Draw hover highlight around a building
export function drawHoverHighlight(
  context: CanvasRenderingContext2D,
  entity: Entity,
  layout: IsoLayout,
  displayX: number,
  displayY: number,
): void {
  const center = toScreen(displayX + 0.5, displayY + 0.5, 0.5, layout);
  const radius = layout.tileHeight * 1.2;

  context.save();
  context.strokeStyle = 'rgba(86, 217, 255, 0.55)';
  context.lineWidth = 1.5;
  context.shadowBlur = 16;
  context.shadowColor = 'rgba(86, 217, 255, 0.35)';
  context.setLineDash([4, 4]);
  context.beginPath();
  context.arc(center.sx, center.sy, radius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

// Draw selection ring with pulsing effect
export function drawSelectionRing(
  context: CanvasRenderingContext2D,
  entity: Entity,
  layout: IsoLayout,
  displayX: number,
  displayY: number,
  phase: number,
): void {
  const center = toScreen(displayX + 0.5, displayY + 0.5, 0.5, layout);
  const radius = layout.tileHeight * 1.35;
  const pulse = 0.7 + ((phase % 12) * 0.04);

  context.save();
  context.strokeStyle = `rgba(86, 217, 255, ${pulse})`;
  context.lineWidth = 2.2;
  context.shadowBlur = 22;
  context.shadowColor = 'rgba(86, 217, 255, 0.55)';
  context.beginPath();
  context.arc(center.sx, center.sy, radius, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = `rgba(86, 217, 255, ${pulse * 0.15})`;
  context.beginPath();
  context.arc(center.sx, center.sy, radius * 0.85, 0, Math.PI * 2);
  context.fill();

  // Selection brackets
  const bracketSize = radius * 0.2;
  context.strokeStyle = `rgba(86, 217, 255, ${pulse * 0.8})`;
  context.lineWidth = 2;
  // Top-left bracket
  context.beginPath();
  context.moveTo(center.sx - radius, center.sy - radius + bracketSize);
  context.lineTo(center.sx - radius, center.sy - radius);
  context.lineTo(center.sx - radius + bracketSize, center.sy - radius);
  context.stroke();
  // Top-right bracket
  context.beginPath();
  context.moveTo(center.sx + radius - bracketSize, center.sy - radius);
  context.lineTo(center.sx + radius, center.sy - radius);
  context.lineTo(center.sx + radius, center.sy - radius + bracketSize);
  context.stroke();
  // Bottom-left bracket
  context.beginPath();
  context.moveTo(center.sx - radius, center.sy + radius - bracketSize);
  context.lineTo(center.sx - radius, center.sy + radius);
  context.lineTo(center.sx - radius + bracketSize, center.sy + radius);
  context.stroke();
  // Bottom-right bracket
  context.beginPath();
  context.moveTo(center.sx + radius - bracketSize, center.sy + radius);
  context.lineTo(center.sx + radius, center.sy + radius);
  context.lineTo(center.sx + radius, center.sy + radius - bracketSize);
  context.stroke();

  context.restore();
}
