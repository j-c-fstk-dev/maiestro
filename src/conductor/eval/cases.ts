import type { AskResult } from '../conductor';
import type { AiOp, AiPlan } from '../schema';
import type { Timeline } from '../../scheduler/timeline';
import type { Op } from '../../song/ops';

/**
 * Pedidos de teste do maestro. Cada caso diz o que a resposta precisa conter.
 * Rodam contra um techno tocando no compasso 45 (drop, compasso 6 de 32).
 * Para rodar com a IA de verdade: `npm run eval:ai`.
 */

export interface EvalCase {
  name: string;
  prompt: string;
  /** prepara o estado antes do pedido (ops aplicadas já) */
  setup?: Op[];
  /** agenda algo antes do pedido (para "desfaz") */
  pendingSetup?: Op[];
  check: (r: AskResult, tl: Timeline) => string | null;
}

type Flat = AiOp & { plan: AiPlan; index: number };
const flat = (r: AskResult): Flat[] => r.response.plans.flatMap((plan, index) => plan.ops.map((op) => ({ ...op, plan, index })));
const find = (r: AskResult, pred: (o: Flat) => boolean) => flat(r).find(pred);
const need = (cond: unknown, msg: string) => (cond ? null : msg);
const all = (...checks: (string | null)[]) => checks.filter(Boolean).join('; ') || null;

const hasOp = (r: AskResult, op: string, layer?: string) => find(r, (o) => o.op === op && (!layer || ('layer' in o && o.layer === layer)));
const muteOrRemove = (r: AskResult, layer: string) => hasOp(r, 'mute', layer) ?? hasOp(r, 'remove_layer', layer) ?? hasOp(r, 'set_gain', layer);
const darker = (r: AskResult) =>
  find(r, (o) => (o.op === 'set_mood' && (o.darkness ?? 0) > 0.4) || (o.op === 'set_key' && ['minor', 'phrygian', 'harmonic minor'].includes(o.scale)) || (o.op === 'set_master' && (o.filter ?? 0.5) < 0.5));

export const CASES: EvalCase[] = [
  { name: 'tirar beat por N', prompt: 'tira o beat por 8 compassos', check: (r) => {
    const m = hasOp(r, 'mute', 'kick');
    return all(need(m, 'não mutou o kick'), need(m?.plan.forBars === 8 || hasOp(r, 'unmute', 'kick'), 'não volta depois de 8'));
  } },
  { name: 'voltar beat', prompt: 'volta o beat', setup: [{ op: 'mute', layer: 'kick' }], check: (r) => need(hasOp(r, 'unmute', 'kick'), 'não desmutou o kick') },
  { name: 'sombrio', prompt: 'deixa mais sombrio', check: (r) => need(darker(r), 'nada ficou mais escuro') },
  { name: 'alegre', prompt: 'deixa mais alegre', check: (r) =>
    need(find(r, (o) => (o.op === 'set_mood' && (o.darkness ?? 1) < 0.4) || (o.op === 'set_key' && ['major', 'lydian', 'mixolydian', 'major pentatonic'].includes(o.scale))), 'nada ficou mais alegre') },
  { name: 'bpm exato', prompt: 'acelera pra 135', check: (r) => need(find(r, (o) => o.op === 'set_bpm' && o.bpm === 135), 'não foi para 135') },
  { name: 'bpm com rampa', prompt: 'acelera aos poucos pra 140 ao longo de 16 compassos', check: (r) =>
    need(find(r, (o) => o.op === 'set_bpm' && o.bpm === 140 && o.rampBars === 16), 'faltou bpm 140 com rampa 16') },
  { name: 'bpm relativo', prompt: 'um pouco mais rápido', check: (r) => need(find(r, (o) => o.op === 'set_bpm' && o.bpm > 128 && o.bpm <= 140), 'BPM não subiu um pouco') },
  { name: 'build e drop', prompt: 'faz um build e um drop', check: (r) => {
    const ins = find(r, (o) => o.op === 'insert_sections');
    const types = ins && ins.op === 'insert_sections' ? ins.sections.map((s) => s.type) : [];
    return need(types.includes('build') && types.includes('drop') && types.indexOf('build') < types.indexOf('drop'), `seções inseridas: ${types.join(',') || 'nenhuma'}`);
  } },
  { name: 'breakdown na próxima seção', prompt: 'na próxima seção faz um breakdown', check: (r) => {
    const o = find(r, (x) => (x.op === 'insert_sections' && x.sections[0].type === 'breakdown') || (x.op === 'jump_to' && x.section === 'breakdown'));
    return all(need(o, 'sem breakdown'), need(o && o.plan.when === 'section', `quando = ${JSON.stringify(o?.plan.when)}`));
  } },
  { name: 'voz etérea', prompt: 'coloca uma voz feminina etérea', check: (r) => need(hasOp(r, 'add_layer', 'vocal'), 'não adicionou vocal') },
  { name: 'tirar baixo', prompt: 'tira o baixo', check: (r) => need(muteOrRemove(r, 'bass'), 'baixo continua') },
  { name: 'trocar timbre', prompt: 'troca o baixo por um acid', check: (r) => need(find(r, (o) => o.op === 'set_instrument' && o.layer === 'bass' && o.instrument === 'acid'), 'baixo não virou acid') },
  { name: 'padrão de chimbal', prompt: 'coloca o chimbal só no contratempo', check: (r) =>
    need(find(r, (o) => o.op === 'set_pattern' && o.layer === 'hats' && ['offbeat', 'open_offbeat'].includes(o.pattern)), 'chimbal não foi pro contratempo') },
  { name: 'abafar', prompt: 'abafa tudo', check: (r) => need(find(r, (o) => o.op === 'set_master' && (o.filter ?? 0.5) < 0.5), 'filtro master não abaixou') },
  { name: 'abrir filtro', prompt: 'abre o filtro de novo', setup: [{ op: 'set_master', filter: 0.3 }], check: (r) =>
    need(find(r, (o) => o.op === 'set_master' && (o.filter ?? 0) >= 0.5), 'filtro não voltou') },
  { name: 'tom exato', prompt: 'muda o tom pra ré menor', check: (r) => need(find(r, (o) => o.op === 'set_key' && o.root === 'D' && o.scale === 'minor'), 'não foi para D minor') },
  { name: 'tom no drop', prompt: 'no próximo drop muda pra fá frígio', check: (r) => {
    const o = find(r, (x) => x.op === 'set_key' && x.root === 'F' && x.scale === 'phrygian');
    return all(need(o, 'não foi para F phrygian'), need(o && typeof o.plan.when === 'object' && 'section' in o.plan.when && o.plan.when.section === 'drop', 'não esperou o drop'));
  } },
  { name: 'reverb numa camada', prompt: 'mais reverb no lead', check: (r) => need(find(r, (o) => o.op === 'set_fx' && o.layer === 'lead' && (o.room ?? 0) > 0), 'sem room no lead') },
  { name: 'delay numa camada', prompt: 'coloca um delay no lead', check: (r) => need(find(r, (o) => o.op === 'set_fx' && o.layer === 'lead' && (o.delay ?? 0) > 0), 'sem delay no lead') },
  { name: 'mais energia', prompt: 'mais energia!', check: (r) =>
    need(find(r, (o) => (o.op === 'set_mood' && (o.energy ?? 0) > 0.7) || (o.op === 'set_bpm' && o.bpm > 128) || o.op === 'set_pattern'), 'energia não subiu') },
  { name: 'mais calmo', prompt: 'deixa mais calmo', check: (r) =>
    need(find(r, (o) => (o.op === 'set_mood' && (o.energy ?? 1) < 0.7) || (o.op === 'set_bpm' && o.bpm < 128) || o.op === 'mute' || (o.op === 'set_master' && (o.filter ?? 0.5) < 0.5)), 'nada acalmou') },
  { name: 'pular seção', prompt: 'pula pro breakdown', check: (r) =>
    need(find(r, (o) => (o.op === 'jump_to' && o.section === 'breakdown') || (o.op === 'insert_sections' && o.sections[0].type === 'breakdown')), 'não foi pro breakdown') },
  { name: 'mute temporário de acordes', prompt: 'tira os acordes por 16 compassos', check: (r) => {
    const m = hasOp(r, 'mute', 'chords');
    return all(need(m, 'acordes não mutaram'), need(m?.plan.forBars === 16 || hasOp(r, 'unmute', 'chords'), 'não volta depois de 16'));
  } },
  { name: 'volume de camada +', prompt: 'aumenta o volume do kick', check: (r) => need(find(r, (o) => o.op === 'set_gain' && o.layer === 'kick' && o.gain > 1), 'kick não subiu') },
  { name: 'volume de camada -', prompt: 'abaixa um pouco o lead', check: (r) => need(find(r, (o) => o.op === 'set_gain' && o.layer === 'lead' && o.gain < 1), 'lead não desceu') },
  { name: 'remover camada', prompt: 'remove a percussão', check: (r) => need(muteOrRemove(r, 'perc'), 'percussão continua') },
  { name: 'arpejo', prompt: 'quero um arpejo no lead', check: (r) =>
    need(find(r, (o) => (o.op === 'set_pattern' && o.pattern === 'arp_up') || (o.op === 'add_layer' && o.pattern === 'arp_up')), 'sem arpejo') },
  { name: 'desfazer', prompt: 'desfaz isso', pendingSetup: [{ op: 'mute', layer: 'bass' }], check: (r, tl) =>
    all(need(r.response.undo, 'não pediu undo'), need(!tl.snapshot().pending.some((e) => e.label === 'setup'), 'a mudança anterior continua agendada')) },
  { name: 'pedido completo (o exemplo do projeto)', prompt: 'na próxima seção da música tira a batida por alguns instantes, coloca um efeito etéreo de voz feminina, faz um build e um drop e muda o tom para algo mais sombrio e pesado', check: (r) => {
    const ins = find(r, (o) => o.op === 'insert_sections');
    const types = ins && ins.op === 'insert_sections' ? ins.sections.map((s) => s.type) : [];
    return all(
      need(hasOp(r, 'mute', 'kick'), 'beat não saiu'),
      need(hasOp(r, 'add_layer', 'vocal'), 'sem vocal'),
      need(types.includes('build') && types.includes('drop'), 'sem build+drop'),
      need(darker(r), 'não escureceu'),
    );
  } },
  { name: 'instrumento que não existe', prompt: 'coloca uma guitarra distorcida', check: (r) => need(r.reply.length > 0, 'sem resposta') },
  { name: 'pedido vago', prompt: 'surpreenda', check: (r) => need(flat(r).length >= 1, 'nenhuma mudança') },
  { name: 'relativo a agora', prompt: 'daqui a 8 compassos tira o chimbal', check: (r, tl) => {
    const m = hasOp(r, 'mute', 'hats');
    const entry = tl.snapshot().pending.find((e) => e.ops.some((o) => o.op === 'mute' && o.layer === 'hats'));
    return all(need(m, 'chimbal não mutou'), need(entry && entry.cycle >= 52 && entry.cycle <= 54, `entrou no compasso ${entry?.cycle} (esperado ~53)`));
  } },
  // dois decks
  { name: 'preparar outro deck', prompt: 'prepara um melodic techno no outro deck', check: (r) => {
    const load = find(r, (o) => o.op === 'load_style' && o.style === 'melodic');
    return all(need(load, 'não carregou melodic'), need(load && load.op === 'load_style' && load.deck === 'B', 'não foi no deck B'));
  } },
  { name: 'transição com estilo', prompt: 'faz a transição pro outro deck em 32 compassos trocando os graves', check: (r) =>
    need(find(r, (o) => o.op === 'transition' && o.style === 'bass_swap' && (o.bars ?? 32) === 32), 'sem transição bass_swap de 32') },
  { name: 'preparar e mixar', prompt: 'prepara um house no outro deck, um pouco mais lento, e na próxima seção mixa pra ele', check: (r, tl) => {
    const load = find(r, (o) => o.op === 'load_style' && o.style === 'house');
    const tr = find(r, (o) => o.op === 'transition');
    const b = tl.stateAt(Infinity).decks.B;
    return all(need(load, 'não carregou house'), need(tr, 'sem transição'), need(b.bpm < 124 || find(r, (o) => o.op === 'set_bpm' && o.deck === 'B'), 'BPM do B não baixou'));
  } },
];

export { flat };
