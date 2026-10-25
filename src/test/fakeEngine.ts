import type { EngineLike } from '../scheduler/timeline';

/** Motor de mentira para testes: guarda o que foi agendado e deixa o teste controlar o relógio. */
export class FakeEngine implements EngineLike {
  isPlaying = false;
  cycle = 0;
  bpm = 0;
  scheduled: { cycle: number; code: string }[] = [];
  played: string[] = [];
  failCode: ((code: string) => boolean) | null = null;
  now() {
    return this.cycle;
  }
  minCycle() {
    return this.cycle + 0.1;
  }
  async play(code: string) {
    this.isPlaying = true;
    this.played.push(code);
    return true;
  }
  async schedule(code: string, cycle: number) {
    if (this.failCode?.(code)) return false;
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
