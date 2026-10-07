// Eje 7 — Evidencia y trazabilidad: ¿cómo demuestra el agente que hizo lo que dice, y dónde queda
// quién hizo qué? De inventario: el verbo de entrega (si existe), las bitácoras que ya separó el
// analizador por autor/fecha, el comando de pruebas documentado y el criterio de hecho de
// `tareas[]`.
import type { CriterioDecidido, Inventario, Ruta } from "../modelo/index.ts";
import { criterioJson, cumple, evidenciaArchivo, evidenciaAusencia, haySenalCerca, noAplica, noCumple, parcial, porMetrica, proporcion } from "./comun.ts";

const EJE = "evidencia-y-trazabilidad";
const NOMBRE_ENTREGA = /^(entregar|entrega|deliver|submit)$/i;

type Ubicacion = { archivo: Ruta; linea: number };

function ultimoSegmento(ruta: string): string {
  return ruta.split("/").filter(Boolean).pop() ?? ruta;
}

function buscarEntrega(inventario: Inventario): Ubicacion | undefined {
  const verbo = inventario.superficies.cli.find((v) => NOMBRE_ENTREGA.test(v.nombre)) ?? inventario.superficies.mcp_tools.find((t) => NOMBRE_ENTREGA.test(t.nombre));
  if (verbo) return { archivo: verbo.archivo, linea: verbo.linea };
  const api = inventario.superficies.api.find((r) => NOMBRE_ENTREGA.test(ultimoSegmento(r.ruta)));
  return api ? { archivo: api.archivo, linea: api.linea } : undefined;
}

function entregaConEvidencia(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "entrega-con-evidencia");
  const entrega = buscarEntrega(inventario);
  if (entrega === undefined) return noAplica(c, "No se encontró un verbo de entrega: puede que en el ciclo no haya entrega ni revisión.");
  const banderas = inventario.superficies.banderas.find((b) => b.archivo === entrega.archivo)?.banderas ?? [];
  const pideEvidencia = banderas.some((b) => /^--(evidencia|evidence|prueba)\b/i.test(b));
  const ev = [evidenciaArchivo(entrega.archivo, entrega.linea)];
  if (!pideEvidencia) {
    const documentaEvidencia = inventario.guias.some((g) => /evidencia|evidence/i.test(g.contenido));
    return documentaEvidencia
      ? parcial(c, "La evidencia se pide en una guía, no en el verbo de entrega.", ev)
      : noCumple(c, "El verbo de entrega no pide evidencia.", [evidenciaAusencia("bandera --evidencia o --prueba en el verbo de entrega", entrega.archivo)]);
  }
  const rechaza = haySenalCerca(inventario, entrega.archivo, entrega.linea, ["construye-error", "codigo-de-salida"]);
  return rechaza !== undefined
    ? cumple(c, "El verbo de entrega pide evidencia y se niega si falta.", ev)
    : parcial(c, "El verbo de entrega acepta evidencia, pero no se ve que se niegue sin ella.", ev);
}

function registroDeQuienHizoQue(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "registro-de-quien-hizo-que");
  const bitacoras = inventario.trazabilidad.bitacoras;
  const conAutorYFecha = bitacoras.find((b) => b.claves.some((k) => /^(autor|author|usuario|user)$/i.test(k)) && b.claves.some((k) => /^(fecha|date|timestamp|ts)$/i.test(k)));
  if (conAutorYFecha !== undefined) return cumple(c, `La bitácora ${conAutorYFecha.ruta} guarda autor y fecha en cada operación.`, [evidenciaArchivo(conAutorYFecha.ruta, 1)]);
  if (bitacoras.length > 0) return parcial(c, "Hay una bitácora, pero no se ve que guarde autor y fecha en sus registros.", [evidenciaArchivo(bitacoras[0]!.ruta, 1)]);
  if (inventario.trazabilidad.git) return parcial(c, "No hay bitácora del dominio: solo queda el historial de git.", []);
  return noCumple(c, "Ni bitácora del dominio ni control de versiones.", [evidenciaAusencia("bitácora jsonl con autor y fecha, o un repo git", "trazabilidad del Inventario")]);
}

function pruebasRepetibles(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "pruebas-repetibles");
  const hayPruebas = inventario.pruebas.archivos.length > 0;
  const comando = inventario.pruebas.comandos[0];
  if (!hayPruebas && comando === undefined) {
    return noCumple(c, "No hay pruebas ni un comando que las corra.", [evidenciaAusencia("archivos de prueba, o un script test/check en un manifiesto", "pruebas del Inventario")]);
  }
  if (comando === undefined) return parcial(c, "Hay archivos de prueba, pero no un comando de manifiesto documentado que las corra.", [evidenciaArchivo(inventario.pruebas.archivos[0]!, 1)]);
  const documentado = inventario.guias.some((g) => g.comandos.some((cmd) => cmd.texto.includes(comando.nombre)) || g.contenido.includes(comando.nombre));
  const ev = [evidenciaArchivo(comando.manifiesto, comando.linea)];
  if (!hayPruebas) return parcial(c, `Hay un comando («${comando.nombre}»), pero no se encontraron archivos de prueba.`, ev);
  if (documentado) return cumple(c, `El comando «${comando.nombre}» está documentado en una guía y hay pruebas detrás.`, ev);
  return parcial(c, `Hay un comando de pruebas («${comando.nombre}»), pero ninguna guía lo documenta.`, ev);
}

function criterioDeHecho(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "criterio-de-hecho");
  const totalTareas = inventario.tareas.reduce((a, t) => a + t.tareas, 0);
  if (totalTareas === 0) return noAplica(c, "El repo no lleva tareas dentro.");
  const conCriterio = inventario.tareas.reduce((a, t) => a + t.con_criterio, 0);
  const prop = proporcion(conCriterio, totalTareas)!;
  const sinCriterio = inventario.tareas.flatMap((t) => t.sin_criterio);
  const ev = sinCriterio.length > 0 ? sinCriterio.slice(0, 2).map((u) => evidenciaArchivo(u.archivo, u.linea)) : [evidenciaArchivo(inventario.tareas[0]!.ruta, 1)];
  return porMetrica(c, prop, ev);
}

export function evaluar(inventario: Inventario): CriterioDecidido[] {
  return [entregaConEvidencia(inventario), registroDeQuienHizoQue(inventario), pruebasRepetibles(inventario), criterioDeHecho(inventario)];
}
