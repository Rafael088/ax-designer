// Las descripciones de los verbos HTTP y de sus entradas, sacadas de lo que el analizador vio en
// el manejador: qué devuelve (las claves de la respuesta o la consulta de Prisma de la que sale),
// de qué periodo es cada cosa, y el valor por defecto y los topes de cada parámetro. Es lo que lee
// el agente en `--help`, en ax/cli.md y en cada tool del MCP para no abrir el código. Lo que no se
// vio no se dice: se omite, o se dice que no se pudo seguir.
import type {
  CampoDelCuerpo, ClaveDeRespuesta, ConsultaPrisma, ModeloDeDatos, ParametroDeConsulta, PeriodoInferido, RespuestaInferida, RutaApi, TipoDeCampo,
} from "../modelo/index.ts";

type Modelos = readonly ModeloDeDatos[];

const TIPO: Partial<Record<TipoDeCampo, string>> = { numero: "número", entero: "entero", texto: "texto", booleano: "booleano", fecha: "fecha" };

export function describirPeriodo(p: PeriodoInferido, parametros: Parametros = []): string {
  if (p.parametro !== undefined) return `de los últimos «${p.parametro}» días${defecto(p.parametro, parametros)}`;
  if (p.hasta === null || p.hasta >= 1) return p.desde === 0 ? "de hoy" : `de los últimos ${1 - p.desde} días`;
  const dias = p.hasta - p.desde;
  if (dias === 1) return p.desde === -1 ? "de ayer" : `del día de hace ${-p.desde} días`;
  return `de ${dias} días, de hace ${-p.desde} a hace ${1 - p.hasta} días`;
}

function modeloDe(nombre: string, modelos: Modelos): ModeloDeDatos | undefined {
  const n = nombre.toLowerCase();
  return modelos.find((m) => m.nombre.toLowerCase() === n || m.tabla?.toLowerCase() === n);
}

/** `Venta (id, fecha, total, metodoPago; con items)`: el modelo con sus columnas, si se conoce. */
function registro(c: ConsultaPrisma, modelos: Modelos): string {
  const modelo = modeloDe(c.modelo, modelos);
  const nombre = modelo?.nombre ?? c.modelo;
  const columnas = modelo?.campos.filter((x) => !x.relacion).map((x) => x.nombre) ?? [];
  const partes = [
    ...(columnas.length > 0 ? [columnas.length > 10 ? `${columnas.slice(0, 10).join(", ")}…` : columnas.join(", ")] : []),
    ...(c.incluye !== undefined ? [`con ${c.incluye.join(", ")}`] : []),
  ];
  return partes.length > 0 ? `${nombre} (${partes.join("; ")})` : nombre;
}

/** Los parámetros de consulta de la ruta, para decir su defecto y su tope donde la descripción los nombra. */
type Parametros = readonly ParametroDeConsulta[];

/** « (por defecto 30, máximo 200)»: lo que se sabe del valor de un parámetro, o nada. */
function defecto(nombre: string, parametros: Parametros): string {
  const p = parametros.find((x) => x.nombre === nombre);
  const partes = [
    ...(p?.por_defecto !== undefined ? [`por defecto ${valor(p.por_defecto)}`] : []),
    ...(p?.maximo !== undefined ? [`máximo ${numero(p.maximo)}`] : []),
  ];
  return partes.length > 0 ? ` (${partes.join(", ")})` : "";
}

function tope(c: ConsultaPrisma, parametros: Parametros): string | undefined {
  if (c.tope === undefined) return undefined;
  return typeof c.tope === "number" ? `como mucho ${c.tope}` : `como mucho «${c.tope}»${defecto(c.tope, parametros)}`;
}

function orden(c: ConsultaPrisma): string | undefined {
  return c.orden === undefined ? undefined : `ordenada por ${c.orden.join(", ")}`;
}

/** Lo que es una consulta de Prisma como respuesta, en pocas palabras. */
function describirConsulta(c: ConsultaPrisma, modelos: Modelos, corta: boolean, parametros: Parametros): string {
  const modelo = modeloDe(c.modelo, modelos)?.nombre ?? c.modelo;
  if (c.operacion === "groupBy") {
    return [`${modelo} agrupado por ${c.agrupa?.join(", ") ?? "?"}`, orden(c), tope(c, parametros)].filter(Boolean).join(", ");
  }
  if (c.operacion === "findMany") return [corta ? `lista de ${modelo}` : `una lista de ${registro(c, modelos)}`, orden(c), tope(c, parametros)].filter(Boolean).join(", ");
  const que = corta ? modelo : registro(c, modelos);
  if (/^find/.test(c.operacion)) return `un registro de ${que}`;
  if (/^create$/.test(c.operacion)) return `el registro creado de ${que}`;
  if (/^update$/.test(c.operacion)) return `el registro actualizado de ${que}`;
  if (/^upsert$/.test(c.operacion)) return `el registro creado o actualizado de ${que}`;
  if (/^delete$/.test(c.operacion)) return `el registro borrado de ${que}`;
  return `lo que da ${c.modelo}.${c.operacion}`;
}

function describirClave(k: ClaveDeRespuesta, modelos: Modelos, parametros: Parametros): string {
  if (k.claves !== undefined) return `${k.nombre} {${k.claves.map((x) => describirClave(x, modelos, parametros)).join(", ")}}`;
  const detalles = [
    ...(k.periodo !== undefined ? [describirPeriodo(k.periodo, parametros)] : []),
    ...(k.consulta !== undefined ? [describirConsulta(k.consulta, modelos, true, parametros)] : []),
  ];
  return detalles.length > 0 ? `${k.nombre} (${detalles.join("; ")})` : k.nombre;
}

/** Lo que devuelve la ruta, o undefined si no se pudo seguir. */
export function describirRespuesta(r: RespuestaInferida | undefined, modelos: Modelos, parametros: Parametros = []): string | undefined {
  if (r === undefined) return undefined;
  if (r.forma === "objeto" && r.claves !== undefined) {
    return r.claves.length === 0 ? "un objeto vacío" : `un objeto con ${r.claves.map((k) => describirClave(k, modelos, parametros)).join(", ")}`;
  }
  if (r.consulta === undefined) return undefined;
  const partes = [
    describirConsulta(r.consulta, modelos, false, parametros),
    ...(r.periodo !== undefined ? [describirPeriodo(r.periodo, parametros)] : []),
    ...(r.anade !== undefined ? [`y a cada uno le añade ${r.anade.join(", ")}`] : []),
  ];
  return partes.join(", ");
}

function numero(v: number): string {
  return Number.isInteger(v) && Math.abs(v) >= 10_000 ? v.toLocaleString("es") : String(v);
}

function topes(minimo: number | undefined, maximo: number | undefined, unidad = ""): string | undefined {
  if (minimo !== undefined && maximo !== undefined) return minimo === maximo ? `exactamente ${numero(minimo)}${unidad}` : `de ${numero(minimo)} a ${numero(maximo)}${unidad}`;
  if (minimo !== undefined) return `mínimo ${numero(minimo)}${unidad}`;
  if (maximo !== undefined) return `máximo ${numero(maximo)}${unidad}`;
  return undefined;
}

function valor(v: string | number | boolean): string {
  return typeof v === "string" ? `«${v}»` : String(v);
}

/** La descripción de un parámetro de consulta: qué hace con la respuesta, su tipo, por defecto y topes. */
export function describirParametro(nombre: string, p: ParametroDeConsulta | undefined, ruta: RutaApi, donde: string): string {
  if (p === undefined) return `El parámetro de consulta «${nombre}» que lee el manejador (${donde}).`;
  const r = ruta.respuesta;
  const efectos = [
    ...(r?.consulta?.tope === nombre ? ["cuántos devuelve"] : []),
    ...(r?.periodo?.parametro === nombre || r?.claves?.some((k) => k.periodo?.parametro === nombre) ? [`el periodo: los últimos «${nombre}» días`] : []),
  ];
  const partes = [
    ...(p.tipo !== undefined && TIPO[p.tipo] !== undefined ? [TIPO[p.tipo]!] : []),
    ...(p.requerido === true ? ["requerido"] : []),
    ...(efectos.length > 0 ? [`fija ${efectos.join(" y ")}`] : p.filtra === true ? ["filtra lo que devuelve"] : []),
    ...(p.valores !== undefined ? [`valores que entiende: ${p.valores.map(valor).join(", ")}`] : []),
    ...(p.por_defecto !== undefined ? [`por defecto ${valor(p.por_defecto)}`] : []),
    ...(topes(p.minimo, p.maximo, p.tipo === "texto" ? " caracteres" : "") !== undefined ? [topes(p.minimo, p.maximo, p.tipo === "texto" ? " caracteres" : "")!] : []),
  ];
  const linea = `${ruta.archivo}:${p.linea}`;
  if (partes.length === 0) return `El parámetro de consulta «${nombre}»; no se vio su valor por defecto ni sus topes (${linea}).`;
  return `Parámetro de consulta «${nombre}»: ${partes.join("; ")} (${linea}).`;
}

/** Un campo del cuerpo con lo que se sabe de él: `cantidad (entero, requerido, de 1 a 100)`. */
export function describirCampo(c: CampoDelCuerpo, tipo: string): string {
  const unidad = c.tipo === "texto" ? " caracteres" : c.tipo === "lista" ? " elemento(s)" : "";
  const partes = [
    tipo,
    ...(c.requerido ? ["requerido"] : []),
    ...(c.por_defecto !== undefined ? [`por defecto ${valor(c.por_defecto)}`] : []),
    ...(topes(c.minimo, c.maximo, unidad) !== undefined ? [topes(c.minimo, c.maximo, unidad)!] : []),
    ...(c.valores !== undefined ? [`uno de ${c.valores.map(valor).join(", ")}`] : c.valores_de !== undefined ? [`uno de ${c.valores_de}`] : []),
  ];
  return `${c.nombre} (${partes.join(", ")})`;
}

/** La descripción del verbo de una ruta HTTP. `metodo` es el que se llama (all → GET). */
export function describirVerboHttp(ruta: RutaApi, metodo: string, conCuerpo: boolean, modelos: Modelos): string {
  const doc = ruta.doc !== undefined ? `${ruta.doc.replace(/[.\s]+$/, "")}. ` : "";
  const respuesta = describirRespuesta(ruta.respuesta, modelos, ruta.consulta_detalle);
  const peticion = `${metodo} ${ruta.ruta}`;
  const devuelve = respuesta !== undefined
    ? `devuelve ${respuesta}`
    : `no se pudo seguir qué devuelve (mira ${ruta.archivo}:${ruta.linea})`;
  if (metodo === "GET") return `${doc}Lee ${peticion}: ${devuelve}. No cambia nada.`;
  const con = conCuerpo ? " con el cuerpo de --cuerpo" : "";
  return `${doc}Hace ${peticion}${con}: ${devuelve}. Sin aplicar es un ensayo que dice qué petición haría y no la hace.`;
}
