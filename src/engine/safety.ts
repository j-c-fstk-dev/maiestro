/**
 * Código que nunca entra no motor. O código de camadas "raw" pode vir da IA: ele só pode
 * descrever música, nunca mexer no tempo global, carregar coisas ou acessar o navegador.
 */
const FORBIDDEN = /\b(setcpm|setcps|hush|samples|fetch|eval|Function|window|document|globalThis|self|import|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|Worker|postMessage|location|navigator)\b/;

/** Devolve a palavra proibida encontrada, ou null. */
export function forbiddenIn(code: string): string | null {
  return FORBIDDEN.exec(code)?.[1] ?? null;
}
