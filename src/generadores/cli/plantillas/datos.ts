// Lo propio del repo que entra en el CLI generado: un objeto JSON sacado del contrato. El código de
// las plantillas es fijo; solo esto cambia de un repo a otro.
import type { Contrato, EntradaDelVerbo, FuenteDelDominio, Implementacion, VerboDelContrato } from "../../../modelo/index.ts";

export type VerboDelCli = {
  nombre: string;
  tipo: VerboDelContrato["tipo"];
  descripcion: string;
  entradas: Pick<EntradaDelVerbo, "nombre" | "tipo" | "requerida" | "descripcion" | "como" | "posicion" | "bandera">[];
  implementacion: Implementacion;
  /** El presupuesto de su lectura en el contrato; null en las escrituras. */
  presupuesto_tokens: number | null;
};

export type DatosDelCli = {
  nombre: string;
  contrato: string;
  /** Cómo se llama al CLI, para los mensajes: `node ax/cli.mjs`. */
  programa: string;
  /** De la carpeta del CLI a la raíz del repo: el CLI resuelve las fuentes desde ahí. */
  hasta_la_raiz: string;
  fuentes: FuenteDelDominio[];
  verbos: VerboDelCli[];
  vedadas: { nombre: string; que: string; motivo: string }[];
  codigos: Contrato["codigos"];
  /** La lectura que hay que volver a hacer cuando una escritura sale con 4. */
  relectura: string | null;
  /** El presupuesto del estado nuevo que devuelven las escrituras: el de la lectura más barata. */
  presupuesto_del_estado_nuevo: number;
};

const PRESUPUESTO_POR_DEFECTO = 500;

export function datosDelCli(contrato: Contrato): DatosDelCli {
  const presupuestos = new Map(contrato.lecturas.map((l) => [l.verbo, l.presupuesto_tokens]));
  const resumen = contrato.verbos.find((v) => v.implementacion.tipo === "resumen")?.nombre;
  const lectura = contrato.verbos.find((v) => v.tipo === "lectura" && v.implementacion.tipo !== "sin-implementar")?.nombre;
  const minimo = Math.min(...contrato.lecturas.map((l) => l.presupuesto_tokens));
  const segmentos = contrato.cli.ruta.split("/").length - 1;
  return {
    nombre: contrato.proyecto.nombre,
    contrato: contrato.huella,
    programa: [contrato.cli.programa, ...contrato.cli.argumentos].join(" "),
    hasta_la_raiz: segmentos === 0 ? "." : Array.from({ length: segmentos }, () => "..").join("/"),
    fuentes: contrato.dominio.fuentes,
    verbos: contrato.verbos.map((v) => ({
      nombre: v.nombre,
      tipo: v.tipo,
      descripcion: v.descripcion,
      entradas: v.entradas.map(({ nombre, tipo, requerida, descripcion, como, posicion, bandera }) => ({ nombre, tipo, requerida, descripcion, como, posicion, bandera })),
      implementacion: v.implementacion,
      presupuesto_tokens: v.tipo === "lectura" ? (presupuestos.get(v.nombre) ?? PRESUPUESTO_POR_DEFECTO) : null,
    })),
    vedadas: contrato.vedadas.map(({ nombre, que, motivo }) => ({ nombre, que, motivo })),
    codigos: contrato.codigos,
    relectura: resumen ?? lectura ?? null,
    presupuesto_del_estado_nuevo: Number.isFinite(minimo) ? minimo : PRESUPUESTO_POR_DEFECTO,
  };
}
