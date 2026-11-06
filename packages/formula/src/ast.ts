/**
 * Syntax der Formelsprache (angelehnt an Notion Formulas 2.0):
 *   Zahlen 1, 2.5, 1e3 · Text "a\"b" · true/false · Listen [1, 2]
 *   prop("Name") · Funktionen f(a, b) · Methoden a.f(b) (= f(a, b))
 *   Operatoren (stärkste zuerst): ^  ·  - !  ·  * / %  ·  + -  ·  < <= > >=  ·  == !=  ·  && and  ·  || or  ·  ? :
 *   let(x, 1, x + 1) · lets(a, 1, b, 2, a + b) · current und index in map/filter/...
 */

export interface Span {
  start: number;
  end: number;
}

export type Node =
  | ({ k: 'num'; v: number } & Span)
  | ({ k: 'str'; v: string } & Span)
  | ({ k: 'bool'; v: boolean } & Span)
  | ({ k: 'list'; items: Node[] } & Span)
  | ({ k: 'ident'; name: string } & Span)
  | ({ k: 'call'; name: string; args: Node[]; method: boolean; nameSpan: Span } & Span)
  | ({ k: 'unary'; op: '-' | '!'; arg: Node } & Span)
  | ({ k: 'bin'; op: BinOp; l: Node; r: Node } & Span)
  | ({ k: 'cond'; c: Node; t: Node; f: Node } & Span);

export type BinOp =
  '+' | '-' | '*' | '/' | '%' | '^' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';

export class FormulaError extends Error {
  constructor(
    message: string,
    readonly start: number,
    readonly end: number,
    readonly kind: 'syntax' | 'type' | 'runtime' = 'syntax',
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}
