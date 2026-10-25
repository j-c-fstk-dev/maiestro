import { Pattern, TimeSpan, Fraction, signal } from '@strudel/core';

/**
 * Funções que o código compilado chama (ficam no escopo global do Strudel).
 * Elas conhecem o arranjo em ciclos absolutos, então a posição na música é sempre
 * derivada do relógio — trocar o código nunca "reinicia" nada.
 */

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Toca as seções em sequência, em loop, a partir do ciclo `anchor`.
 * Cada seção é consultada no tempo absoluto (padrões como "<a b c d>" continuam fluindo).
 */
export function maestroArrange(anchor: number, sections: [number, any][]): any {
  const lengths = sections.map(([bars]) => bars);
  const loop = lengths.reduce((a, b) => a + b, 0);
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));

  const sectionIndexAt = (cycle: number) => {
    const pos = mod(cycle - anchor, loop);
    let i = 0;
    while (i < starts.length - 1 && pos >= starts[i] + lengths[i]) i++;
    return { i, pos };
  };

  return new Pattern((state: any) => {
    const haps: any[] = [];
    let begin = state.span.begin;
    const end = state.span.end;
    while (begin.lt(end)) {
      const b = begin.valueOf();
      const { i, pos } = sectionIndexAt(b);
      // ciclo absoluto em que esta seção termina (sempre inteiro)
      const sectionEnd = Math.round(b - pos + starts[i] + lengths[i]);
      const cut = Fraction(sectionEnd).lt(end) ? Fraction(sectionEnd) : end;
      haps.push(...sections[i][1].query(state.setSpan(new TimeSpan(begin, cut))));
      begin = cut;
    }
    return haps;
  });
}

/**
 * Rampa de `from` a `to` ao longo de uma seção (start/bars relativos ao arranjo).
 * Fora da seção vale `from` antes e `to` depois (dentro da mesma volta do loop).
 */
export function maestroRamp(anchor: number, loop: number, start: number, bars: number, from: number, to: number): any {
  return signal((t: number) => {
    const x = Math.min(1, Math.max(0, (mod(t - anchor, loop) - start) / bars));
    return from + (to - from) * x;
  });
}

/**
 * Envelope em ciclos absolutos: pontos [ciclo, valor], interpolação linear,
 * constante antes do primeiro e depois do último (transições entre decks).
 */
export function maestroEnv(points: [number, number][]): any {
  return signal((t: number) => {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i];
      if (t <= x1) {
        const [x0, y0] = points[i - 1];
        return x1 === x0 ? y1 : y0 + ((y1 - y0) * (t - x0)) / (x1 - x0);
      }
    }
    return points[points.length - 1][1];
  });
}

export function installArrangeHelpers(scope: Record<string, unknown> = globalThis as any) {
  Object.assign(scope, { maestroArrange, maestroRamp, maestroEnv });
}
