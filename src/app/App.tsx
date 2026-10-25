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
  stop,
  toggleMute,
  togglePlay,
  toggleRecording,
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
  const { snap, showCode, loading, thinking } = useUi();
  const now = useNow();
  const { state, playing, pending } = snap;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (e.key === 'Escape') {
        e.preventDefault();
        panic();
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
          <Deck state={state} playing={playing} now={now} />
          {!playing && <Setup current={state.style} loading={loading} />}
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
    </div>
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

function Deck({ state, playing, now }: { state: SongState; playing: boolean; now: number }) {
  const pos = positionAt(state, playing ? now : 0);
  const section = state.arrangement[pos.index];
  return (
    <section className="panel">
      <h2>
        deck A <span className="dim">· {state.name}</span>
      </h2>
      <Arrangement state={state} playing={playing} now={now} />
      <div className="layers">
        {LAYER_IDS.map((id) => {
          const layer = state.layers[id];
          if (!layer) {
            return (
              <div key={id} className="layer empty">
                <span className="lid">{id}</span>
                <span className="dim">— vazio · /add {id}</span>
              </div>
            );
          }
          const sectionMuted = section.mute.includes(id);
          const status = layer.muted ? 'mudo' : sectionMuted ? 'fora da seção' : 'tocando';
          return (
            <button
              key={id}
              className={`layer ${layer.muted ? 'muted' : sectionMuted ? 'resting' : 'on'}`}
              onClick={() => toggleMute(id)}
              title="clique para mutar/desmutar (no próximo compasso)"
            >
              <span className="led">{layer.muted ? '□' : sectionMuted ? '◌' : '■'}</span>
              <span className="lid">{id}</span>
              <span className="inst">{INSTRUMENTS_BY_ID[layer.instrument]?.label ?? layer.instrument}</span>
              <span className="pat">{PATTERNS_BY_ID[layer.pattern]?.label ?? layer.pattern}</span>
              <span className="gain">{'▮'.repeat(Math.round(layer.gain * 5)).padEnd(7, '▯')}</span>
              <span className="st dim">{status}</span>
            </button>
          );
        })}
      </div>
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

function Setup({ current, loading }: { current: string; loading: boolean }) {
  return (
    <section className="panel">
      <h2>montar o deck</h2>
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

const COMPLETIONS = ['/play', '/stop', '/rec', '/undo', '/insert', '/style', '/bpm', '/key', '/mute', '/unmute', '/gain', '/pattern', '/inst', '/add', '/remove', '/fx', '/filter', '/reverb', '/volume', '/mood', '/arr', '/goto', '/list', '/panic', '/code', '/clear', '/help'];

function Prompt() {
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
    }
  };

  return (
    <div className="prompt">
      <span className="caret">›</span>
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
