/** Áudio gravado em PCM 16 bits, estéreo, guardado em blocos (cresce sem copiar tudo). */

export interface PcmData {
  sampleRate: number;
  left: Int16Array;
  right: Int16Array;
}

export class PcmBuffer {
  private left: Int16Array[] = [];
  private right: Int16Array[] = [];
  private frames = 0;
  /** maior amplitude vista (0..1), para o medidor e para avisar de gravação muda */
  peak = 0;

  constructor(readonly sampleRate: number) {}

  push(l: Float32Array, r: Float32Array) {
    const li = new Int16Array(l.length);
    const ri = new Int16Array(r.length);
    let peak = this.peak;
    for (let i = 0; i < l.length; i++) {
      const a = clamp(l[i]);
      const b = clamp(r[i]);
      li[i] = a < 0 ? a * 0x8000 : a * 0x7fff;
      ri[i] = b < 0 ? b * 0x8000 : b * 0x7fff;
      const m = Math.max(Math.abs(a), Math.abs(b));
      if (m > peak) peak = m;
    }
    this.peak = peak;
    this.left.push(li);
    this.right.push(ri);
    this.frames += l.length;
  }

  get seconds() {
    return this.frames / this.sampleRate;
  }

  get bytes() {
    return this.frames * 4;
  }

  toData(): PcmData {
    return { sampleRate: this.sampleRate, left: concat(this.left, this.frames), right: concat(this.right, this.frames) };
  }
}

const clamp = (x: number) => (x > 1 ? 1 : x < -1 ? -1 : x);

function concat(parts: Int16Array[], length: number) {
  const out = new Int16Array(length);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
