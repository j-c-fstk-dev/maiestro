# MAESTRO

Web app de música eletrônica ao vivo com uma **IA maestro**: você monta a base (estilo, BPM, tom, estrutura),
dá play e vai mudando a música com comandos. As mudanças entram no tempo certo, sem travar.

> Status: **Fase 4 — dois decks**: fale com a música em português, prepare a próxima música no outro deck, mixe com transições de DJ e grave em MP3.
> Visão, arquitetura e roadmap: [`docs/PROJETO.md`](docs/PROJETO.md).

## Rodar localmente

Requisitos: Node 20+.

```bash
npm install
cp .env.example .env     # coloque sua chave da z.ai em LLM_API_KEY
npm run dev              # abre em http://localhost:5173
```

## Como usar

1. Escolha um estilo (**techno, house, trance, ambient**) e clique em **▶ tocar** — ou digite `/play techno`.
2. A música toca em loop seguindo o arranjo (intro → groove → build → drop → breakdown → …).
3. **Fale com o maestro** no prompt, em português, por exemplo:
   - *na próxima seção tira a batida por alguns instantes, coloca uma voz etérea, faz um build e um drop e deixa mais sombrio*
   - *abafa tudo* · *mais energia!* · *no próximo drop muda pra fá frígio* · *acelera aos poucos pra 140* · *desfaz*

   A resposta aparece no log com o que foi agendado e quando. `Ctrl+Z` desfaz o último pedido inteiro.
4. **Dois decks:** o deck A começa no ar; o B fica preparado (melodic techno por padrão). Clique no título de um deck (ou `Tab` no prompt) para escolher qual você edita — o prompt mostra `A ›`/`B ›`. Peça ao maestro *"prepara um house mais lento no outro deck e mixa na próxima seção"*, ou use os botões de transição no mixer / `/xfade`.
5. **Grave:** clique em `● gravar` no topo (ou `/rec`). Ao parar, a gravação aparece em **gravações**: baixe o **MP3 320k**, o **WAV** ou a **sessão .json** (tudo que aconteceu). As gravações ficam só na aba — baixe antes de fechar.
6. Ou use **comandos diretos** (sem IA, instantâneos). Toda mudança entra **no próximo limite musical** e aparece em "agendado".

| comando | exemplo |
|---|---|
| tempo | `/bpm 132` · `/bpm 140 8` (rampa de 8 compassos) |
| tom | `/key F# minor` · `/key D dorian @drop` |
| camadas | `/mute kick 8` (mudo por 8 compassos) · `/unmute hats` · `/gain bass 0.7` |
| timbre/padrão | `/inst bass acid` · `/pattern hats offbeat` · `/add lead arp_up pluck` · `/remove perc` |
| efeitos | `/fx lead delay 0.5` · `/filter 0.3` (master) · `/reverb 0.3` · `/mood dark 0.8` |
| estrutura | `/goto breakdown` · `/insert build:8 drop:16` · `/arr intro:8 build:8 drop:32` · `/style house` |
| desfazer | `/undo` (ou `Ctrl+Z`) · `/panic` (ou `Esc`) cancela tudo que está agendado |
| gravar | `/rec` começa/para |
| decks | `/deck b` (editar o B) · `/load house` (carrega no deck fora do ar) · `/copy a b` · `/xfade 32 bass_swap` · `/xfade cut @drop` · `/list transitions` |
| info | `/list patterns bass` · `/list insts lead` · `/code` · `/help` |

**Quando:** qualquer comando aceita um sufixo `@bar`, `@phrase` (8 compassos), `@section` ou `@<seção>` (ex.: `@drop`).
**Atalhos:** `Espaço` play/stop (fora do prompt) · `Esc` cancela tudo que está agendado · `Ctrl+Z` desfaz · `↑/↓` histórico · `Tab` completa comando (ou troca o deck editado).
Clique numa camada para mutar/desmutar.

## Scripts

| comando | o que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento + proxy da IA (`/api/llm`) |
| `npm test` | testes (Vitest) — o compiler é testado rodando o Strudel de verdade; a IA é testada com respostas roteirizadas |
| `npm run eval:ai` | avalia o maestro com a IA de verdade (35 pedidos, usa a chave do `.env`) e imprime um relatório |
| `npm run typecheck` | checagem de tipos |
| `npm run build` | build de produção |

## Licença

AGPL-3.0-or-later (o motor de áudio, [Strudel](https://strudel.cc), é AGPL). Ver `docs/PROJETO.md` §15.
