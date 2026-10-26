import { INSTRUMENTS_BY_ID, instrumentsFor } from '../presets/instruments';
import { PATTERNS_BY_ID, patternsFor } from '../presets/patterns';
import { parseArrangement } from '../presets/sections';
import { STYLES_BY_ID } from '../presets/styles';
import { isDeckOp, type Op } from '../song/ops';
import { DECK_IDS, TRANSITION_STYLES, other, type DeckId, type MixState, type TransitionStyle } from '../song/mix';
import { TRANSITIONS, TRANSITIONS_BY_ID } from '../presets/transitions';
import type { When } from '../song/time';
import {
  LAYER_IDS,
  NOTE_NAMES,
  SCALES,
  SECTION_TYPES,
  type LayerId,
  type SectionType,
  type SongState,
} from '../song/types';

/**
 * /comandos diretos (determinísticos, sem IA). Texto sem "/" vai para a IA (Fase 2).
 * Sufixo opcional de tempo: @bar @phrase @section @drop @build … (padrão depende do comando).
 */

export type Command =
  | { kind: 'ops'; ops: Op[]; when: When; label: string; revertAfterBars?: number }
  | { kind: 'play'; style?: string }
  | { kind: 'stop' }
  | { kind: 'panic' }
  | { kind: 'undo' }
  | { kind: 'rec' }
  | { kind: 'target'; deck: DeckId }
  | { kind: 'auto'; autonomy?: number; ai?: boolean }
  | { kind: 'scene'; action: 'save' | 'recall' | 'list' | 'forget'; name?: string; deck: DeckId }
  | { kind: 'code' }
  | { kind: 'clear' }
  | { kind: 'info'; text: string }
  | { kind: 'natural'; text: string };

export class CommandError extends Error {}

const FX_PARAMS = ['lpf', 'hpf', 'room', 'delay', 'pan', 'distort'] as const;

export const HELP = `comandos (sufixo opcional @bar @phrase @section @<seção>, ex.: /key F minor @drop)
  /play [estilo]            tocar (${Object.keys(STYLES_BY_ID).join(', ')})
  /stop                     parar
  /style <estilo>           trocar o estilo do deck selecionado (padrão @section)
  /bpm <n> [rampa]          ex.: /bpm 132 8  (rampa em compassos)
  /key <nota> [escala]      ex.: /key F# minor · escalas: ${SCALES.join(', ')}
  /mute <camada> [compassos]   /unmute <camada>
  /gain <camada> <0-1.5>
  /pattern <camada> <id>    /inst <camada> <id>
  /add <camada> [padrão] [instrumento]   /remove <camada>
  /fx <camada> <${FX_PARAMS.join('|')}> <valor>
  /filter <0-1>             filtro master (0.5 neutro, <0.5 grave, >0.5 agudo)
  /reverb <0-1>   /volume <0-1.5>
  /mood dark <0-1>  ·  /mood energy <0-1>
  /arr intro:16 build:8 drop:32   novo arranjo (padrão @section)
  /insert build:8 drop:16   toca essas seções uma vez e volta ao arranjo (padrão @section)
  /goto <seção>             pular para a próxima seção desse tipo (padrão @phrase)
  /list styles | layers | transitions | patterns <camada> | insts <camada>
dois decks: os comandos valem para o deck selecionado (Tab ou /deck a|b troca)
  /deck a|b                 selecionar o deck que os comandos editam
cenas e código:
  /save <nome> [a|b]        guardar o deck como cena (fica no navegador)
  /recall <nome> [a|b]      carregar uma cena no deck (padrão: o que não está no ar) · /scenes · /forget <nome>
  /raw <camada> <código>    camada com código Strudel livre, ex.: /raw perc s("[~ cp]*2").bank("RolandTR808")
piloto automático:
  /auto <0-100>             autonomia (0 = desligado): até 30 detalhes · até 70 + camadas/estrutura · acima + tom, BPM e troca de música
  /auto off · /auto ia on|off (usar ou não a IA; sem ela, variações locais)
  /load <estilo> [a|b]      carregar um estilo no deck (padrão: o que não está no ar)
  /copy a b                 copiar um deck para o outro
  /xfade [compassos] [estilo] [from:<seção>]   transição para o outro deck (padrão @phrase)
      estilos: ${TRANSITION_STYLES.join(', ')} · ex.: /xfade 32 bass_swap · /xfade cut @drop
  /undo (ou Ctrl+Z)  desfaz o último comando/pedido · /panic (ou Esc) cancela tudo que está agendado
  /rec   começa/para a gravação (baixe WAV, MP3 e o registro da sessão no painel "gravações")
  /code  mostra o código Strudel   ·   /clear  limpa o log
camadas: ${LAYER_IDS.join(', ')} · seções: ${SECTION_TYPES.join(', ')}`;

export function parseCommand(input: string, mix: MixState, target: DeckId = mix.live): Command {
  const state = mix.decks[target];
  const text = input.trim();
  if (!text) throw new CommandError('vazio');
  if (!text.startsWith('/')) return { kind: 'natural', text };

  let tokens = text.slice(1).split(/\s+/);
  let when: When | undefined;
  const last = tokens[tokens.length - 1];
  if (last.startsWith('@')) {
    when = parseWhen(last.slice(1));
    tokens = tokens.slice(0, -1);
  }
  const [cmd, ...args] = tokens;
  // ops de deck vão para o deck selecionado (a não ser que já digam qual)
  const ops = (o: Op[], defaultWhen: When, label: string): Command => ({
    kind: 'ops',
    ops: o.map((op) => (isDeckOp(op) ? { ...op, deck: op.deck ?? target } : op)),
    when: when ?? defaultWhen,
    label: target === mix.live ? label : `[${target}] ${label}`,
  });

  switch (cmd.toLowerCase()) {
    case 'help':
    case 'h':
    case '?':
      return { kind: 'info', text: HELP };
    case 'play':
      if (args[0] && !STYLES_BY_ID[args[0]]) throw new CommandError(`estilo desconhecido: ${args[0]}`);
      return { kind: 'play', style: args[0] };
    case 'stop':
      return { kind: 'stop' };
    case 'panic':
      return { kind: 'panic' };
    case 'undo':
      return { kind: 'undo' };
    case 'rec':
    case 'record':
      return { kind: 'rec' };
    case 'code':
      return { kind: 'code' };
    case 'clear':
      return { kind: 'clear' };

    case 'style': {
      const style = STYLES_BY_ID[args[0]];
      if (!style) throw new CommandError(`estilo desconhecido: ${args[0] ?? ''} (${Object.keys(STYLES_BY_ID).join(', ')})`);
      return ops([{ op: 'load', state: style.build() }], { at: target === mix.live ? 'section' : 'bar' }, `estilo ${style.id}`);
    }
    case 'deck':
      return { kind: 'target', deck: deckArg(args[0]) };
    case 'raw': {
      const layer = layerId(args[0]);
      const code = args.slice(1).join(' ').trim();
      if (!code) throw new CommandError('use /raw <camada> <código strudel>, ex.: /raw perc s("[~ cp]*2").bank("RolandTR808").room(0.4)');
      return ops([{ op: 'set_raw', layer, code }], { at: 'bar' }, `${layer} = código`);
    }
    case 'save':
    case 'recall':
    case 'forget': {
      if (!args[0]) throw new CommandError(`use /${cmd} <nome>${cmd === 'forget' ? '' : ' [a|b]'}`);
      const action = cmd as 'save' | 'recall' | 'forget';
      return { kind: 'scene', action, name: args[0], deck: args[1] ? deckArg(args[1]) : action === 'recall' ? other(mix.live) : target };
    }
    case 'scenes':
      return { kind: 'scene', action: 'list', deck: target };
    case 'auto': {
      const a = (args[0] ?? '').toLowerCase();
      if (a === 'off') return { kind: 'auto', autonomy: 0 };
      if (a === 'ia' || a === 'ai') {
        const v = (args[1] ?? '').toLowerCase();
        if (v !== 'on' && v !== 'off') throw new CommandError('use /auto ia on ou /auto ia off');
        return { kind: 'auto', ai: v === 'on' };
      }
      if (!a) return { kind: 'auto' };
      return { kind: 'auto', autonomy: Math.round(number(a.replace('%', ''), 0, 100, 'autonomia')) };
    }
    case 'load': {
      const style = STYLES_BY_ID[args[0]];
      if (!style) throw new CommandError(`estilo desconhecido: ${args[0] ?? ''} (${Object.keys(STYLES_BY_ID).join(', ')})`);
      const d = args[1] ? deckArg(args[1]) : other(mix.live);
      const c = ops([{ op: 'load', state: style.build(), deck: d }], { at: d === mix.live ? 'section' : 'bar' }, `deck ${d} ← ${style.label}`);
      return { ...c, label: `deck ${d} ← ${style.label}` } as Command;
    }
    case 'copy': {
      const from = deckArg(args[0]);
      const to = deckArg(args[1] ?? other(from));
      return ops([{ op: 'copy_deck', from, to }], { at: 'bar' }, `copiar deck ${from} → ${to}`);
    }
    case 'xfade':
    case 'transition': {
      if (mix.transition) throw new CommandError('já existe uma transição em andamento');
      let bars: number | undefined;
      let style: TransitionStyle = 'filter_swap';
      let enterAt: SectionType | undefined;
      for (const a of args) {
        if (/^\d+$/.test(a)) bars = Math.round(number(a, 1, 128, 'compassos'));
        else if ((TRANSITION_STYLES as readonly string[]).includes(a)) style = a as TransitionStyle;
        else if (a.startsWith('from:')) enterAt = sectionType(a.slice(5));
        else if (/^[ab]$/i.test(a)) {
          if (deckArg(a) === mix.live) throw new CommandError(`o deck ${deckArg(a)} já está no ar`);
        } else throw new CommandError(`não entendi "${a}" (use /xfade [compassos] [${TRANSITION_STYLES.join('|')}] [from:<seção>])`);
      }
      bars ??= TRANSITIONS_BY_ID[style].defaultBars;
      const to = other(mix.live);
      return ops([{ op: 'transition', to, bars, style, enterAt }], { at: 'phrase' }, `transição ${style} ${mix.live}→${to} (${bars}c)`);
    }
    case 'bpm': {
      const bpm = number(args[0], 60, 200, 'BPM');
      const ramp = args[1] ? Math.round(number(args[1], 0, 64, 'rampa')) : undefined;
      return ops([{ op: 'set_bpm', bpm, rampBars: ramp }], { at: 'bar' }, `BPM ${bpm}${ramp ? ` (rampa ${ramp}c)` : ''}`);
    }
    case 'key': {
      const root = NOTE_NAMES.find((n) => n.toLowerCase() === (args[0] ?? '').toLowerCase());
      if (!root) throw new CommandError(`nota inválida: ${args[0] ?? ''}`);
      const scaleText = args.slice(1).join(' ').toLowerCase() || state.key.scale;
      const scale = SCALES.find((s) => s === scaleText);
      if (!scale) throw new CommandError(`escala inválida: ${scaleText} (${SCALES.join(', ')})`);
      return ops([{ op: 'set_key', key: { root, scale } }], { at: 'phrase' }, `tom ${root} ${scale}`);
    }
    case 'mute': {
      const layer = layerArg(args[0], state);
      const c = ops([{ op: 'mute', layer }], { at: 'bar' }, `mute ${layer}`);
      if (args[1] && c.kind === 'ops') {
        c.revertAfterBars = Math.round(number(args[1], 1, 128, 'compassos'));
        c.label += ` por ${c.revertAfterBars}c`;
      }
      return c;
    }
    case 'unmute': {
      const layer = layerArg(args[0], state);
      return ops([{ op: 'unmute', layer }], { at: 'bar' }, `unmute ${layer}`);
    }
    case 'gain': {
      const layer = layerArg(args[0], state);
      const gain = number(args[1], 0, 1.5, 'ganho');
      return ops([{ op: 'set_gain', layer, gain }], { at: 'bar' }, `${layer} ganho ${gain}`);
    }
    case 'pattern': {
      const layer = layerArg(args[0], state);
      const p = PATTERNS_BY_ID[args[1]];
      if (!p || p.layer !== layer) throw new CommandError(`padrão inválido para ${layer}. Opções: ${patternsFor(layer).map((x) => x.id).join(', ')}`);
      return ops([{ op: 'set_pattern', layer, pattern: p.id }], { at: 'bar' }, `${layer} → ${p.label}`);
    }
    case 'inst': {
      const layer = layerArg(args[0], state);
      const i = INSTRUMENTS_BY_ID[args[1]];
      if (!i || !i.layers.includes(layer)) throw new CommandError(`instrumento inválido para ${layer}. Opções: ${instrumentsFor(layer).map((x) => x.id).join(', ')}`);
      return ops([{ op: 'set_instrument', layer, instrument: i.id }], { at: 'bar' }, `${layer} → ${i.label}`);
    }
    case 'add': {
      const layer = layerId(args[0]);
      const pattern = args[1] ?? patternsFor(layer)[0].id;
      const instrument = args[2] ?? instrumentsFor(layer)[0].id;
      if (PATTERNS_BY_ID[pattern]?.layer !== layer) throw new CommandError(`padrão inválido para ${layer}. Opções: ${patternsFor(layer).map((x) => x.id).join(', ')}`);
      if (!INSTRUMENTS_BY_ID[instrument]?.layers.includes(layer)) throw new CommandError(`instrumento inválido para ${layer}. Opções: ${instrumentsFor(layer).map((x) => x.id).join(', ')}`);
      return ops([{ op: 'add_layer', layer, value: { instrument, pattern, gain: 1, muted: false, fx: {} } }], { at: 'bar' }, `+ ${layer} (${pattern}, ${instrument})`);
    }
    case 'remove': {
      const layer = layerArg(args[0], state);
      return ops([{ op: 'remove_layer', layer }], { at: 'bar' }, `- ${layer}`);
    }
    case 'fx': {
      const layer = layerArg(args[0], state);
      const param = FX_PARAMS.find((p) => p === args[1]);
      if (!param) throw new CommandError(`efeito inválido: ${args[1] ?? ''} (${FX_PARAMS.join(', ')})`);
      const limits: Record<typeof param, [number, number]> = { lpf: [40, 20000], hpf: [20, 10000], room: [0, 1], delay: [0, 1], pan: [0, 1], distort: [0, 5] };
      const value = number(args[2], ...limits[param], param);
      return ops([{ op: 'set_fx', layer, fx: { [param]: value } }], { at: 'bar' }, `${layer} ${param} ${value}`);
    }
    case 'filter':
      return ops([{ op: 'set_master', filter: number(args[0], 0, 1, 'filtro') }], { at: 'bar' }, `filtro master ${args[0]}`);
    case 'reverb':
      return ops([{ op: 'set_master', reverb: number(args[0], 0, 1, 'reverb') }], { at: 'bar' }, `reverb master ${args[0]}`);
    case 'volume':
      return ops([{ op: 'set_master', gain: number(args[0], 0, 1.5, 'volume') }], { at: 'bar' }, `volume ${args[0]}`);
    case 'mood': {
      const which = args[0];
      const v = number(args[1], 0, 1, 'mood');
      if (which === 'dark' || which === 'darkness') return ops([{ op: 'set_mood', darkness: v }], { at: 'phrase' }, `escuridão ${v}`);
      if (which === 'energy') return ops([{ op: 'set_mood', energy: v }], { at: 'phrase' }, `energia ${v}`);
      throw new CommandError('use /mood dark <0-1> ou /mood energy <0-1>');
    }
    case 'arr': {
      try {
        const sections = parseArrangement(args.join(' '));
        return ops([{ op: 'set_arrangement', sections }], { at: 'section' }, `arranjo ${args.join(' ')}`);
      } catch (e) {
        throw new CommandError((e as Error).message);
      }
    }
    case 'insert': {
      try {
        const sections = parseArrangement(args.join(' '));
        return ops([{ op: 'insert_sections', sections }], { at: 'section' }, `inserir ${args.join(' ')}`);
      } catch (e) {
        throw new CommandError((e as Error).message);
      }
    }
    case 'goto': {
      const section = sectionType(args[0]);
      if (!state.arrangement.some((s) => s.type === section)) throw new CommandError(`o arranjo não tem ${section}`);
      return ops([{ op: 'jump_to', section }], { at: 'phrase' }, `pular para ${section}`);
    }
    case 'list':
      return { kind: 'info', text: list(args, state) };
    default:
      throw new CommandError(`comando desconhecido: /${cmd} (digite /help)`);
  }
}

function parseWhen(s: string): When {
  if (s === 'bar' || s === 'now') return { at: 'bar' };
  if (s === 'phrase') return { at: 'phrase' };
  if (s === 'section') return { at: 'section' };
  if ((SECTION_TYPES as readonly string[]).includes(s)) return { at: 'section_type', type: s as SectionType };
  throw new CommandError(`quando inválido: @${s} (@bar, @phrase, @section, @${SECTION_TYPES.join(', @')})`);
}

function list(args: string[], state: SongState): string {
  const [what, l] = args;
  if (what === 'styles') return Object.values(STYLES_BY_ID).map((s) => `${s.id.padEnd(9)} ${s.description}`).join('\n');
  if (what === 'layers') return LAYER_IDS.map((id) => `${id.padEnd(7)} ${state.layers[id] ? `${state.layers[id]!.instrument} · ${state.layers[id]!.pattern}` : '—'}`).join('\n');
  if (what === 'patterns') return patternsFor(layerId(l)).map((p) => `${p.id.padEnd(15)} ${p.label}`).join('\n');
  if (what === 'transitions') return TRANSITIONS.map((t) => `${t.id.padEnd(12)} ${String(t.defaultBars).padStart(2)}c  ${t.description}`).join('\n');
  if (what === 'insts') return instrumentsFor(layerId(l)).map((i) => `${i.id.padEnd(12)} ${i.label}`).join('\n');
  throw new CommandError('use /list styles | layers | transitions | patterns <camada> | insts <camada>');
}

function deckArg(s: string | undefined): DeckId {
  const d = DECK_IDS.find((x) => x === s?.toUpperCase());
  if (!d) throw new CommandError(`deck inválido: ${s ?? ''} (a ou b)`);
  return d;
}

function layerId(s: string | undefined): LayerId {
  const id = LAYER_IDS.find((l) => l === s);
  if (!id) throw new CommandError(`camada inválida: ${s ?? ''} (${LAYER_IDS.join(', ')})`);
  return id;
}

function layerArg(s: string | undefined, state: SongState): LayerId {
  const id = layerId(s);
  if (!state.layers[id]) throw new CommandError(`a camada ${id} não está no deck (use /add ${id})`);
  return id;
}

function sectionType(s: string | undefined): SectionType {
  const t = SECTION_TYPES.find((x) => x === s);
  if (!t) throw new CommandError(`seção inválida: ${s ?? ''} (${SECTION_TYPES.join(', ')})`);
  return t;
}

function number(s: string | undefined, min: number, max: number, what: string): number {
  const n = Number(s?.replace(',', '.'));
  if (s === undefined || Number.isNaN(n)) throw new CommandError(`${what}: informe um número`);
  if (n < min || n > max) throw new CommandError(`${what}: entre ${min} e ${max}`);
  return n;
}
