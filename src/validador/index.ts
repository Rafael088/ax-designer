// validar: tareas de prueba × {sin, con} → comparación. `ensayarValidacion` arma el plan con su
// costo estimado y falla donde fallaría la corrida, sin copiar, escribir ni gastar nada.
// `correrValidacion` prepara las copias, corre cada tarea por el motor, comprueba sin agente si
// terminó, compara y deja todo en .ax-corridas/ del repo objetivo.
import { dirname, join } from "node:path";
import type { TareasDePrueba, Comparacion, Contrato, Medicion, PlanDeCorridas, ResultadoDeCorrida, SalidaDelMotor, TablaDePrecios } from "../modelo/index.ts";
import { ErrorAx } from "../modelo/index.ts";
import { lectorDeDisco } from "../analizador/index.ts";
import { archivosDe, ensayar, esGeneradoPorAxd, escribirCorrida, GENERADORES, type Escrito } from "../generadores/index.ts";
import { comparar } from "./comparar.ts";
import type { Motor, PedidoDeCorrida, Verificador } from "./motor.ts";
import { armarPlan } from "./plan.ts";
import { costoDeUso, PRECIOS_POR_DEFECTO, precioDe } from "./precios.ts";
import { copiaParaCorrida, limpiar, prepararPlantillas } from "./preparar.ts";

export { leerTareas, validarRepeticiones, MAX_REPETICIONES, POR_DEFECTO } from "./tareas.ts";
export { leerPrecios, PRECIOS_POR_DEFECTO, precioDe, costoDeUso } from "./precios.ts";
export { armarPlan } from "./plan.ts";
export { estimar, lecturasDe, FORMULA } from "./estimacion.ts";
export { comparar, resumir } from "./comparar.ts";
export { EXCLUIDAS_DE_LA_COPIA, copiaParaCorrida, limpiar, prepararPlantillas } from "./preparar.ts";
export type { Comprobacion, Motor, NoDisponible, PedidoDeCorrida, Verificador } from "./motor.ts";

export type PedidoDeValidacion = {
  raiz: string;
  tareas: TareasDePrueba;
  /** La del repo sin lo que generó axd: lo que vería el agente en «sin». */
  medicion: Medicion;
  contrato: Contrato;
  motor: Motor;
  repeticiones?: number;
  tabla?: TablaDePrecios;
};

export type Validacion = {
  esquema: 1;
  fecha: string;
  plan: PlanDeCorridas;
  resultados: ResultadoDeCorrida[];
  comparacion: Comparacion;
};

function plan(pedido: PedidoDeValidacion, ensayo: boolean): PlanDeCorridas {
  return armarPlan(pedido.tareas, pedido.medicion, pedido.contrato, {
    raiz: pedido.raiz,
    motor: pedido.motor.nombre,
    repeticiones: pedido.repeticiones ?? pedido.tareas.repeticiones,
    ensayo,
    tabla: pedido.tabla ?? PRECIOS_POR_DEFECTO,
  });
}

/** Lo que haría fallar la corrida antes de lanzar nada: preparar el «con» o el motor. */
function comprobar(pedido: PedidoDeValidacion, elPlan: PlanDeCorridas): void {
  const lector = lectorDeDisco(pedido.raiz);
  for (const generador of GENERADORES) {
    // Lo que generó axd no se copia, así que solo estorba lo que no generó axd.
    const negados = ensayar(pedido.raiz, pedido.contrato.huella, archivosDe(generador, pedido.contrato)).archivos
      .filter((p) => p.accion === "negado" && !esGeneradoPorAxd(p.ruta, () => lector.leer(p.ruta)));
    if (negados.length > 0) {
      throw new ErrorAx(`El «con» no se puede preparar: ${negados.map((p) => p.ruta).join(", ")} existe en el repo y no lo generó axd.`, {
        codigo: 5,
        salida: "Una persona tiene que mover o borrar esos archivos del repo (axd no los pisa ni en una copia) y volver a ensayar.",
        datos: { archivos: negados.map(({ ruta, por_que }) => ({ ruta, por_que })) },
      });
    }
  }
  const falta = pedido.motor.disponible({ con: true });
  if (falta !== null) throw new ErrorAx(falta.error, { codigo: 3, salida: falta.salida, datos: { plan: elPlan } });
}

/** El plan y su costo estimado. No copia, no escribe y no gasta. */
export function ensayarValidacion(pedido: PedidoDeValidacion): PlanDeCorridas {
  const elPlan = plan(pedido, true);
  comprobar(pedido, elPlan);
  return elPlan;
}

function nombreDeCorrida(fecha: Date, contrato: string): string {
  return `${fecha.toISOString().replace(/[:.]/g, "-")}-${contrato.slice(0, 8)}`;
}

/** Corre el plan: GASTA con un motor de verdad. Devuelve la validación y lo escrito en .ax-corridas/. */
export function correrValidacion(pedido: PedidoDeValidacion, verificador: Verificador, ahora: () => Date = () => new Date()): Validacion & { escrito: Escrito } {
  const elPlan = plan(pedido, false);
  comprobar(pedido, elPlan);
  const inicio = ahora();
  const precio = precioDe(pedido.tabla ?? PRECIOS_POR_DEFECTO, pedido.tareas.modelo);
  const tareas = new Map(pedido.tareas.tareas.map((t) => [t.id, t]));
  const copias = prepararPlantillas(pedido.raiz, pedido.contrato, pedido.motor);
  const resultados: ResultadoDeCorrida[] = [];
  try {
    for (const corrida of elPlan.corridas) {
      const tarea = tareas.get(corrida.tarea)!;
      const cwd = copiaParaCorrida(copias, corrida);
      const encargo: PedidoDeCorrida = {
        corrida,
        cwd,
        enunciado: tarea.enunciado,
        modelo: pedido.tareas.modelo,
        presupuesto: tarea.presupuesto,
        mcp: corrida.variante === "con" ? { nombre: pedido.contrato.proyecto.nombre, servidor: join(cwd, "ax", "mcp", "servidor.mjs") } : null,
        temporal: dirname(cwd),
      };
      let salida: SalidaDelMotor;
      try {
        salida = pedido.motor.correr(encargo);
      } catch (e) {
        salida = { ok: false, error: "El motor lanzó una excepción.", detalle: (e as Error).message };
      }
      if (!salida.ok) {
        resultados.push({ ...corrida, estado: "fallo-motor", error: salida.error, detalle: salida.detalle });
        continue;
      }
      const { termino, comprobacion } = verificador.comprobar(tarea.terminado, cwd, salida.respuesta, tarea.presupuesto.segundos);
      const u = salida.uso;
      resultados.push({
        ...corrida,
        estado: "corrida",
        rondas: salida.rondas,
        uso: u,
        tokens: u.entrada + u.salida + u.escritura_cache + u.lectura_cache,
        usd: salida.usd ?? (precio === null ? null : costoDeUso(u, precio)),
        acabo: salida.acabo,
        motivo: salida.motivo,
        termino,
        comprobacion,
        duracion_ms: salida.duracion_ms,
      });
    }
  } finally {
    limpiar(copias);
  }
  const validacion: Validacion = { esquema: 1, fecha: inicio.toISOString(), plan: elPlan, resultados, comparacion: comparar(resultados) };
  const escrito = escribirCorrida(pedido.raiz, nombreDeCorrida(inicio, pedido.contrato.huella), JSON.stringify(validacion, null, 2) + "\n");
  return { ...validacion, escrito };
}
