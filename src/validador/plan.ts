// El plan: cada tarea × {sin, con} × repeticiones, con su estimación. Las variantes se alternan
// dentro de cada repetición para que un cambio del motor a mitad de camino (caché, carga) no caiga
// todo del mismo lado.
import type { TareasDePrueba, Contrato, CorridaPlaneada, Medicion, PlanDeCorridas, TablaDePrecios } from "../modelo/index.ts";
import { VARIANTES } from "../modelo/index.ts";
import { CARACTERES_POR_TOKEN } from "../medicion/index.ts";
import { FORMULA, estimar } from "./estimacion.ts";
import { precioDe, redondear } from "./precios.ts";

export type OpcionesDelPlan = {
  raiz: string;
  motor: string;
  repeticiones: number;
  ensayo: boolean;
  tabla: TablaDePrecios;
};

export function armarPlan(tareas: TareasDePrueba, medicion: Medicion, contrato: Contrato, opciones: OpcionesDelPlan): PlanDeCorridas {
  const precio = precioDe(opciones.tabla, tareas.modelo);
  const corridas: CorridaPlaneada[] = [];
  for (const tarea of tareas.tareas) {
    for (let repeticion = 1; repeticion <= opciones.repeticiones; repeticion++) {
      const orden = repeticion % 2 === 1 ? VARIANTES : [...VARIANTES].reverse();
      for (const variante of orden) {
        corridas.push({ id: `${tarea.id}/${variante}/${repeticion}`, tarea: tarea.id, variante, repeticion, estimacion: estimar(tarea, variante, medicion, contrato, opciones.tabla, precio) });
      }
    }
  }
  const suma = (f: (c: CorridaPlaneada) => number) => corridas.reduce((a, c) => a + f(c), 0);
  const notas: string[] = [];
  if (precio === null) notas.push(`No hay precio para el modelo «${tareas.modelo}» en la tabla: usd queda en null. Usa un alias de la tabla (${Object.keys(opciones.tabla.modelos).join(", ")}) o pasa --precios.`);
  if (!opciones.tabla.verificado) notas.push("Los precios no están verificados contra su fuente (verificado: false): el usd estimado es un orden de magnitud. El tope de gasto real es usd_tope.");
  notas.push("Con una suscripción de Claude Code en vez de una clave de API, la corrida consume cuota y total_cost_usd es lo que costaría por API.");
  return {
    esquema: 1,
    ensayo: opciones.ensayo,
    raiz: opciones.raiz,
    motor: opciones.motor,
    modelo: tareas.modelo,
    repeticiones: opciones.repeticiones,
    contrato: contrato.huella,
    corridas,
    total: {
      corridas: corridas.length,
      tokens_entrada: suma((c) => c.estimacion.tokens_entrada),
      tokens_salida: suma((c) => c.estimacion.tokens_salida),
      usd: precio === null ? null : redondear(suma((c) => c.estimacion.usd ?? 0)),
      usd_tope: redondear(suma((c) => c.estimacion.usd_tope)),
    },
    estimacion: {
      formula: FORMULA,
      caracteres_por_token: CARACTERES_POR_TOKEN,
      precios: { fuente: opciones.tabla.fuente, fecha: opciones.tabla.fecha, verificado: opciones.tabla.verificado, modelo: precio },
      supuestos: opciones.tabla.supuestos,
    },
    notas,
  };
}
