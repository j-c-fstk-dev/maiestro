import type { Conductor } from '../conductor/conductor';
import type { Timeline } from '../scheduler/timeline';
import { PHRASE_BARS } from '../song/time';
import { other, liveDeck } from '../song/mix';
import { OpError } from '../song/ops';
import { localMove, localRotation, type Move, type Rng, type Tier } from './moves';

/**
 * Piloto automático. A cada frase (8 compassos), com chance proporcional à autonomia,
 * faz UMA mudança do tamanho permitido pelo nível. Com autonomia alta, também troca de
 * música sozinho (prepara o outro deck e faz a transição) depois de um tempo.
 *
 * Primeiro tenta a IA (com as ops restritas ao nível); se ela falhar, estiver sem chave,
 * no limite de taxa ou dentro do intervalo mínimo entre chamadas, usa um movimento local.
 * Nunca atropela o usuário: fica quieto se ele mexeu há pouco ou tem mudança dele agendada.
 */

export interface AutopilotEvent {
  kind: 'ai' | 'local' | 'error';
  text: string;
  rotation?: boolean;
}

export interface AutopilotStats {
  aiMoves: number;
  localMoves: number;
  aiTokens: number;
  rotations: number;
}

export interface AutopilotOptions {
  rng?: Rng;
  /** relógio em ms (para o intervalo mínimo entre chamadas à IA) */
  clock?: () => number;
  /** intervalo mínimo entre chamadas à IA, em segundos (limite dos modelos grátis) */
  minAiIntervalSec?: number;
  /** usar a IA (false = só movimentos locais) */
  useAi?: boolean;
  onEvent?: (e: AutopilotEvent) => void;
}

const TIER_OPS: Record<Tier, string[]> = {
  micro: ['set_pattern', 'mute', 'unmute', 'set_fx', 'set_master', 'set_gain'],
  medium: ['set_pattern', 'mute', 'unmute', 'set_fx', 'set_master', 'set_gain', 'add_layer', 'remove_layer', 'set_instrument', 'insert_sections', 'set_mood', 'jump_to'],
  large: [
    'set_pattern', 'mute', 'unmute', 'set_fx', 'set_master', 'set_gain', 'add_layer', 'remove_layer', 'set_instrument',
    'insert_sections', 'set_mood', 'jump_to', 'set_key', 'set_bpm', 'load_style', 'copy_deck', 'transition',
  ],
};

const TIER_TEXT: Record<Tier, string> = {
  micro: 'PEQUENA (um detalhe: padrão de chimbal/percussão, tirar uma camada por alguns compassos, filtro ou efeito)',
  medium: 'MÉDIA (pode trocar timbre, entrar/sair camada, inserir build/drop ou breakdown, mudar o mood)',
  large: 'GRANDE (pode mudar tom, BPM, mood e estrutura — mantendo a música coerente)',
};

export const tierOf = (autonomy: number): Tier | null =>
  autonomy <= 0 ? null : autonomy <= 30 ? 'micro' : autonomy <= 70 ? 'medium' : 'large';

/** Chance de agir em cada frase: 100% de autonomia ≈ uma mudança a cada 2 frases. */
const chancePerPhrase = (autonomy: number) => (autonomy / 100) * 0.5;

/** Quanto tempo (compassos) uma música fica no ar antes do piloto trocar (só no nível grande). */
const SONG_BARS: [number, number] = [96, 160];

/** Falhas seguidas da IA até o piloto desistir dela (ex.: sem chave). */
const MAX_AI_FAILURES = 3;

/** Compassos de silêncio do piloto depois de uma ação do usuário. */
const USER_QUIET_BARS = 16;

export class Autopilot {
  autonomy = 0;
  readonly stats: AutopilotStats = { aiMoves: 0, localMoves: 0, aiTokens: 0, rotations: 0 };
  busy = false;
  private lastPhrase = -1;
  private lastUserCycle = -Infinity;
  private lastAiAt = -Infinity;
  private liveDeckId: string | null = null;
  private liveSince = 0;
  private songBars = 128;
  private recent: string[] = [];
  private aiFailures = 0;
  private rng: Rng;
  private clock: () => number;
  private opts: AutopilotOptions;

  constructor(
    private timeline: Timeline,
    private conductor: Conductor | null,
    opts: AutopilotOptions = {},
  ) {
    this.opts = opts;
    this.rng = opts.rng ?? Math.random;
    this.clock = opts.clock ?? (() => Date.now());
    this.songBars = this.pickSongBars();
  }

  set useAi(v: boolean) {
    this.opts.useAi = v;
    if (v) this.aiFailures = 0;
  }

  get useAi() {
    return this.opts.useAi !== false && !!this.conductor;
  }

  /** Avise quando o usuário mexer (comando, pedido, clique). */
  noteUser() {
    this.lastUserCycle = this.timeline.now();
  }

  /** Chamar com frequência. Decide no máximo uma vez por frase. */
  async tick(): Promise<void> {
    const tier = tierOf(this.autonomy);
    if (!tier || !this.timeline.playing || this.busy) return;
    const now = this.timeline.now();
    const mix = this.timeline.state;

    if (mix.live !== this.liveDeckId) {
      this.liveDeckId = mix.live;
      this.liveSince = now;
      this.songBars = this.pickSongBars();
    }

    // decide no compasso 1–2 da frase: dá tempo da IA responder antes do próximo limite
    const phrase = Math.floor(now / PHRASE_BARS);
    const inPhrase = now - phrase * PHRASE_BARS;
    if (phrase === this.lastPhrase || inPhrase < 1 || inPhrase > 3) return;
    this.lastPhrase = phrase;

    if (mix.transition) return;
    const snap = this.timeline.snapshot();
    if (now - this.lastUserCycle < USER_QUIET_BARS) return;
    if (snap.pending.some((e) => e.source !== 'autopilot')) return;
    if (snap.pending.some((e) => e.ops.some((o) => o.op === 'transition'))) return;

    const rotate = tier === 'large' && now - this.liveSince > this.songBars;
    if (!rotate && this.rng() > chancePerPhrase(this.autonomy)) return;

    this.busy = true;
    try {
      if (rotate) await this.rotate();
      else await this.vary(tier);
    } finally {
      this.busy = false;
    }
  }

  private async vary(tier: Tier) {
    if (this.canCallAi()) {
      const ok = await this.askAi(
        `[PILOTO AUTOMÁTICO · autonomia ${this.autonomy}%] Faça UMA mudança ${TIER_TEXT[tier]} que mantenha a música interessante e coerente com o estilo do deck no ar.
Use "when" = "phrase" ou "section". Para mudanças passageiras, use "forBars". Não mexa no deck fora do ar.
Mudanças recentes do piloto (não repita): ${this.recent.join(' | ') || 'nenhuma'}.`,
        tier,
        false,
      );
      if (ok) return;
    }
    const move = localMove(tier, this.timeline.state, this.rng);
    if (move) await this.applyLocal([move], false);
  }

  private async rotate() {
    const mix = this.timeline.state;
    const off = other(mix.live);
    if (this.canCallAi()) {
      const ok = await this.askAi(
        `[PILOTO AUTOMÁTICO · autonomia ${this.autonomy}%] Hora de trocar de música. Prepare no deck ${off} uma música nova
(load_style com um estilo diferente de "${liveDeck(mix).style}", mais 1 a 3 ajustes com "deck":"${off}") e faça a transição
para ele com "when":"section" e um estilo de transição adequado ao clima.`,
        'large',
        true,
      );
      if (ok) return;
    }
    await this.applyLocal(localRotation(mix, this.rng), true);
  }

  private canCallAi() {
    const min = (this.opts.minAiIntervalSec ?? 20) * 1000;
    return this.useAi && this.clock() - this.lastAiAt >= min;
  }

  private async askAi(text: string, tier: Tier, rotation: boolean): Promise<boolean> {
    this.lastAiAt = this.clock();
    try {
      const r = await this.conductor!.ask(text, { source: 'autopilot', allowedOps: new Set(TIER_OPS[tier]), remember: false });
      if (!r.scheduled.length) return false;
      this.aiFailures = 0;
      this.stats.aiMoves++;
      this.stats.aiTokens += r.tokens;
      if (rotation) this.stats.rotations++;
      this.remember(r.scheduled.map((s) => s.label).join(' + '));
      this.opts.onEvent?.({ kind: 'ai', text: r.reply || r.scheduled.map((s) => s.label).join(', '), rotation });
      return true;
    } catch (err) {
      this.aiFailures++;
      const giveUp = this.aiFailures >= MAX_AI_FAILURES;
      if (giveUp) this.opts.useAi = false;
      this.opts.onEvent?.({
        kind: 'error',
        text: giveUp
          ? `a IA falhou ${MAX_AI_FAILURES} vezes seguidas (${(err as Error).message.slice(0, 100)}); o piloto segue só com variações locais (/auto ia on para tentar de novo)`
          : `IA indisponível para o piloto (${(err as Error).message.slice(0, 120)}); usando variação local`,
      });
      return false;
    }
  }

  private async applyLocal(moves: Move[], rotation: boolean) {
    const group = this.timeline.newGroup();
    try {
      for (const m of moves) {
        await this.timeline.schedule(m.ops, m.when, m.label, { source: 'autopilot', group, revertAfterBars: m.revertAfterBars });
      }
    } catch (err) {
      await this.timeline.cancelGroup(group);
      if (err instanceof OpError) return; // movimento não coube no estado atual; tenta na próxima frase
      throw err;
    }
    this.stats.localMoves++;
    if (rotation) this.stats.rotations++;
    const label = moves.map((m) => m.label).join(' + ');
    this.remember(label);
    this.opts.onEvent?.({ kind: 'local', text: label, rotation });
  }

  private remember(label: string) {
    this.recent = [...this.recent, label].slice(-4);
  }

  private pickSongBars() {
    const [a, b] = SONG_BARS;
    return Math.round((a + this.rng() * (b - a)) / PHRASE_BARS) * PHRASE_BARS;
  }
}
