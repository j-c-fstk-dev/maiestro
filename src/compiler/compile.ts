import { INSTRUMENTS_BY_ID, type Instrument } from '../presets/instruments';
import { PATTERNS_BY_ID } from '../presets/patterns';
import { LAYER_IDS, type Layer, type LayerId, type Section, type SongState } from '../song/types';
import { loopLength, sectionStarts } from '../song/time';

/**
 * SongState → código Strudel. Função pura.
 *
 * Forma do código gerado:
 *   maestroArrange(ANCHOR, [
 *     [BARS, stack(camada, camada, ...).djf(FILTRO)],   // uma entrada por seção
 *     ...
 *   ])
 * maestroArrange/maestroRamp vêm de src/engine/arrange.ts.
 */

/** cada grupo de camadas num "orbit" próprio do Strudel, para reverb/delay não brigarem */
const ORBITS: Record<LayerId, number> = { kick: 1, clap: 1, hats: 1, perc: 1, bass: 2, chords: 3, lead: 4, vocal: 6, fx: 5 };
const DRUMS: LayerId[] = ['kick', 'clap', 'hats', 'perc'];
const MELODIC: LayerId[] = ['bass', 'chords', 'lead', 'vocal'];

/** cutoff "aberto" usado quando o mood escurece um instrumento sem lpf próprio */
const OPEN_LPF = 12000;

const num = (n: number) => String(Math.round(n * 1000) / 1000);

export class CompileError extends Error {}

export function compileLayer(state: SongState, id: LayerId, layer: Layer, rise?: RiseCtx): string {
  const inst: Instrument | undefined = INSTRUMENTS_BY_ID[layer.instrument];
  const pattern = PATTERNS_BY_ID[layer.pattern];
  if (!inst) throw new CompileError(`instrumento desconhecido: ${layer.instrument}`);
  if (!pattern) throw new CompileError(`padrão desconhecido: ${layer.pattern}`);
  const { darkness, energy } = state.mood;

  const parts: string[] = [pattern.src];
  if (inst.kind === 'drums') {
    parts.push(`.bank("${inst.bank}")`);
  } else {
    parts.push(`.s("${inst.sound}")`);
    if (MELODIC.includes(id)) parts.push(`.scale("${state.key.root}${inst.octave ?? 3}:${state.key.scale}")`);
    if (inst.vowel) parts.push(`.vowel("${inst.vowel}")`);
  }

  const params: Record<string, number> = { ...inst.params, ...stripUndefined(layer.fx) };

  // mood: escuridão fecha o filtro dos melódicos e abre o reverb
  if (darkness > 0 && MELODIC.includes(id)) {
    params.lpf = (params.lpf ?? OPEN_LPF) * (1 - 0.65 * darkness);
  }
  const darkRoom = MELODIC.includes(id) ? 0.25 * darkness : 0;
  if (darkRoom > 0 || state.master.reverb > 0) {
    params.room = Math.min(1, (params.room ?? 0) + darkRoom + state.master.reverb);
  }
  if (params.room) params.size = Math.min(1, 0.4 + 0.5 * params.room);
  if (params.delay) {
    params.delaytime ??= (3 / 16) * (240 / state.bpm); // colcheia pontuada, em segundos
    params.delayfeedback ??= 0.45;
  }

  // energia: bateria mais alta e mais presente
  const energyGain = DRUMS.includes(id) ? 0.75 + 0.35 * energy : 1;
  const gain = inst.gain * layer.gain * energyGain * state.master.gain;

  for (const [k, v] of Object.entries(params)) parts.push(`.${k}(${num(v)})`);

  if (id === 'fx' && rise) {
    // riser: volume e corte sobem ao longo do build
    parts.push(`.gain(${rampExpr(rise, 0, gain)})`, `.hpf(${rampExpr(rise, 400, 6000)})`);
  } else {
    parts.push(`.gain(${num(gain)})`);
  }
  parts.push(`.orbit(${ORBITS[id]})`);
  return parts.join('');
}

interface RiseCtx {
  anchor: number;
  loop: number;
  start: number;
  bars: number;
}

const rampExpr = (r: RiseCtx, from: number, to: number) =>
  `maestroRamp(${r.anchor}, ${r.loop}, ${r.start}, ${r.bars}, ${num(from)}, ${num(to)})`;

/** Quais camadas tocam numa seção. */
export function activeLayers(state: SongState, section: Section): LayerId[] {
  return LAYER_IDS.filter((id) => {
    const layer = state.layers[id];
    return layer && !layer.muted && !section.mute.includes(id);
  });
}

export function compileSection(state: SongState, index: number): string {
  const section = state.arrangement[index];
  const rise: RiseCtx | undefined = section.rise
    ? { anchor: state.anchor, loop: loopLength(state.arrangement), start: sectionStarts(state.arrangement)[index], bars: section.bars }
    : undefined;

  const layers = activeLayers(state, section).map((id) => compileLayer(state, id, state.layers[id]!, rise));
  if (layers.length === 0) return 'silence';

  // filtro master (DJ filter é por orbit: aplicamos em todas as camadas, sempre, para resetar)
  const filter = section.filter ?? state.master.filter;
  const djf = rise ? rampExpr(rise, filter, Math.max(filter, 0.72)) : num(filter);
  return `stack(\n    ${layers.join(',\n    ')}\n  ).djf(${djf})`;
}

export function compile(state: SongState): string {
  const sections = state.arrangement.map((s, i) => `  [${s.bars}, ${compileSection(state, i)}]`);
  return `maestroArrange(${state.anchor}, [\n${sections.join(',\n')}\n])`;
}

function stripUndefined<T extends object>(o: T): Record<string, number> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Record<string, number>;
}
