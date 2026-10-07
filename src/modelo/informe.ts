// El Informe: lo que entrega `axd auditar`. Sale de los 7 Eje[] de la rúbrica; no vuelve a evaluar
// nada. El JSON es el contrato (esquema 1); `--formato md` lo redacta src/informe/ para personas.
import type { Eje, Hallazgo } from "./rubrica.ts";

export type Informe = {
  esquema: 1;
  raiz: string;
  /** Media simple de la puntuación de los ejes con nivel; null si ninguno tiene nivel. */
  puntuacion_global: number | null;
  /** De src/rubrica/criterios.json, para que quien lea el informe sepa a qué cobertura se exige. */
  cobertura_minima: number;
  /** Siempre los 7, también los sin nivel o no-aplica. */
  ejes: Eje[];
  /** Todos los criterios en parcial o no-cumple, de los 7 ejes, en el orden de docs/rubrica.md. */
  hallazgos: Hallazgo[];
};
