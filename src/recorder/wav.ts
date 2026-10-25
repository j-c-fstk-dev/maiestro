import type { PcmData } from './pcm';

/** WAV PCM 16 bits estéreo, sem perdas. */
export function encodeWav({ sampleRate, left, right }: PcmData): Blob {
  const frames = left.length;
  const dataBytes = frames * 4;
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // tamanho do bloco fmt
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // canais
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true); // bytes por segundo
  v.setUint16(32, 4, true); // bytes por frame
  v.setUint16(34, 16, true); // bits
  str(36, 'data');
  v.setUint32(40, dataBytes, true);

  // intercala L/R em blocos para não alocar um único array gigante de uma vez
  const parts: BlobPart[] = [header];
  const CHUNK = 1 << 18;
  for (let start = 0; start < frames; start += CHUNK) {
    const n = Math.min(CHUNK, frames - start);
    const inter = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) {
      inter[2 * i] = left[start + i];
      inter[2 * i + 1] = right[start + i];
    }
    parts.push(inter.buffer as ArrayBuffer);
  }
  return new Blob(parts, { type: 'audio/wav' });
}
