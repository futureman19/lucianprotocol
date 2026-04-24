import type { Entity } from '../src/types';
import type { IsoLayout, ScreenPoint } from './iso';
import { toScreen, createPrismProjection, traceFace } from './iso';
import { getBuildingStyle, getDroneStyle, getNodeStatePalette, getFileFootprint, getBuildingHeight } from './building-styles';
import { ParticleSystem } from './particles';

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

// Draw a building (file or directory)
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
  const footprint = getFileFootprint(entity);
  const height = getBuildingHeight(entity);

  // Use state palette if it's a warning state, otherwise use building style
  const isWarning = statePalette.warning || nodeState === 'in-progress' || nodeState === 'task';
  const palette = isWarning
    ? { ...style, accent: statePalette.accent, glow: statePalette.glow, left: statePalette.left, right: statePalette.right, top: statePalette.top }
    : style;

  const pulsing = nodeState === 'in-progress' || nodeState === 'asymmetry';
  const highlighted = pulsing || nodeState === 'task' || nodeState === 'verified';

  const projection = createPrismProjection(
    displayX + ((1 - footprint.width) / 2),
    displayY + ((1 - footprint.depth) / 2),
    0,
    footprint.width,
    footprint.depth,
    height,
    layout,
  );

  context.save();
  context.lineWidth = entity.type === 'directory' ? 1.6 : 1.2;

  if (highlighted) {
    context.shadowBlur = pulsing ? 16 + ((phase % 12) * 0.8) : 14;
    context.shadowColor = palette.glow;
  }

  // Draw faces with slight gradient effect
  fillFace(context, projection.left, palette.left, withAlpha(palette.trim, 0.18));
  fillFace(context, projection.right, palette.right, withAlpha(palette.trim, 0.22));
  fillFace(context, projection.top, palette.top, palette.accent);

  // Draw trim line on top edges
  context.strokeStyle = withAlpha(palette.trim, 0.4);
  context.lineWidth = 0.8;
  context.beginPath();
  context.moveTo(projection.top[0].sx, projection.top[0].sy);
  context.lineTo(projection.top[1].sx, projection.top[1].sy);
  context.lineTo(projection.top[2].sx, projection.top[2].sy);
  context.lineTo(projection.top[3].sx, projection.top[3].sy);
  context.closePath();
  context.stroke();

  // Draw windows
  drawBuildingWindows(context, projection, style, height, phase, entity);

  // Draw roof
  drawRoof(context, projection, style, layout);

  // Draw directory label on ground
  if (entity.type === 'directory' && entity.name) {
    const groundCenter = toScreen(displayX + 0.5, displayY + 0.5, 0, layout);
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

  // Critical mass warning
  const mass = entity.mass ?? 1;
  const lineCount = (entity.content ?? entity.content_preview ?? '').split('\n').length;
  const chiralMass = mass + Math.floor(Math.max(0, lineCount - 1) / 120);
  if (chiralMass >= 8) {
    const pulse = 0.7 + ((phase % 10) * 0.05);
    context.save();
    context.beginPath();
    context.ellipse(
      projection.center.sx,
      projection.center.sy,
      layout.tileWidth * 0.32,
      layout.tileHeight * 0.26,
      0,
      0,
      Math.PI * 2,
    );
    context.strokeStyle = `rgba(236, 72, 153, ${pulse})`;
    context.lineWidth = 1.6;
    context.shadowBlur = 16;
    context.shadowColor = 'rgba(236, 72, 153, 0.62)';
    context.stroke();
    context.restore();
  }

  // Scaffolding for in-progress
  if (nodeState === 'in-progress') {
    context.save();
    context.strokeStyle = 'rgba(251, 146, 60, 0.4)';
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    const padding = layout.tileWidth * 0.1;
    context.strokeRect(
      projection.center.sx - layout.tileWidth * 0.35 - padding,
      projection.center.sy - layout.tileHeight * height * 0.3 - padding,
      (layout.tileWidth * 0.35 + padding) * 2,
      layout.tileHeight * height * 0.6 + padding * 2,
    );
    context.restore();
  }

  context.restore();
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
