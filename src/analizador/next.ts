// Las rutas HTTP de Next.js, que no se declaran llamando a un router (get, post… con la ruta):
// App Router: `app/**/route.ts` (o `src/app/**`), con un export por método (`export async function
// GET`, `export const POST = …`, `export { manejador as PUT }`). Pages Router: `pages/api/**`, un
// manejador que mira `req.method`. Los segmentos `[id]` son parámetros, `[...slug]` el resto de la
// ruta, los grupos `(x)` no cuentan y una carpeta `_privada` no es ruta. Como el resto del
// analizador, es texto con expresiones regulares, no un parser.
import type { CampoDelCuerpo, CuerpoInferido, MetodoHttp, Ruta, RutaApi, TipoDeCampo } from "../modelo/index.ts";
import { definicionesDe } from "./codigo.ts";
import { detallesZod, documentacionDe, parametrosDeConsulta, respuestaDe } from "./manejador.ts";
import { cadena, cierreDe, entradasDeObjeto, lineaDe } from "./texto-ts.ts";

const APP_ROUTER = /(?:^|\/)app\/((?:[^/]+\/)*)route\.[cm]?[jt]sx?$/;
const PAGES_API = /(?:^|\/)pages\/(api(?:\/[^/]+)*?)\.[cm]?[jt]sx?$/;
const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Metodo = (typeof METODOS)[number];

/** Las rutas de un archivo de Next, o [] si el archivo no es una ruta de Next. */
export function rutasNext(ruta: Ruta, texto: string): RutaApi[] {
  const app = APP_ROUTER.exec(ruta);
  if (app) {
    const camino = caminoDe(app[1]!.split("/").filter(Boolean));
    return camino === undefined ? [] : rutasDelAppRouter(ruta, texto, camino);
  }
  const pages = PAGES_API.exec(ruta);
  if (pages) {
    const segmentos = pages[1]!.split("/");
    if (segmentos.at(-1) === "index") segmentos.pop();
    const camino = caminoDe(segmentos);
    return camino === undefined ? [] : rutasDelPagesRouter(ruta, texto, camino);
  }
  return [];
}

/** De los segmentos de carpeta a la ruta HTTP; undefined si una carpeta privada la saca del enrutado. */
function caminoDe(segmentos: string[]): string | undefined {
  const partes: string[] = [];
  for (const s of segmentos) {
    if (s.startsWith("_")) return undefined;
    if (/^\(.*\)$/.test(s) || s.startsWith("@")) continue;
    const opcional = /^\[\[\.\.\.(\w+)\]\]$/.exec(s);
    const resto = /^\[\.\.\.(\w+)\]$/.exec(s);
    const parametro = /^\[(\w+)\]$/.exec(s);
    if (opcional) partes.push(`:${opcional[1]}*?`);
    else if (resto) partes.push(`:${resto[1]}*`);
    else if (parametro) partes.push(`:${parametro[1]}`);
    else partes.push(s);
  }
  return "/" + partes.join("/");
}

function rutasDelAppRouter(archivo: Ruta, texto: string, camino: string): RutaApi[] {
  const vistos = new Map<Metodo, { linea: number; funcion?: string }>();
  const poner = (metodo: string, indice: number, funcion?: string) => {
    if ((METODOS as readonly string[]).includes(metodo) && !vistos.has(metodo as Metodo)) {
      vistos.set(metodo as Metodo, { linea: lineaDe(texto, indice), ...(funcion !== undefined ? { funcion } : {}) });
    }
  };
  for (const m of texto.matchAll(/^[ \t]*export\s+(?:async\s+)?function\s*\*?\s*(GET|POST|PUT|PATCH|DELETE)\b/gm)) poner(m[1]!, m.index, m[1]);
  for (const m of texto.matchAll(/^[ \t]*export\s+(?:const|let|var)\s+(GET|POST|PUT|PATCH|DELETE)\b/gm)) poner(m[1]!, m.index, m[1]);
  // `export const { GET, POST } = handlers` (auth.js) y `export { manejador as GET }`.
  for (const m of texto.matchAll(/^[ \t]*export\s+(?:const|let|var)\s*\{([^}]*)\}\s*=/gm)) {
    for (const nombre of m[1]!.split(",").map((p) => p.trim().split(/\s*:\s*/).pop()!)) poner(nombre, m.index);
  }
  for (const m of texto.matchAll(/^[ \t]*export\s*\{([^}]*)\}/gm)) {
    for (const parte of m[1]!.split(",")) {
      const [local, alias] = parte.trim().split(/\s+as\s+/);
      if (local) poner(alias ?? local, m.index, local);
    }
  }
  const lineas = texto.split("\n");
  const definiciones = definicionesDe(lineas, "typescript");
  const esquemas = esquemasZod(texto);
  const detalle = parametrosDeConsulta(texto, "next-app-router", esquemas);
  const consulta = detalle.map((p) => p.nombre);
  return METODOS.flatMap((metodo): RutaApi[] => {
    const visto = vistos.get(metodo);
    if (visto === undefined) return [];
    const rango = visto.funcion !== undefined ? definiciones.get(visto.funcion) : undefined;
    const cuerpo = metodo === "GET" || metodo === "DELETE" ? undefined : cuerpoDe(archivo, texto, lineas, esquemas, rango, vistos.size);
    const respuesta = rango !== undefined
      ? respuestaDe(lineas.slice(rango.linea - 1, rango.hasta).join("\n"), rango.linea, texto, metodo === "GET" ? detalle : [])
      : undefined;
    const doc = documentacionDe(lineas, visto.linea);
    return [{
      metodo: metodo.toLowerCase() as MetodoHttp,
      ruta: camino,
      archivo,
      linea: visto.linea,
      marco: "next-app-router",
      ...(metodo === "GET" && consulta.length > 0 ? { consulta, consulta_detalle: detalle } : {}),
      ...(cuerpo !== undefined ? { cuerpo } : {}),
      ...(respuesta !== undefined ? { respuesta } : {}),
      ...(doc !== undefined ? { doc } : {}),
    }];
  });
}

function rutasDelPagesRouter(archivo: Ruta, texto: string, camino: string): RutaApi[] {
  const metodos = new Map<Metodo, number>();
  const poner = (metodo: string, indice: number) => {
    const m = metodo.toUpperCase();
    if ((METODOS as readonly string[]).includes(m) && !metodos.has(m as Metodo)) metodos.set(m as Metodo, lineaDe(texto, indice));
  };
  for (const m of texto.matchAll(/\b(?:req|request)\.method\s*={2,3}\s*["'`](\w+)["'`]|["'`](\w+)["'`]\s*={2,3}\s*(?:req|request)\.method\b/g)) poner(m[1] ?? m[2]!, m.index);
  if (/\bswitch\s*\(\s*(?:req|request)\.method\s*\)/.test(texto)) {
    for (const m of texto.matchAll(/\bcase\s+["'`](\w+)["'`]\s*:/g)) poner(m[1]!, m.index);
  }
  const manejador = /^[ \t]*export\s+default\b/m.exec(texto);
  if (manejador === null) return [];
  const parametros = new Set([...camino.matchAll(/:(\w+)/g)].map((m) => m[1]!));
  const lineas = texto.split("\n");
  const esquemas = esquemasZod(texto);
  const detalle = parametrosDeConsulta(texto, "next-pages-router", esquemas, parametros);
  const consulta = detalle.map((p) => p.nombre);
  // La respuesta solo se sabe de qué método es si el manejador atiende uno solo.
  const lineaDelManejador = lineaDe(texto, manejador.index);
  const respuestaUnica = metodos.size <= 1 ? respuestaDe(texto, 1, texto, detalle) : undefined;
  const doc = documentacionDe(lineas, lineaDelManejador);
  const base = {
    ruta: camino, archivo, marco: "next-pages-router" as const,
    ...(respuestaUnica !== undefined ? { respuesta: respuestaUnica } : {}),
    ...(doc !== undefined ? { doc } : {}),
  };
  // Sin un `req.method` comparado con un literal, el manejador atiende cualquier método.
  if (metodos.size === 0) return [{ ...base, metodo: "all", linea: lineaDelManejador, ...(consulta.length > 0 ? { consulta, consulta_detalle: detalle } : {}) }];
  return METODOS.flatMap((metodo): RutaApi[] => {
    const linea = metodos.get(metodo);
    if (linea === undefined) return [];
    const escritura = metodo !== "GET" && metodo !== "DELETE";
    const cuerpo = escritura ? cuerpoDe(archivo, texto, lineas, esquemas, undefined, [...metodos.keys()].filter((m) => m !== "GET" && m !== "DELETE").length) : undefined;
    return [{
      ...base,
      metodo: metodo.toLowerCase() as MetodoHttp,
      linea,
      ...(metodo === "GET" && consulta.length > 0 ? { consulta, consulta_detalle: detalle } : {}),
      ...(cuerpo !== undefined ? { cuerpo } : {}),
    }];
  });
}

// --- el cuerpo, del esquema zod que valida el manejador ---

type EsquemaZod = { nombre: string; linea: number; campos: CampoDelCuerpo[]; parcial: boolean };

/**
 * El cuerpo que valida el manejador: el esquema zod con el que llama a `.parse(`/`.safeParse(`
 * dentro de su función, o, si no se ve la función, el único esquema que se usa así en el archivo
 * (solo si hay un único método que escribe: si no, no se sabe de cuál es).
 */
function cuerpoDe(
  archivo: Ruta, texto: string, lineas: readonly string[], esquemas: Map<string, EsquemaZod>,
  rango: { linea: number; hasta: number } | undefined, escrituras: number,
): CuerpoInferido | undefined {
  const tramo = rango !== undefined ? lineas.slice(rango.linea - 1, rango.hasta).join("\n") : escrituras === 1 ? texto : undefined;
  if (tramo === undefined) return undefined;
  const comoCuerpo = (esquema: EsquemaZod, parcial: boolean): CuerpoInferido => ({
    origen: "zod",
    nombre: esquema.nombre,
    desde: { archivo, linea: esquema.linea },
    campos: esquema.campos.map((c) => (parcial ? { ...c, requerido: false } : c)),
  });
  for (const m of tramo.matchAll(/\b(\w+)((?:\.\w+\(\))*)\.(?:safeParse|parse)(?:Async)?\(/g)) {
    const esquema = esquemas.get(m[1]!);
    if (esquema === undefined) continue;
    return comoCuerpo(esquema, esquema.parcial || /\.partial\(\)/.test(m[2]!));
  }
  // Sin parse a la vista, el esquema que se pasa a un ayudante que lee el cuerpo (`leerCuerpo(req, ventaSchema)`), si es uno solo.
  const pasados = [...new Set([...tramo.matchAll(/\(\s*\w+\s*,\s*(\w+)((?:\.\w+\(\))*)\s*\)/g)].filter((m) => esquemas.has(m[1]!)).map((m) => `${m[1]}${m[2]}`))];
  if (pasados.length === 1) {
    const [, nombre, cadenaDeLlamadas] = /^(\w+)(.*)$/.exec(pasados[0]!)!;
    const esquema = esquemas.get(nombre!)!;
    return comoCuerpo(esquema, esquema.parcial || /\.partial\(\)/.test(cadenaDeLlamadas!));
  }
  return undefined;
}

/** Los `const x = z.object({ … })` del archivo, con sus campos de primer nivel. */
export function esquemasZod(texto: string): Map<string, EsquemaZod> {
  const esquemas = new Map<string, EsquemaZod>();
  for (const m of texto.matchAll(/\b(?:const|let|var)\s+(\w+)(?:\s*:[^=]+)?\s*=\s*z\s*\.\s*(?:strictObject|looseObject|object)\(\s*\{/g)) {
    const abre = m.index + m[0].length - 1;
    const cierra = cierreDe(texto, abre);
    if (cierra === undefined) continue;
    const tras = texto.slice(cierra + 1, cierra + 40);
    esquemas.set(m[1]!, {
      nombre: m[1]!,
      linea: lineaDe(texto, m.index),
      campos: camposZod(texto.slice(abre + 1, cierra), esquemas),
      parcial: /^\s*\)\s*\.partial\(\)/.test(tras),
    });
  }
  return esquemas;
}

function camposZod(cuerpo: string, previos: Map<string, EsquemaZod>): CampoDelCuerpo[] {
  return entradasDeObjeto(cuerpo).flatMap((entrada): CampoDelCuerpo[] => {
    const m = /^["']?([\w$]+)["']?\s*:\s*([\s\S]+)$/.exec(entrada);
    if (!m) return [];
    const llamadas = cadena(m[2]!);
    const tipo = tipoZod(llamadas, previos);
    return [{ nombre: m[1]!, tipo, requerido: !/\.(optional|nullish|default|catch)\(/.test(llamadas) && !/^z\.(optional|undefined)\(/.test(llamadas), ...detallesZod(m[2]!, tipo) }];
  });
}

function tipoZod(llamadas: string, previos: Map<string, EsquemaZod>): TipoDeCampo {
  const base = /^z\.(?:coerce\.)?(\w+)/.exec(llamadas)?.[1];
  if (base === undefined) return previos.has(/^(\w+)/.exec(llamadas)?.[1] ?? "") ? "objeto" : "otro";
  if (base === "number") return /\.int\(\)/.test(llamadas) ? "entero" : "numero";
  if (base === "int" || base === "int32" || base === "bigint") return "entero";
  if (base === "boolean") return "booleano";
  if (base === "array" || base === "tuple" || base === "set") return "lista";
  if (base === "object" || base === "record" || base === "strictObject" || base === "looseObject" || base === "map") return "objeto";
  if (base === "date") return "fecha";
  if (/^(string|email|uuid|url|cuid2?|ulid|enum|nativeEnum|literal|iso|ipv4|ipv6|base64|e164|jwt|nanoid|emoji)$/.test(base)) return "texto";
  return "otro";
}
