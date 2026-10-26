import type { EngineLike } from '../scheduler/timeline';
import { renderParts, type MixParts } from '../compiler/compile';

/** Motor de mentira para testes: guarda o que foi agendado e deixa o teste controlar o relógio. */
export class FakeEngine implements EngineLike {
  isPlaying = false;
  cycle = 0;
  bpm = 0;
  scheduled: { cycle: number; code: string }[] = [];
  played: string[] = [];
  failCode: ((code: string) => boolean) | null = null;
  lastError: string | null = null;
  now() {
    return this.cycle;
  }
  minCycle() {
    return this.cycle + 0.1;
  }
  async play(parts: MixParts) {
    this.isPlaying = true;
    this.played.push(renderParts(parts));
    return true;
  }
  async schedule(parts: MixParts, cycle: number) {
    const code = renderParts(parts);
    if (this.failCode?.(code)) {
      this.lastError = 'código quebrado';
      return false;
    }
    this.scheduled = [...this.scheduled.filter((s) => s.cycle !== cycle), { cycle, code }];
    return true;
  }
  cancelPending(from = -Infinity) {
    this.scheduled = this.scheduled.filter((s) => s.cycle < from);
  }
  stop() {
    this.isPlaying = false;
  }
  setBpm(bpm: number) {
    this.bpm = bpm;
  }
}
