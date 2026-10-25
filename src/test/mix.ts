import { STYLES_BY_ID } from '../presets/styles';
import { createMix } from '../song/mix';

/** Mixagem padrão dos testes: techno no ar (A), melodic techno preparado (B). */
export const testMix = () => createMix(STYLES_BY_ID.techno.build(), STYLES_BY_ID.melodic.build());
