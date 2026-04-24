export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  glow: string;
  type: 'spark' | 'smoke' | 'ring' | 'beam' | 'pop';
}

export class ParticleSystem {
  particles: Particle[] = [];
  private nextId = 0;

  spawn(
    x: number,
    y: number,
    count: number,
    options: {
      color?: string;
      glow?: string;
      type?: Particle['type'];
      speed?: number;
      size?: number;
      life?: number;
      spread?: number;
    } = {},
  ): void {
    const {
      color = '#56d9ff',
      glow = 'rgba(86, 217, 255, 0.5)',
      type = 'spark',
      speed = 2,
      size = 2,
      life = 30,
      spread = Math.PI * 2,
    } = options;

    const startAngle = Math.random() * Math.PI * 2;

    for (let i = 0; i < count; i++) {
      const angle = startAngle + (spread * (i / count)) + (Math.random() - 0.5) * 0.5;
      const velocity = speed * (0.5 + Math.random() * 0.8);

      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - (type === 'smoke' ? 1 : 0),
        life,
        maxLife: life,
        size: size * (0.7 + Math.random() * 0.6),
        color,
        glow,
        type,
      });
    }
  }

  spawnConstruction(x: number, y: number, intensity: number = 1): void {
    this.spawn(x, y, Math.floor(8 * intensity), {
      color: '#ffbf69',
      glow: 'rgba(255, 191, 105, 0.6)',
      type: 'spark',
      speed: 1.5,
      size: 2,
      life: 25,
    });
    this.spawn(x, y, Math.floor(4 * intensity), {
      color: '#ffd43b',
      glow: 'rgba(255, 212, 59, 0.4)',
      type: 'smoke',
      speed: 0.8,
      size: 3,
      life: 40,
    });
  }

  spawnRepair(x: number, y: number): void {
    this.spawn(x, y, 12, {
      color: '#22c55e',
      glow: 'rgba(34, 197, 94, 0.6)',
      type: 'spark',
      speed: 2,
      size: 2.5,
      life: 20,
    });
  }

  spawnAsymmetryWarning(x: number, y: number): void {
    this.spawn(x, y, 6, {
      color: '#ef4444',
      glow: 'rgba(239, 68, 68, 0.7)',
      type: 'spark',
      speed: 1.2,
      size: 2,
      life: 35,
    });
  }

  spawnDroneArrive(x: number, y: number, role: string): void {
    const colors: Record<string, string> = {
      visionary: '#ec4899',
      architect: '#10b981',
      critic: '#ef4444',
      scout: '#a78bfa',
      builder: '#3b82f6',
      miner: '#f59e0b',
    };
    const color = colors[role] ?? '#56d9ff';
    this.spawn(x, y, 5, {
      color,
      glow: color.replace(')', ', 0.5)').replace('rgb', 'rgba'),
      type: 'pop',
      speed: 1.5,
      size: 3,
      life: 20,
    });
  }

  spawnCommandCenterDrop(x: number, y: number): void {
    // Impact ring
    this.spawn(x, y, 1, {
      color: '#ec4899',
      glow: 'rgba(236, 72, 153, 0.8)',
      type: 'ring',
      speed: 0,
      size: 1,
      life: 45,
    });
    // Sparks
    this.spawn(x, y, 20, {
      color: '#ec4899',
      glow: 'rgba(236, 72, 153, 0.6)',
      type: 'spark',
      speed: 3,
      size: 2.5,
      life: 35,
    });
    // Smoke
    this.spawn(x, y, 8, {
      color: '#ffb0dc',
      glow: 'rgba(255, 176, 220, 0.3)',
      type: 'smoke',
      speed: 1,
      size: 4,
      life: 50,
    });
  }

  spawnSelectionPulse(x: number, y: number): void {
    this.spawn(x, y, 1, {
      color: '#56d9ff',
      glow: 'rgba(86, 217, 255, 0.6)',
      type: 'ring',
      speed: 0,
      size: 1,
      life: 25,
    });
  }

  update(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (!p) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.life--;

      // Gravity for sparks
      if (p.type === 'spark') {
        p.vy += 0.05;
      }

      // Fade smoke
      if (p.type === 'smoke') {
        p.vx *= 0.98;
        p.vy *= 0.98;
      }

      // Expand ring
      if (p.type === 'ring') {
        p.size += 2;
      }

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  draw(context: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;

      if (p.type === 'ring') {
        context.save();
        context.strokeStyle = p.color.replace(')', `, ${alpha * 0.6})`).replace('rgb', 'rgba');
        context.lineWidth = 1.5;
        context.shadowBlur = 12 * alpha;
        context.shadowColor = p.glow;
        context.beginPath();
        context.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        context.stroke();
        context.restore();
        continue;
      }

      context.save();
      context.globalAlpha = alpha;
      context.fillStyle = p.color;
      context.shadowBlur = 8;
      context.shadowColor = p.glow;
      context.beginPath();
      context.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  clear(): void {
    this.particles = [];
  }
}
