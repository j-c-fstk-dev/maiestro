import { create } from 'zustand';
import { StrudelEngine } from '../engine/strudelEngine';
import { Timeline, type TimelineSnapshot } from '../scheduler/timeline';
import { STYLES, STYLES_BY_ID } from '../presets/styles';
import { CommandError, HELP, parseCommand } from '../commands/parse';
import { OpError } from '../song/ops';
import type { LayerId } from '../song/types';
import { Conductor, ConductorError } from '../conductor/conductor';
import { chat } from '../conductor/llmClient';
import { Recorder } from '../recorder/recorder';
import { SessionLog, type SessionFile } from '../recorder/sessionLog';
import { encodeWav } from '../recorder/wav';
import { encodeMp3 } from '../recorder/mp3';
import type { PcmData } from '../recorder/pcm';

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
  /** gravação em andamento */
  rec: { seconds: number; bytes: number; peak: number } | null;
  recordings: Recording[];
}

export interface Recording {
  id: number;
  name: string;
  seconds: number;
  pcm: PcmData;
  session: SessionFile;
  mp3?: Blob;
  /** 0..1 enquanto o MP3 está sendo gerado */
  mp3Progress?: number;
  silent: boolean;
}

let logId = 0;

export const engine = new StrudelEngine({
  onError: (err) => log(`erro no código (a música continua): ${err.message}`, 'err'),
});

export const timeline = new Timeline(engine, STYLES[0].build(), {
  onError: (msg) => log(msg, 'err'),
  onApplied: (e) => {
    log(`▸ ${e.label}`, 'ai');
    session({ type: 'applied', cycle: e.cycle, label: e.label, source: e.source, ops: e.ops });
  },
});

export const useUi = create<UiState>(() => ({
  snap: timeline.snapshot(),
  log: [],
  showCode: false,
  loading: false,
  thinking: null,
  rec: null,
  recordings: [],
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
    session({ type: 'transport', action: 'play', state: timeline.state });
    log(`▶ ${timeline.state.name} · ${timeline.state.bpm} BPM · ${timeline.state.key.root} ${timeline.state.key.scale}`, 'ok');
  } finally {
    useUi.setState({ loading: false });
  }
}

export function stop() {
  timeline.stop();
  session({ type: 'transport', action: 'stop' });
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
  if (text.startsWith('/') && !/^\/rec(ord)?\b/.test(text)) session({ type: 'command', text });
  try {
    // comandos usam o estado mais recente (incluindo o que já está agendado)
    const cmd = parseCommand(text, timeline.stateAt(Infinity));
    switch (cmd.kind) {
      case 'natural':
        return ask(cmd.text);
      case 'undo':
        return undo();
      case 'rec':
        return toggleRecording();
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
    session({ type: 'prompt', text, reply: r.reply });
    if (r.undone) log(r.undone, 'warn');
    log(`maestro: ${r.reply || '(sem comentário)'}`, 'ai');
    for (const s of r.scheduled) {
      log(s.cycle === null ? `  · ${s.label}` : `  · compasso ${s.cycle} (${describeWait(s.cycle)}): ${s.label}`, 'ai');
    }
    const retry = r.attempts > 1 ? ` · ${r.attempts} tentativas` : '';
    log(`  ${r.model} · ${(r.latencyMs / 1000).toFixed(1)}s · ${r.tokens} tokens${retry}`, 'info');
  } catch (err) {
    session({ type: 'prompt', text, error: (err as Error).message });
    if (err instanceof ConductorError) log(`o maestro não conseguiu montar um plano válido (${err.message}). Nada mudou.`, 'err');
    else log(`falha ao falar com a IA (a música não é afetada): ${(err as Error).message}`, 'err');
  } finally {
    useUi.setState({ thinking: null });
  }
}

// ─── gravação ────────────────────────────────────────────────────────────────

const recorder = new Recorder(engine);
let sessionLog: SessionLog | null = null;
let recTimer: ReturnType<typeof setInterval> | null = null;
let recId = 0;
/** acima disso o navegador pode ficar sem memória (PCM fica na RAM até exportar) */
const WARN_EVERY_SEC = 10 * 60;

function session(e: Parameters<SessionLog['add']>[0]) {
  sessionLog?.add(e);
}

export async function toggleRecording() {
  if (recorder.recording) return stopRecording();
  await engine.init();
  await recorder.start();
  sessionLog = new SessionLog(timeline.stateAt(Infinity));
  let warned = 0;
  recTimer = setInterval(() => {
    useUi.setState({ rec: { seconds: recorder.seconds, bytes: recorder.bytes, peak: recorder.peak } });
    if (recorder.seconds - warned > WARN_EVERY_SEC) {
      warned = recorder.seconds;
      log(`gravando há ${Math.round(recorder.seconds / 60)} min (${mb(recorder.bytes)} na memória) — exporte de vez em quando`, 'warn');
    }
  }, 250);
  useUi.setState({ rec: { seconds: 0, bytes: 0, peak: 0 } });
  log('● gravando a saída master', 'warn');
}

async function stopRecording() {
  if (recTimer) clearInterval(recTimer);
  recTimer = null;
  const buffer = await recorder.stop();
  const log_ = sessionLog;
  sessionLog = null;
  useUi.setState({ rec: null });
  if (!buffer || !log_) return;
  if (buffer.seconds < 0.5) {
    log('gravação muito curta, descartada', 'warn');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const rec: Recording = {
    id: ++recId,
    name: `maestro-${stamp}-${timeline.state.style}`,
    seconds: buffer.seconds,
    pcm: buffer.toData(),
    session: log_.toFile(buffer.seconds, buffer.sampleRate),
    silent: buffer.peak < 0.001,
  };
  useUi.setState((s) => ({ recordings: [rec, ...s.recordings] }));
  log(`■ gravação pronta: ${rec.name} (${formatTime(rec.seconds)}) — baixe em "gravações"`, 'ok');
  if (rec.silent) log('atenção: a gravação está em silêncio (a música estava tocando?)', 'warn');
}

function updateRecording(id: number, patch: Partial<Recording>) {
  useUi.setState((s) => ({ recordings: s.recordings.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
}

const findRecording = (id: number) => useUi.getState().recordings.find((r) => r.id === id);

export function downloadWav(id: number) {
  const r = findRecording(id);
  if (r) download(encodeWav(r.pcm), `${r.name}.wav`);
}

export async function downloadMp3(id: number) {
  const r = findRecording(id);
  if (!r || r.mp3Progress !== undefined) return;
  if (!r.mp3) {
    updateRecording(id, { mp3Progress: 0 });
    try {
      const mp3 = await encodeMp3(r.pcm, (p) => updateRecording(id, { mp3Progress: p }));
      updateRecording(id, { mp3, mp3Progress: undefined });
      log(`MP3 pronto: ${r.name}.mp3 (${mb(mp3.size)})`, 'ok');
    } catch (err) {
      updateRecording(id, { mp3Progress: undefined });
      log(`falha ao gerar MP3: ${(err as Error).message}`, 'err');
      return;
    }
  }
  const done = findRecording(id)!;
  download(done.mp3!, `${done.name}.mp3`);
}

export function downloadSession(id: number) {
  const r = findRecording(id);
  if (r) download(new Blob([JSON.stringify(r.session, null, 2)], { type: 'application/json' }), `${r.name}.sessao.json`);
}

export function discardRecording(id: number) {
  useUi.setState((s) => ({ recordings: s.recordings.filter((r) => r.id !== id) }));
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const formatTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// gravações só existem na memória: avisa antes de fechar a aba
window.addEventListener('beforeunload', (e) => {
  if (recorder.recording || useUi.getState().recordings.length) e.preventDefault();
});

function describeWait(cycle: number) {
  const bars = cycle - engine.now();
  const secs = bars * engine.secondsPerCycle();
  return `em ${secs.toFixed(1)}s`;
}

log('MAESTRO · escolha um estilo e dê play. Fale com o maestro em português ou use /comandos (/help).');
log('atalhos: Espaço = play/stop · Esc = cancela o agendado · Ctrl+Z = desfaz');
export { HELP };
