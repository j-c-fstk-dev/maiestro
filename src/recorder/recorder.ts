import { PcmBuffer } from './pcm';

/**
 * Grava a saída master. Um AudioWorklet copia o áudio em blocos e manda para cá;
 * aqui vira PCM 16 bits. Quem conecta o nó na saída é o engine (só ele conhece o Strudel).
 */

const PROCESSOR = 'maestro-capture';

// Junta os quadros de 128 amostras em blocos maiores antes de mandar (menos mensagens).
const WORKLET_SRC = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 8192;
    this.l = new Float32Array(this.size);
    this.r = new Float32Array(this.size);
    this.n = 0;
    this.port.onmessage = (e) => { if (e.data === 'flush') this.flush(); };
  }
  flush() {
    if (!this.n) return;
    const l = this.l.slice(0, this.n), r = this.r.slice(0, this.n);
    this.port.postMessage({ l, r }, [l.buffer, r.buffer]);
    this.n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const l = input[0], r = input[1] || input[0];
      for (let i = 0; i < l.length; i++) {
        this.l[this.n] = l[i];
        this.r[this.n] = r[i];
        if (++this.n === this.size) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSOR}', Capture);
`;

const loaded = new WeakSet<BaseAudioContext>();

export interface OutputTap {
  getAudioContext(): AudioContext;
  connectOutput(node: AudioNode): void;
  disconnectOutput(node: AudioNode): void;
}

export class Recorder {
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private buffer: PcmBuffer | null = null;

  constructor(private tap: OutputTap) {}

  get recording() {
    return this.buffer !== null;
  }

  get seconds() {
    return this.buffer?.seconds ?? 0;
  }

  get bytes() {
    return this.buffer?.bytes ?? 0;
  }

  get peak() {
    return this.buffer?.peak ?? 0;
  }

  async start() {
    if (this.buffer) return;
    const ctx = this.tap.getAudioContext();
    if (!loaded.has(ctx)) {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      loaded.add(ctx);
    }
    const buffer = new PcmBuffer(ctx.sampleRate);
    const node = new AudioWorkletNode(ctx, PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    node.port.onmessage = (e: MessageEvent<{ l: Float32Array; r: Float32Array }>) => buffer.push(e.data.l, e.data.r);
    // o nó precisa estar ligado ao destino para o navegador processá-lo; o ganho 0 evita som em dobro
    const sink = new GainNode(ctx, { gain: 0 });
    node.connect(sink).connect(ctx.destination);
    this.tap.connectOutput(node);
    this.node = node;
    this.sink = sink;
    this.buffer = buffer;
  }

  /** Para e devolve o que foi gravado. */
  async stop(): Promise<PcmBuffer | null> {
    const { node, sink, buffer } = this;
    if (!node || !buffer) return null;
    this.tap.disconnectOutput(node);
    node.port.postMessage('flush');
    await new Promise((r) => setTimeout(r, 100)); // tempo para o último bloco chegar
    node.port.onmessage = null;
    node.disconnect();
    sink?.disconnect();
    this.node = this.sink = this.buffer = null;
    return buffer;
  }
}
