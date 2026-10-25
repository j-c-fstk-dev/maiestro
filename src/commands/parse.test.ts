import { describe, expect, it } from 'vitest';
import { CommandError, parseCommand } from './parse';
import { testMix } from '../test/mix';

const mix = testMix();
const p = (s: string) => parseCommand(s, mix);

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

describe('parseCommand — dois decks', () => {
  it('/xfade com compassos e estilo', () => {
    expect(p('/xfade 32 bass_swap')).toMatchObject({ ops: [{ op: 'transition', to: 'B', bars: 32, style: 'bass_swap' }], when: { at: 'phrase' } });
    expect(p('/xfade cut @drop')).toMatchObject({ ops: [{ op: 'transition', bars: 1, style: 'cut' }], when: { at: 'section_type', type: 'drop' } });
    expect(p('/xfade from:drop')).toMatchObject({ ops: [{ op: 'transition', style: 'filter_swap', bars: 32, enterAt: 'drop' }] });
  });

  it('/load vai para o deck fora do ar por padrão', () => {
    expect(p('/load house')).toMatchObject({ ops: [{ op: 'load', deck: 'B' }], when: { at: 'bar' } });
  });

  it('comandos valem para o deck selecionado', () => {
    expect(parseCommand('/bpm 120', mix, 'B')).toMatchObject({ ops: [{ op: 'set_bpm', bpm: 120, deck: 'B' }], label: '[B] BPM 120' });
    expect(p('/deck b')).toEqual({ kind: 'target', deck: 'B' });
  });
});
