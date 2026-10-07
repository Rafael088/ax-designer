// La Medicion: lo que le cuesta a un agente enterarse del repo objetivo, camino por camino.
// Sale del Inventario y del Contador; ella sola no lee disco ni lanza nada.
// Los números son estimaciones comparables entre caminos (caracteres / 4), no para facturar.

import type { Ruta } from "./inventario.ts";

/** Los caminos que `axd medir` sabe medir sin ejecutar nada del repo objetivo. */
export type IdDeCamino = "guia-de-entrada" | "resumen" | "estado-dominio" | "lectura-todo";

export type Camino = {
  id: IdDeCamino;
  /** Qué se lee en este camino, en una línea para quien lee el JSON. */
  que: string;
  /** Archivos del repo objetivo que se leen, deduplicados. */
  archivos: Ruta[];
  caracteres: number;
  tokens: number;
  /** Llamadas a herramienta que un agente necesita para recorrer el camino. */
  rondas_estimadas: number;
};

export type Medicion = {
  esquema: 1;
  raiz: string;
  /** La estimación usada, para que el número se pueda repetir. */
  caracteres_por_token: number;
  caminos: Camino[];
  /** Las métricas que la rúbrica pide por fuente `medicion`. Null: no hay camino medible. */
  metricas: {
    tokens_guia_de_entrada: number | null;
    tokens_resumen: number | null;
    tokens_camino_caro: number | null;
    /** tokens(estado-dominio) / tokens(resumen). Null si falta alguno de los dos. */
    razon_caro_barato: number | null;
  };
  /** Lo que no se pudo medir y por qué, incluido lo que le toca al validador. */
  notas: string[];
};
