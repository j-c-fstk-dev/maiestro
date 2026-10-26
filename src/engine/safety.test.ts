import { describe, expect, it } from 'vitest';
import { forbiddenIn } from './safety';

describe('forbiddenIn', () => {
  it('aceita código musical', () => {
    expect(forbiddenIn('s("[~ cp]*2").bank("RolandTR808").room(0.4)')).toBeNull();
    expect(forbiddenIn('n("0 2 4").scale("A3:minor").s("kalimba").gain(signal(t => t % 1))')).toBeNull();
  });
  it('recusa mexer no tempo global, carregar coisas ou acessar o navegador', () => {
    expect(forbiddenIn('setcpm(200)')).toBe('setcpm');
    expect(forbiddenIn('s("bd").gain(fetch("x"))')).toBe('fetch');
    expect(forbiddenIn('window.location="x"')).toBe('window');
    expect(forbiddenIn('samples("github:x/y")')).toBe('samples');
  });
});
