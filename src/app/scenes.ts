import { SongStateSchema, type SongState } from '../song/types';

/**
 * Cenas: decks salvos no navegador (localStorage). Conveniência pessoal — se o armazenamento
 * estiver bloqueado, as funções só não guardam nada.
 */

const KEY = 'maestro.scenes.v1';

export interface Scene {
  name: string;
  savedAt: string;
  state: SongState;
}

function readAll(): Record<string, Scene> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, Scene>;
    // descarta o que não for mais um SongState válido (ex.: versão antiga)
    return Object.fromEntries(Object.entries(data).filter(([, s]) => SongStateSchema.safeParse(s.state).success));
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Scene>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function saveScene(name: string, state: SongState): boolean {
  const all = readAll();
  all[name] = { name, savedAt: new Date().toISOString(), state };
  return writeAll(all);
}

export function getScene(name: string): Scene | undefined {
  return readAll()[name];
}

export function listScenes(): Scene[] {
  return Object.values(readAll()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function forgetScene(name: string): boolean {
  const all = readAll();
  if (!all[name]) return false;
  delete all[name];
  return writeAll(all);
}
