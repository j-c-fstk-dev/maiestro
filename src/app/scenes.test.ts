import { beforeEach, describe, expect, it } from 'vitest';
import { forgetScene, getScene, listScenes, saveScene } from './scenes';
import { STYLES_BY_ID } from '../presets/styles';

describe('cenas', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });

  it('salva, lista, carrega e apaga', () => {
    expect(saveScene('noite', STYLES_BY_ID.lofi.build())).toBe(true);
    expect(listScenes().map((s) => s.name)).toEqual(['noite']);
    expect(getScene('noite')!.state.style).toBe('lofi');
    expect(forgetScene('noite')).toBe(true);
    expect(listScenes()).toEqual([]);
  });

  it('sem armazenamento disponível não quebra', () => {
    (globalThis as any).localStorage = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    expect(saveScene('x', STYLES_BY_ID.lofi.build())).toBe(false);
    expect(listScenes()).toEqual([]);
  });
});
