import { useEffect, useState } from 'react';
import { engine } from './controller';

/** Atualizações da tela por segundo: suficiente para compasso/tempo e não disputa a thread com o áudio. */
const FPS = 10;

/** Posição atual em ciclos. */
export function useNow(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(engine.now()), 1000 / FPS);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Compasso atual (inteiro): só re-renderiza quando o compasso muda. */
export function useBar(): number {
  const [bar, setBar] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setBar(Math.floor(engine.now())), 1000 / FPS);
    return () => clearInterval(id);
  }, []);
  return bar;
}
