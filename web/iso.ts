export interface IsoLayout {
  halfHeight: number;
  halfWidth: number;
  originX: number;
  originY: number;
  tileHeight: number;
  tileWidth: number;
  tileZ: number;
}

export interface ScreenPoint {
  sx: number;
  sy: number;
}

export interface CubeProjection {
  center: ScreenPoint;
  left: ScreenPoint[];
  right: ScreenPoint[];
  top: ScreenPoint[];
}

export function createIsoLayout(viewportWidth: number, viewportHeight: number): IsoLayout {
  const tileWidth = Math.max(16, Math.min(viewportWidth / 30, viewportHeight / 15));
  const tileHeight = Math.max(8, tileWidth * 0.5);

  return {
    halfHeight: tileHeight / 2,
    halfWidth: tileWidth / 2,
    originX: viewportWidth / 2,
    originY: Math.max(100, tileHeight * 2.6),
    tileHeight,
    tileWidth,
    tileZ: tileHeight * 0.9,
  };
}

export function toScreen(
  x: number,
  y: number,
  z: number,
  layout: IsoLayout,
): ScreenPoint {
  return {
    sx: layout.originX + ((x - y) * layout.halfWidth),
    sy: layout.originY + ((x + y) * layout.halfHeight) - (z * layout.tileZ),
  };
}

export function fromScreen(
  sx: number,
  sy: number,
  layout: IsoLayout,
): { x: number; y: number } {
  const dx = (sx - layout.originX) / layout.halfWidth;
  const dy = (sy - layout.originY) / layout.halfHeight;
  return {
    x: (dx + dy) / 2,
    y: (dy - dx) / 2,
  };
}

export function createCubeProjection(
  x: number,
  y: number,
  z: number,
  height: number,
  layout: IsoLayout,
): CubeProjection {
  return createPrismProjection(x, y, z, 1, 1, height, layout);
}

export function createPrismProjection(
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  layout: IsoLayout,
): CubeProjection {
  const topNorthWest = toScreen(x, y, z + height, layout);
  const topNorthEast = toScreen(x + width, y, z + height, layout);
  const topSouthEast = toScreen(x + width, y + depth, z + height, layout);
  const topSouthWest = toScreen(x, y + depth, z + height, layout);

  const bottomNorthWest = toScreen(x, y, z, layout);
  const bottomNorthEast = toScreen(x + width, y, z, layout);
  const bottomSouthEast = toScreen(x + width, y + depth, z, layout);
  const bottomSouthWest = toScreen(x, y + depth, z, layout);

  return {
    center: toScreen(x + (width / 2), y + (depth / 2), z + height, layout),
    left: [topSouthWest, topNorthWest, bottomNorthWest, bottomSouthWest],
    right: [topNorthEast, topSouthEast, bottomSouthEast, bottomNorthEast],
    top: [topNorthWest, topNorthEast, topSouthEast, topSouthWest],
  };
}

export function traceFace(
  context: CanvasRenderingContext2D,
  points: ScreenPoint[],
): void {
  const firstPoint = points[0];
  if (!firstPoint) {
    return;
  }

  context.beginPath();
  context.moveTo(firstPoint.sx, firstPoint.sy);

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (!point) {
      continue;
    }

    context.lineTo(point.sx, point.sy);
  }

  context.closePath();
}
