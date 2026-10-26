# MAESTRO

Web app de música eletrônica ao vivo com uma IA "maestro" que recebe comandos em linguagem natural.

**Leia `docs/PROJETO.md` antes de qualquer tarefa.** É a fonte da verdade (visão, arquitetura, roadmap, decisões).

Regras rápidas:
- A música nunca para: falha de IA/rede nunca pode afetar o áudio.
- A IA emite ops JSON validadas (Zod); o `SongState` é a verdade e o código Strudel é compilado dele.
- Só `src/engine/` e `src/compiler/` conhecem o Strudel.
- A chave do LLM fica no `.env` do proxy (`server/`), nunca no navegador.
- Decisões novas entram na seção ADR do `docs/PROJETO.md`.

Comandos: `npm start` (tocar, versão otimizada) · `npm run dev` · `npm test` · `npm run typecheck`.
Desempenho: o scheduler do Strudel roda na thread principal; nada pode travar a página >~150 ms (ver "Correção — áudio picotando" no PROJETO.md).
Fluxo: comando/IA → ops (`src/song/ops.ts`) → `Timeline.schedule` (`src/scheduler`) → `compile` (`src/compiler`) → `StrudelEngine.schedule` (`src/engine`).
