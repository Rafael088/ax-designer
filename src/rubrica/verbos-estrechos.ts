// Eje 3 — Verbos estrechos, y transiciones con dueño: ¿hay operaciones con nombre en vez de
// «escribe el archivo», y qué no puede hacer el agente? Los verbos salen de las superficies que
// ya encontró el analizador (CLI, API, MCP); como el Inventario no distingue lectura de
// escritura, se aproxima por nombre (CLI/MCP) o por método HTTP (API): una lista corta y
// documentada en el propio código, no un juicio nuevo sobre el repo.
import type { CriterioDecidido, Inventario, Manejador, Ruta } from "../modelo/index.ts";
import {
  criterioJson, cumple, evidenciaArchivo, evidenciaAusencia, haySenalEnElVerbo, noAplica, noCumple, parcial, porMetrica, proporcion,
} from "./comun.ts";

const EJE = "verbos-estrechos";
export const VERBOS_DE_LECTURA = /^(estado|status|resumen|contexto|summary|listar|list|ver|show|get|buscar|search|leer|read|mostrar)$/i;
export const VERBOS_DE_CIERRE = /^(aprobar|approve|finalizar|finalize|hecho|done|merge|publish|publicar|cerrar|close|integrar)[-_]?/i;

type VerboUnificado = { nombre: string; archivo: Ruta; linea: number; escritura: boolean; manejador?: Manejador | undefined };

function ultimoSegmento(ruta: string): string {
  return ruta.split("/").filter(Boolean).pop() ?? ruta;
}

function todosLosVerbos(inventario: Inventario): VerboUnificado[] {
  return [
    ...inventario.superficies.cli.map((v) => ({ nombre: v.nombre, archivo: v.archivo, linea: v.linea, escritura: !VERBOS_DE_LECTURA.test(v.nombre), manejador: v.manejador })),
    ...inventario.superficies.api.map((r) => ({ nombre: ultimoSegmento(r.ruta), archivo: r.archivo, linea: r.linea, escritura: r.metodo !== "get" })),
    ...inventario.superficies.mcp_tools.map((t) => ({ nombre: t.nombre, archivo: t.archivo, linea: t.linea, escritura: !VERBOS_DE_LECTURA.test(t.nombre) })),
  ];
}

function operacionesConNombre(inventario: Inventario, verbos: VerboUnificado[]): CriterioDecidido {
  const c = criterioJson(EJE, "operaciones-con-nombre");
  const escritura = verbos.filter((v) => v.escritura);
  if (escritura.length === 0) {
    if (verbos.length > 0) return noAplica(c, "Los verbos expuestos son todos de lectura: el agente no tiene que cambiar estado en este proyecto.");
    return noCumple(c, "No hay verbos ni endpoints expuestos: actuar sería editar los datos a mano.", [
      evidenciaAusencia("subcomandos, endpoints o tools de escritura", "superficies.cli, superficies.api y superficies.mcp_tools del Inventario"),
    ]);
  }
  const ev = escritura.slice(0, 3).map((v) => evidenciaArchivo(v.archivo, v.linea));
  const mencionados = escritura.filter((v) => inventario.guias.some((g) => g.contenido.includes(v.nombre)));
  if (mencionados.length === escritura.length) return cumple(c, "Hay verbos de escritura y una guía los nombra como la vía para cambiar el estado.", ev);
  return parcial(c, "Hay verbos de escritura, pero ninguna guía los da como la única vía.", ev);
}

function superficieEstrecha(verbos: VerboUnificado[]): CriterioDecidido {
  const c = criterioJson(EJE, "superficie-estrecha");
  if (verbos.length === 0) return noAplica(c, "No hay verbos (eso ya es no-cumple en operaciones-con-nombre).");
  const ev = [evidenciaArchivo(verbos[0]!.archivo, verbos[0]!.linea)];
  return porMetrica(c, verbos.length, ev);
}

/**
 * Buscar una tabla de dueños en las guías confirma que está documentado; que el código lo haga
 * cumplir de verdad exigiría seguir cada verbo hasta su comprobación de permisos, que el
 * Inventario no da hecho. Por eso el máximo que esta heurística alcanza es `parcial`.
 */
function transicionesConDueno(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "transiciones-con-dueno");
  const hayFlujo = inventario.tareas.length > 0 || inventario.estado.some((e) => e.rol === "dominio");
  if (!hayFlujo) return noAplica(c, "El dominio no tiene estados ni flujo que repartir.");
  const documentado = inventario.guias.find(
    (g) => /\|\s*estado\s*\|\s*(due[ñn]o|owner)\s*\|/i.test(g.contenido) || /due[ñn]o de (la|cada) transici[oó]n/i.test(g.contenido),
  );
  if (documentado === undefined) {
    return noCumple(c, "No hay un mapa de quién puede hacer cada transición.", [evidenciaAusencia("tabla o lista de estados con su dueño", "guias[].contenido del Inventario")]);
  }
  return parcial(c, "Hay un mapa de dueños en una guía; que el código lo haga cumplir exige leerlo, no se infiere del Inventario.", [evidenciaArchivo(documentado.ruta, 1)]);
}

function sinAutoaprobacion(inventario: Inventario, verbos: VerboUnificado[]): CriterioDecidido {
  const c = criterioJson(EJE, "sin-autoaprobacion");
  const cierre = verbos.find((v) => VERBOS_DE_CIERRE.test(v.nombre));
  if (cierre !== undefined) {
    return noCumple(c, `El verbo «${cierre.nombre}» aprueba o cierra el trabajo del agente.`, [evidenciaArchivo(cierre.archivo, cierre.linea)]);
  }
  const guiaLoVeda = inventario.guias.find((g) => /es de una persona|lo marca una persona|no (lo hace|puede hacerlo) el agente/i.test(g.contenido));
  if (guiaLoVeda !== undefined) return cumple(c, "Ningún verbo del agente cierra ni aprueba, y una guía lo dice.", [evidenciaArchivo(guiaLoVeda.ruta, 1)]);
  const hayRevisionHumana = inventario.trazabilidad.bitacoras.length > 0 || inventario.tareas.some((t) => t.tareas > 0);
  if (!hayRevisionHumana) return noAplica(c, "No hay señales de que el ciclo tenga revisión humana.");
  return parcial(c, "No hay verbo de cierre, pero ninguna guía lo veda: el agente podría hacerlo editando los datos.", []);
}

function devuelveEstadoNuevo(inventario: Inventario, verbos: VerboUnificado[]): CriterioDecidido {
  const c = criterioJson(EJE, "devuelve-estado-nuevo");
  const escritura = verbos.filter((v) => v.escritura);
  if (escritura.length === 0) return noAplica(c, "No hay verbos de escritura.");
  const conSalida = escritura.filter((v) => haySenalEnElVerbo(inventario, v, ["serializa-json", "campo-de-salida"]) !== undefined);
  const prop = proporcion(conSalida.length, escritura.length)!;
  const ev = conSalida.slice(0, 2).map((v) => evidenciaArchivo(v.archivo, v.linea));
  return porMetrica(c, prop, ev);
}

export function evaluar(inventario: Inventario): CriterioDecidido[] {
  const verbos = todosLosVerbos(inventario);
  return [
    operacionesConNombre(inventario, verbos),
    superficieEstrecha(verbos),
    transicionesConDueno(inventario),
    sinAutoaprobacion(inventario, verbos),
    devuelveEstadoNuevo(inventario, verbos),
  ];
}
