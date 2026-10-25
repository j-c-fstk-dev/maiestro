# MAESTRO

Web app de música eletrônica ao vivo com uma **IA maestro**: você monta a base (estilo, BPM, tom, estrutura),
dá play e vai mudando a música com comandos em linguagem natural. As mudanças entram no tempo certo,
sem travar.

> Status: **Fase 0 (spike técnico)**. Visão, arquitetura e roadmap estão em [`docs/PROJETO.md`](docs/PROJETO.md).

## Rodar localmente

Requisitos: Node 20+.

```bash
npm install
cp .env.example .env     # coloque sua chave da z.ai em LLM_API_KEY
npm run dev              # abre em http://localhost:5173
```

Na página da Fase 0:
1. **▶ tocar A** — começa o techno de teste (na primeira vez, os samples são baixados do GitHub).
2. **Troca quantizada** — os botões trocam A↔B no próximo compasso ou na próxima frase. Compare com "B agora (sem quantizar)".
3. **build** — o filtro high-pass sobe por 8 compassos e o drop entra exatamente no compasso seguinte.
4. **IA** — manda a frase pra z.ai e mostra o JSON que o maestro devolveu, a latência e os tokens. Nada disso afeta o áudio ainda.

## Scripts

| comando | o que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento + proxy da IA (`/api/llm`) |
| `npm test` | testes (Vitest) |
| `npm run typecheck` | checagem de tipos |
| `npm run build` | build de produção |

## Licença

AGPL-3.0-or-later (o motor de áudio, [Strudel](https://strudel.cc), é AGPL). Ver `docs/PROJETO.md` §15.
