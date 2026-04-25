import { inferFileRole, type FileRole } from '../src/graph-layout';
import type { Entity } from '../src/types';
import { toScreen, type IsoLayout } from './iso';

export interface District {
  role: FileRole;
  label: string;
  color: string;
  centroid: { x: number; y: number };
  count: number;
}

const ROLE_LABELS: Record<FileRole, string> = {
  entry: 'ENTRY',
  infra: 'INFRA',
  logic: 'LOGIC',
  presentation: 'UI',
  data: 'DATA',
  test: 'TESTS',
  asset: 'ASSETS',
  unknown: 'CODE',
};

const ROLE_COLORS: Record<FileRole, string> = {
  entry: '#fbbf24',
  infra: '#60a5fa',
  logic: '#f97316',
  presentation: '#2dd4bf',
  data: '#a3e635',
  test: '#c084fc',
  asset: '#94a3b8',
  unknown: '#e2e8f0',
};

function roleFromEntity(entity: Entity): FileRole {
  if (entity.type === 'directory') {
    // Directories inherit role from their dominant file children if possible,
    // but for layout we just treat root specially
    if (entity.path === '.' || entity.path === '') return 'infra';
  }
  return inferFileRole({
    path: entity.path ?? '',
    name: entity.name ?? '',
    extension: entity.extension ?? null,
  });
}

export function computeDistricts(entities: Entity[]): District[] {
  const groups = new Map<FileRole, { x: number; y: number; count: number }[]>();

  for (const entity of entities) {
    if (entity.type !== 'file' && entity.type !== 'directory') continue;
    if (!entity.path) continue;

    const role = roleFromEntity(entity);
    const list = groups.get(role) ?? [];
    list.push({ x: entity.x, y: entity.y, count: 1 });
    groups.set(role, list);
  }

  const districts: District[] = [];

  for (const [role, points] of groups) {
    if (points.length < 2) continue;

    let sumX = 0;
    let sumY = 0;
    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
    }

    districts.push({
      role,
      label: ROLE_LABELS[role],
      color: ROLE_COLORS[role],
      centroid: {
        x: sumX / points.length,
        y: sumY / points.length,
      },
      count: points.length,
    });
  }

  // Sort by count descending so larger districts are drawn first
  return districts.sort((a, b) => b.count - a.count);
}

// ─── Road Rendering ───

export function drawAdaptiveRoads(
  context: CanvasRenderingContext2D,
  layout: IsoLayout,
  entities: Entity[],
): void {
  const districts = computeDistricts(entities);
  if (districts.length === 0) return;

  const centerIso = toScreen(24.5, 24.5, 0, layout);

  // Central plaza glow
  context.save();
  context.fillStyle = 'rgba(86, 217, 255, 0.04)';
  context.beginPath();
  const plazaRadius = layout.tileHeight * 5;
  context.ellipse(centerIso.sx, centerIso.sy, plazaRadius, plazaRadius * 0.6, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  // Draw spoke roads from center to each district centroid
  for (const district of districts) {
    const targetIso = toScreen(district.centroid.x, district.centroid.y, 0, layout);

    // Road surface (wide translucent strip)
    context.save();
    context.strokeStyle = district.color.replace(')', ', 0.08)').replace('rgb', 'rgba').replace('#', '');
    // Fallback for hex colors
    const roadColor = withAlpha(district.color, 0.08);
    context.strokeStyle = roadColor;
    context.lineWidth = layout.tileHeight * 1.2;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(centerIso.sx, centerIso.sy);
    context.lineTo(targetIso.sx, targetIso.sy);
    context.stroke();
    context.restore();

    // Road edge glow
    context.save();
    context.strokeStyle = withAlpha(district.color, 0.18);
    context.lineWidth = 2;
    context.shadowBlur = 12;
    context.shadowColor = withAlpha(district.color, 0.15);
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(centerIso.sx, centerIso.sy);
    context.lineTo(targetIso.sx, targetIso.sy);
    context.stroke();
    context.restore();
  }

  // Draw ring road connecting district centroids (if 3+ districts)
  if (districts.length >= 3) {
    context.save();
    context.strokeStyle = 'rgba(255, 191, 105, 0.12)';
    context.lineWidth = 3;
    context.shadowBlur = 8;
    context.shadowColor = 'rgba(255, 191, 105, 0.08)';
    context.lineJoin = 'round';
    context.beginPath();

    for (let i = 0; i < districts.length; i++) {
      const a = districts[i]!;
      const b = districts[(i + 1) % districts.length]!;
      const aIso = toScreen(a.centroid.x, a.centroid.y, 0, layout);
      const bIso = toScreen(b.centroid.x, b.centroid.y, 0, layout);

      if (i === 0) {
        context.moveTo(aIso.sx, aIso.sy);
      }
      // Quadratic curve for organic road feel
      const midX = (aIso.sx + bIso.sx) / 2 + (Math.random() - 0.5) * 10;
      const midY = (aIso.sy + bIso.sy) / 2 + (Math.random() - 0.5) * 10;
      context.quadraticCurveTo(midX, midY, bIso.sx, bIso.sy);
    }

    context.closePath();
    context.stroke();
    context.restore();
  }
}

export function drawDistrictLabels(
  context: CanvasRenderingContext2D,
  layout: IsoLayout,
  entities: Entity[],
): void {
  const districts = computeDistricts(entities);

  for (const district of districts) {
    if (district.count < 3) continue;

    const pos = toScreen(district.centroid.x, district.centroid.y, 0, layout);
    const fontSize = Math.max(10, Math.round(layout.tileHeight * 0.65));

    context.save();
    context.fillStyle = district.color;
    context.font = `bold ${fontSize}px var(--mono), monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowBlur = 14;
    context.shadowColor = district.color;
    context.globalAlpha = 0.35;
    context.fillText(district.label, pos.sx, pos.sy - fontSize * 0.6);
    context.restore();
  }
}

function withAlpha(hexColor: string, alpha: number): string {
  const normalized = hexColor.replace('#', '');
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
