import { describe, expect, it } from 'vitest';
import { Conductor, type ChatFn } from '../conductor';
import { Timeline } from '../../scheduler/timeline';
import { FakeEngine } from '../../test/fakeEngine';
import { testMix } from '../../test/mix';
import { CASES } from './cases';

/**
 * Garante que os critérios da avaliação estão certos: uma resposta "ideal" escrita à mão
 * para cada caso tem que passar (e ser executável). Não chama nenhum LLM.
 */

const p = (when: unknown, ops: unknown[], extra: object = {}) => ({ when, label: 'x', ops, ...extra });
const IDEAL: Record<string, unknown> = {
  'tirar beat por N': { plans: [p('bar', [{ op: 'mute', layer: 'kick' }], { forBars: 8 })] },
  'voltar beat': { plans: [p('bar', [{ op: 'unmute', layer: 'kick' }])] },
  sombrio: { plans: [p('phrase', [{ op: 'set_mood', darkness: 0.8 }])] },
  alegre: { plans: [p('phrase', [{ op: 'set_key', root: 'A', scale: 'major' }, { op: 'set_mood', darkness: 0.15 }])] },
  'bpm exato': { plans: [p('bar', [{ op: 'set_bpm', bpm: 135 }])] },
  'bpm com rampa': { plans: [p('bar', [{ op: 'set_bpm', bpm: 140, rampBars: 16 }])] },
  'bpm relativo': { plans: [p('bar', [{ op: 'set_bpm', bpm: 131 }])] },
  'build e drop': { plans: [p('section', [{ op: 'insert_sections', sections: [{ type: 'build', bars: 8 }, { type: 'drop', bars: 16 }] }])] },
  'breakdown na próxima seção': { plans: [p('section', [{ op: 'insert_sections', sections: [{ type: 'breakdown', bars: 16 }] }])] },
  'voz etérea': { plans: [p('phrase', [{ op: 'add_layer', layer: 'vocal', instrument: 'choir_aah', pattern: 'vox_long' }])] },
  'tirar baixo': { plans: [p('bar', [{ op: 'mute', layer: 'bass' }])] },
  'trocar timbre': { plans: [p('phrase', [{ op: 'set_instrument', layer: 'bass', instrument: 'acid' }])] },
  'padrão de chimbal': { plans: [p('bar', [{ op: 'set_pattern', layer: 'hats', pattern: 'offbeat' }])] },
  abafar: { plans: [p('bar', [{ op: 'set_master', filter: 0.3 }])] },
  'abrir filtro': { plans: [p('bar', [{ op: 'set_master', filter: 0.5 }])] },
  'tom exato': { plans: [p('phrase', [{ op: 'set_key', root: 'D', scale: 'minor' }])] },
  'tom no drop': { plans: [p({ section: 'drop' }, [{ op: 'set_key', root: 'F', scale: 'phrygian' }])] },
  'reverb numa camada': { plans: [p('bar', [{ op: 'set_fx', layer: 'lead', room: 0.6 }])] },
  'delay numa camada': { plans: [p('bar', [{ op: 'set_fx', layer: 'lead', delay: 0.4 }])] },
  'mais energia': { plans: [p('phrase', [{ op: 'set_mood', energy: 0.95 }])] },
  'mais calmo': { plans: [p('phrase', [{ op: 'set_mood', energy: 0.3 }])] },
  'pular seção': { plans: [p('phrase', [{ op: 'jump_to', section: 'breakdown' }])] },
  'mute temporário de acordes': { plans: [p('bar', [{ op: 'mute', layer: 'chords' }], { forBars: 16 })] },
  'volume de camada +': { plans: [p('bar', [{ op: 'set_gain', layer: 'kick', gain: 1.2 }])] },
  'volume de camada -': { plans: [p('bar', [{ op: 'set_gain', layer: 'lead', gain: 0.7 }])] },
  'remover camada': { plans: [p('bar', [{ op: 'remove_layer', layer: 'perc' }])] },
  arpejo: { plans: [p('phrase', [{ op: 'set_pattern', layer: 'lead', pattern: 'arp_up' }])] },
  desfazer: { plans: [], undo: true },
  'pedido completo (o exemplo do projeto)': {
    plans: [
      p('section', [{ op: 'mute', layer: 'kick' }], { forBars: 8 }),
      p({ after: 0 }, [{ op: 'add_layer', layer: 'vocal', instrument: 'choir_aah', pattern: 'vox_long' }]),
      p({ after: 8 }, [{ op: 'insert_sections', sections: [{ type: 'build', bars: 8 }, { type: 'drop', bars: 16 }] }]),
      p({ section: 'drop' }, [{ op: 'set_key', root: 'A', scale: 'phrygian' }, { op: 'set_mood', darkness: 0.85 }]),
    ],
  },
  'instrumento que não existe': { plans: [p('bar', [{ op: 'set_fx', layer: 'lead', distort: 2 }])] },
  'pedido vago': { plans: [p('phrase', [{ op: 'set_pattern', layer: 'hats', pattern: 'shuffle' }])] },
  'relativo a agora': { plans: [p({ after: 8 }, [{ op: 'mute', layer: 'hats' }])] },
  'preparar outro deck': { plans: [p('bar', [{ op: 'load_style', style: 'melodic', deck: 'b' }])] },
  'transição com estilo': { plans: [p('phrase', [{ op: 'transition', style: 'bass_swap', bars: 32 }])] },
  'preparar e mixar': {
    plans: [
      p('bar', [{ op: 'load_style', style: 'house', deck: 'B' }, { op: 'set_bpm', bpm: 120, deck: 'B' }]),
      p('section', [{ op: 'transition', style: 'filter_swap', bars: 32 }]),
    ],
  },
};

describe('casos da avaliação aceitam a resposta ideal', () => {
  it('todo caso tem resposta ideal', () => {
    expect(CASES.map((c) => c.name).filter((n) => !(n in IDEAL))).toEqual([]);
  });
  for (const c of CASES) {
    it(c.name, async () => {
      const engine = new FakeEngine();
      const tl = new Timeline(engine, testMix());
      await tl.play();
      for (const op of c.setup ?? []) await tl.schedule([op], { at: 'bar' }, 'setup');
      engine.cycle = 45;
      tl.tick();
      for (const op of c.pendingSetup ?? []) await tl.schedule([op], { at: 'phrase' }, 'setup');
      const chat: ChatFn = async () => ({ content: JSON.stringify({ reply: 'ok', ...(IDEAL[c.name] as object) }), model: 'ideal', latencyMs: 0 });
      const r = await new Conductor(tl, chat).ask(c.prompt);
      expect(r.attempts).toBe(1);
      expect(c.check(r, tl)).toBeNull();
    });
  }
});
