import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vite.config.ts';

// Avaliação da IA com o LLM de verdade: npm run eval:ai
export default defineConfig((env) =>
  mergeConfig(typeof base === 'function' ? base(env) : base, {
    test: { include: ['src/**/*.eval.ts'], testTimeout: 180_000, fileParallelism: false, reporters: ['default'] },
  }),
);
