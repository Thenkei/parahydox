import type { Theme } from '../themes';
import { type Camera, type Viewport, project } from './camera';
import { withAlpha } from './scene';

/** Everything that is mood rather than level: sky, clouds, dust, sparks, the 1D night. */

export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  theme: Theme,
  cam: Camera,
  view: Viewport,
  time: number,
): void {
  const { width, height } = view;
  if (image) {
    // Cover the viewport with some margin, and let the sky slide a little as depth opens.
    const scale = Math.max(width / image.width, height / image.height) * 1.08;
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, (width - w) / 2 - cam.depth * 22, (height - h) / 2 + cam.depth * 10, w, h);
  } else {
    ctx.fillStyle = '#0d1017';
    ctx.fillRect(0, 0, width, height);
  }

  // Far islands drifting between the sky and the level: the world goes on beyond this one.
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? 0 : 1;
    const drift = Math.sin(time * 0.05 + i * 2.1) * 14;
    const ix = width * (side === 0 ? 0.05 + i * 0.02 : 0.95 - i * 0.02) + drift - cam.depth * (6 + i * 5);
    // High and to the sides, where they never sit behind the level itself.
    const iy = height * (0.1 + i * 0.045) + Math.sin(time * 0.31 + i) * 5;
    const size = 34 + i * 9;
    ctx.globalAlpha = 0.14 + i * 0.02;
    ctx.fillStyle = theme.rockDark;
    ctx.beginPath();
    ctx.moveTo(ix - size, iy);
    ctx.quadraticCurveTo(ix - size * 0.4, iy + size * 0.5, ix - size * 0.05, iy + size * 1.05);
    ctx.quadraticCurveTo(ix + size * 0.45, iy + size * 0.4, ix + size, iy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = theme.grassDark;
    ctx.beginPath();
    ctx.ellipse(ix, iy, size, size * 0.16, 0, Math.PI, 0);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Slow clouds between the sky and the islands.
  for (let i = 0; i < 6; i++) {
    const speed = 6 + i * 2.5;
    const span = width + 520;
    const x = ((i * 397 + time * speed) % span) - 260 - cam.depth * (10 + i * 6);
    const y = height * (0.16 + ((i * 0.137) % 0.55));
    const rx = 150 + (i % 3) * 60;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.32);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    gradient.addColorStop(0, withAlpha(theme.haze, 0.2));
    gradient.addColorStop(1, withAlpha(theme.haze, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Specks in the air, pollen or embers rising, ash falling: the world breathes even when nothing moves.
  const { mote } = theme;
  for (let i = 0; i < mote.count; i++) {
    const travel = (time * (0.012 + (i % 4) * 0.004) + i * 0.137) % 1;
    const mx = ((i * 0.618) % 1) * width + Math.sin(time * 0.5 + i * 1.9) * 26;
    const twinkle = 0.25 + 0.75 * Math.abs(Math.sin(time * 1.3 + i * 2.1));
    ctx.globalAlpha = twinkle * 0.5 * Math.sin(Math.PI * travel);
    ctx.fillStyle = mote.color;
    ctx.beginPath();
    ctx.arc(mx, height * (mote.drift > 0 ? 1 - travel : travel), 1.4 + (i % 3) * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // The void: a sea of haze rising from below.
  const sea = ctx.createLinearGradient(0, height * 0.72, 0, height);
  sea.addColorStop(0, withAlpha(theme.haze, 0));
  sea.addColorStop(1, withAlpha(theme.haze, 0.55));
  ctx.fillStyle = sea;
  ctx.fillRect(0, height * 0.72, width, height * 0.28);

  // 1D: the world is gone. Night, and a few distant points.
  const night = 1 - cam.world;
  if (night > 0.01) {
    ctx.fillStyle = `rgba(5, 6, 14, ${0.86 * night})`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 70; i++) {
      const sx = (i * 7919) % width;
      const sy = (i * 104729) % height;
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(time * (0.6 + (i % 5) * 0.2) + i));
      ctx.globalAlpha = night * twinkle * 0.7;
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
  }
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  age: number;
  readonly life: number;
  readonly size: number;
  readonly color: string;
  readonly gravity: number;
}

interface Ring {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  age: number;
  readonly life: number;
  readonly color: string;
}

/** Particles live in world coordinates so they stay glued to the level while the camera moves. */
export class Effects {
  private particles: Particle[] = [];
  private rings: Ring[] = [];

  clear(): void {
    this.particles = [];
    this.rings = [];
  }

  /** A puff where feet or a crate hit the ground. */
  dust(x: number, y: number, z: number, color: string): void {
    for (let i = 0; i < 7; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      this.particles.push({
        x,
        y: y + 0.04,
        z,
        vx: side * (0.6 + Math.random() * 1.4),
        vy: 0.4 + Math.random() * 0.9,
        age: 0,
        life: 0.32 + Math.random() * 0.2,
        size: 0.05 + Math.random() * 0.05,
        color,
        gravity: 1.5,
      });
    }
  }

  burst(x: number, y: number, z: number, color: string, count = 16, speed = 3): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x,
        y,
        z,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        age: 0,
        life: 0.5 + Math.random() * 0.5,
        size: 0.04 + Math.random() * 0.05,
        color,
        gravity: 3,
      });
    }
  }

  /** One or two specks kicked up by a footstep, or shed by a spark on a wire. */
  speck(x: number, y: number, z: number, color: string, drift: number): void {
    for (let i = 0; i < 2; i++) {
      this.particles.push({
        x,
        y: y + 0.03,
        z,
        vx: drift * (0.5 + Math.random()),
        vy: 0.3 + Math.random() * 0.6,
        age: 0,
        life: 0.22 + Math.random() * 0.14,
        size: 0.03 + Math.random() * 0.03,
        color,
        gravity: 1.2,
      });
    }
  }

  ring(x: number, y: number, z: number, color: string, life = 0.55): void {
    this.rings.push({ x, y, z, age: 0, life, color });
  }

  update(dt: number): void {
    for (const p of this.particles) {
      p.age += dt;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (const ring of this.rings) ring.age += dt;
    this.particles = this.particles.filter((p) => p.age < p.life);
    this.rings = this.rings.filter((r) => r.age < r.life);
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera): void {
    for (const p of this.particles) {
      const at = project(cam, p.x, p.y, p.z);
      const fade = 1 - p.age / p.life;
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(at.x, at.y, Math.max(1, p.size * cam.cell * (0.5 + fade * 0.5)), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const ring of this.rings) {
      const at = project(cam, ring.x, ring.y, ring.z);
      const u = ring.age / ring.life;
      ctx.globalAlpha = (1 - u) * 0.9;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = Math.max(1.5, cam.cell * 0.07 * (1 - u));
      ctx.beginPath();
      ctx.arc(at.x, at.y, cam.cell * (0.25 + u * 1.5), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
