import type { PcmData } from './pcm';
import type { Mp3Message } from './mp3.worker';

/** MP3 (padrão 320 kbps) via Web Worker. */
export function encodeMp3(pcm: PcmData, onProgress?: (p: number) => void, kbps = 320): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Mp3Message>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress?.(m.value);
      else {
        worker.terminate();
        if (m.type === 'done') resolve(m.blob);
        else reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    // cópias: o PCM original continua disponível para baixar o WAV depois
    worker.postMessage({ sampleRate: pcm.sampleRate, left: pcm.left.slice(), right: pcm.right.slice(), kbps });
  });
}
