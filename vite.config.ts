import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { llmProxy } from './server/llmProxy.ts';

/**
 * Acesso por outros aparelhos da rede (`--host`) liga HTTPS com certificado próprio:
 * fora do localhost o navegador só libera os AudioWorklets (supersaw, filtro, gravação)
 * em páginas seguras. O navegador vai avisar do certificado — é só aceitar uma vez.
 */
const onNetwork = process.argv.includes('--host');

export default defineConfig(({ mode }) => {
  // '' = carrega todas as variáveis do .env (não só as VITE_*), mas só no servidor
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), llmProxy(env), ...(onNetwork ? [basicSsl({ name: 'maestro' })] : [])],
    // na rede, aceita ser aberto pelo nome da máquina (ex.: kali.local), não só pelo IP
    ...(onNetwork ? { preview: { allowedHosts: true }, server: { allowedHosts: true } } : {}),
    // o motor (Strudel) é grande; o aviso de "chunk > 500 kB" não indica problema aqui
    build: { chunkSizeWarningLimit: 2000 },
    test: {
      // os pacotes do Strudel só funcionam pela entrada ESM ("module")
      server: { deps: { inline: [/@strudel/, /@kabelsalat/, /superdough/, /supradough/] } },
    },
  };
});
