import { LESSONS, type Lesson, type LessonId } from '../lessons';
import type { Assets } from './assets';
import type { Audio } from './audio';
import { Game } from './game';
import type { LevelEntry } from './hud';

/** Owns the demonstration room. The real level and its recording stay paused underneath it. */
export class LessonPlayer {
  private readonly stage: Game;
  private readonly title = document.getElementById('lesson-title')!;
  private readonly key = document.getElementById('lesson-key')!;
  private readonly line = document.getElementById('lesson-line')!;
  private lesson: Lesson | null = null;

  constructor(assets: Assets, audio: Audio) {
    const canvas = document.getElementById('lesson-view');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing lesson canvas');
    this.stage = new Game(canvas, assets, null, audio);
  }

  start(id: LessonId, entry: LevelEntry): void {
    this.lesson = LESSONS[id];
    this.title.textContent = this.lesson.level.name;
    this.stage.start({ ...entry, level: this.lesson.level });
    this.stage.demo(this.lesson.loops);
  }

  /** False when the last caption has played through. A stalled tab never skips a beat. */
  frame(now: number): boolean {
    if (!this.lesson) return false;
    this.stage.frame(now);
    const cue = this.lesson.cues.find(({ end }) => this.stage.playedFrames < end);
    if (!cue || this.stage.outcome !== 'playing') return false;
    if (this.line.textContent !== cue.caption) {
      this.key.hidden = !cue.key;
      this.key.textContent = cue.key;
      this.line.textContent = cue.caption;
    }
    return true;
  }
}
