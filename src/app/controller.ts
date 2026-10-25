import { create } from 'zustand';
import { StrudelEngine } from '../engine/strudelEngine';
import { Timeline, type TimelineSnapshot } from '../scheduler/timeline';
import { STYLES, STYLES_BY_ID } from '../presets/styles';
import { CommandError, HELP, parseCommand } from '../commands/parse';
import { OpError } from '../song/ops';
import type { LayerId } from '../song/types';
import { Conductor, ConductorError } from '../conductor/conductor';
import { chat } from '../conductor/llmClient';

/** Liga motor + linha do tempo + estado da UI. Uma instância por página. */

export type LogKind = 'info' | 'ok' | 'warn' | 'err' | 'cmd' | 'ai';
export interface LogLine {
  id: number;
  time: string;
  kind: LogKind;
  text: string;
}

interface UiState {
  snap: TimelineSnapshot;
  log: LogLine[];
  showCode: boolean;
  loading: boolean;
  /** pedido que o maestro está processando */
  thinking: string | null;
}

let logId = 0;

export const engine = new StrudelEngine({
  onError: (err) => log(`erro no código (a música continua): ${err.message}`, 'err'),
});

export const timeline = new Timeline(engine, STYLES[0].build(), {
  onError: (msg) => log(msg, 'err'),
  onApplied: (e) => log(`▸ ${e.label}`, 'ai'),
});

export const useUi = create<UiState>(() => ({
  snap: timeline.snapshot(),
  log: [],
  showCode: false,
  loading: false,
  thinking: null,
}));

export const conductor = new Conductor(timeline, chat);

timeline.subscribe((snap) => useUi.setState({ snap }));
setInterval(() => timeline.tick(), 50);

export function log(text: string, kind: LogKind = 'info') {
  const bar = engine.isPlaying ? `c${Math.max(0, Math.floor(engine.now()))} ` : '';
  const line: LogLine = { id: ++logId, time: new Date().toLocaleTimeString('pt-BR'), kind, text: bar + text };
  useUi.setState((s) => ({ log: [...s.log.slice(-300), line] }));
}

export async function play(styleId?: string) {
  const style = styleId ? STYLES_BY_ID[styleId] : undefined;
  useUi.setState({ loading: true });
  try {
    await timeline.play(style ? style.build() : timeline.state);
    log(`▶ ${timeline.state.name} · ${timeline.state.bpm} BPM · ${timeline.state.key.root} ${timeline.state.key.scale}`, 'ok');
  } finally {
    useUi.setState({ loading: false });
  }
}

export function stop() {
  timeline.stop();
  log('■ parado');
}

export function togglePlay() {
  if (engine.isPlaying) stop();
  else void play();
}

export function panic() {
  const n = timeline.snapshot().pending.length;
  timeline.panic();
  log(n ? `pânico: ${n} mudança(s) agendada(s) cancelada(s)` : 'pânico: nada agendado', 'warn');
}

/** Carrega um estilo no deck parado (para ajustar antes de tocar). */
export function loadStyle(styleId: string) {
  const style = STYLES_BY_ID[styleId];
  if (!style) return;
  if (engine.isPlaying) {
    void run(`/style ${styleId}`);
    return;
  }
  void timeline.schedule([{ op: 'load', state: style.build() }], { at: 'bar' }, `estilo ${styleId}`);
  log(`deck carregado: ${style.label} — ${style.description}`);
}

export function toggleMute(layer: LayerId) {
  const l = timeline.stateAt(Infinity).layers[layer];
  if (!l) return;
  void run(`/${l.muted ? 'unmute' : 'mute'} ${layer}`);
}

/** Executa uma linha do prompt. */
export async function run(input: string) {
  const text = input.trim();
  if (!text) return;
  log(text, 'cmd');
  try {
    // comandos usam o estado mais recente (incluindo o que já está agendado)
    const cmd = parseCommand(text, timeline.stateAt(Infinity));
    switch (cmd.kind) {
      case 'natural':
        return ask(cmd.text);
      case 'undo':
        return undo();
      case 'info':
        log(cmd.text);
        return;
      case 'play':
        return play(cmd.style);
      case 'stop':
        return stop();
      case 'panic':
        return panic();
      case 'code':
        useUi.setState((s) => ({ showCode: !s.showCode }));
        return;
      case 'clear':
        useUi.setState({ log: [] });
        return;
      case 'ops': {
        const cycle = await timeline.schedule(cmd.ops, cmd.when, cmd.label, { revertAfterBars: cmd.revertAfterBars });
        if (cycle === null) {
          log(`ok: ${cmd.label}`, 'ok');
          return;
        }
        log(`agendado p/ compasso ${cycle} (${describeWait(cycle)}): ${cmd.label}`, 'ok');
        if (cmd.revertAfterBars) log(`volta no compasso ${cycle + cmd.revertAfterBars}`, 'ok');
        return;
      }
    }
  } catch (err) {
    if (err instanceof CommandError || err instanceof OpError) log(err.message, 'err');
    else {
      console.error(err);
      log(`erro inesperado: ${(err as Error).message}`, 'err');
    }
  }
}

export async function undo() {
  const msg = await timeline.undo();
  log(msg ?? 'nada para desfazer', msg ? 'warn' : 'info');
}

/** Pedido em linguagem natural → maestro. Um de cada vez; a música não espera por ele. */
async function ask(text: string) {
  if (useUi.getState().thinking) {
    log('o maestro ainda está pensando no pedido anterior — espere um instante (ou use /comandos)', 'warn');
    return;
  }
  useUi.setState({ thinking: text });
  try {
    const r = await conductor.ask(text);
    if (r.undone) log(r.undone, 'warn');
    log(`maestro: ${r.reply || '(sem comentário)'}`, 'ai');
    for (const s of r.scheduled) {
      log(s.cycle === null ? `  · ${s.label}` : `  · compasso ${s.cycle} (${describeWait(s.cycle)}): ${s.label}`, 'ai');
    }
    const retry = r.attempts > 1 ? ` · ${r.attempts} tentativas` : '';
    log(`  ${r.model} · ${(r.latencyMs / 1000).toFixed(1)}s · ${r.tokens} tokens${retry}`, 'info');
  } catch (err) {
    if (err instanceof ConductorError) log(`o maestro não conseguiu montar um plano válido (${err.message}). Nada mudou.`, 'err');
    else log(`falha ao falar com a IA (a música não é afetada): ${(err as Error).message}`, 'err');
  } finally {
    useUi.setState({ thinking: null });
  }
}

function describeWait(cycle: number) {
  const bars = cycle - engine.now();
  const secs = bars * engine.secondsPerCycle();
  return `em ${secs.toFixed(1)}s`;
}

log('MAESTRO · escolha um estilo e dê play. Fale com o maestro em português ou use /comandos (/help).');
log('atalhos: Espaço = play/stop · Esc = cancela o agendado · Ctrl+Z = desfaz');
export { HELP };
