import type { MixState } from '../song/mix';
import type { Op } from '../song/ops';

/**
 * Registro da sessão durante a gravação: estado inicial + tudo que mudou (com tempo e compasso)
 * + os pedidos feitos ao maestro. Exportado como JSON junto com o áudio; serve para entender
 * depois o que aconteceu e, no futuro, re-renderizar a sessão.
 */

export type SessionEvent =
  | { t: number; type: 'applied'; cycle: number; label: string; source: string; ops: Op[] }
  | { t: number; type: 'prompt'; text: string; reply?: string; error?: string }
  | { t: number; type: 'command'; text: string }
  | { t: number; type: 'transport'; action: 'play' | 'stop'; state?: MixState };

export interface SessionFile {
  app: 'maestro';
  version: 2;
  startedAt: string;
  durationSec: number;
  sampleRate: number;
  initialState: MixState;
  events: SessionEvent[];
}

type Without<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

export class SessionLog {
  private start = performance.now();
  private startedAt = new Date().toISOString();
  private events: SessionEvent[] = [];

  constructor(private initialState: MixState) {}

  add(e: Without<SessionEvent, 't'>) {
    this.events.push({ ...e, t: Math.round((performance.now() - this.start) / 10) / 100 } as SessionEvent);
  }

  toFile(durationSec: number, sampleRate: number): SessionFile {
    return {
      app: 'maestro',
      version: 2,
      startedAt: this.startedAt,
      durationSec,
      sampleRate,
      initialState: this.initialState,
      events: this.events,
    };
  }
}
