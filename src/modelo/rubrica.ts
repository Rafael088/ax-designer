// Lo que decide cada criterio de la rúbrica y en qué queda cada eje. Sin E/S: estos tipos los
// llenan los evaluar() de src/rubrica/ a partir del Inventario y la Medicion, y los lee el
// informe. Los umbrales y la escala que los producen son datos, en src/rubrica/criterios.json
// (docs/rubrica.md).

import type { Ruta } from "./inventario.ts";

export type Resultado = "cumple" | "parcial" | "no-cumple" | "no-aplica" | "sin-evidencia";

/** Un sitio exacto del repo objetivo, citado como prueba de lo que afirma el criterio. */
export type EvidenciaArchivo = { tipo: "archivo"; ruta: Ruta; linea: number };
/** Un camino medido por el Contador y su número. */
export type EvidenciaMedicion = { tipo: "medicion"; camino: string; tokens: number; archivos?: Ruta[] };
/** Lo que se buscó y dónde, para que un no-cumple por ausencia sea repetible. */
export type EvidenciaAusencia = { tipo: "ausencia"; buscado: string; en: string };
/** Solo la produce el validador (`axd validar --correr`); `axd auditar` nunca la emite. */
export type EvidenciaCorrida = { tipo: "corrida"; comando: string; codigo: number; salida: string };

export type Evidencia = EvidenciaArchivo | EvidenciaMedicion | EvidenciaAusencia | EvidenciaCorrida;

export type Impacto = "contexto" | "riesgo";

/** Un criterio ya decidido: el resultado, su peso y por qué, con su evidencia. */
export type CriterioDecidido = {
  id: string;
  resultado: Resultado;
  /** 2 · 1 · 0 si `resultado` cuenta; null si no-aplica o sin-evidencia. */
  valor: number | null;
  peso: number;
  critico: boolean;
  impacto: Impacto;
  /** Por qué salió este resultado, en una línea. */
  motivo: string;
  evidencia: Evidencia[];
};

/** Un criterio en `parcial` o `no-cumple`: lo que el informe ordena por lo que ahorra o el riesgo que quita. */
export type Hallazgo = {
  criterio: string;
  eje: string;
  numero_eje: number;
  /** Posición del criterio en su eje dentro de criterios.json: el último desempate, para que el orden sea estable. */
  orden_criterio: number;
  resultado: "parcial" | "no-cumple";
  critico: boolean;
  /** peso × (2 − valor); el orden principal entre hallazgos. */
  brecha: number;
  impacto: Impacto;
  /** Solo si `impacto` es «contexto» y hay medición: tokens que ahorraría el cambio. Si no, null. */
  ahorro_tokens: number | null;
  motivo: string;
  evidencia: Evidencia[];
};

export type Eje = {
  id: string;
  numero: number;
  nombre: string;
  pregunta: "enterarse" | "actuar" | "demostrar";
  /** round(100 × Σ(peso × valor) / Σ(peso × 2)) sobre los criterios que cuentan; null si ninguno cuenta. */
  puntuacion: number | null;
  /** 0 ausente · 1 incipiente · 2 suficiente · 3 ejemplar; null si no_aplica o cobertura < cobertura_minima. */
  nivel: number | null;
  nombre_nivel: string | null;
  /** Σ peso de los que cuentan / Σ peso de los que aplican; null si el eje entero es no-aplica. */
  cobertura: number | null;
  no_aplica: boolean;
  motivo_no_aplica: string | null;
  criterios: CriterioDecidido[];
  /** Los criterios de este eje en parcial o no-cumple, en el orden de criterios.json. El informe
   *  los junta con los de los otros 6 ejes y los ordena por lo que ahorran o el riesgo que quitan. */
  hallazgos: Hallazgo[];
};
