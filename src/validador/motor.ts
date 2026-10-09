// Lo que el validador le pide a un motor. Las implementaciones viven en motores/, lo único de axd
// que lanza procesos; esta interfaz no hace E/S, así que el resto del validador se prueba con un
// motor de mentira sin lanzar nada.
import type { CorridaPlaneada, CriterioDeTerminado, Presupuesto, Ruta, SalidaDelMotor } from "../modelo/index.ts";

export type PedidoDeCorrida = {
  corrida: CorridaPlaneada;
  /** La copia del repo donde trabaja el agente. */
  cwd: string;
  enunciado: string;
  modelo: string;
  presupuesto: Presupuesto;
  /** En «con», el MCP generado: el nombre con el que se registra y la ruta absoluta de su servidor. */
  mcp: { nombre: string; servidor: string } | null;
  /** Una carpeta fuera de la copia donde el motor puede dejar lo suyo (p. ej. la config del MCP). */
  temporal: string;
};

/** Por qué un motor no puede correr, con el siguiente paso. */
export type NoDisponible = { error: string; salida: string };

export interface Motor {
  readonly nombre: string;
  /** La guía que el agente del motor carga solo al entrar (CLAUDE.md para claude): ahí va la línea que apunta a ax/cli.md. */
  readonly guia: Ruta;
  /** null si puede correr. No lanza nada caro: solo mira si está lo que hace falta (`mcp`: el «con» lleva el MCP generado). */
  disponible(variantes: { con: boolean; mcp?: boolean }): NoDisponible | null;
  /** Lo que la copia «con» necesita antes de las corridas (instalar el SDK del MCP generado). Lanza ErrorAx si falla. */
  prepararCon(copia: string): void;
  /** Una corrida. No lanza: un fallo vuelve como `{ ok: false }`. */
  correr(pedido: PedidoDeCorrida): SalidaDelMotor;
}

export type Comprobacion = { termino: boolean; comprobacion: string };

/** Comprueba el criterio de terminado sobre la copia, sin agente. */
export interface Verificador {
  comprobar(criterio: CriterioDeTerminado, copia: string, respuesta: string, segundos: number): Comprobacion;
}
