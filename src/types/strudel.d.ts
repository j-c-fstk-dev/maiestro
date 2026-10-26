// O Strudel não publica tipos. Declaramos só o mínimo que usamos;
// todo o resto fica restrito a src/engine/.
declare module '@strudel/core' {
  export const Pattern: any;
  export const TimeSpan: any;
  export const Fraction: any;
  export const stack: (...pats: any[]) => any;
  export const silence: any;
  export const signal: (fn: (t: number) => number) => any;
  export const pure: (v: unknown) => any;
  export function evaluate(code: string, transpiler?: unknown, options?: Record<string, unknown>): Promise<{ pattern: any }>;
  export function evalScope(...modules: unknown[]): Promise<unknown>;
}
declare module '@strudel/mini' {
  export function miniAllStrings(): void;
}
declare module '@strudel/tonal';
declare module '@strudel/transpiler' {
  export const transpiler: unknown;
}
declare module '@strudel/web' {
  export function initStrudel(options?: Record<string, unknown>): Promise<any>;
  export function samples(source: string | Record<string, unknown>, base?: string): Promise<void>;
  export function getAudioContext(): AudioContext;
  export function initAudio(options?: Record<string, unknown>): Promise<void>;
  export const transpiler: unknown;
  export function getSuperdoughAudioController(): { output: { destinationGain: AudioNode } };
}
declare module '@strudel/webaudio' {
  export function getAudioContext(): AudioContext;
}
