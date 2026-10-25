import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { llmProxy } from './server/llmProxy.ts';

export default defineConfig(({ mode }) => {
  // '' = carrega todas as variáveis do .env (não só as VITE_*), mas só no servidor
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), llmProxy(env)],
    test: {
      // os pacotes do Strudel só funcionam pela entrada ESM ("module")
      server: { deps: { inline: [/@strudel/, /@kabelsalat/, /superdough/, /supradough/] } },
    },
  };
});
