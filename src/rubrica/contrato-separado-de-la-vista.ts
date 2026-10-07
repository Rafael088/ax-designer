// Eje 2 — Contrato separado de la vista: ¿el estado del dominio vive en un formato que el agente
// lee directo, y el de interfaz aparte? Los cinco criterios son de inventario: se leen del rol
// (dominio/interfaz) que el analizador ya asignó a cada archivo de estado y de los contratos que
// encontró (modelo, tipos, schema).
import type { CriterioDecidido, Inventario } from "../modelo/index.ts";
import { criterioJson, cumple, evidenciaArchivo, evidenciaAusencia, noAplica, noCumple, parcial } from "./comun.ts";

const EJE = "contrato-separado-de-la-vista";
const FORMATOS_ABIERTOS = new Set(["json", "jsonl", "yaml", "toml", "csv", "markdown"]);

function dominioLegible(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "dominio-legible");
  const dominio = inventario.estado.filter((e) => e.rol === "dominio");
  const hayVerbos = inventario.superficies.cli.length + inventario.superficies.api.length + inventario.superficies.mcp_tools.length > 0;
  if (dominio.length === 0) {
    if (!hayVerbos) return noAplica(c, "El proyecto no expone verbos ni endpoints: puede no tener estado propio.");
    return noCumple(c, "Hay verbos o endpoints, pero no se encontró estado del dominio persistido en un formato reconocido.", [
      evidenciaAusencia("archivo de estado del dominio (json, jsonl, yaml, toml, csv, markdown, sqlite)", "estado[] del Inventario"),
    ]);
  }
  const ev = dominio.slice(0, 3).map((e) => evidenciaArchivo(e.ruta, 1));
  const abiertos = dominio.filter((e) => FORMATOS_ABIERTOS.has(e.formato));
  if (abiertos.length === dominio.length) return cumple(c, `El estado del dominio vive en ${[...new Set(dominio.map((e) => e.formato))].join(", ")}: formato abierto.`, ev);
  const haySchema = inventario.contratos.length > 0 || inventario.senales.some((s) => s.tipo === "tabla-de-auditoria");
  if (abiertos.length === 0 && haySchema) return cumple(c, "El estado del dominio vive en sqlite, con esquema en migraciones o contratos.", ev);
  return parcial(c, "Parte del estado del dominio exige conocer la implementación (sqlite sin esquema visible, u otro binario).", ev);
}

/**
 * `clasificarEstado` del analizador da a cada archivo un único rol: nunca hay un archivo que sea
 * dominio e interfaz a la vez. Por eso, si hay estado de interfaz, siempre está en archivos
 * propios: el no-cumple (mezclado en el mismo archivo) queda para cuando el analizador distinga
 * roles dentro de un mismo archivo.
 */
function interfazAparte(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "interfaz-aparte");
  const interfaz = inventario.estado.filter((e) => e.rol === "interfaz");
  if (interfaz.length === 0) return noAplica(c, "No se encontró estado de interfaz persistido.");
  return cumple(c, "El estado de interfaz vive en archivos propios, separados de los del dominio.", interfaz.slice(0, 2).map((e) => evidenciaArchivo(e.ruta, 1)));
}

function lecturaSinLaVista(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "lectura-sin-la-vista");
  const hayInterfaz = inventario.senales.some((s) => s.tipo === "importa-interfaz");
  if (!hayInterfaz) return noAplica(c, "El proyecto no tiene interfaz para personas.");
  const archivoEstructurado = inventario.estado.find((e) => e.rol === "dominio" && e.claves !== undefined);
  if (archivoEstructurado !== undefined) {
    return cumple(c, "Hay estado del dominio con claves: el agente lo lee sin pasar por la interfaz.", [evidenciaArchivo(archivoEstructurado.ruta, 1)]);
  }
  const serializa = inventario.senales.find((s) => s.tipo === "serializa-json");
  if (serializa !== undefined) return cumple(c, "Hay un verbo que serializa JSON: el agente no tiene que raspar la interfaz.", [evidenciaArchivo(serializa.archivo, serializa.linea)]);
  return noCumple(c, "No se encontró un camino de datos estructurados: para enterarse hay que mirar la interfaz.", [
    evidenciaAusencia("estado del dominio con claves, o una señal de serialización JSON", "estado[] y senales[] del Inventario"),
  ]);
}

function contratoDocumentado(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "contrato-documentado");
  if (inventario.contratos.length === 0) {
    return noCumple(c, "No hay un archivo de tipos, schema ni documento que describa el formato.", [
      evidenciaAusencia("modelo/, types/, *.schema.json, openapi.* o un documento de formato", "contratos[] del Inventario"),
    ]);
  }
  const formal = inventario.contratos.find((ct) => ct.tipo === "json-schema" || ct.tipo === "openapi" || ct.tipo === "tipos" || ct.tipo === "modelo");
  const ev = inventario.contratos.slice(0, 2).map((ct) => evidenciaArchivo(ct.ruta, 1));
  return formal !== undefined ? cumple(c, `El formato está documentado en ${formal.ruta}.`, ev) : parcial(c, "Solo hay un documento informal del formato.", ev);
}

function modeloSobreElAlmacenamiento(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "modelo-sobre-el-almacenamiento");
  const dominio = inventario.estado.filter((e) => e.rol === "dominio");
  if (dominio.length === 0) return noAplica(c, "El proyecto no tiene estado propio.");
  const modelo = inventario.contratos.find((ct) => ct.tipo === "modelo" || ct.tipo === "tipos");
  if (modelo === undefined) {
    return noCumple(c, "No hay una capa de modelo separada: el contrato del agente es el formato de disco.", [
      evidenciaAusencia("carpeta modelo/, tipos/ o un módulo de tipos del dominio", "contratos[] del Inventario"),
    ]);
  }
  return cumple(c, `Hay una capa de modelo en ${modelo.ruta}.`, [evidenciaArchivo(modelo.ruta, 1)]);
}

export function evaluar(inventario: Inventario): CriterioDecidido[] {
  return [
    dominioLegible(inventario),
    interfazAparte(inventario),
    lecturaSinLaVista(inventario),
    contratoDocumentado(inventario),
    modeloSobreElAlmacenamiento(inventario),
  ];
}
