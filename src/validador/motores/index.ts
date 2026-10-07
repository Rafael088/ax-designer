// Los motores que `axd validar --motor` sabe usar. claude gasta de verdad; mentira no lanza nada.
import type { Motor } from "../motor.ts";
import { motorClaude } from "./claude.ts";
import { motorDeMentira } from "./mentira.ts";

export { HERRAMIENTAS_BASE, argvDeClaude, configMcp, leerSalidaDeClaude, motorClaude, rutaDeConfigMcp } from "./claude.ts";
export { guionEstimado, motorDeMentira, type Guion, type Jugada } from "./mentira.ts";
export { verificador } from "./verificador.ts";
export type { Buscador, Lanzado, Lanzador, Lanzamiento } from "./lanzador.ts";

export const MOTORES: Record<string, () => Motor> = {
  claude: () => motorClaude(),
  mentira: () => motorDeMentira(),
};
