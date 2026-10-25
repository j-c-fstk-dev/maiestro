import { describe, expect, it } from 'vitest';
import { CommandError, parseCommand } from './parse';
import { STYLES } from '../presets/styles';

const state = STYLES[0].build();
const p = (s: string) => parseCommand(s, state);

describe('parseCommand', () => {
  it('texto sem barra vai para a IA', () => {
    expect(p('deixa mais sombrio')).toEqual({ kind: 'natural', text: 'deixa mais sombrio' });
  });

  it('bpm com rampa', () => {
    expect(p('/bpm 132 8')).toMatchObject({ kind: 'ops', ops: [{ op: 'set_bpm', bpm: 132, rampBars: 8 }], when: { at: 'bar' } });
  });

  it('tom com escala de duas palavras e sufixo de tempo', () => {
    expect(p('/key f# harmonic minor @drop')).toMatchObject({
      ops: [{ op: 'set_key', key: { root: 'F#', scale: 'harmonic minor' } }],
      when: { at: 'section_type', type: 'drop' },
    });
  });

  it('mute temporário gera o unmute', () => {
    expect(p('/mute kick 8')).toMatchObject({ ops: [{ op: 'mute', layer: 'kick' }], revertAfterBars: 8 });
  });

  it('arranjo', () => {
    const c = p('/arr intro:8 drop:16');
    expect(c).toMatchObject({ kind: 'ops', when: { at: 'section' } });
    if (c.kind === 'ops' && c.ops[0].op === 'set_arrangement') expect(c.ops[0].sections.map((s) => s.bars)).toEqual([8, 16]);
  });

  it('erros com mensagem útil', () => {
    expect(() => p('/pattern kick xyz')).toThrow(/Opções: four/);
    expect(() => p('/bpm 500')).toThrow(CommandError);
    expect(() => p('/mute guitarra')).toThrow(/camada inválida/);
    expect(() => p('/nada')).toThrow(/desconhecido/);
  });
});
