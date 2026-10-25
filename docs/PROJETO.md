# MAESTRO — Documento Mestre do Projeto

> Nome provisório. Este documento é a **fonte da verdade** do projeto: visão, arquitetura, decisões, roadmap.
> Toda decisão nova relevante entra na seção [Registro de decisões](#17-registro-de-decisões-adr).
> Última atualização: 2026-10-25

---

## 1. Visão

Um **web app com cara de terminal** para criar música eletrônica ao vivo, onde:

- Você monta a base da música escolhendo **estilo, BPM, tom, instrumentos, efeitos e estrutura** (intro, build, drop, etc.) a partir de presets ajustáveis.
- Dá play e a música **toca indefinidamente**, seguindo a estrutura em loop.
- Numa linha de comando embaixo, você escreve instruções em **linguagem natural** ("na próxima seção tira o beat, põe uma voz etérea, faz um build e um drop e deixa mais sombrio") e uma **IA maestro** traduz isso em mudanças musicais **agendadas e sincronizadas**, sem travar nem quebrar o fluxo.
- Existem **dois decks** (A e B), como num set de DJ: enquanto um toca, você prepara o outro e pede para a IA fazer a **transição** no momento certo.
- Um controle de **autonomia (0–100%)** define o quanto a IA pode mudar a música sozinha.
- Tudo pode ser **gravado e exportado** (WAV/MP3) para publicar.

**O diferencial** (segundo a pesquisa de mercado, ver §16): existem ferramentas que geram código Strudel com IA, e modelos que geram áudio em tempo real (Lyria RealTime), mas **nenhuma junta**: IA que entende estrutura musical + agendamento quantizado + dois decks com transição + autonomia + gravação.

---

## 2. Princípios inegociáveis

1. **A música nunca para.** Erro da IA, JSON inválido, rede caiu, timeout → a música continua tocando como estava. Falhas aparecem no log, nunca no som.
2. **A IA é o maestro, não a orquestra.** A IA não gera áudio nem (no início) código livre. Ela emite **operações estruturadas** sobre o estado da música. Quem toca é o motor.
3. **O estado é a verdade.** Existe um `SongState` (JSON) por deck. O código Strudel é **compilado** a partir dele. Nunca editamos o código diretamente como fonte primária.
4. **Tudo é quantizado.** Mudanças acontecem em limites musicais (próximo compasso, próxima frase, próxima seção), nunca "no meio".
5. **O humano sempre manda.** Comando do usuário tem prioridade sobre o piloto automático. Existe "desfazer" e "pânico" (volta ao último estado bom).
6. **Começar pequeno e tocável.** Cada fase do roadmap termina com algo que **toca e soa bem**.

---

## 3. Glossário

| Termo | Significado no projeto |
|---|---|
| **Ciclo** | Unidade de tempo do Strudel. **Convenção nossa: 1 ciclo = 1 compasso (4 tempos).** `cpm = bpm / 4` |
| **Compasso (bar)** | 4 tempos. Unidade mínima de quantização |
| **Frase** | Grupo de compassos (normalmente 8 ou 16) |
| **Seção** | Parte nomeada da estrutura: `intro`, `verse`, `build`, `drop`, `breakdown`, `outro`… Tem duração em compassos |
| **Estrutura (arrangement)** | Sequência de seções que roda em loop (ex.: intro 16 → build 8 → drop 16 → breakdown 16 → build 8 → drop 16) |
| **Camada (layer)** | Um instrumento/voz da música: kick, hats, bass, lead, pad, vocal, fx… |
| **Deck** | Uma "música" completa (estado + estrutura). Existem A e B |
| **Op (operação)** | Uma mudança atômica no estado, emitida pela IA ou pelo usuário |
| **Plano (plan)** | Lista de ops + quando aplicar (quantização) |
| **Cena** | Snapshot de um deck que pode ser salvo/carregado |

---

## 4. Arquitetura

```
┌───────────────────────────── NAVEGADOR ─────────────────────────────┐
│                                                                      │
│  UI Terminal (React)                                                 │
│   ├─ Deck A view   ├─ Deck B view   ├─ Mixer/crossfader              │
│   ├─ Timeline (seção atual, compassos, próximos eventos agendados)   │
│   └─ Prompt (linguagem natural  |  /comandos diretos)                │
│            │                                                         │
│            ▼                                                         │
│  ┌─────────────────┐   texto + estado   ┌────────────────────────┐  │
│  │  Command Router │ ─────────────────▶ │ Conductor (IA maestro) │──┼──▶ /api/llm (proxy local)
│  │  (/cmd ou NL)   │ ◀── Plan (JSON) ── │ prompt + validação     │  │      └─▶ z.ai (GLM) / outro
│  └────────┬────────┘                    └────────────────────────┘  │
│           │ Plan validado                         ▲                  │
│           ▼                                       │ "propor mudança" │
│  ┌─────────────────┐                     ┌────────┴────────┐         │
│  │ Scheduler       │ ◀── tick do clock ─ │ Autopilot       │         │
│  │ (fila quantiz.) │                     │ (autonomia %)   │         │
│  └────────┬────────┘                     └─────────────────┘         │
│           │ aplica ops no limite certo                               │
│           ▼                                                          │
│  ┌─────────────────┐   compila   ┌──────────────┐   evaluate()       │
│  │ Store (SongState│ ──────────▶ │ Compiler     │ ─────────────┐     │
│  │ deck A, B, mix) │             │ State→Strudel│              ▼     │
│  └─────────────────┘             └──────────────┘   ┌──────────────┐ │
│                                                     │ Engine       │ │
│                                                     │ (@strudel/web│ │
│                                                     │  adapter)    │ │
│                                                     └──────┬───────┘ │
│                                                            │ áudio   │
│                                          ┌─────────────────┼───────┐ │
│                                          ▼                 ▼       │ │
│                                     alto-falantes     Recorder     │ │
│                                                     (WAV → MP3)    │ │
└──────────────────────────────────────────────────────────────────────┘
```

### Módulos

| Módulo | Responsabilidade | Observações |
|---|---|---|
| **UI Terminal** | Renderizar decks, timeline, log, prompt. Atalhos de teclado | Estética terminal (monoespaçada, verde/âmbar), mas é um app React normal por baixo |
| **Command Router** | Decide se a entrada é `/comando` direto (determinístico, sem IA) ou linguagem natural (vai pro Conductor) | `/bpm 128`, `/play`, `/stop`, `/mute bass`, `/xfade b 32`… |
| **Conductor** | Monta o prompt (system + estado atual + catálogo + pedido), chama o LLM, valida o JSON, retorna um `Plan` | Nunca toca no áudio. Pode pedir 1 retry com o erro de validação |
| **Store** | Estado global: `SongState` de cada deck, mixer, settings, histórico (undo) | Zustand. Imutável, com histórico de snapshots |
| **Scheduler** | Fila de `Plan`s com momento de aplicação (`next_bar`, `next_phrase`, `next_section`, `at_bar:N`). Aplica no limite certo | Usa o relógio do motor, com antecedência (lookahead) |
| **Compiler** | Função pura `SongState → string de código Strudel` | Testável com snapshot tests. Coração da qualidade do som |
| **Engine adapter** | Interface única pro motor de áudio (`init`, `evaluate`, `setTempo`, `getCycle`, `hush`, `getAudioContext`) | Isola o Strudel → permite trocar o motor no futuro (licença, ver §15) |
| **Autopilot** | A cada N compassos, decide (pela autonomia %) se pede ao Conductor uma mudança ou transição | Respeita comandos do usuário pendentes |
| **Recorder** | Captura a saída master e exporta WAV/MP3 | Ver §11 |
| **Presets** | Biblioteca de estilos, estruturas, instrumentos, kits e efeitos | Em arquivos TS/JSON versionados |
| **LLM proxy** | Mini servidor local que guarda a chave e repassa chamadas pro provedor | A chave **nunca** vai pro navegador |

---

## 5. Modelo de dados (rascunho)

```ts
type DeckId = 'A' | 'B';

interface SongState {
  id: string;
  name: string;
  style: StyleId;              // 'techno' | 'house' | 'trance' | 'dnb' | 'ambient' | ...
  bpm: number;                 // 60–200
  key: { root: NoteName; scale: ScaleName };   // ex.: { root: 'A', scale: 'minor' }
  mood: { darkness: number; energy: number };  // 0..1, macros que afetam vários parâmetros
  arrangement: Section[];      // estrutura em loop
  layers: Record<LayerId, Layer>;
  master: { lpf: number; hpf: number; reverb: number; delay: number; gain: number };
}

interface Section {
  id: string;
  type: 'intro' | 'verse' | 'build' | 'drop' | 'breakdown' | 'bridge' | 'outro';
  bars: number;                              // múltiplo de 4, normalmente 8/16/32
  layerOverrides?: Partial<Record<LayerId, LayerOverride>>; // ex.: no breakdown, kick muted
  automation?: Automation[];                 // ex.: build: hpf sobe de 0 a 2000 em 8 compassos
}

interface Layer {
  id: LayerId;                 // 'kick' | 'hats' | 'clap' | 'bass' | 'lead' | 'pad' | 'arp' | 'vocal' | 'fx' | ...
  role: 'drums' | 'bass' | 'harmony' | 'melody' | 'texture' | 'vocal' | 'fx';
  instrument: InstrumentId;    // do catálogo (synth ou banco de samples)
  pattern: PatternRef;         // id de padrão do catálogo OU mini-notação validada
  gain: number;
  muted: boolean;
  fx: { lpf?: number; hpf?: number; room?: number; delay?: number; distort?: number; pan?: number };
}

interface Plan {
  id: string;
  source: 'user' | 'autopilot';
  when: When;                  // quando aplicar
  ops: Op[];                   // o que fazer
  explanation: string;         // frase curta pro log ("tirando o beat por 8 compassos e escurecendo...")
}

type When =
  | { at: 'now_bar' }          // próximo compasso
  | { at: 'next_phrase' }      // próxima frase (8 ou 16 compassos)
  | { at: 'next_section' }
  | { at: 'bar'; bar: number } // compasso absoluto
  | { at: 'section'; type: Section['type'] };  // próxima vez que chegar num drop, por ex.
```

### Operações (o "vocabulário" da IA)

Lista **fechada** — a IA só pode usar estas. Cada uma é validada (Zod) e tem limites.

> A lista implementada (fonte da verdade) está em `src/song/ops.ts`. A tabela abaixo é o plano original; `insert_section`, `transition`, `prepare_deck` e rampas de fx ainda vão entrar.

| Op | Exemplo | Efeito |
|---|---|---|
| `set_bpm` | `{ op:'set_bpm', bpm:130, rampBars:8 }` | Muda o BPM (com rampa opcional) |
| `set_key` | `{ op:'set_key', root:'F', scale:'phrygian' }` | Muda tom/escala |
| `set_mood` | `{ op:'set_mood', darkness:0.8, energy:0.6 }` | Ajusta macros |
| `add_layer` | `{ op:'add_layer', layer:{ role:'vocal', instrument:'vox_ethereal_f', pattern:'pad_long' } }` | Adiciona camada |
| `remove_layer` / `mute` / `unmute` | `{ op:'mute', layer:'kick', forBars:8 }` | Tira/silencia (temporariamente ou não) |
| `set_pattern` | `{ op:'set_pattern', layer:'hats', pattern:'offbeat_16' }` | Troca o padrão |
| `set_instrument` | `{ op:'set_instrument', layer:'bass', instrument:'acid_303' }` | Troca o timbre |
| `set_fx` | `{ op:'set_fx', target:'master', lpf:800, rampBars:4 }` | Efeitos/filtros com rampa |
| `insert_section` | `{ op:'insert_section', type:'build', bars:8, then:'drop' }` | Insere build/drop/breakdown agora |
| `set_arrangement` | `{ op:'set_arrangement', sections:[...] }` | Reescreve a estrutura |
| `transition` | `{ op:'transition', to:'B', bars:32, style:'filter_swap' }` | Transição entre decks |
| `prepare_deck` | `{ op:'prepare_deck', deck:'B', description:'...' }` | IA monta um deck novo a partir de uma descrição |

> Fase avançada (opcional): op `raw_layer` com código Strudel livre gerado pela IA, rodado num "sandbox" (testado antes, com fallback). Dá mais criatividade, mais risco.

---

## 6. Protocolo da IA (Conductor)

### Fluxo
1. Usuário envia texto → Router detecta que é linguagem natural.
2. Conductor monta a mensagem:
   - **System prompt** (fixo, versionado em `src/conductor/prompts/`): papel, regras, catálogo de ops, catálogo de instrumentos/padrões disponíveis, limites, formato de saída, exemplos (few-shot).
   - **Contexto**: estado resumido do deck ativo e do outro deck, seção atual, compasso atual, próximos eventos já agendados, nível de autonomia.
   - **Pedido** do usuário.
3. LLM responde **apenas JSON** (`{ plans: Plan[] , reply: string }`).
4. Validação com **Zod**. Se inválido → 1 retry enviando o erro. Se falhar de novo → log de erro, música segue.
5. Plans válidos vão pro Scheduler. A UI mostra o que foi agendado e quando.

### Regras importantes no system prompt
- Só usar ops e ids do catálogo enviado. Nunca inventar instrumento.
- Respeitar a música: mudanças grandes em limites de seção/frase; mudanças pequenas (filtro, mute) podem ser no próximo compasso.
- Pedidos compostos viram **vários plans encadeados** (ex.: "tira o beat, faz build e drop" → plan 1 no próximo início de seção: mute kick 8 compassos + add vocal; plan 2: insert build 8; plan 3: drop + set_mood darker).
- Interpretar adjetivos musicais com uma tabela de referência (ex.: "sombrio" → escala menor/frígia, menos brilho (lpf ↓), mais reverb, mais grave; "eufórico" → maior, mais agudo, supersaw, energia ↑).
- Responder em português no campo `reply`.

### Provedor de LLM
- **Agora:** chave da **z.ai** (modelos GLM). A z.ai oferece endpoint **compatível com OpenAI** (`https://api.z.ai/api/paas/v4`) e também um compatível com Anthropic (`https://api.z.ai/api/anthropic`). Usaremos o compatível com OpenAI. *(Confirmar URL e id do modelo atual em docs.z.ai — fontes de terceiros citam `glm-5.1`/`glm-5.2`; se a chave for do "Coding Plan", a URL pode ser diferente.)*
- **Abstração:** cliente genérico "OpenAI-compatible" com `baseURL`, `apiKey`, `model` configuráveis no `.env`. Trocar para Claude, OpenAI, OpenRouter ou modelo local = mudar config.
- **JSON mode:** usar `response_format: { type: 'json_object' }` se o provedor suportar; senão, extrair o JSON da resposta. Validação Zod sempre.
- **Latência esperada:** 1–6 s. Irrelevante para o som, porque as mudanças são agendadas para o próximo limite musical. Se a resposta chegar depois do limite pedido, o Scheduler empurra para o próximo limite equivalente.

---

## 7. Tempo, sincronismo e quantização

- O relógio é o **scheduler do Strudel** (baseado no `AudioContext`), não `setInterval`.
- Convenção: **1 ciclo = 1 compasso**. `setcpm(bpm/4)`.
- O Scheduler do app consulta o ciclo atual com frequência (ex.: a cada ~50 ms via `requestAnimationFrame`/timer) e, quando faltar menos que o **lookahead** (ex.: ~150–300 ms, a calibrar) para o limite alvo, aplica as ops no Store → compila → `evaluate()`.
- Os padrões do Strudel são funções do tempo: trocar o código **não reinicia** a música, ela continua na mesma posição do ciclo. Por isso aplicar perto do limite dá uma troca limpa.
- **Automações e rampas** (build, filtros subindo, crossfade) são compiladas como **sinais do próprio Strudel** ancorados num ciclo absoluto (ex.: `saw` deslocado/escalonado), assim a rampa é suave e precisa, sem precisar reavaliar a cada compasso.
- **A validar no protótipo (risco técnico #1):** precisão do momento do `evaluate()` e se há "engasgo" ao reavaliar códigos grandes. Plano B: compilar a seção seguinte inteira com antecedência e trocar por pattern de arranjo (`arrange`/condicionais por ciclo) em vez de reavaliar no limite.

---

## 8. Dois decks e transições

- **Implementação inicial:** uma única instância do Strudel tocando `stack(deckA, deckB)`, cada deck com seu ganho/filtro controlado pelo **mixer** (crossfader). O deck inativo fica com ganho 0 (ou não é compilado, para economizar CPU).
- **BPM durante a transição:** os dois decks compartilham um único relógio. Se os BPMs forem diferentes, a transição faz **rampa de BPM** do deck A até o BPM do B ao longo da transição (como um DJ faz com o pitch).
- **Tom:** opcionalmente a IA sugere/ajusta o tom do deck B para ser compatível (roda harmônica / Camelot) — fase posterior.
- **Estilos de transição** (presets): `crossfade` (simples), `filter_swap` (graves de A saem enquanto os de B entram — clássico de DJ), `breakdown_drop` (A vai para breakdown, B entra no drop), `cut` (corte seco no 1 do compasso), `echo_out` (A sai com delay/reverb).
- Comando típico: *"daqui a 2 frases faz a transição pro deck B em 32 compassos, troca os graves no meio"*.

---

## 9. Autonomia (piloto automático)

- Slider 0–100%.
- A cada **frase** (configurável), o Autopilot sorteia com probabilidade proporcional à autonomia se deve agir. Se sim, chama o Conductor com um pedido interno ("proponha uma variação pequena/média/grande coerente com a música atual").
- Faixas:
  - **0%**: nada automático.
  - **1–30%**: microvariações (filtros, fills, mute/unmute de percussão, padrão de hats).
  - **31–70%**: + novas camadas, mudanças de seção, variações de melodia/baixo.
  - **71–100%**: + mudar tom/mood, preparar o deck B sozinho e fazer transições → "rádio infinita".
- Regras: comandos do usuário pendentes bloqueiam o Autopilot; toda ação automática aparece no log com origem `autopilot`; existe "desfazer última mudança".
- Custo: mais autonomia = mais chamadas de API. Mostrar contador de chamadas/tokens na UI.
- **Limite de taxa:** os modelos Flash gratuitos da z.ai (`glm-4.7-flash`, `glm-4.5-flash`) não cobram, mas limitam requisições por minuto. O proxy já repete em caso de 429 (até 3x, respeitando `Retry-After`). O Autopilot precisa de um intervalo mínimo entre chamadas e deve ceder a vez quando houver comando do usuário.

---

## 10. UI / UX (terminal)

```
┌─ MAESTRO ───────────────────────────────────────── ● REC 03:12  ▶ 128 BPM ─┐
│ DECK A ◀ ATIVO                         │ DECK B  (preparando)              │
│ techno · A minor · dark 0.7            │ melodic techno · F minor          │
│ [intro16][build8][DROP16][brk16]...    │ [intro16][build8][drop16]...      │
│  ▓▓▓▓▓▓▓▓░░░░ drop · bar 9/16          │  —                                │
│ kick ■ hats ■ bass ■ lead □ pad ■      │ kick ■ bass ■ arp ■ pad ■         │
├────────────────────────────────────────┴───────────────────────────────────┤
│ A ███████████░░░░░ B   autonomia [████░░░░░░] 40%                          │
├────────────────────────────────────────────────────────────────────────────┤
│ 03:01 maestro › agendado p/ próxima seção: kick off 8c, + vocal etéreo     │
│ 03:01 maestro › depois: build 8c → drop, escala frígia, lpf ↓              │
│ 03:05 auto    › hats: padrão offbeat_16                                    │
├────────────────────────────────────────────────────────────────────────────┤
│ > _                                                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Tela de setup do deck**: escolher estilo → preenche BPM/tom/camadas/estrutura sugeridos → ajustar → "carregar no deck".
- **Prompt** com histórico (↑/↓), autocompletar de `/comandos`, `Tab` alterna o deck alvo.
- **Atalhos**: `Espaço` play/stop, `Esc` pânico, `Ctrl+Z` desfazer, `R` gravar.
- Modo "ver código": painel opcional mostrando o código Strudel compilado (didático e útil pra debug).

---

## 11. Gravação e exportação

- Plugar um nó de captura na saída master do `AudioContext` do Strudel.
- **Opção A (simples):** `MediaStreamAudioDestinationNode` + `MediaRecorder` → WebM/Opus. Rápido, mas com compressão.
- **Opção B (qualidade, preferida):** `AudioWorklet` capturando PCM float → **WAV** sem perdas → conversão para **MP3** no navegador (lamejs ou ffmpeg.wasm), 320 kbps.
- Exportar também um **log da sessão** (JSON com estados e plans ao longo do tempo) → permite reproduzir/re-renderizar a sessão depois.
- Futuro: render offline (mais rápido que tempo real) a partir do log.

---

## 12. Stack técnica

| Camada | Escolha | Por quê |
|---|---|---|
| Build | **Vite + TypeScript** | Rápido, simples |
| UI | **React** | Ecossistema; estética de terminal feita com CSS |
| Estado | **Zustand** (+ Immer) | Simples, fácil de ler fora do React (Scheduler) |
| Validação | **Zod** | Schemas dos plans/ops, também usados para gerar a descrição pro prompt |
| Motor de áudio | **@strudel/web** atrás de um adapter | Padrões musicais de alto nível, samples, efeitos, roda no navegador. `initStrudel()` + `evaluate(code)` |
| Samples | dirt-samples / bancos do Strudel no início; depois biblioteca própria livre de direitos | Vozes "etéreas" exigem samples dedicados |
| LLM | Cliente OpenAI-compatible → **z.ai (GLM)** agora | Troca por config |
| Proxy da chave | Mini servidor **Node (Hono ou Express)**, ou o proxy do próprio Vite em dev | Chave fica no `.env` do servidor |
| Testes | **Vitest** (Compiler e validação), Playwright (smoke da UI) | Compiler é função pura → muito testável |
| Export | AudioWorklet + lamejs/ffmpeg.wasm | §11 |

### Configuração (`.env`, nunca commitado)
```
LLM_BASE_URL=https://api.z.ai/api/paas/v4
LLM_API_KEY=...
LLM_MODEL=glm-4.7-flash   # modelo gratuito da z.ai
LLM_JSON_MODE=true
LLM_EXTRA_BODY={"thinking":{"type":"disabled"}}
```
Ver `.env.example`.

---

## 13. Estrutura de pastas

```
maiestro/
├─ docs/PROJETO.md           ← este documento
├─ server/llmProxy.ts        ← proxy do LLM (plugin do Vite; guarda a chave)
├─ src/
│  ├─ main.tsx
│  ├─ app/                   ← UI React (App.tsx, style.css) + controller.ts (liga tudo + estado da UI em Zustand)
│  ├─ song/                  ← types.ts (SongState, Zod), ops.ts (operações + applyOp), time.ts (compassos/seções/"quando")
│  ├─ presets/               ← instrumentos, padrões, modelos de seção, estilos
│  ├─ compiler/              ← SongState → código Strudel (+ testes que rodam o Strudel de verdade)
│  ├─ engine/                ← adapter do Strudel: strudelEngine.ts, switchAt.ts, arrange.ts
│  ├─ scheduler/             ← timeline.ts: mudanças agendadas por ciclo, rampas de BPM
│  ├─ commands/              ← /comandos diretos → ops
│  ├─ conductor/             ← cliente do LLM (Fase 2: prompts, parsing)
│  ├─ autopilot/             ← (Fase 5)
│  └─ recorder/              ← (Fase 3)
├─ .env.example
└─ package.json
```

---

## 14. Roadmap

Cada fase termina com uma **demo tocável**. Os critérios de pronto são o que precisa funcionar.

### Fase 0 — Spike técnico (validar riscos) ✅ (falta só o teste real da z.ai)
- [x] Vite + TS + `@strudel/web` tocando um padrão techno escrito à mão.
- [x] Trocar o código no limite do compasso sem engasgo (medir precisão).
- [x] Rampa de filtro via sinal ancorado num ciclo.
- [x] Erro no código não para a música.
- [ ] Chamada à z.ai via proxy retornando JSON válido — proxy pronto e testado sem chave; falta rodar com a chave real.
- **Pronto quando:** sabemos que trocar no limite funciona (ou qual é o plano B).

**Resultados (2026-10-25):**
- A troca quantizada é **exata no tempo musical**: em vez de chamar `evaluate()` no limite, o engine avalia o código novo na hora e o envolve com `switchAt(antigo, novo, ciclo)` (`src/engine/switchAt.ts`). O pattern resultante responde ao scheduler com o antigo antes do ciclo e o novo a partir dele, então **não importa quando a avaliação termina**, desde que fique pronta antes do scheduler consultar o limite (~0,35 s de antecedência mínima). Trocas encadeadas funcionam. Depois do limite, o wrapper é removido para a cadeia não crescer.
- Medido no navegador headless: avaliação ~7 ms; troca agendada caiu exatamente no compasso alvo (padrão A até o ciclo 3, padrão B a partir dele).
- Rampa de build com `signal(t => …)` ancorado em ciclo absoluto: hpf 20 → 1270 → 2441 Hz ao longo de 8 compassos e drop exato no compasso seguinte. Isso já valida o mecanismo de automações (§7).
- O "plano B" da §7 não é necessário.
- Pendências para a Fase 1: mudança de BPM ainda é imediata (não quantizada, sem rampa); o controle `hpf` aparece internamente como `hcutoff` (o compiler deve usar os nomes de controle do Strudel com cuidado).

### Fase 1 — Um deck tocável (sem IA) ✅ (falta a validação de ouvido)
- [x] `SongState` + Compiler para 4 estilos (techno, house, trance, ambient).
- [x] Catálogo inicial: 8 camadas, 32 padrões, 16 instrumentos, efeitos básicos.
- [x] Estrutura em loop (seções com overrides: breakdown sem kick, build com filtro subindo + riser).
- [x] UI terminal: setup do deck, play/stop, timeline do arranjo, camadas clicáveis, lista de agendados, painel de código, `/comandos` com sufixo de tempo (`@bar`, `@phrase`, `@section`, `@drop`…).
- [x] BPM agendado e com rampa (`/bpm 132 8`).
- **Pronto quando:** dá pra montar um techno e deixar tocando 10 minutos soando bem.

**Como ficou (2026-10-25):**
- **Ops** (`src/song/ops.ts`) são o vocabulário único: os `/comandos` viram ops, e a IA vai emitir as mesmas ops na Fase 2. `applyOp` é puro e valida tudo (camada existe? padrão/instrumento serve pra camada?).
- **Timeline** (`src/scheduler/timeline.ts`): estado efetivado + lista de mudanças por ciclo. Agendar algo antes de uma mudança já agendada recompila as posteriores (ex.: mute no compasso 18 + troca de tom no 32 → o código do 32 já tem o mute). Mudanças inválidas ou com código quebrado são descartadas sem afetar o som.
- **Engine**: virou uma linha do tempo de patterns (`efetivado + pendentes`), reconstruída com `switchAt` a cada mudança, então dá pra agendar e cancelar em qualquer ordem. "Pânico" (`Esc`) cancela tudo.
- **Arranjo**: o código compilado chama `maestroArrange(anchor, [[compassos, stack(...)], ...])`, que escolhe a seção pelo ciclo absoluto. A posição na música sempre vem do relógio; `jump_to`/`set_arrangement` só mudam o `anchor`.
- **Mood**: escuridão fecha o lpf e abre o reverb das camadas melódicas; energia aumenta o volume da bateria.
- **Teste no navegador headless:** samples da 909/808 carregam, troca de estilo, tom, salto de seção e mute temporário caem no compasso certo; parar/tocar de novo e rampa de BPM funcionam.
- **Bug encontrado e corrigido:** o Strudel só carrega os AudioWorklets (supersaw, DJ filter) num clique do mouse; com play pelo teclado eles faltavam. O engine agora carrega no `init`.

### Fase 2 — IA maestro (o coração) ✅ (falta rodar a avaliação com a z.ai de verdade)
- [x] Conductor + system prompt v1 + schemas Zod + retry.
- [x] Scheduler com `bar / phrase / section / <tipo de seção> / N compassos depois`.
- [x] Pedidos compostos → vários plans encadeados.
- [x] Log mostrando o que foi agendado; desfazer (`Ctrl+Z`, `/undo`, "desfaz"); pânico.
- [x] Suite de 32 prompts de teste (`npm run eval:ai`).
- **Pronto quando:** a frase *"na próxima seção tira o beat, põe um vocal etéreo, faz build e drop e deixa mais sombrio"* funciona do jeito esperado.

**Como ficou (2026-10-25):**
- **Fluxo:** texto → `Conductor.ask` (`src/conductor/conductor.ts`) monta system prompt + contexto (estado, posição, arranjo, camadas, o que já está agendado) + memória dos últimos 4 pedidos → LLM devolve JSON `{reply, plans[], undo?}` → Zod (`schema.ts`) → ops → `Timeline.schedule`, todos no mesmo **grupo** (o desfazer desfaz o pedido inteiro).
- **Retry com feedback:** JSON quebrado, formato errado ou op que não faz sentido (padrão que não existe, camada vazia…) → o grupo é cancelado e o erro volta para a IA; ela tem mais 1 tentativa. Se falhar de novo, nada muda.
- **Formato da IA** é mais tolerante que as ops internas: números como texto, nota em minúscula, seções só com `{type, bars}` (o modelo de seção completa o resto).
- **"Quando" da IA:** `"bar" | "phrase" | "section" | {"section": "drop"} | {"after": N}` (N compassos depois do plano anterior). `forBars: N` desfaz o plano sozinho (via `inverseOps`).
- **Novas ops:** `insert_sections` (toca seções uma vez e o arranjo segue de onde estava — a Timeline agenda o `remove_sections` sozinha) e `restore` (desfazer).
- **Timeline.resolve** procura "próxima seção X" no arranjo *como ele vai estar*, incluindo seções inseridas por mudanças já agendadas (o "drop" do pedido acha o drop inserido).
- **Camada `vocal`:** coro sintético (formante `vowel` sobre osciladores): `choir_aah`, `choir_ooh`, `vox_chop`. Ainda não há samples de voz.
- **System prompt v1** (`prompt.ts`) é gerado do catálogo (nunca fica desatualizado) e traz uma tabela de interpretação ("sombrio" → darkness/escala/reese, "abafa" → filtro…) e o exemplo do projeto.
- **Avaliação:** `src/conductor/eval/cases.ts` tem 32 pedidos com critérios; `cases.test.ts` garante que uma resposta ideal passa em todos (testa os critérios); `npm run eval:ai` roda os 32 com o LLM de verdade e imprime um relatório (acertos, tentativas, latência, tokens).
- **Teste no navegador** com um LLM falso local: retry após resposta inválida, os 4 planos agendados nos compassos certos, e tocando até o fim: c17 sem kick + coro, c25 build inserido, c33 drop em lá frígio com escuridão 0,85 e o kick de volta. `Ctrl+Z` cancela o pedido inteiro.

### Fase 3 — Gravação
- [ ] Gravação WAV via AudioWorklet, export MP3.
- [ ] Log da sessão em JSON.
- **Pronto quando:** dá pra gravar 5 min e subir o MP3.

### Fase 4 — Dois decks e transições
- [ ] Deck B, mixer/crossfader, rampa de BPM.
- [ ] 5 estilos de transição.
- [ ] `prepare_deck` (IA monta o deck B a partir de uma descrição).
- **Pronto quando:** dá pra ir de um techno pra um melodic techno com BPM diferente, comandado por texto, sem quebra.

### Fase 5 — Autonomia
- [ ] Autopilot com faixas de autonomia, contador de chamadas/custo.
- **Pronto quando:** a 100% ele toca 30 min sozinho, variando e trocando de música de forma coerente.

### Fase 6 — Polimento e som
- [ ] Biblioteca de samples própria (vocais, texturas), mais estilos, cenas salvas, painel de código.
- [ ] Explorar op `raw_layer` (IA escreve Strudel livre em sandbox).
- [ ] Explorar **Lyria RealTime** / Magenta RealTime como camada de textura/voz gerada por IA.

### Fase 7 — Rumo a produto (se fizer sentido)
- [ ] Decidir motor (ver §15), contas, hospedagem, custos de IA, termos de uso.

---

## 15. Licenças e comercialização

- **Strudel é AGPL-3.0.** Para **uso pessoal**: sem problema. Se o app for **distribuído ou oferecido como serviço**, a AGPL exige disponibilizar o código-fonte do app inteiro sob licença compatível.
  - Caminho 1: lançar o Maestro como **open source** (AGPL) e monetizar de outra forma (hospedado, recursos de IA, samples premium).
  - Caminho 2: trocar o motor por um próprio sobre **Tone.js (MIT)** / Web Audio. O **Engine adapter** existe para tornar isso viável sem reescrever o resto.
  - Decisão adiada para a Fase 7, mas **toda dependência direta do Strudel fica dentro de `src/engine/` e `src/compiler/`**.
- **Samples:** só usar samples com licença que permita uso comercial da música gerada (CC0 ou equivalente) antes de publicar no Spotify/YouTube. Registrar a origem/licença de cada banco em `presets/`.
- **Áudio gerado por IA (Lyria etc.):** checar os termos do provedor antes de publicar comercialmente.
- **z.ai:** só gera *comandos*, não áudio — sem impacto nos direitos da música.

---

## 16. Contexto de mercado (pesquisa de 2026-10)

- **Live coding:** Strudel (navegador, JS, port do TidalCycles), TidalCycles (Haskell), Sonic Pi (Ruby). Poderosos, mas exigem aprender notação de padrões.
- **Strudel + IA:** StrudelLM (Tambo), fork BLamy/strudel (assistente Claude), Param Strudels (agente autônomo), servidores MCP para Strudel, modelo `strudel-coder 0.5B`. Todos **geram código** — nenhum tem estrutura musical, decks, autonomia ou gravação integrados.
- **Áudio gerado em tempo real:** Google **Lyria RealTime** (API, WebSocket, prompts com peso + BPM/densidade/brilho), **MusicFX DJ**, **Magenta RealTime** (open weights). Som contínuo e orgânico, mas controle por "prompts de estilo", não por instruções estruturadas nem por seção.
- **IA em software de DJ/DAW:** VirtualDJ 2026 (prompts em linguagem natural), LIA/Jamu (Ableton), ai-dj (innermost47, plugin com vários modelos). Focados em mixar faixas existentes ou gerar MIDI.
- **Lacuna que o Maestro ocupa:** maestro por linguagem natural, que entende estrutura musical, agenda mudanças quantizadas, controla dois decks e tem autonomia ajustável.

---

## 17. Registro de decisões (ADR)

| # | Data | Decisão | Motivo |
|---|---|---|---|
| 1 | 2026-10-25 | Web app primeiro | Zero instalação; Strudel roda no navegador |
| 2 | 2026-10-25 | Uso pessoal por enquanto; comercialização avaliada depois | Permite usar Strudel (AGPL) agora |
| 3 | 2026-10-25 | LLM via z.ai (GLM), cliente OpenAI-compatible configurável | Custo; trocar provedor = mudar `.env` |
| 4 | 2026-10-25 | IA emite ops estruturadas (JSON validado), não áudio nem código livre | Robustez: a música nunca quebra |
| 5 | 2026-10-25 | `SongState` é a fonte da verdade; código Strudel é compilado | Testável, desfazível, permite trocar motor |
| 6 | 2026-10-25 | Chave do LLM fica num proxy local, nunca no navegador | Segurança |
| 7 | 2026-10-25 | Modelo padrão `glm-4.7-flash` (plano gratuito da z.ai), "thinking" desligado | Gratuito e com menos latência; trocável no `.env` |
| 8 | 2026-10-25 | Proxy do LLM como plugin do servidor de dev do Vite (`server/llmProxy.ts`) | Um comando só (`npm run dev`); vira servidor separado se precisar |
| 9 | 2026-10-25 | Troca quantizada via `switchAt` (corte dentro da consulta do scheduler), não `evaluate()` cronometrado | Precisão exata, independente da latência de avaliação |
| 10 | 2026-10-25 | Repositório: github.com/j-c-fstk-dev/maiestro | — |
| 11 | 2026-10-25 | 8 slots fixos de camada (`kick clap hats perc bass chords lead fx`) | Simples pra UI e pra IA; `vocal` entra quando houver samples |
| 12 | 2026-10-25 | Padrões melódicos em graus da escala; o compiler aplica tom/escala/oitava | Mudar o tom transpõe tudo de uma vez, sem reescrever padrões |
| 13 | 2026-10-25 | Filtro master = DJ filter (`djf`) do Strudel; cada grupo de camadas num orbit | `lpf` no stack apagaria o lpf de cada camada; reverb/delay por orbit não brigam |
| 14 | 2026-10-25 | Arranjo roteado por ciclo absoluto (`maestroArrange`) em vez do `arrange` do Strudel | O `arrange` comprime o tempo das seções; o nosso mantém padrões `<...>` fluindo |
| 15 | 2026-10-25 | Ops como vocabulário único de comandos e da IA | Um só caminho de validação/agendamento |
| 16 | 2026-10-25 | Página de testes da Fase 0 removida (está no histórico do git) | A UI da Fase 1 cobre os mesmos testes |
| 17 | 2026-10-25 | Formato de resposta da IA próprio (achatado e tolerante) convertido para ops | Modelos pequenos erram menos; ops internas continuam estritas |
| 18 | 2026-10-25 | 1 retry com o erro devolvido à IA; depois desiste sem mexer na música | Corrige a maioria dos erros sem dobrar a latência sempre |
| 19 | 2026-10-25 | Desfazer por grupo (comando ou pedido inteiro); se já tocou, `restore` do estado anterior | É o que o usuário entende por "desfaz" |
| 20 | 2026-10-25 | Camada `vocal` com coro sintético (formante) até termos samples de voz | Atende "voz etérea" sem depender de samples externos |
| 21 | 2026-10-25 | Avaliação da IA como suíte do Vitest separada (`vitest.eval.config.ts`) | Funciona em qualquer SO; não roda no `npm test` (gasta API) |

---

## 18. Questões em aberto

- ~~Precisão real da troca no limite do compasso no Strudel~~ → resolvido na Fase 0 (`switchAt`).
- Qual modelo GLM tem melhor custo/qualidade/latência para JSON estruturado? Testar 2–3.
- Origem dos samples vocais "etéreos" (bancos CC0? gravar? gerar com IA?).
- Nome definitivo do projeto.
- ~~Onde hospedar o código~~ → github.com/j-c-fstk-dev/maiestro.
