import type { Level } from '../../core/types';
import type { Theme } from '../themes';
import { type Camera, type Viewport, project } from './camera';
import { withAlpha } from './scene';
import { copiesOf, shifted } from './seam';

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

  if (theme.biome === 'hyperspace') {
    const cx = width * (0.54 + 0.055 * Math.sin(time * 0.12));
    const cy = height * (0.43 + 0.045 * Math.cos(time * 0.16));
    const span = Math.max(width, height);
    const veil = ctx.createRadialGradient(cx, cy, 0, cx, cy, span * 0.85);
    veil.addColorStop(0, '#503778');
    veil.addColorStop(0.48, 'rgba(19, 14, 51, 0.94)');
    veil.addColorStop(1, '#070919');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(cx, cy);
    // Successive cross sections turn through each other as the fold passes the camera.
    for (let i = 0; i < 12; i++) {
      const t = (i / 12 + time * 0.027) % 1;
      const r = (0.015 + t * t) * span;
      ctx.strokeStyle = withAlpha(i % 2 ? '#ad8eff' : '#71eae7', 0.24 * Math.sin(Math.PI * t));
      ctx.beginPath();
      for (let corner = 0; corner <= 6; corner++) {
        const angle = corner * Math.PI / 3 + t * 0.9 + time * 0.045;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r * 0.64;
        if (corner === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 125; i++) {
      const t = (i * 0.618 + time * 0.043) % 1;
      const angle = i * 2.399;
      const r = t * t * span;
      ctx.fillStyle = withAlpha('#d7dcff', 0.2 + t * 0.62);
      ctx.fillRect(Math.cos(angle) * r, Math.sin(angle) * r * 0.72, 0.75 + t * 1.6, 0.75 + t);
    }
    ctx.restore();
    return;
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

  // Le tore: two great hoops turning slowly behind everything, a bead of light going round
  // each and always coming back.
  if (theme.biome === 'tore') {
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const cx = width * (i === 0 ? 0.24 : 0.78) - cam.depth * (8 + i * 6);
      const cy = height * (i === 0 ? 0.36 : 0.56);
      const rx = Math.min(width, height) * (i === 0 ? 0.36 : 0.27);
      const ry = rx * (0.3 + 0.07 * Math.sin(time * 0.11 + i * 2));
      const tilt = (i === 0 ? -0.32 : 0.4) + Math.sin(time * 0.07 + i) * 0.05;
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = theme.mote.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, tilt, 0, Math.PI * 2);
      ctx.stroke();
      const angle = time * (0.22 - i * 0.07) + i * 2.4;
      const bx = cx + Math.cos(angle) * rx * Math.cos(tilt) - Math.sin(angle) * ry * Math.sin(tilt);
      const by = cy + Math.cos(angle) * rx * Math.sin(tilt) + Math.sin(angle) * ry * Math.cos(tilt);
      // The half of the turn that passes behind is dimmer: the hoop has a near side and a far one.
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(angle);
      const bead = ctx.createRadialGradient(bx, by, 0, bx, by, 9);
      bead.addColorStop(0, withAlpha(theme.mote.color, 0.95));
      bead.addColorStop(1, withAlpha(theme.mote.color, 0));
      ctx.fillStyle = bead;
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

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
  ctx.fillStyle = mote.color;
  for (let i = 0; i < mote.count; i++) {
    if (mote.kind === 'snow') {
      // Snow is heavier than ash: it falls faster, sways wider, and the near flakes are larger.
      const near = (i % 5) / 4;
      const travel = (time * (0.035 + near * 0.03) + i * 0.137) % 1;
      const mx = ((i * 0.618) % 1) * width + Math.sin(time * (0.6 + near * 0.5) + i * 1.9) * (14 + near * 20) + travel * 40;
      ctx.globalAlpha = (0.45 + 0.4 * near) * Math.min(1, Math.sin(Math.PI * travel) * 4);
      ctx.beginPath();
      ctx.arc(mx, height * travel, 1.3 + near * 2.1, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    if (mote.kind === 'orbit') {
      // Gold dust going round: out by the right, back by the left, each grain on its own slow lane.
      const lane = ((i * 0.618) % 1) * height;
      const span = width + 60;
      const mx = (((time * (7 + (i % 4) * 3) + i * 211) % span) + span) % span - 30;
      const my = lane + Math.sin(time * 0.35 + i * 1.9) * 22;
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(time * 0.9 + i * 2.1));
      ctx.globalAlpha = twinkle * 0.6;
      ctx.beginPath();
      ctx.arc(mx, my, 1.4 + (i % 3) * 0.8, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    const travel = (time * (0.012 + (i % 4) * 0.004) + i * 0.137) % 1;
    const mx = ((i * 0.618) % 1) * width + Math.sin(time * 0.5 + i * 1.9) * 26;
    const twinkle = 0.25 + 0.75 * Math.abs(Math.sin(time * 1.3 + i * 2.1));
    // With two grounds there are two ways to fall: half the pollen goes each way.
    const drift = mote.kind === 'both' && i % 2 === 1 ? -mote.drift : mote.drift;
    ctx.globalAlpha = twinkle * 0.5 * Math.sin(Math.PI * travel);
    ctx.fillStyle = mote.color;
    ctx.beginPath();
    ctx.arc(mx, height * (drift > 0 ? 1 - travel : travel), 1.4 + (i % 3) * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // The void: a sea of haze rising from below. Where the sky is turned over the clouds are
  // overhead, and a thinner haze comes down from them as well.
  const sea = ctx.createLinearGradient(0, height * 0.72, 0, height);
  sea.addColorStop(0, withAlpha(theme.haze, 0));
  sea.addColorStop(1, withAlpha(theme.haze, theme.ceiling === null ? 0.55 : 0.2));
  ctx.fillStyle = sea;
  ctx.fillRect(0, height * 0.72, width, height * 0.28);
  if (theme.ceiling !== null) {
    const lid = ctx.createLinearGradient(0, 0, 0, height * 0.24);
    lid.addColorStop(0, withAlpha(theme.haze, 0.4));
    lid.addColorStop(1, withAlpha(theme.haze, 0));
    ctx.fillStyle = lid;
    ctx.fillRect(0, 0, width, height * 0.24);
  }

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

  /** A puff where feet or a crate hit the ground. `up` is -1 for soles that land on a ceiling: the puff then comes down off it. */
  dust(x: number, y: number, z: number, color: string, up: 1 | -1 = 1): void {
    for (let i = 0; i < 7; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      this.particles.push({
        x,
        y: y + up * 0.04,
        z,
        vx: side * (0.6 + Math.random() * 1.4),
        vy: up * (0.4 + Math.random() * 0.9),
        age: 0,
        life: 0.32 + Math.random() * 0.2,
        size: 0.05 + Math.random() * 0.05,
        color,
        gravity: up * 1.5,
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

  /** One or two specks kicked up by a footstep, by soles or a crate sliding on ice, or shed by a spark on a wire. */
  speck(x: number, y: number, z: number, color: string, drift: number, up: 1 | -1 = 1): void {
    for (let i = 0; i < 2; i++) {
      this.particles.push({
        x,
        y: y + up * 0.03,
        z,
        vx: drift * (0.5 + Math.random()),
        vy: up * (0.3 + Math.random() * 0.6),
        age: 0,
        life: 0.22 + Math.random() * 0.14,
        size: 0.03 + Math.random() * 0.03,
        color,
        gravity: up * 1.2,
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

  /**
   * In a level that wraps, a puff or a ring next to a joined edge is seen on both sides of it,
   * like the body it came from.
   */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, level: Level): void {
    for (const p of this.particles) {
      const fade = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      for (const copy of copiesOf(level, p.x, p.x, p.y, p.y)) {
        const at = project(shifted(cam, copy), p.x, p.y, p.z);
        ctx.globalAlpha = fade * copy.alpha;
        ctx.beginPath();
        ctx.arc(at.x, at.y, Math.max(1, p.size * cam.cell * (0.5 + fade * 0.5)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const ring of this.rings) {
      const u = ring.age / ring.life;
      const reach = 0.25 + u * 1.5;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = Math.max(1.5, cam.cell * 0.07 * (1 - u));
      for (const copy of copiesOf(level, ring.x - 0.25, ring.x + 0.25, ring.y - 0.25, ring.y + 0.25)) {
        const at = project(shifted(cam, copy), ring.x, ring.y, ring.z);
        ctx.globalAlpha = (1 - u) * 0.9 * copy.alpha;
        ctx.beginPath();
        ctx.arc(at.x, at.y, cam.cell * reach, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}
