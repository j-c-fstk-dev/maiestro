import { useEffect, useState } from 'react';
import { engine } from './controller';

/** Posição atual em ciclos, atualizada a cada frame. */
export function useNow(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setNow(engine.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return now;
}
