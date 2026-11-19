import { COLORS } from '../themes';

/**
 * The hero is drawn, not sampled from a sprite sheet: a small hooded figure whose walk,
 * squash and scarf are driven by the motion of the step. Clones are the same figure in
 * amber with closed eyes: past selves replaying what they once did. Reflections wear
 * violet, antipodes jade and hang by their soles.
 */
export interface CharacterLook {
  readonly role: 'player' | 'clone';
  /** A mirror clone: same figure, in the colour of glass. */
  readonly reflection: boolean;
  /**
   * A clone that falls upward: same figure in jade, drawn head down from its soles, so that
   * its squash, its stride and its scarf (which lifts away from the fall) all turn over with it.
   * It keeps its colour when it is a reflection too: which way it falls is what matters most.
   */
  readonly antipode: boolean;
  /** 1D: the figure folds into a point of light riding the wire. */
  readonly onWire: boolean;
  readonly facing: 1 | -1;
  /** 0..1 through a step sideways, or null when standing. */
  readonly stride: number | null;
  readonly airborne: boolean;
  /** The level is won: eyes smile and the figure bounces. */
  readonly joy: boolean;
  /** 1 right after landing, decaying to 0. */
  readonly squash: number;
  readonly alpha: number;
  /** Seconds, for idle breathing, blinking and the scarf. */
  readonly time: number;
  /** Per-actor phase so that clones do not breathe in unison. */
  readonly seed: number;
}

export function drawCharacter(ctx: CanvasRenderingContext2D, feetX: number, feetY: number, cell: number, look: CharacterLook): void {
  const [body, dark] =
    look.role === 'player'
      ? [COLORS.player, COLORS.playerDark]
      : look.antipode
        ? [COLORS.antipode, COLORS.antipodeDark]
        : look.reflection
          ? [COLORS.reflection, COLORS.reflectionDark]
          : [COLORS.clone, COLORS.cloneDark];
  const t = look.time + look.seed * 1.7;

  ctx.save();
  ctx.globalAlpha *= look.alpha * (look.role === 'clone' ? 0.86 : 1);

  if (look.onWire) {
    drawSpark(ctx, feetX, feetY - cell * 0.5, cell, body, look, t);
    ctx.restore();
    return;
  }

  // Head down: everything below is drawn as for anyone, mirrored about the line of the soles.
  if (look.antipode) {
    ctx.translate(0, feetY);
    ctx.scale(1, -1);
    ctx.translate(0, -feetY);
  }

  // Joy is a bounce on the spot.
  if (look.joy) feetY -= Math.abs(Math.sin(t * 7)) * cell * 0.16;
  const breathe = Math.sin(t * 2.4) * 0.025;
  const stretch = look.airborne ? 0.1 : 0;
  const sx = 1 + look.squash * 0.28 - stretch * 0.6 - breathe;
  const sy = 1 - look.squash * 0.3 + stretch + breathe;
  const w = cell * 0.5 * sx;
  const h = cell * 0.66 * sy;
  const cx = feetX;
  const top = feetY - h - cell * 0.05;
  const step = look.stride === null ? 0 : Math.sin(look.stride * Math.PI * 2);

  // Feet: two pads that trade places through the stride and tuck in mid-air.
  ctx.fillStyle = COLORS.ink;
  const footY = feetY - cell * 0.045;
  const spread = look.airborne ? cell * 0.07 : cell * 0.13;
  for (const side of [-1, 1] as const) {
    const lift = look.airborne ? cell * 0.05 : Math.max(0, step * side) * cell * 0.08;
    ctx.beginPath();
    ctx.ellipse(cx + side * spread + step * side * cell * 0.04, footY - lift, cell * 0.095, cell * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Scarf: trails behind, lifts when falling.
  const tail = -look.facing;
  const wave = Math.sin(t * 6) * cell * 0.04;
  const neckY = top + h * 0.52;
  ctx.fillStyle = look.role === 'player' ? '#ff6b6b' : '#fff1c9';
  ctx.beginPath();
  ctx.moveTo(cx + tail * w * 0.35, neckY - cell * 0.04);
  ctx.quadraticCurveTo(
    cx + tail * (w * 0.75 + cell * 0.1),
    neckY + wave - (look.airborne ? cell * 0.22 : 0),
    cx + tail * (w * 0.6 + cell * 0.3 + (look.stride === null ? 0 : cell * 0.08)),
    neckY + cell * 0.1 + wave * 1.6 - (look.airborne ? cell * 0.34 : 0),
  );
  ctx.lineTo(cx + tail * w * 0.35, neckY + cell * 0.07);
  ctx.closePath();
  ctx.fill();

  // Body: a rounded cloak.
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, top + h);
  ctx.bezierCurveTo(cx - w * 0.62, top + h * 0.35, cx - w * 0.42, top, cx, top);
  ctx.bezierCurveTo(cx + w * 0.42, top, cx + w * 0.62, top + h * 0.35, cx + w / 2, top + h);
  ctx.quadraticCurveTo(cx, top + h * 1.06, cx - w / 2, top + h);
  ctx.closePath();
  ctx.fill();

  // Hood tip, leaning back from the direction of travel.
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.2, top + h * 0.1);
  ctx.quadraticCurveTo(cx + tail * w * 0.15, top - h * 0.22, cx + tail * w * 0.5, top - h * 0.1 + wave * 0.5);
  ctx.quadraticCurveTo(cx + tail * w * 0.2, top + h * 0.02, cx + w * 0.2, top + h * 0.1);
  ctx.closePath();
  ctx.fill();

  // Shaded side, away from the light.
  ctx.fillStyle = dark;
  ctx.globalAlpha *= 0.35;
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.18, top + h * 0.06);
  ctx.bezierCurveTo(cx + w * 0.52, top + h * 0.2, cx + w * 0.6, top + h * 0.6, cx + w / 2, top + h);
  ctx.quadraticCurveTo(cx + w * 0.3, top + h * 1.03, cx + w * 0.12, top + h * 1.02);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha /= 0.35;

  // Face.
  const faceX = cx + look.facing * w * 0.08;
  const faceY = top + h * 0.42;
  ctx.fillStyle = COLORS.paper;
  ctx.beginPath();
  ctx.ellipse(faceX, faceY, w * 0.36, h * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();

  const blink = look.role === 'clone' || (t % 3.7) < 0.12;
  ctx.fillStyle = COLORS.ink;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = Math.max(1.5, cell * 0.03);
  ctx.lineCap = 'round';
  for (const side of [-1, 1] as const) {
    const ex = faceX + side * w * 0.15 + look.facing * w * 0.05;
    if (look.joy) {
      ctx.beginPath();
      ctx.arc(ex, faceY + h * 0.03, w * 0.065, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else if (blink) {
      ctx.beginPath();
      ctx.moveTo(ex - w * 0.06, faceY);
      ctx.lineTo(ex + w * 0.06, faceY);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.ellipse(ex, faceY, w * 0.055, h * 0.075, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawSpark(ctx: CanvasRenderingContext2D, cx: number, cy: number, cell: number, color: string, look: CharacterLook, t: number): void {
  const pulse = 1 + Math.sin(t * 7) * 0.08;
  const r = cell * 0.2 * pulse;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.8);
  glow.addColorStop(0, `${color}cc`);
  glow.addColorStop(1, `${color}00`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.paper;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.fill();

  // The eyes survive the fold: it is still you.
  ctx.fillStyle = COLORS.ink;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = Math.max(1.2, cell * 0.025);
  for (const side of [-1, 1] as const) {
    const ex = cx + side * r * 0.26 + look.facing * r * 0.1;
    if (look.role === 'clone') {
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.12, cy);
      ctx.lineTo(ex + r * 0.12, cy);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.ellipse(ex, cy, r * 0.1, r * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
