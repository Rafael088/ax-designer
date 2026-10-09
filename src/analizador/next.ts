// Las rutas HTTP de Next.js, que no se declaran llamando a un router (get, post… con la ruta):
// App Router: `app/**/route.ts` (o `src/app/**`), con un export por método (`export async function
// GET`, `export const POST = …`, `export { manejador as PUT }`). Pages Router: `pages/api/**`, un
// manejador que mira `req.method`. Los segmentos `[id]` son parámetros, `[...slug]` el resto de la
// ruta, los grupos `(x)` no cuentan y una carpeta `_privada` no es ruta. Como el resto del
// analizador, es texto con expresiones regulares, no un parser.
import type { CampoDelCuerpo, CuerpoInferido, MetodoHttp, Ruta, RutaApi, TipoDeCampo } from "../modelo/index.ts";
import { definicionesDe } from "./codigo.ts";

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

function lineaDe(texto: string, indice: number): number {
  return texto.slice(0, indice).split("\n").length;
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
  const consulta = [...new Set([...texto.matchAll(/\bsearchParams\.get(?:All)?\(\s*["'`]([\w-]+)["'`]/g)].map((m) => m[1]!))].sort();
  return METODOS.flatMap((metodo): RutaApi[] => {
    const visto = vistos.get(metodo);
    if (visto === undefined) return [];
    const rango = visto.funcion !== undefined ? definiciones.get(visto.funcion) : undefined;
    const cuerpo = metodo === "GET" || metodo === "DELETE" ? undefined : cuerpoDe(archivo, texto, lineas, esquemas, rango, vistos.size);
    return [{
      metodo: metodo.toLowerCase() as MetodoHttp,
      ruta: camino,
      archivo,
      linea: visto.linea,
      marco: "next-app-router",
      ...(metodo === "GET" && consulta.length > 0 ? { consulta } : {}),
      ...(cuerpo !== undefined ? { cuerpo } : {}),
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
  const consulta = [...new Set([
    ...[...texto.matchAll(/\breq\.query\.(\w+)/g)].map((m) => m[1]!),
    ...[...texto.matchAll(/\{([^{}]*)\}\s*=\s*req\.query\b/g)].flatMap((m) => m[1]!.split(",").map((p) => p.trim().split(/\s*[:=]\s*/)[0]!)),
  ])].filter((n) => /^\w+$/.test(n) && !parametros.has(n)).sort();
  const lineas = texto.split("\n");
  const esquemas = esquemasZod(texto);
  const base = { ruta: camino, archivo, marco: "next-pages-router" as const };
  // Sin un `req.method` comparado con un literal, el manejador atiende cualquier método.
  if (metodos.size === 0) return [{ ...base, metodo: "all", linea: lineaDe(texto, manejador.index) }];
  return METODOS.flatMap((metodo): RutaApi[] => {
    const linea = metodos.get(metodo);
    if (linea === undefined) return [];
    const escritura = metodo !== "GET" && metodo !== "DELETE";
    const cuerpo = escritura ? cuerpoDe(archivo, texto, lineas, esquemas, undefined, [...metodos.keys()].filter((m) => m !== "GET" && m !== "DELETE").length) : undefined;
    return [{
      ...base,
      metodo: metodo.toLowerCase() as MetodoHttp,
      linea,
      ...(metodo === "GET" && consulta.length > 0 ? { consulta } : {}),
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
  for (const m of tramo.matchAll(/\b(\w+)((?:\.\w+\(\))*)\.(?:safeParse|parse)(?:Async)?\(/g)) {
    const esquema = esquemas.get(m[1]!);
    if (esquema === undefined) continue;
    const parcial = esquema.parcial || /\.partial\(\)/.test(m[2]!);
    return {
      origen: "zod",
      nombre: esquema.nombre,
      desde: { archivo, linea: esquema.linea },
      campos: esquema.campos.map((c) => (parcial ? { ...c, requerido: false } : c)),
    };
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

/** El índice de la llave, corchete o paréntesis que cierra el que abre en `abre`, saltando cadenas. */
function cierreDe(texto: string, abre: number): number | undefined {
  let profundidad = 0;
  let comilla: string | undefined;
  for (let i = abre; i < texto.length; i++) {
    const c = texto[i]!;
    if (comilla !== undefined) {
      if (c === "\\") i++;
      else if (c === comilla) comilla = undefined;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") comilla = c;
    else if (c === "/" && texto[i + 1] === "/") i = texto.indexOf("\n", i) === -1 ? texto.length : texto.indexOf("\n", i);
    else if (c === "{" || c === "(" || c === "[") profundidad++;
    else if (c === "}" || c === ")" || c === "]") {
      profundidad--;
      if (profundidad === 0) return i;
    }
  }
  return undefined;
}

/** Parte el cuerpo de un objeto por las comas de primer nivel. */
function entradasDeObjeto(cuerpo: string): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let comilla: string | undefined;
  let actual = "";
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i]!;
    if (comilla !== undefined) {
      actual += c;
      if (c === "\\") actual += cuerpo[++i] ?? "";
      else if (c === comilla) comilla = undefined;
      continue;
    }
    if (c === "/" && cuerpo[i + 1] === "/") {
      const fin = cuerpo.indexOf("\n", i);
      i = fin === -1 ? cuerpo.length : fin;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") comilla = c;
    else if (c === "{" || c === "(" || c === "[") profundidad++;
    else if (c === "}" || c === ")" || c === "]") profundidad--;
    if (c === "," && profundidad === 0) {
      partes.push(actual);
      actual = "";
    } else actual += c;
  }
  partes.push(actual);
  return partes.map((p) => p.trim()).filter(Boolean);
}

/** La cadena de llamadas de primer nivel de una expresión, sin lo de dentro de los paréntesis. */
function cadena(expresion: string): string {
  let salida = "";
  let profundidad = 0;
  for (const c of expresion) {
    if (c === "(" || c === "[" || c === "{") {
      if (profundidad === 0) salida += c;
      profundidad++;
    } else if (c === ")" || c === "]" || c === "}") {
      profundidad--;
      if (profundidad === 0) salida += c;
    } else if (profundidad === 0) salida += c;
  }
  return salida.replace(/\s+/g, "");
}

function camposZod(cuerpo: string, previos: Map<string, EsquemaZod>): CampoDelCuerpo[] {
  return entradasDeObjeto(cuerpo).flatMap((entrada): CampoDelCuerpo[] => {
    const m = /^["']?([\w$]+)["']?\s*:\s*([\s\S]+)$/.exec(entrada);
    if (!m) return [];
    const llamadas = cadena(m[2]!);
    return [{ nombre: m[1]!, tipo: tipoZod(llamadas, previos), requerido: !/\.(optional|nullish|default|catch)\(/.test(llamadas) && !/^z\.(optional|undefined)\(/.test(llamadas) }];
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
