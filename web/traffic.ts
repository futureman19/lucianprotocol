import { toScreen, type IsoLayout } from './iso';

export interface Car {
  x: number;
  y: number;
  roadIndex: number;
  progress: number; // 0-1 along the road
  speed: number;
  color: string;
  headlightColor: string;
  width: number;
  length: number;
  direction: number; // angle in radians
}

export interface TrafficSystem {
  cars: Car[];
  lastSpawnTick: number;
}

export function createTrafficSystem(): TrafficSystem {
  return { cars: [], lastSpawnTick: 0 };
}

const CAR_COLORS = [
  { body: '#e74c3c', headlight: '#ffeb3b' },
  { body: '#3498db', headlight: '#e0f7fa' },
  { body: '#f39c12', headlight: '#fff9c4' },
  { body: '#2ecc71', headlight: '#d4edda' },
  { body: '#9b59b6', headlight: '#f3e5f5' },
  { body: '#e67e22', headlight: '#ffe0b2' },
  { body: '#1abc9c', headlight: '#e0f2f1' },
  { body: '#ecf0f1', headlight: '#ffffff' },
];

export function spawnCars(
  traffic: TrafficSystem,
  roadCount: number,
  totalTrafficDensity: number,
  tick: number,
): void {
  // Target car count based on total traffic density
  const targetCars = Math.floor(totalTrafficDensity * 15);
  
  if (traffic.cars.length < targetCars && tick - traffic.lastSpawnTick > 5) {
    traffic.lastSpawnTick = tick;
    
    const colorSet = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]!;
    
    traffic.cars.push({
      x: 0,
      y: 0,
      roadIndex: Math.floor(Math.random() * Math.max(1, roadCount)),
      progress: Math.random() * 0.3, // Start near beginning
      speed: 0.003 + Math.random() * 0.008,
      color: colorSet.body,
      headlightColor: colorSet.headlight,
      width: 0.12,
      length: 0.18,
      direction: 0,
    });
  }

  // Remove cars that have reached the end
  traffic.cars = traffic.cars.filter(c => c.progress < 1);
}

export function updateCars(traffic: TrafficSystem, deltaTime: number): void {
  for (const car of traffic.cars) {
    car.progress += car.speed * deltaTime;
  }
}

export function drawRoadsAndTraffic(
  context: CanvasRenderingContext2D,
  roads: Array<{ fromX: number; fromY: number; toX: number; toY: number; width: number; name: string; trafficDensity: number }>,
  traffic: TrafficSystem,
  layout: IsoLayout,
  phase: number,
): void {
  // Draw road surfaces first
  for (const road of roads) {
    const from = toScreen(road.fromX, road.fromY, 0.02, layout);
    const to = toScreen(road.toX, road.toY, 0.02, layout);

    const dx = to.sx - from.sx;
    const dy = to.sy - from.sy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) continue;

    const nx = -dy / len;
    const ny = dx / len;
    const rw = road.width * layout.tileWidth * 0.5;

    // Road surface (dark asphalt)
    context.beginPath();
    context.moveTo(from.sx + nx * rw, from.sy + ny * rw);
    context.lineTo(to.sx + nx * rw, to.sy + ny * rw);
    context.lineTo(to.sx - nx * rw, to.sy - ny * rw);
    context.lineTo(from.sx - nx * rw, from.sy - ny * rw);
    context.closePath();
    
    context.fillStyle = 'rgba(45, 50, 60, 0.85)';
    context.fill();

    // Road border
    context.strokeStyle = 'rgba(80, 85, 100, 0.5)';
    context.lineWidth = 1;
    context.stroke();

    // Center line (dashed for two-way)
    if (road.width > 0.4) {
      context.beginPath();
      context.moveTo(from.sx, from.sy);
      context.lineTo(to.sx, to.sy);
      context.strokeStyle = 'rgba(180, 170, 140, 0.3)';
      context.lineWidth = 1;
      const dashSize = 6 + phase % 3;
      context.setLineDash([dashSize, dashSize * 2]);
      context.stroke();
      context.setLineDash([]);
    }

    // Road name (only for major roads)
    if (road.width > 0.5) {
      const midX = (from.sx + to.sx) / 2;
      const midY = (from.sy + to.sy) / 2;
      context.save();
      context.translate(midX, midY);
      context.rotate(Math.atan2(dy, dx));
      context.fillStyle = 'rgba(180, 170, 140, 0.25)';
      context.font = `500 ${Math.max(7, layout.tileWidth * 0.08)}px 'IBM Plex Mono', monospace`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(road.name, 0, 0);
      context.restore();
    }
  }

  // Draw cars on roads
  for (const car of traffic.cars) {
    const road = roads[car.roadIndex];
    if (!road) continue;

    const from = toScreen(road.fromX, road.fromY, 0.05, layout);
    const to = toScreen(road.toX, road.toY, 0.05, layout);

    const x = from.sx + (to.sx - from.sx) * car.progress;
    const y = from.sy + (to.sy - from.sy) * car.progress;

    const dx = to.sx - from.sx;
    const dy = to.sy - from.sy;
    const angle = Math.atan2(dy, dx);
    car.direction = angle;

    // Car offset from center (lanes)
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle);
    const laneOffset = road.width * layout.tileWidth * 0.15;
    const carScreenX = x + perpX * laneOffset;
    const carScreenY = y + perpY * laneOffset;

    const carW = car.width * layout.tileWidth;
    const carL = car.length * layout.tileWidth;

    context.save();
    context.translate(carScreenX, carScreenY);
    context.rotate(angle);

    // Car shadow
    context.fillStyle = 'rgba(0, 0, 0, 0.3)';
    context.fillRect(-carL/2 + 2, -carW/2 + 2, carL, carW);

    // Car body (isometric-ish rectangle)
    context.fillStyle = car.color;
    context.fillRect(-carL/2, -carW/2, carL, carW);

    // Car roof (lighter)
    context.fillStyle = lightenColor(car.color, 20);
    context.fillRect(-carL/4, -carW/3, carL/2, carW/1.5);

    // Headlights
    context.fillStyle = car.headlightColor;
    context.shadowBlur = 8;
    context.shadowColor = car.headlightColor;
    context.fillRect(carL/2 - 2, -carW/3, 3, carW/4);
    context.fillRect(carL/2 - 2, carW/3 - carW/4, 3, carW/4);
    context.shadowBlur = 0;

    // Taillights
    context.fillStyle = '#ff4444';
    context.fillRect(-carL/2, -carW/3, 2, carW/4);
    context.fillRect(-carL/2, carW/3 - carW/4, 2, carW/4);

    context.restore();
  }
}

function lightenColor(color: string, amount: number): string {
  // Simple hex lightener
  const num = parseInt(color.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0x00FF) + amount);
  const b = Math.min(255, (num & 0x00FF) + amount);
  return `rgb(${r},${g},${b})`;
}

export function drawDistricts(
  context: CanvasRenderingContext2D,
  districts: Array<{ type: string; x: number; y: number; radius: number; color: string; name: string }>,
  layout: IsoLayout,
): void {
  for (const district of districts) {
    const center = toScreen(district.x, district.y, 0, layout);
    const radiusX = district.radius * layout.tileWidth * 0.7;
    const radiusY = district.radius * layout.tileHeight * 0.7;

    // Draw district ground
    context.beginPath();
    context.ellipse(center.sx, center.sy, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fillStyle = district.color;
    context.fill();

    // District label (only when zoomed out enough)
    if (layout.tileWidth > 12) {
      context.fillStyle = 'rgba(200, 200, 210, 0.25)';
      context.font = `600 ${Math.max(9, layout.tileWidth * 0.12)}px 'Rajdhani', sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(district.name.toUpperCase(), center.sx, center.sy);
    }
  }
}

export function drawGroundPlane(
  context: CanvasRenderingContext2D,
  viewport: { width: number; height: number },
  _layout: IsoLayout,
): void {
  // Subtle ground gradient
  const ground = context.createRadialGradient(
    viewport.width * 0.5, viewport.height * 0.6, 0,
    viewport.width * 0.5, viewport.height * 0.6, viewport.width * 0.8,
  );
  ground.addColorStop(0, 'rgba(25, 30, 40, 0.3)');
  ground.addColorStop(0.5, 'rgba(15, 18, 25, 0.2)');
  ground.addColorStop(1, 'rgba(5, 8, 12, 0.1)');
  context.fillStyle = ground;
  context.fillRect(0, 0, viewport.width, viewport.height);
}
