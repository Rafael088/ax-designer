// El error de dominio de axd. La CLI lo serializa como { error, salida, reintentable } y sale
// con `codigo`; los módulos lo lanzan sin saber nada de la CLI.

/** 2 uso incorrecto · 3 error · 4 el destino cambió · 5 hace falta una persona. */
export type CodigoDeError = 2 | 3 | 4 | 5;

export class ErrorAx extends Error {
  readonly codigo: CodigoDeError;
  /** El siguiente paso, accionable. */
  readonly salida: string;
  readonly reintentable: boolean;
  /** Claves extra para el cuerpo del error (p. ej. los archivos que el escritor se niega a pisar). */
  readonly datos: Record<string, unknown> | undefined;

  constructor(mensaje: string, opciones: { codigo: CodigoDeError; salida: string; reintentable?: boolean; datos?: Record<string, unknown> }) {
    super(mensaje);
    this.name = "ErrorAx";
    this.codigo = opciones.codigo;
    this.salida = opciones.salida;
    this.reintentable = opciones.reintentable ?? false;
    this.datos = opciones.datos;
  }
}
