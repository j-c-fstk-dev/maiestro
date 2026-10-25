/// <reference lib="webworker" />
import { Mp3Encoder } from '@breezystack/lamejs';

/** Codifica PCM 16 bits estéreo em MP3 fora da thread principal (a música não engasga). */

export interface Mp3Request {
  sampleRate: number;
  left: Int16Array;
  right: Int16Array;
  kbps: number;
}

export type Mp3Message = { type: 'progress'; value: number } | { type: 'done'; blob: Blob } | { type: 'error'; message: string };

const BLOCK = 1152 * 20;

self.onmessage = (e: MessageEvent<Mp3Request>) => {
  try {
    const { sampleRate, left, right, kbps } = e.data;
    const enc = new Mp3Encoder(2, sampleRate, kbps);
    const parts: BlobPart[] = [];
    let lastReport = 0;
    for (let i = 0; i < left.length; i += BLOCK) {
      const out = enc.encodeBuffer(left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK));
      if (out.length) parts.push(new Uint8Array(out));
      const progress = i / left.length;
      if (progress - lastReport > 0.02) {
        lastReport = progress;
        post({ type: 'progress', value: progress });
      }
    }
    const end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    post({ type: 'done', blob: new Blob(parts, { type: 'audio/mpeg' }) });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
};

const post = (m: Mp3Message) => (self as unknown as Worker).postMessage(m);
