# MAESTRO

Web app de música eletrônica ao vivo com uma **IA maestro**: você monta a base (estilo, BPM, tom, estrutura),
dá play e vai mudando a música com comandos. As mudanças entram no tempo certo, sem travar.

> Status: **Fase 1 — um deck tocável com /comandos** (a IA entra na Fase 2).
> Visão, arquitetura e roadmap: [`docs/PROJETO.md`](docs/PROJETO.md).

## Rodar localmente

Requisitos: Node 20+.

```bash
npm install
cp .env.example .env     # coloque sua chave da z.ai em LLM_API_KEY (só vai ser usada na Fase 2)
npm run dev              # abre em http://localhost:5173
```

## Como usar

1. Escolha um estilo (**techno, house, trance, ambient**) e clique em **▶ tocar** — ou digite `/play techno`.
2. A música toca em loop seguindo o arranjo (intro → groove → build → drop → breakdown → …).
3. Mude ao vivo com comandos. Toda mudança entra **no próximo limite musical** e aparece em "agendado".

| comando | exemplo |
|---|---|
| tempo | `/bpm 132` · `/bpm 140 8` (rampa de 8 compassos) |
| tom | `/key F# minor` · `/key D dorian @drop` |
| camadas | `/mute kick 8` (mudo por 8 compassos) · `/unmute hats` · `/gain bass 0.7` |
| timbre/padrão | `/inst bass acid` · `/pattern hats offbeat` · `/add lead arp_up pluck` · `/remove perc` |
| efeitos | `/fx lead delay 0.5` · `/filter 0.3` (master) · `/reverb 0.3` · `/mood dark 0.8` |
| estrutura | `/goto breakdown` · `/arr intro:8 build:8 drop:32` · `/style house` |
| info | `/list patterns bass` · `/list insts lead` · `/code` · `/help` |

**Quando:** qualquer comando aceita um sufixo `@bar`, `@phrase` (8 compassos), `@section` ou `@<seção>` (ex.: `@drop`).
**Atalhos:** `Espaço` play/stop (fora do prompt) · `Esc` cancela tudo que está agendado · `↑/↓` histórico · `Tab` completa comando.
Clique numa camada para mutar/desmutar.

## Scripts

| comando | o que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento + proxy da IA (`/api/llm`) |
| `npm test` | testes (Vitest) — o compiler é testado rodando o Strudel de verdade |
| `npm run typecheck` | checagem de tipos |
| `npm run build` | build de produção |

## Licença

AGPL-3.0-or-later (o motor de áudio, [Strudel](https://strudel.cc), é AGPL). Ver `docs/PROJETO.md` §15.
