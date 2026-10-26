import { useEffect, useRef, useState } from 'react';
import {
  discardRecording,
  downloadMp3,
  downloadSession,
  downloadWav,
  engine,
  formatTime,
  loadStyle,
  mb,
  panic,
  play,
  run,
  setAutonomy,
  setTarget,
  stop,
  tierLabel,
  toggleMute,
  togglePlay,
  toggleHelp,
  toggleRecording,
  toggleTarget,
  HELP,
  undo,
  useUi,
  type LogLine,
} from './controller';
import { useNow } from './useNow';
import { STYLES } from '../presets/styles';
import { INSTRUMENTS_BY_ID } from '../presets/instruments';
import { PATTERNS_BY_ID } from '../presets/patterns';
import { positionAt, loopLength } from '../song/time';
import { LAYER_IDS, type SongState } from '../song/types';
import { DECK_IDS, liveDeck, type DeckId, type MixState } from '../song/mix';
import { TRANSITIONS } from '../presets/transitions';
import type { Entry } from '../scheduler/timeline';

const SECTION_LABEL: Record<string, string> = {
  intro: 'intro',
  verse: 'groove',
  build: 'build',
  drop: 'DROP',
  breakdown: 'breakdown',
  outro: 'outro',
};

export function App() {
  const { snap, showCode, loading, thinking, target } = useUi();
  const now = useNow();
  const { state: mix, playing, pending } = snap;
  const state = liveDeck(mix);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (e.key === 'Escape') {
        e.preventDefault();
        if (useUi.getState().showHelp) toggleHelp(false);
        else panic();
      } else if (e.key === 'F1' || (e.key === '?' && !typing)) {
        e.preventDefault();
        toggleHelp();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(typing && (e.target as HTMLInputElement).value)) {
        e.preventDefault();
        void undo();
      } else if (e.code === 'Space' && !typing) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Header state={state} playing={playing} now={now} pendingCount={pending.length} loading={loading} thinking={thinking} />
      <div className="main">
        <div className="col">
          <Mixer mix={mix} playing={playing} now={now} />
          {DECK_IDS.map((id) => (
            <Deck key={id} id={id} mix={mix} playing={playing} now={now} target={target} />
          ))}
          {(!playing || target !== mix.live) && <Setup deck={target} current={mix.decks[target].style} loading={loading} playing={playing} />}
          <Pending pending={pending} now={now} />
          <Recordings />
        </div>
        <div className="col">
          {showCode && (
            <section className="panel code">
              <h2>código strudel (compilado do estado)</h2>
              <pre>{snap.code}</pre>
            </section>
          )}
          <Log />
        </div>
      </div>
      <Prompt />
      <HelpPanel />
    </div>
  );
}

function HelpPanel() {
  const show = useUi((s) => s.showHelp);
  if (!show) return null;
  return (
    <aside className="help" role="dialog" aria-label="comandos">
      <div className="help-head">
        <h2>comandos e dicas</h2>
        <button className="ghost" onClick={() => toggleHelp(false)}>
          fechar (Esc)
        </button>
      </div>
      <p className="dim">
        Fale com o maestro em português no prompt (sem “/”), ou use os comandos. Exemplos: “na próxima seção tira o beat e faz um build”, “prepara um
        lo-fi no outro deck e mixa”, “mais sombrio no drop”.
      </p>
      <pre>{HELP}</pre>
      <p className="dim">
        atalhos: Espaço play/stop · Esc cancela o agendado · Ctrl+Z desfaz · Tab troca o deck editado · ↑/↓ histórico · ? ou F1 esta ajuda
      </p>
    </aside>
  );
}

function Header({ state, playing, now, pendingCount, loading, thinking }: { state: SongState; playing: boolean; now: number; pendingCount: number; loading: boolean; thinking: string | null }) {
  const bar = Math.floor(now);
  const beat = Math.floor((now % 1) * 4) + 1;
  return (
    <header className="header">
      <span className="brand">MAESTRO</span>
      <span className={playing ? 'live' : 'dim'}>{loading ? '… carregando' : playing ? '▶ tocando' : '■ parado'}</span>
      <span>
        <b>{playing ? engine.getBpm().toFixed(1) : state.bpm}</b> BPM
      </span>
      <span>
        tom <b>{state.key.root} {state.key.scale}</b>
      </span>
      <span className="dim">
        escuridão {state.mood.darkness.toFixed(2)} · energia {state.mood.energy.toFixed(2)}
      </span>
      {playing && (
        <span className="clock">
          compasso <b>{bar}</b> · <span className="beats">{[1, 2, 3, 4].map((b) => (b === beat ? '●' : '○')).join('')}</span>
        </span>
      )}
      {pendingCount > 0 && <span className="warn">{pendingCount} agendada(s)</span>}
      {thinking && <span className="thinking">maestro pensando…</span>}
      <RecButton />
      <button className="ghost help-btn" onClick={() => toggleHelp()} title="comandos e atalhos (? ou F1)">
        ?
      </button>
    </header>
  );
}

function RecButton() {
  const rec = useUi((s) => s.rec);
  return (
    <button className={`rec ${rec ? 'on' : ''}`} onClick={() => void toggleRecording()} title="gravar a saída (/rec)">
      {rec ? (
        <>
          ● REC {formatTime(rec.seconds)} <span className="dim">{mb(rec.bytes)}</span>
          <span className="meter" style={{ width: `${Math.round(Math.min(1, rec.peak) * 24)}px` }} />
        </>
      ) : (
        '● gravar'
      )}
    </button>
  );
}

function Recordings() {
  const recordings = useUi((s) => s.recordings);
  if (!recordings.length) return null;
  return (
    <section className="panel">
      <h2>
        gravações <span className="dim">· ficam só nesta aba até você baixar</span>
      </h2>
      <ul className="recordings">
        {recordings.map((r) => (
          <li key={r.id}>
            <div>
              <b>{r.name}</b> <span className="dim">· {formatTime(r.seconds)}</span>
              {r.silent && <span className="warn"> · em silêncio</span>}
            </div>
            <div className="row">
              <button className="ghost" onClick={() => void downloadMp3(r.id)} disabled={r.mp3Progress !== undefined}>
                {r.mp3Progress !== undefined ? `gerando MP3… ${Math.round(r.mp3Progress * 100)}%` : 'baixar MP3 (320k)'}
              </button>
              <button className="ghost" onClick={() => downloadWav(r.id)}>
                WAV
              </button>
              <button className="ghost" onClick={() => downloadSession(r.id)} title="o que aconteceu na sessão: estado inicial, mudanças, pedidos à IA">
                sessão .json
              </button>
              <button className="ghost danger" onClick={() => confirm('Descartar esta gravação?') && discardRecording(r.id)}>
                descartar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Mixer({ mix, playing, now }: { mix: MixState; playing: boolean; now: number }) {
  const t = mix.transition;
  const x = t ? Math.min(1, Math.max(0, (now - t.start) / t.bars)) : mix.live === 'A' ? 0 : 1;
  // durante a transição o "fader" anda de um lado para o outro
  const pos = t ? (t.from === 'A' ? x : 1 - x) : x;
  return (
    <section className="panel mixer">
      <div className="xfader">
        <span className={mix.live === 'A' || t ? 'live' : 'dim'}>A</span>
        <div className="track">
          <div className="knob" style={{ left: `calc(${pos * 100}% - 6px)` }} />
        </div>
        <span className={mix.live === 'B' || t ? 'live' : 'dim'}>B</span>
        <span className="dim">
          {t ? `${t.style} ${t.from}→${t.to} · ${Math.round(x * 100)}% · faltam ${Math.max(0, Math.ceil(t.start + t.bars - now))}c` : `no ar: deck ${mix.live}`}
        </span>
      </div>
      <AutoControl />
      {playing && !t && (
        <div className="row">
          <span className="dim">transição para o deck {mix.live === 'A' ? 'B' : 'A'} (na próxima frase):</span>
          {TRANSITIONS.map((tr) => (
            <button key={tr.id} className="ghost" title={tr.description} onClick={() => void run(`/xfade ${tr.id}`)}>
              {tr.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function AutoControl() {
  // dois seletores: um objeto novo a cada leitura faria o Zustand renderizar em loop
  const auto = useUi((s) => s.auto);
  const ai = useUi((s) => s.ai);
  const tokens = ai.tokens + auto.stats.aiTokens;
  return (
    <div className="row auto">
      <label className="auto-label" title="o quanto o maestro muda a música sozinho (/auto 0-100)">
        piloto automático
        <input type="range" min={0} max={100} step={5} value={auto.autonomy} onChange={(e) => setAutonomy(Number(e.target.value))} />
        <b className={auto.autonomy ? 'live' : 'dim'}>{auto.autonomy}%</b>
      </label>
      <span className="dim">
        {tierLabel(auto.autonomy)}
        {auto.autonomy > 0 && !auto.useAi && ' · sem IA'}
        {auto.busy && ' · pensando…'}
      </span>
      <span className="dim stats" title="movimentos do piloto (IA / locais), trocas de música, e uso total da IA">
        auto: {auto.stats.aiMoves} IA · {auto.stats.localMoves} locais · {auto.stats.rotations} trocas │ IA: {ai.calls + auto.stats.aiMoves} chamadas · {(tokens / 1000).toFixed(1)}k tokens
      </span>
    </div>
  );
}

function Deck({ id, mix, playing, now, target }: { id: DeckId; mix: MixState; playing: boolean; now: number; target: DeckId }) {
  const state = mix.decks[id];
  const sounding = playing && (mix.live === id || mix.transition?.to === id || mix.transition?.from === id);
  const pos = positionAt(state, sounding ? now : 0);
  const section = state.arrangement[pos.index];
  const isLive = mix.live === id;
  const editing = target === id;
  const role = mix.transition?.to === id ? 'ENTRANDO' : mix.transition?.from === id ? 'SAINDO' : isLive ? 'NO AR' : 'preparado';
  return (
    <section className={`panel deck ${editing ? 'editing' : 'collapsed'} ${isLive ? 'is-live' : ''}`}>
      <h2 className="deck-head" onClick={() => setTarget(id)} title="clique (ou Tab no prompt) para editar este deck">
        deck {id} <span className={`badge ${isLive || mix.transition ? 'badge-live' : ''}`}>{role}</span>
        <span className="dim">
          {' '}
          · {state.name} · {state.bpm} BPM · {state.key.root} {state.key.scale}
        </span>
        {editing && <span className="badge badge-edit">editando</span>}
      </h2>
      <Arrangement state={state} playing={sounding} now={now} />
      {editing && <div className="layers">
        {LAYER_IDS.map((lid) => {
          const layer = state.layers[lid];
          if (!layer) {
            return (
              <div key={lid} className="layer empty">
                <span className="lid">{lid}</span>
                <span className="dim">— vazio · /add {lid}</span>
              </div>
            );
          }
          const sectionMuted = sounding && section.mute.includes(lid);
          const status = layer.muted ? 'mudo' : sectionMuted ? 'fora da seção' : sounding ? 'tocando' : 'pronto';
          return (
            <button
              key={lid}
              className={`layer ${layer.muted ? 'muted' : sectionMuted ? 'resting' : 'on'}`}
              onClick={() => toggleMute(lid, id)}
              title="clique para mutar/desmutar (no próximo compasso)"
            >
              <span className="led">{layer.muted ? '□' : sectionMuted ? '◌' : '■'}</span>
              <span className="lid">{lid}</span>
              <span className="inst">{layer.code ? 'código' : (INSTRUMENTS_BY_ID[layer.instrument]?.label ?? layer.instrument)}</span>
              <span className="pat" title={layer.code}>
                {layer.code ?? PATTERNS_BY_ID[layer.pattern]?.label ?? layer.pattern}
              </span>
              <span className="gain">{'▮'.repeat(Math.round(layer.gain * 5)).padEnd(7, '▯')}</span>
              <span className="st dim">{status}</span>
            </button>
          );
        })}
      </div>}
    </section>
  );
}

function Arrangement({ state, playing, now }: { state: SongState; playing: boolean; now: number }) {
  const pos = positionAt(state, playing ? now : 0);
  const total = loopLength(state.arrangement);
  return (
    <div className="arr" aria-label="arranjo">
      {state.arrangement.map((s, i) => {
        const current = i === pos.index && playing;
        const progress = current ? (pos.barInSection / s.bars) * 100 : 0;
        return (
          <div key={i} className={`sec sec-${s.type} ${current ? 'current' : ''}`} style={{ flexGrow: s.bars, flexBasis: `${(s.bars / total) * 100}%` }}>
            {current && <div className="fill" style={{ width: `${progress}%` }} />}
            <span className="sec-label">
              {SECTION_LABEL[s.type]} <span className="dim">{s.bars}</span>
            </span>
            {current && <span className="sec-pos">{Math.floor(pos.barInSection) + 1}/{s.bars}</span>}
          </div>
        );
      })}
    </div>
  );
}

function Setup({ deck, current, loading, playing }: { deck: DeckId; current: string; loading: boolean; playing: boolean }) {
  return (
    <section className="panel">
      <h2>
        carregar um estilo no deck {deck} <span className="dim">· {playing ? 'ele fica preparado até a transição' : 'Tab troca o deck'}</span>
      </h2>
      <div className="styles">
        {STYLES.map((s) => (
          <button key={s.id} className={`style ${current === s.id ? 'selected' : ''}`} onClick={() => loadStyle(s.id)}>
            <b>{s.label}</b>
            <span className="dim">{s.description}</span>
          </button>
        ))}
      </div>
      <div className="row">
        <button className="primary" disabled={loading} onClick={() => play()}>
          ▶ tocar
        </button>
        <span className="dim">ajuste antes com /comandos (ex.: /bpm 130, /key D minor, /inst bass acid)</span>
      </div>
    </section>
  );
}

function Pending({ pending, now }: { pending: Entry[]; now: number }) {
  if (pending.length === 0) return null;
  return (
    <section className="panel">
      <h2>
        agendado <span className="dim">· Esc cancela tudo · Ctrl+Z desfaz o último</span>
      </h2>
      <ul className="pending">
        {pending.map((e) => (
          <li key={e.id}>
            <span className="when">c{e.cycle}</span>
            <span className="dim">em {Math.max(0, e.cycle - now).toFixed(1)} compassos</span>{' '}
            <span className={`src src-${e.source}`}>{e.source === 'ai' ? 'IA' : e.source === 'autopilot' ? 'auto' : 'você'}</span> {e.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Log() {
  const lines = useUi((s) => s.log);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines.length]);
  return (
    <section className="panel log" ref={ref}>
      {lines.map((l: LogLine) => (
        <div key={l.id} className={`l l-${l.kind}`}>
          <span className="t">{l.time}</span> {l.kind === 'cmd' ? '› ' : ''}
          {l.text}
        </div>
      ))}
    </section>
  );
}

const COMPLETIONS = ['/play', '/stop', '/rec', '/undo', '/insert', '/deck', '/load', '/copy', '/xfade', '/style', '/bpm', '/key', '/mute', '/unmute', '/gain', '/pattern', '/inst', '/add', '/remove', '/fx', '/filter', '/reverb', '/volume', '/mood', '/arr', '/goto', '/list', '/panic', '/code', '/clear', '/help'];

function Prompt() {
  const target = useUi((s) => s.target);
  const [value, setValue] = useState('');
  const history = useRef<string[]>([]);
  const cursor = useRef(-1);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (value.trim()) {
        history.current.push(value);
        cursor.current = -1;
        void run(value);
      }
      setValue('');
    } else if (e.key === 'ArrowUp' && history.current.length) {
      e.preventDefault();
      cursor.current = cursor.current < 0 ? history.current.length - 1 : Math.max(0, cursor.current - 1);
      setValue(history.current[cursor.current]);
    } else if (e.key === 'ArrowDown' && cursor.current >= 0) {
      e.preventDefault();
      cursor.current = Math.min(history.current.length, cursor.current + 1);
      setValue(history.current[cursor.current] ?? '');
      if (cursor.current >= history.current.length) cursor.current = -1;
    } else if (e.key === 'Tab' && value.startsWith('/') && !value.includes(' ')) {
      e.preventDefault();
      const match = COMPLETIONS.filter((c) => c.startsWith(value));
      if (match.length === 1) setValue(match[0] + ' ');
      else if (match.length > 1) void run(`/help`);
    } else if (e.key === 'Tab') {
      // fora do autocompletar, Tab troca o deck que os comandos editam
      e.preventDefault();
      toggleTarget();
    }
  };

  return (
    <div className="prompt">
      <span className="caret">{target} ›</span>
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="fale com o maestro: “na próxima seção tira o beat e faz um build” · ou /help"
        spellCheck={false}
        autoComplete="off"
        aria-label="comando"
      />
      <button className="ghost" onClick={() => (engine.isPlaying ? stop() : play())}>
        {engine.isPlaying ? '■' : '▶'}
      </button>
    </div>
  );
}
