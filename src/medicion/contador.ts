// El Contador: la única fuente de tokens de axd. Un número de tokens que sale de otro sitio no
// es comparable y no vale como evidencia. La estimación es caracteres / 4, el mismo factor que
// usa la rúbrica: así una medición entra como evidencia en cualquier criterio medido.

export const CARACTERES_POR_TOKEN = 4;

export function contarTokens(caracteres: number): number {
  return Math.round(caracteres / CARACTERES_POR_TOKEN);
}
