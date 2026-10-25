import { StrudelEngine } from '../engine/strudelEngine';
import { chat, extractJson } from '../conductor/llmClient';

// Fase 0: página de testes para validar os riscos técnicos (ver docs/PROJETO.md §14).

const CODE_A = `stack(
  s("bd*4").gain(1),
  s("~ cp ~ cp").gain(0.6).room(0.2),
  s("hh*8").gain("[0.35 0.7]*4"),
  note("<a1 a1 c2 g1>*8").s("sawtooth")
    .lpf(700).lpq(8).decay(0.15).sustain(0).gain(0.6),
  n("<0 3 5 4>").scale("A:minor").s("supersaw")
    .slow(2).lpf(1400).room(0.6).gain(0.22)
)`;

const CODE_B = `stack(
  s("~ ~ ~ ~ ~ ~ ~ hh").gain(0.3).room(0.8),
  note("<a1 bb1>/2").s("sawtooth").lpf(320).lpq(4).gain(0.55),
  n("<[0,2,4] [1,3,5]>/2").scale("A:phrygian").s("supersaw")
    .lpf(900).room(0.9).size(0.9).gain(0.25),
  n("0 ~ 4 ~ 7 ~ 4 ~").scale("A:phrygian").s("triangle")
    .octave(5).delay(0.5).delayfeedback(0.6).room(0.7).gain(0.18)
)`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const codeA = $<HTMLTextAreaElement>('code-a');
const codeB = $<HTMLTextAreaElement>('code-b');
codeA.value = CODE_A;
codeB.value = CODE_B;

function log(msg: string, kind: 'ok' | 'warn' | 'err' | 'ai' | '' = '') {
  const line = document.createElement('div');
  if (kind) line.className = `l-${kind}`;
  const bar = engine.isPlaying ? `[c${engine.now().toFixed(2)}] ` : '';
  line.textContent = `${new Date().toLocaleTimeString()} ${bar}${msg}`;
  const box = $('log');
  box.prepend(line);
}

const engine = new StrudelEngine({
  onError: (err) => log(`erro no código (a música continua): ${err.message}`, 'err'),
  onSwitch: (r) =>
    log(
      `troca agendada p/ compasso ${r.atCycle} · pronta ${r.leadSeconds.toFixed(3)}s antes · avaliação ${r.evalMs.toFixed(0)}ms`,
      r.leadSeconds > 0.25 ? 'ok' : 'warn',
    ),
});

$('start').onclick = async () => {
  $('status').textContent = 'carregando samples…';
  await engine.play(codeA.value);
  $('status').textContent = 'tocando';
  log('tocando A', 'ok');
};

$('stop').onclick = () => {
  engine.stop();
  $('status').textContent = 'parado';
  log('parado');
};

$('bpm-apply').onclick = () => {
  const bpm = Number($<HTMLInputElement>('bpm').value);
  engine.setBpm(bpm);
  log(`BPM → ${bpm}`);
};

document.querySelectorAll<HTMLButtonElement>('[data-switch]').forEach((btn) => {
  btn.onclick = async () => {
    const code = btn.dataset.switch === 'a' ? codeA.value : codeB.value;
    const every = Number(btn.dataset.every);
    if (every === 0) {
      await engine.play(code);
      log('troca imediata (sem quantizar) — compare com as quantizadas', 'warn');
      return;
    }
    await engine.scheduleSwitch(code, engine.nextBoundary(every));
  };
});

// Build: high-pass sobe de 0 a 2500 Hz em 8 compassos (sinal ancorado no ciclo absoluto)
// e no compasso seguinte volta o código original ("drop").
$('ramp').onclick = async () => {
  const start = engine.nextBoundary(1);
  const bars = 8;
  const build = `stack(${codeA.value})
  .hpf(signal(t => 20 + 2500 * Math.min(1, Math.max(0, (t - ${start}) / ${bars}))))
  .gain(signal(t => 1 + 0.15 * Math.min(1, Math.max(0, (t - ${start}) / ${bars}))))`;
  await engine.scheduleSwitch(build, start);
  await engine.scheduleSwitch(codeA.value, start + bars);
  log(`build agendado: compassos ${start}–${start + bars}, drop no ${start + bars}`, 'ok');
};

// Teste da IA: só valida conexão, latência e se o modelo devolve JSON válido.
const SYSTEM = `Você é o MAESTRO, uma IA que rege música eletrônica ao vivo.
Responda SOMENTE com um objeto JSON, sem texto fora dele, no formato:
{"reply": "frase curta em português", "plans": [{"when": "next_bar|next_phrase|next_section", "ops": [ {"op": "...", ...} ]}]}
Ops permitidas: set_bpm{bpm}, set_key{root,scale}, set_mood{darkness,energy (0..1)}, mute{layer,forBars}, unmute{layer},
add_layer{role,instrument}, set_fx{target,lpf?,hpf?,room?,delay?,rampBars?}, insert_section{type,bars}.
Camadas existentes: kick, clap, hats, bass, pad.`;

$('ask').onclick = async () => {
  const text = $<HTMLInputElement>('prompt').value;
  log(`› ${text}`, 'ai');
  try {
    const res = await chat(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text },
      ],
      { json: true },
    );
    let parsed: unknown;
    try {
      parsed = extractJson(res.content);
    } catch (e) {
      log(`resposta não é JSON válido: ${res.content.slice(0, 300)}`, 'err');
      return;
    }
    log(`maestro (${res.model}, ${res.latencyMs}ms, ${res.usage?.total_tokens ?? '?'} tokens):\n${JSON.stringify(parsed, null, 2)}`, 'ai');
  } catch (e) {
    log(`falha na IA (a música não é afetada): ${(e as Error).message}`, 'err');
  }
};

// relógio
function tick() {
  if (engine.isPlaying) {
    const c = engine.now();
    $('bar').textContent = String(Math.floor(c));
    $('beat').textContent = `${Math.floor((c % 1) * 4) + 1}/4`;
    $('phrase').textContent = `${Math.floor(c / 8)} · ${(Math.floor(c) % 8) + 1}/8`;
  }
  requestAnimationFrame(tick);
}
tick();

// para inspeção no console / testes automatizados
if (import.meta.env.DEV) (window as any).__engine = engine;
