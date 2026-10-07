// Lo que pasa por el validador: el archivo de tareas de prueba, el plan de corridas con su costo
// estimado, lo que devuelve cada corrida y la comparación «sin» contra «con». Sin E/S.
//
// Una tarea de prueba es lo que se le pide a un agente de verdad sobre el repo objetivo, una vez
// sin lo que generó axd y otra con ello. Su criterio de terminado se comprueba sin
// agente, sobre la copia del repo después de la corrida o sobre la respuesta del agente.

import type { Ruta } from "./inventario.ts";

/** «sin»: la copia del repo tal cual. «con»: la copia con `generar cli` y `generar mcp` aplicados. */
export type Variante = "sin" | "con";

export const VARIANTES: readonly Variante[] = ["sin", "con"];

/** Cómo se sabe, sin preguntarle a un agente, que la tarea quedó hecha. */
export type CriterioDeTerminado =
  /** Un comando en la raíz de la copia; terminó si sale con `codigo` (0 si se omite). */
  | { tipo: "comando"; argv: string[]; codigo?: number }
  /** Un archivo de la copia contiene el texto. */
  | { tipo: "archivo-contiene"; ruta: Ruta; texto: string }
  /** La respuesta final del agente contiene el texto (para tareas de solo lectura). */
  | { tipo: "respuesta-contiene"; texto: string };

/** Los topes de una corrida. Al motor real se le pasan como límites duros. */
export type Presupuesto = {
  /** Máximo de rondas (turnos del agente). */
  rondas: number;
  /** Tope de gasto de una corrida, en dólares. */
  usd: number;
  /** Tope de tiempo de una corrida. */
  segundos: number;
};

export type TareaDePrueba = {
  id: string;
  enunciado: string;
  terminado: CriterioDeTerminado;
  presupuesto: Presupuesto;
};

export type TareasDePrueba = {
  esquema: 1;
  /** Alias del modelo que se le pasa al motor (p. ej. «sonnet»); el precio sale de este nombre. */
  modelo: string;
  repeticiones: number;
  tareas: TareaDePrueba[];
};

/** El precio de un modelo, en dólares por millón de tokens, con de dónde salió. */
export type Precio = {
  entrada: number;
  salida: number;
  escritura_cache: number;
  lectura_cache: number;
};

export type TablaDePrecios = {
  fuente: string;
  fecha: string;
  /** false: los números no se comprobaron contra la fuente en la fecha; trátalos como supuesto. */
  verificado: boolean;
  /** Lo que la estimación supone y no se mide: tokens fijos del agente por ronda y de salida por ronda. */
  supuestos: { contexto_base_tokens: number; salida_por_ronda_tokens: number; fuente: string };
  modelos: Record<string, Precio>;
};

/** Lo que el agente leería en una variante, en tokens del Contador. */
export type LecturaEstimada = {
  que: string;
  archivos: Ruta[];
  tokens: number;
};

export type Estimacion = {
  rondas: number;
  tokens_entrada: number;
  tokens_salida: number;
  /** Null si no hay precio para el modelo. */
  usd: number | null;
  /** Lo que más podría gastar por el presupuesto de la tarea, pase lo que pase. */
  usd_tope: number;
  lecturas: LecturaEstimada[];
};

export type CorridaPlaneada = {
  /** `<tarea>/<variante>/<repeticion>`, estable para cruzar plan y resultados. */
  id: string;
  tarea: string;
  variante: Variante;
  repeticion: number;
  estimacion: Estimacion;
};

export type PlanDeCorridas = {
  esquema: 1;
  ensayo: boolean;
  raiz: string;
  motor: string;
  modelo: string;
  repeticiones: number;
  contrato: string;
  corridas: CorridaPlaneada[];
  total: {
    corridas: number;
    tokens_entrada: number;
    tokens_salida: number;
    usd: number | null;
    usd_tope: number;
  };
  /** Cómo se estimó, para que el número se pueda repetir o corregir. */
  estimacion: {
    formula: string;
    caracteres_por_token: number;
    precios: { fuente: string; fecha: string; verificado: boolean; modelo: Precio | null };
    supuestos: TablaDePrecios["supuestos"];
  };
  notas: string[];
};

export type Uso = {
  entrada: number;
  salida: number;
  escritura_cache: number;
  lectura_cache: number;
};

/** Lo que devuelve un motor tras una corrida: qué hizo el agente, no si la tarea quedó hecha. */
export type SalidaDelMotor =
  | {
      ok: true;
      rondas: number;
      uso: Uso;
      /** Lo que el motor dice que costó; null si no lo dice. */
      usd: number | null;
      /** Si el agente acabó por su cuenta (no por tope de rondas, de gasto o de tiempo). */
      acabo: boolean;
      motivo: string;
      respuesta: string;
      duracion_ms: number;
    }
  | { ok: false; error: string; detalle: string };

export type ResultadoDeCorrida = CorridaPlaneada & (
  | {
      estado: "corrida";
      rondas: number;
      uso: Uso;
      tokens: number;
      usd: number | null;
      acabo: boolean;
      motivo: string;
      /** Lo que dice el criterio de terminado, comprobado sin agente. */
      termino: boolean;
      comprobacion: string;
      duracion_ms: number;
    }
  | { estado: "fallo-motor"; error: string; detalle: string }
);

/** Resumen de una variante de una tarea sobre sus repeticiones válidas. Medianas. */
export type ResumenDeVariante = {
  corridas: number;
  fallos_del_motor: number;
  terminadas: number;
  tasa_terminado: number | null;
  rondas: number | null;
  tokens: number | null;
  usd: number | null;
};

export type Veredicto = "con-mejor" | "con-peor" | "empate" | "sin-datos";

export type ComparacionDeTarea = {
  tarea: string;
  sin: ResumenDeVariante;
  con: ResumenDeVariante;
  /** con − sin; null si falta alguno. Negativo es mejor para «con» salvo en tasa_terminado. */
  diferencia: { tasa_terminado: number | null; rondas: number | null; tokens: number | null; usd: number | null };
  veredicto: Veredicto;
  por_que: string;
};

export type Comparacion = {
  tareas: ComparacionDeTarea[];
  veredictos: Record<Veredicto, number>;
};
