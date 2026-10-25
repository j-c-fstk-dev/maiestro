import { Pattern, TimeSpan, Fraction } from '@strudel/core';

/**
 * Troca quantizada: devolve um pattern que toca `oldPat` antes do ciclo `cycle`
 * e `newPat` a partir dele.
 *
 * A troca acontece dentro da consulta do scheduler (corte exato no tempo musical),
 * então não depende de *quando* o código novo foi avaliado — só precisa estar
 * pronto antes do scheduler consultar o trecho que contém o limite.
 */
export function switchAt(oldPat: any, newPat: any, cycle: number): any {
  const boundary = Fraction(cycle);
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    if (end.lte(boundary)) return oldPat.query(state);
    if (begin.gte(boundary)) return newPat.query(state);
    return [
      ...oldPat.query(state.setSpan(new TimeSpan(begin, boundary))),
      ...newPat.query(state.setSpan(new TimeSpan(boundary, end))),
    ];
  });
}
