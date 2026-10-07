// Eje 5 — Contexto progresivo: ¿se puede pedir poco y luego más? Reusa el resumen que detecta
// lectura-barata y añade lista (un verbo o endpoint que devuelve varias cosas) y detalle (uno que
// pide un identificador). `tres-tamanos`, `filtros` y `lectura-acotada` giran sobre esa lista.
import type { CriterioDecidido, Inventario, Medicion, Ruta } from "../modelo/index.ts";
import { buscarResumen, type Resumen } from "./lectura-barata.ts";
import { criterioJson, cumple, evidenciaArchivo, evidenciaAusencia, evidenciaMedicion, noAplica, noCumple, parcial, porMetrica } from "./comun.ts";

const EJE = "contexto-progresivo";
// «buscar/search/find» son tan nombre-de-lista como «listar/list»: un verbo que filtra y
// devuelve varias cosas, sea cual sea el verbo con el que el dominio lo llame. Sin ellos, un
// repo en español cuyo verbo de lista se llama `buscar` salía con tres-tamanos y filtros en
// no-cumple o no-aplica aunque el verbo existiera (hallazgo en un repo real en español).
const NOMBRE_LISTA = /^(listar|list|buscar|search|find)$/i;
// Lo mismo para detalle: `leer` (sin guion) es tan detalle como `leer-` o `get-`.
const NOMBRE_DETALLE = /detalle|^obtener$|^get-|^get$|^leer$|^leer-|^ver$|^mostrar$|^show$|^read$/i;
const BANDERAS_NO_FILTRO = new Set(["--json", "--help", "--version", "--dry-run", "--aplicar", "--apply", "--correr", "--simular", "--ensayo", "--confirm", "--formato", "--format"]);
const BANDERAS_DE_LIMITE = /^--(limite|limit|max|page|pagina|offset|top)\b/i;

type Ubicacion = { archivo: Ruta; linea: number };

function buscarLista(inventario: Inventario): Ubicacion | undefined {
  const verbo = inventario.superficies.cli.find((v) => NOMBRE_LISTA.test(v.nombre)) ?? inventario.superficies.mcp_tools.find((t) => NOMBRE_LISTA.test(t.nombre));
  if (verbo) return { archivo: verbo.archivo, linea: verbo.linea };
  const api = inventario.superficies.api.find((r) => r.metodo === "get");
  return api ? { archivo: api.archivo, linea: api.linea } : undefined;
}

function buscarDetalle(inventario: Inventario): Ubicacion | undefined {
  const tool = inventario.superficies.mcp_tools.find((t) => NOMBRE_DETALLE.test(t.nombre));
  if (tool) return { archivo: tool.archivo, linea: tool.linea };
  const api = inventario.superficies.api.find((r) => r.metodo === "get" && /[:{]\w+[}]?/.test(r.ruta));
  if (api) return { archivo: api.archivo, linea: api.linea };
  const verbo = inventario.superficies.cli.find((v) => NOMBRE_DETALLE.test(v.nombre));
  return verbo ? { archivo: verbo.archivo, linea: verbo.linea } : undefined;
}

function ubicacionDeResumen(resumen: Resumen | undefined): Ubicacion | undefined {
  if (resumen === undefined) return undefined;
  return resumen.tipo === "verbo" ? { archivo: resumen.archivo, linea: resumen.linea } : { archivo: resumen.ruta, linea: 1 };
}

function cabeEnElResumen(medicion: Medicion): number | undefined {
  const caro = medicion.metricas.tokens_camino_caro;
  return caro !== null && caro < 500 ? caro : undefined;
}

function tresTamanos(medicion: Medicion, resumen: Ubicacion | undefined, lista: Ubicacion | undefined, detalle: Ubicacion | undefined): CriterioDecidido {
  const c = criterioJson(EJE, "tres-tamanos");
  const cabe = cabeEnElResumen(medicion);
  if (cabe !== undefined) return noAplica(c, `El estado del dominio entero cabe en ${cabe} tokens: no hay nada que trocear.`);
  const presentes = [resumen, lista, detalle].filter((u): u is Ubicacion => u !== undefined);
  const ev = presentes.slice(0, 3).map((u) => evidenciaArchivo(u.archivo, u.linea));
  return porMetrica(c, presentes.length, ev);
}

function contarFiltros(inventario: Inventario, lista: Ubicacion | undefined): number {
  if (lista === undefined) return 0;
  const banderas = inventario.superficies.banderas.find((b) => b.archivo === lista.archivo)?.banderas ?? [];
  return banderas.filter((b) => !BANDERAS_NO_FILTRO.has(b.split("=")[0]!)).length;
}

function filtros(inventario: Inventario, medicion: Medicion, lista: Ubicacion | undefined): CriterioDecidido {
  const c = criterioJson(EJE, "filtros");
  if (lista === undefined) return noAplica(c, "No hay lectura de lista.");
  const cabe = cabeEnElResumen(medicion);
  if (cabe !== undefined) return noAplica(c, `El estado del dominio entero cabe en ${cabe} tokens.`);
  return porMetrica(c, contarFiltros(inventario, lista), [evidenciaArchivo(lista.archivo, lista.linea)]);
}

function identificadoresEstables(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "identificadores-estables");
  const dominio = inventario.estado.filter((e) => e.rol === "dominio");
  if (dominio.length === 0) return noAplica(c, "El proyecto no tiene entidades que el agente tenga que nombrar.");
  const conId = dominio.filter((e) => e.claves?.some((k) => /^id$/i.test(k)) ?? false);
  if (conId.length === 0) {
    return noCumple(c, "Las entidades del dominio no guardan un id: la identidad sería la posición.", [
      evidenciaAusencia("clave id en el estado del dominio", dominio.map((e) => e.ruta).join(", ")),
    ]);
  }
  const aceptanId = inventario.superficies.banderas.some((b) => b.banderas.some((f) => /^--id$/i.test(f))) || inventario.superficies.api.some((r) => /[:{]id\}?\b/i.test(r.ruta));
  const ev = [evidenciaArchivo(conId[0]!.ruta, 1)];
  if (conId.length === dominio.length && aceptanId) return cumple(c, "Las entidades guardan un id estable y los verbos lo aceptan.", ev);
  return parcial(c, conId.length < dominio.length ? "No todas las entidades del dominio guardan un id." : "Hay id, pero no se ve que los verbos lo acepten.", ev);
}

function guiaDeEntradaAcotada(medicion: Medicion): CriterioDecidido {
  const c = criterioJson(EJE, "guia-de-entrada-acotada");
  const tokens = medicion.metricas.tokens_guia_de_entrada;
  if (tokens === null) return noCumple(c, "No hay una guía de entrada que el agente cargue solo al entrar.", [evidenciaAusencia("AGENTS.md, CLAUDE.md o llms.txt", "guias[] del Inventario")]);
  const camino = medicion.caminos.find((cm) => cm.id === "guia-de-entrada");
  return porMetrica(c, tokens, [evidenciaMedicion("guia-de-entrada", tokens, camino?.archivos)]);
}

/**
 * Que el tope sea el valor por defecto (cumple) frente a uno que hay que pedir (parcial) exige
 * saber si el código lo aplica sin que se lo pidan; el Inventario solo dice si la bandera existe.
 * Por eso el máximo que esta heurística alcanza es `parcial`.
 */
function lecturaAcotada(inventario: Inventario, medicion: Medicion, lista: Ubicacion | undefined): CriterioDecidido {
  const c = criterioJson(EJE, "lectura-acotada");
  if (lista === undefined) return noAplica(c, "No hay lectura de lista.");
  const cabe = cabeEnElResumen(medicion);
  if (cabe !== undefined) return noAplica(c, `El estado del dominio entero cabe en ${cabe} tokens.`);
  const banderas = inventario.superficies.banderas.find((b) => b.archivo === lista.archivo)?.banderas ?? [];
  const tope = banderas.find((b) => BANDERAS_DE_LIMITE.test(b));
  if (tope === undefined) return noCumple(c, "La lectura de lista no tiene límite ni paginación.", [evidenciaAusencia("--limite, --max, --page o --offset en la lista", lista.archivo)]);
  return parcial(c, `Hay un tope disponible (${tope}), pero no se ve que sea el valor por defecto.`, [evidenciaArchivo(lista.archivo, lista.linea)]);
}

export function evaluar(inventario: Inventario, medicion: Medicion): CriterioDecidido[] {
  const resumen = ubicacionDeResumen(buscarResumen(inventario));
  const lista = buscarLista(inventario);
  const detalle = buscarDetalle(inventario);
  return [
    tresTamanos(medicion, resumen, lista, detalle),
    filtros(inventario, medicion, lista),
    identificadoresEstables(inventario),
    guiaDeEntradaAcotada(medicion),
    lecturaAcotada(inventario, medicion, lista),
  ];
}
