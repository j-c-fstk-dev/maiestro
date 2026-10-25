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
}
declare module '@strudel/web' {
  export function initStrudel(options?: Record<string, unknown>): Promise<any>;
  export function samples(source: string | Record<string, unknown>, base?: string): Promise<void>;
  export function getAudioContext(): AudioContext;
}
declare module '@strudel/webaudio' {
  export function getAudioContext(): AudioContext;
}
