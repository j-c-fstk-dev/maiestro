import { describe, expect, it } from 'vitest';
import { Mp3Encoder } from '@breezystack/lamejs';
import { PcmBuffer } from './pcm';
import { encodeWav } from './wav';

const sine = (n: number, freq: number, rate: number, amp = 0.5) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));

describe('gravação', () => {
  it('PcmBuffer junta blocos, converte para 16 bits e mede pico', () => {
    const b = new PcmBuffer(48000);
    b.push(sine(8192, 440, 48000), sine(8192, 440, 48000, 0.25));
    b.push(Float32Array.of(2, -2), Float32Array.of(0, 0)); // estoura: tem que limitar
    const d = b.toData();
    expect(d.left.length).toBe(8194);
    expect(b.seconds).toBeCloseTo(8194 / 48000);
    expect(b.peak).toBe(1);
    expect(d.left[8192]).toBe(32767);
    expect(d.left[8193]).toBe(-32768);
  });

  it('WAV tem cabeçalho certo e dados intercalados', async () => {
    const wav = encodeWav({ sampleRate: 44100, left: Int16Array.of(1, 2, 3), right: Int16Array.of(-1, -2, -3) });
    const v = new DataView(await wav.arrayBuffer());
    const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(40, true)).toBe(12);
    expect([44, 46, 48, 50].map((o) => v.getInt16(o, true))).toEqual([1, -1, 2, -2]);
    expect(wav.size).toBe(44 + 12);
  });

  it('MP3: o encoder gera frames válidos', () => {
    const b = new PcmBuffer(44100);
    b.push(sine(44100, 220, 44100), sine(44100, 330, 44100));
    const d = b.toData();
    const enc = new Mp3Encoder(2, 44100, 320);
    const out = [enc.encodeBuffer(d.left, d.right), enc.flush()];
    const bytes = out.reduce((a, o) => a + o.length, 0);
    expect(bytes).toBeGreaterThan(30000); // ~1 s a 320 kbps ≈ 40 KB
    expect(new Uint8Array(out[0])[0]).toBe(0xff); // sync word do frame MP3 (o encoder devolve Int8Array)
  });
});
