import { INSTRUMENTS_BY_ID, type Instrument } from '../presets/instruments';
import { PATTERNS_BY_ID } from '../presets/patterns';
import { LAYER_IDS, type Layer, type LayerId, type Section, type SongState } from '../song/types';
import { loopLength, sectionStarts } from '../song/time';
import { audibleDecks, type DeckId, type MixState } from '../song/mix';
import { TRANSITIONS_BY_ID, type Env } from '../presets/transitions';

/**
 * MixState → código Strudel. Função pura.
 *
 * Forma do código de um deck:
 *   maestroArrange(ANCHOR, [
 *     [BARS, stack(camada, camada, ...).djf(FILTRO)],   // uma entrada por seção
 *     ...
 *   ])
 * Com dois decks soando (transição): stack(deckA.postgain(env).djf(env), deckB…).
 * maestroArrange/maestroRamp/maestroEnv vêm de src/engine/arrange.ts.
 */

/** cada grupo de camadas num "orbit" próprio do Strudel, para reverb/delay não brigarem;
 *  o deck B usa os mesmos números + 10 */
const ORBITS: Record<LayerId, number> = { kick: 1, clap: 1, hats: 1, perc: 1, bass: 2, chords: 3, lead: 4, vocal: 6, fx: 5 };
const DRUMS: LayerId[] = ['kick', 'clap', 'hats', 'perc'];
const MELODIC: LayerId[] = ['bass', 'chords', 'lead', 'vocal'];

/** cutoff "aberto" usado quando o mood escurece um instrumento sem lpf próprio */
const OPEN_LPF = 12000;

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** folga geral de volume: com várias camadas somadas os drops passavam do teto (o limitador do engine segura o resto) */
const HEADROOM = 0.8;

export class CompileError extends Error {}

/** Opções de compilação que não são música (ex.: modo leve para máquinas modestas). */
export interface CompileOptions {
  /** troca supersaw por serra simples e corta delay/reverb por camada (só acordes e voz mantêm reverb) */
  light?: boolean;
}

const LIGHT_KEEP_ROOM: LayerId[] = ['chords', 'vocal'];

const ORBIT_OFFSET: Record<DeckId, number> = { A: 0, B: 10 };

export function compileLayer(state: SongState, id: LayerId, layer: Layer, rise?: RiseCtx, orbitOffset = 0, opts: CompileOptions = {}): string {
  if (layer.code) {
    // camada raw: o código é do usuário/IA; só ganho e orbit são nossos (validação no engine)
    return `(${layer.code}).gain(${num(layer.gain * state.master.gain * HEADROOM)}).orbit(${ORBITS[id] + orbitOffset})`;
  }
  const inst: Instrument | undefined = INSTRUMENTS_BY_ID[layer.instrument];
  const pattern = PATTERNS_BY_ID[layer.pattern];
  if (!inst) throw new CompileError(`instrumento desconhecido: ${layer.instrument}`);
  if (!pattern) throw new CompileError(`padrão desconhecido: ${layer.pattern}`);
  const { darkness, energy } = state.mood;

  const parts: string[] = [pattern.src];
  if (inst.kind === 'drums') {
    parts.push(`.bank("${inst.bank}")`);
  } else {
    parts.push(`.s("${opts.light && inst.sound === 'supersaw' ? 'sawtooth' : inst.sound}")`);
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
  if (opts.light) {
    delete params.delay;
    if (!LIGHT_KEEP_ROOM.includes(id)) delete params.room;
  }
  if (params.room) params.size = Math.min(1, 0.4 + 0.5 * params.room);
  if (params.delay) {
    params.delaytime ??= (3 / 16) * (240 / state.bpm); // colcheia pontuada, em segundos
    params.delayfeedback ??= 0.45;
  }

  // energia: bateria mais alta e mais presente
  const energyGain = DRUMS.includes(id) ? 0.75 + 0.35 * energy : 1;
  const gain = inst.gain * layer.gain * energyGain * state.master.gain * HEADROOM;

  for (const [k, v] of Object.entries(params)) parts.push(`.${k}(${num(v)})`);

  if (id === 'fx' && rise) {
    // riser: volume e corte sobem ao longo do build
    parts.push(`.gain(${rampExpr(rise, 0, gain)})`, `.hpf(${rampExpr(rise, 400, 6000)})`);
  } else {
    parts.push(`.gain(${num(gain)})`);
  }
  parts.push(`.orbit(${ORBITS[id] + orbitOffset})`);
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

/** Uma seção: expressões das camadas que tocam + filtro master (número ou rampa). */
export interface SectionParts {
  bars: number;
  layers: string[];
  djf: string;
}

/** Um deck: arranjo ancorado + (durante transições) os métodos da transição aplicados ao deck inteiro. */
export interface DeckParts {
  anchor: number;
  sections: SectionParts[];
  wrap: string;
}

/**
 * A mixagem em partes. O engine monta o pattern a partir delas reaproveitando (cache) cada
 * expressão de camada já interpretada — uma mudança pequena não reinterpreta a música inteira.
 * `renderParts` gera o mesmo código como texto (painel de código, testes).
 */
export interface MixParts {
  decks: DeckParts[];
}

export function sectionParts(state: SongState, index: number, orbitOffset = 0, opts: CompileOptions = {}): SectionParts {
  const section = state.arrangement[index];
  const rise: RiseCtx | undefined = section.rise
    ? { anchor: state.anchor, loop: loopLength(state.arrangement), start: sectionStarts(state.arrangement)[index], bars: section.bars }
    : undefined;
  const layers = activeLayers(state, section).map((id) => compileLayer(state, id, state.layers[id]!, rise, orbitOffset, opts));
  // filtro master (DJ filter é por orbit: aplicamos em todas as camadas, sempre, para resetar)
  const filter = section.filter ?? state.master.filter;
  const djf = rise ? rampExpr(rise, filter, Math.max(filter, 0.72)) : num(filter);
  return { bars: section.bars, layers, djf };
}

export function deckParts(state: SongState, orbitOffset = 0, wrap = '', opts: CompileOptions = {}): DeckParts {
  return { anchor: state.anchor, sections: state.arrangement.map((_, i) => sectionParts(state, i, orbitOffset, opts)), wrap };
}

/** A mixagem: o deck no ar ou, durante uma transição, os dois com os envelopes da transição. */
export function compileParts(mix: MixState, opts: CompileOptions = {}): MixParts {
  const t = mix.transition;
  if (!t) return { decks: [deckParts(mix.decks[mix.live], ORBIT_OFFSET[mix.live], '', opts)] };

  const def = TRANSITIONS_BY_ID[t.style];
  const abs = (env: Env) => `maestroEnv([${env.map(([x, v]) => `[${num(t.start + x * t.bars)}, ${num(v)}]`).join(', ')}])`;
  return {
    decks: audibleDecks(mix).map((id) => {
      const envs = id === t.from ? def.out : def.in;
      let wrap = `.postgain(${abs(envs.gain)})`;
      // filtro da transição substitui o do deck enquanto ela dura
      if (envs.filter) wrap += `.djf(${abs(envs.filter)})`;
      if (envs.room) wrap += `.room(${abs(envs.room)}).size(0.9)`;
      if (envs.delay) wrap += `.delay(${abs(envs.delay)}).delaytime(${num((3 / 16) * (240 / mix.decks[id].bpm))}).delayfeedback(0.7)`;
      return deckParts(mix.decks[id], ORBIT_OFFSET[id], wrap, opts);
    }),
  };
}

export function renderSection(p: SectionParts): string {
  return p.layers.length ? `stack(\n    ${p.layers.join(',\n    ')}\n  ).djf(${p.djf})` : 'silence';
}

export function renderDeck(d: DeckParts): string {
  const sections = d.sections.map((s) => `  [${s.bars}, ${renderSection(s)}]`);
  return `maestroArrange(${d.anchor}, [\n${sections.join(',\n')}\n])${d.wrap}`;
}

export function renderParts(parts: MixParts): string {
  const decks = parts.decks.map(renderDeck);
  return decks.length === 1 ? decks[0] : `stack(\n${decks.join(',\n')}\n)`;
}

export function compileSection(state: SongState, index: number, orbitOffset = 0): string {
  return renderSection(sectionParts(state, index, orbitOffset));
}

/** Um deck sozinho. */
export function compileDeck(state: SongState, orbitOffset = 0): string {
  return renderDeck(deckParts(state, orbitOffset));
}

/** A mixagem inteira como código (mesmo resultado que o engine monta a partir das partes). */
export function compile(mix: MixState, opts: CompileOptions = {}): string {
  return renderParts(compileParts(mix, opts));
}

function stripUndefined<T extends object>(o: T): Record<string, number> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Record<string, number>;
}
