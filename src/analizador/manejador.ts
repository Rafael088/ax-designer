// Lo que hace un manejador HTTP de TypeScript, leído como texto: qué parámetros de
// consulta lee (también por alias: `const p = new URL(req.url).searchParams; p.get("x")`, la
// desestructuración, `Object.fromEntries(searchParams)` con zod, `req.query`) con su valor por
// defecto y sus topes; qué devuelve al salir bien (las claves del objeto o la consulta de Prisma de
// la que sale), y de qué periodo de fechas sale cada cosa (`inicioDelDia(-29)`: los últimos 30
// días). Describe lo que se ve; lo que no se puede seguir se queda fuera, no se adivina.
import type {
  CampoDelCuerpo, ClaveDeRespuesta, ConsultaPrisma, ParametroDeConsulta, PeriodoInferido, RespuestaInferida, TipoDeCampo,
} from "../modelo/index.ts";
import {
  cadena, cierreDe, definicionesDeVariables, entradasDeObjeto, finDeSentencia, identificadores, lineaDe, literal, llamadasDeCadena, sinCadenas,
  type Definicion,
} from "./texto-ts.ts";

// --- los detalles de un campo de zod ---

/** Valor por defecto, topes y valores de un campo de zod (`z.coerce.number().int().max(200).default(30)`). */
export function detallesZod(expresion: string, tipo: TipoDeCampo): Omit<CampoDelCuerpo, "nombre" | "tipo" | "requerido"> {
  const detalles: Omit<CampoDelCuerpo, "nombre" | "tipo" | "requerido"> = {};
  const numero = (a: string) => {
    const v = literal(entradasDeObjeto(a)[0] ?? "");
    return typeof v === "number" ? v : undefined;
  };
  for (const { nombre, argumentos } of llamadasDeCadena(expresion)) {
    if (nombre === "default") {
      const v = literal(argumentos);
      if (v !== undefined) detalles.por_defecto = v;
    } else if (nombre === "min" || nombre === "gte" || nombre === "length") {
      const v = numero(argumentos);
      if (v !== undefined) detalles.minimo = v;
      if (nombre === "length" && v !== undefined) detalles.maximo = v;
    } else if (nombre === "gt" && tipo === "entero") {
      const v = numero(argumentos);
      if (v !== undefined) detalles.minimo = v + 1;
    } else if (nombre === "max" || nombre === "lte") {
      const v = numero(argumentos);
      if (v !== undefined) detalles.maximo = v;
    } else if (nombre === "positive" && tipo === "entero") detalles.minimo = 1;
    else if (nombre === "nonnegative") detalles.minimo = 0;
    else if (nombre === "enum" || nombre === "nativeEnum") {
      const lista = /^\s*\[([\s\S]*)\]\s*$/.exec(argumentos);
      const valores = lista ? entradasDeObjeto(lista[1]!).map(literal) : [];
      if (lista && valores.every((v) => typeof v === "string")) detalles.valores = valores as string[];
      else if (/^\s*[A-Za-z_$][\w$.]*\s*$/.test(argumentos)) detalles.valores_de = argumentos.trim();
    } else if (nombre === "literal") {
      const v = literal(argumentos);
      if (typeof v === "string") detalles.valores = [v];
    }
  }
  return detalles;
}

// --- los parámetros de consulta ---

type Lectura = { nombre: string; indice: number };

const NOMBRE = "[A-Za-z_$][\\w$]*";
/** Lo que puede ir antes de la fuente: `new URL(req.url).`, `req.nextUrl.`. */
const PREVIO = "(?:new\\s+URL\\([^)]*\\)\\s*\\.\\s*|[\\w$.]*\\.)?";

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** La definición cuya sentencia contiene `indice`, si la hay. */
function definicionQueContiene(definiciones: readonly Definicion[], indice: number): Definicion | undefined {
  return definiciones.filter((d) => d.inicio <= indice && indice < d.fin).sort((a, b) => b.inicio - a.inicio)[0];
}

/** Tipo, valor por defecto y topes de un parámetro, de la expresión que lo lee y lo convierte. */
function detallesDeExpresion(expresion: string): Pick<ParametroDeConsulta, "tipo" | "por_defecto" | "minimo" | "maximo"> {
  const d: Pick<ParametroDeConsulta, "tipo" | "por_defecto" | "minimo" | "maximo"> = {};
  const limpio = sinCadenas(expresion);
  if (/\bparseInt\s*\(/.test(limpio)) d.tipo = "entero";
  else if (/\b(Number|parseFloat)\s*\(/.test(limpio) || /^\s*\+\s*\w/.test(limpio)) d.tipo = "numero";
  const defectos = [...expresion.matchAll(/(?:\|\||\?\?)\s*(-?\d[\d_]*(?:\.\d+)?|"[^"]*"|'[^']*'|true|false)(?![\w.])/g)];
  const defecto = defectos.length > 0 ? literal(defectos.at(-1)![1]!) : undefined;
  if (defecto !== undefined) d.por_defecto = defecto;
  for (const m of limpio.matchAll(/\bMath\.(min|max)\s*\(/g)) {
    const abre = m.index + m[0].length - 1;
    const cierra = cierreDe(limpio, abre);
    if (cierra === undefined) continue;
    const numeros = entradasDeObjeto(expresion.slice(abre + 1, cierra)).map(literal).filter((v): v is number => typeof v === "number");
    if (numeros.length === 0) continue;
    if (m[1] === "min") d.maximo = Math.min(...numeros, d.maximo ?? Infinity);
    else d.minimo = Math.max(...numeros, d.minimo ?? -Infinity);
  }
  return d;
}

/** Los valores literales con los que se compara una variable (`estado === "pagada"`). */
function valoresComparados(texto: string, objetivo: string): string[] {
  const valores: string[] = [];
  const e = escapar(objetivo);
  const re = new RegExp(`(?<![\\w$.])${e}\\s*[!=]==?\\s*["'\`]([^"'\`]+)["'\`]|["'\`]([^"'\`]+)["'\`]\\s*[!=]==?\\s*${e}(?![\\w$])`, "g");
  for (const m of texto.matchAll(re)) {
    const v = m[1] ?? m[2]!;
    if (!valores.includes(v)) valores.push(v);
  }
  return valores;
}

/** Los textos de los `where` de las consultas de Prisma (y de la variable que se les pasa, `where,`). */
function textosDeFiltro(texto: string, definiciones: readonly Definicion[]): string {
  const textos: string[] = [];
  const limpio = sinCadenas(texto);
  for (const m of limpio.matchAll(/\bwhere\b\s*(:)?/g)) {
    if (m[1] === undefined) {
      if (/^\s*[,}]/.test(limpio.slice(m.index + m[0].length))) textos.push(...definiciones.filter((d) => d.nombre === "where").map((d) => d.expresion));
      continue;
    }
    const resto = texto.slice(m.index + m[0].length);
    const valor = resto.slice(0, Math.max(0, finDeValor(resto)));
    textos.push(valor);
    const nombre = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(valor)?.[1];
    if (nombre !== undefined) textos.push(...definiciones.filter((d) => d.nombre === nombre).map((d) => d.expresion));
  }
  return textos.join("\n");
}

/** El largo del valor de una propiedad de objeto: hasta la coma o la llave de primer nivel. */
function finDeValor(texto: string): number {
  const limpio = sinCadenas(texto);
  let profundidad = 0;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]!;
    if (c === "{" || c === "(" || c === "[") profundidad++;
    else if (c === "}" || c === ")" || c === "]") {
      if (profundidad === 0) return i;
      profundidad--;
    } else if (c === "," && profundidad === 0) return i;
  }
  return limpio.length;
}

/**
 * Los parámetros de consulta que lee el código de una ruta (App Router: `searchParams`; Pages
 * Router: `req.query`), con lo que se ve de cada uno, por orden de nombre. `excluidos` son los
 * parámetros de la ruta, que en el Pages Router también llegan por `req.query`.
 */
export function parametrosDeConsulta(
  texto: string, marco: "next-app-router" | "next-pages-router", esquemas: Map<string, { campos: CampoDelCuerpo[]; linea: number }>,
  excluidos: ReadonlySet<string> = new Set(),
): ParametroDeConsulta[] {
  const limpio = sinCadenas(texto);
  const definiciones = definicionesDeVariables(texto);
  const lecturas: Lectura[] = [];
  const desdeZod = new Map<string, ParametroDeConsulta>();
  const desestructurados = new Map<string, { indice: number; por_defecto?: string; variable: string }>();

  // Lo que es la fuente de la consulta: URLSearchParams en el App Router, req.query en el Pages Router.
  const fuentes = new Set<string>(marco === "next-app-router" ? ["searchParams"] : ["req.query", "request.query"]);
  const patronFuente = marco === "next-app-router" ? /\.searchParams\s*$/ : /^(req|request)\.query\s*$/;
  for (const d of definiciones) {
    const expr = sinCadenas(d.expresion).trim().replace(/;$/, "");
    if (patronFuente.test(expr) && /^[A-Za-z_$][\w$]*$/.test(d.nombre) && !d.expresion.trim().startsWith("{")) {
      const patron = limpio.slice(d.inicio, d.fin);
      if (/^\s*(const|let|var)\s+\{/.test(patron)) continue;
      fuentes.add(d.nombre);
    }
  }
  for (const m of limpio.matchAll(new RegExp(`\\{[^}]*\\bsearchParams\\s*:\\s*(${NOMBRE})[^}]*\\}\\s*=`, "g"))) fuentes.add(m[1]!);
  const alternativa = [...fuentes].map(escapar).join("|");
  // Una fuente que no es `searchParams` puede ir tras un punto solo si es la propia (x.searchParams.get).
  const antes = (f: string) => (f === "searchParams" ? "" : "(?<![\\w$.])");

  // fuente.get("x"), fuente.getAll("x"), fuente.has("x") en el App Router; req.query.x en el Pages Router.
  for (const f of fuentes) {
    if (marco === "next-app-router") {
      for (const m of texto.matchAll(new RegExp(`${antes(f)}\\b${escapar(f)}\\s*\\.\\s*(?:get|getAll|has)\\(\\s*["'\`]([\\w-]+)["'\`]\\s*\\)`, "g"))) {
        if (limpio[m.index] === texto[m.index]) lecturas.push({ nombre: m[1]!, indice: m.index });
      }
    } else {
      for (const m of limpio.matchAll(new RegExp(`${antes(f)}${escapar(f)}\\s*\\.\\s*(${NOMBRE})`, "g"))) lecturas.push({ nombre: m[1]!, indice: m.index });
    }
  }
  // const { a, b = 30 } = fuente | Object.fromEntries(fuente)
  const desestructuracion = new RegExp(`\\b(?:const|let|var)\\s+\\{([^}]*)\\}\\s*(?::[^=]+)?=\\s*(?:Object\\.fromEntries\\(\\s*)?(?:${alternativa})\\b(?:\\.entries\\(\\))?\\s*\\)?\\s*[;\\n]`, "g");
  for (const m of limpio.matchAll(desestructuracion)) {
    const original = texto.slice(m.index, m.index + m[0].length);
    const dentro = /\{([^}]*)\}/.exec(original)![1]!;
    for (const parte of entradasDeObjeto(dentro)) {
      const d = /^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?(?:\s*=\s*([\s\S]+))?$/.exec(parte);
      if (!d || d[1] === "searchParams") continue;
      desestructurados.set(d[1]!, { indice: m.index, variable: d[2] ?? d[1]!, ...(d[3] !== undefined ? { por_defecto: d[3].trim() } : {}) });
    }
  }
  // const q = Object.fromEntries(fuente) → q.x; esquema.parse(q) o esquema.parse(Object.fromEntries(fuente)) → los campos de zod.
  const objetos = new Set<string>();
  for (const d of definiciones) {
    if (new RegExp(`^Object\\.fromEntries\\(\\s*${PREVIO}(?:${alternativa})\\b`).test(sinCadenas(d.expresion).trim())) objetos.add(d.nombre);
  }
  for (const o of objetos) {
    for (const m of limpio.matchAll(new RegExp(`(?<![\\w$.])${escapar(o)}\\s*\\.\\s*(${NOMBRE})`, "g"))) lecturas.push({ nombre: m[1]!, indice: m.index });
  }
  const argumentoDeConsulta = [`Object\\.fromEntries\\(\\s*${PREVIO}(?:${alternativa})\\b`, ...[...objetos].map((o) => `${escapar(o)}\\s*\\)`), ...(marco === "next-pages-router" ? [`(?:${alternativa})\\s*\\)`] : [])].join("|");
  for (const m of limpio.matchAll(new RegExp(`\\b(${NOMBRE})((?:\\.\\w+\\(\\))*)\\.(?:safeParse|parse)(?:Async)?\\(\\s*(?:${argumentoDeConsulta})`, "g"))) {
    const esquema = esquemas.get(m[1]!);
    if (esquema === undefined) continue;
    // const consulta = esquema.parse(…) → cada campo se usa como consulta.campo (con safeParse, consulta.data.campo).
    const destino = definicionQueContiene(definiciones, m.index);
    const prefijo = destino === undefined ? undefined : `${destino.nombre}${/safeParse/.test(m[0]) ? ".data" : ""}.`;
    for (const c of esquema.campos) {
      const { nombre, tipo, requerido, por_defecto, minimo, maximo, valores } = c;
      desdeZod.set(nombre, {
        nombre, linea: esquema.linea, tipo, ...(requerido ? { requerido } : {}), ...(prefijo !== undefined ? { variable: prefijo + nombre } : {}),
        ...(por_defecto !== undefined ? { por_defecto } : {}), ...(minimo !== undefined ? { minimo } : {}),
        ...(maximo !== undefined ? { maximo } : {}), ...(valores !== undefined ? { valores } : {}),
      });
    }
  }

  const filtro = identificadores(textosDeFiltro(texto, definiciones));
  const porNombre = new Map<string, ParametroDeConsulta>();
  const completar = (p: ParametroDeConsulta, variable: string | undefined, expresion: string | undefined) => {
    if (expresion !== undefined) Object.assign(p, Object.fromEntries(Object.entries(detallesDeExpresion(expresion)).filter(([k]) => !(k in p))));
    if (variable !== undefined) {
      p.variable = variable;
      // Lo que se hace después con la variable (`const n = Math.min(Number(limite) || 30, 100)`).
      const siguiente = definiciones.find((d) => d.nombre !== variable && identificadores(d.expresion).includes(variable) && Object.keys(detallesDeExpresion(d.expresion)).length > 0 && /^[^?]*$/.test(sinCadenas(d.expresion)));
      if (siguiente !== undefined && expresion === undefined) {
        Object.assign(p, Object.fromEntries(Object.entries(detallesDeExpresion(siguiente.expresion)).filter(([k]) => !(k in p))));
        p.variable = siguiente.nombre;
      }
      const valores = valoresComparados(texto, p.variable);
      if (valores.length > 0 && p.valores === undefined) p.valores = valores;
      if (filtro.includes(p.variable)) p.filtra = true;
    }
  };
  for (const l of lecturas.sort((a, b) => a.indice - b.indice)) {
    if (excluidos.has(l.nombre) || porNombre.has(l.nombre)) continue;
    const p: ParametroDeConsulta = { nombre: l.nombre, linea: lineaDe(texto, l.indice) };
    const definicion = definicionQueContiene(definiciones, l.indice);
    const fin = finDeSentencia(texto, l.indice);
    const tramo = texto.slice(l.indice, fin);
    const valores = valoresComparados(tramo, texto.slice(l.indice, texto.indexOf(")", l.indice) + 1));
    if (valores.length > 0) p.valores = valores;
    if (definicion !== undefined && /^[A-Za-z_$][\w$]*$/.test(definicion.nombre) && !objetos.has(definicion.nombre)) completar(p, definicion.nombre, definicion.expresion);
    else completar(p, undefined, texto.slice(Math.max(texto.lastIndexOf("\n", l.indice), 0), fin));
    porNombre.set(l.nombre, p);
  }
  for (const [nombre, d] of desestructurados) {
    if (excluidos.has(nombre) || porNombre.has(nombre)) continue;
    const p: ParametroDeConsulta = { nombre, linea: lineaDe(texto, d.indice) };
    const defecto = d.por_defecto !== undefined ? literal(d.por_defecto) : undefined;
    if (defecto !== undefined) p.por_defecto = defecto;
    completar(p, d.variable, undefined);
    porNombre.set(nombre, p);
  }
  for (const [nombre, p] of desdeZod) {
    if (excluidos.has(nombre)) continue;
    porNombre.set(nombre, { ...(porNombre.get(nombre) ?? {}), ...p });
  }
  return [...porNombre.values()].sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
}

// --- los periodos de fechas ---

type Marcador = { desde: number } | { parametro: string };

/** Una función que da una fecha a partir de días: `inicioDelDia`, `startOfDay`, `subDays`, `hace_dias`… (no getDay ni setDate). */
const FUNCION_DE_DIAS = "(?!get|set)[A-Za-z_$]*(?:[Dd][ií]as?|[Dd]ays?)[A-Za-z_$]*";

/** Las fechas relativas a hoy que aparecen en una expresión, como desplazamiento en días o como el parámetro que lo fija. */
function marcadores(expresion: string, variables: ReadonlyMap<string, string>): { marcador: Marcador; texto: string }[] {
  const t = sinCadenas(expresion);
  const encontrados: { marcador: Marcador; texto: string; indice: number }[] = [];
  const poner = (marcador: Marcador | undefined, m: RegExpMatchArray) => {
    // Una fecha que es el tope (`lt: inicioDelDia(-30)`, `f.fecha < inicioDelDia()`) no dice desde cuándo.
    if (marcador === undefined || COTA.test(t.slice(0, m.index))) return;
    if (!encontrados.some((e) => e.indice === m.index)) encontrados.push({ marcador, texto: m[0], indice: m.index! });
  };
  const parametro = (nombre: string): Marcador | undefined => (variables.has(nombre) ? { parametro: variables.get(nombre)! } : undefined);
  // sub/add con dos argumentos: subDays(fecha, 7), addDays(fecha, -7)
  for (const m of t.matchAll(new RegExp(`\\b(${FUNCION_DE_DIAS})\\(\\s*[^,()]*(?:\\([^()]*\\))?[^,()]*,\\s*(-?\\s*\\d+|[A-Za-z_$][\\w$]*)\\s*\\)`, "g"))) {
    const resta = /^sub|^restar|^menos/i.test(m[1]!);
    const valor = m[2]!.replace(/\s+/g, "");
    if (/^-?\d+$/.test(valor)) {
      const n = Number(valor);
      const atras = resta ? n : -n;
      if (atras > 0) poner({ desde: 1 - atras }, m);
    } else if (resta) poner(parametro(valor), m);
  }
  // inicioDelDia(), inicioDelDia(-29), inicioDelDia(-(dias - 1)), inicioDelDia(-dias)
  for (const m of t.matchAll(new RegExp(`\\b(${FUNCION_DE_DIAS})\\(\\s*(?:(-?\\s*\\d+)|-\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\s*-\\s*1\\s*\\)|-\\s*([A-Za-z_$][\\w$]*)|1\\s*-\\s*([A-Za-z_$][\\w$]*))?\\s*\\)`, "g"))) {
    if (/^(start|inicio|comienzo|principio)/i.test(m[1]!) || m[2] !== undefined || m[3] !== undefined || m[4] !== undefined || m[5] !== undefined) {
      if (m[2] !== undefined) poner({ desde: Number(m[2].replace(/\s+/g, "")) }, m);
      else if (m[3] ?? m[4] ?? m[5]) poner(parametro((m[3] ?? m[4] ?? m[5])!), m);
      else poner({ desde: 0 }, m);
    }
  }
  // Date.now() - 7 * 24 * 60 * 60 * 1000
  for (const m of t.matchAll(/-\s*\(?\s*(\d+)\s*\*\s*(?:24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|24\s*\*\s*3600\s*\*\s*1000|86_?400_?000|864e5)/g)) {
    poner({ desde: 1 - Number(m[1]) }, m);
  }
  return encontrados.sort((a, b) => a.indice - b.indice).map(({ marcador, texto }) => ({ marcador, texto }));
}

/** Lo que precede a una fecha usada como tope superior. */
const COTA = /(?:\b(?:lt|lte)\s*:\s*|[^=!<>]<=?\s*)$/;

/** Las variables que se usan como tope superior de una fecha en la expresión. */
function cotas(expresion: string): string[] {
  const t = sinCadenas(expresion);
  return [...t.matchAll(/(?:\b(?:lt|lte)\s*:\s*|[^=!<>]<=?\s*)([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1]!);
}

/** El periodo que forman los marcadores de un mismo nivel, o undefined si no forman uno claro. */
function periodoDe(lista: { marcador: Marcador; texto: string }[]): PeriodoInferido | undefined {
  const unicos = lista.filter((m, i) => lista.findIndex((x) => x.texto.replace(/\s+/g, "") === m.texto.replace(/\s+/g, "")) === i);
  const expresion = unicos.map((m) => m.texto.replace(/\s+/g, " ")).join(" … ");
  const parametros = unicos.flatMap((m) => ("parametro" in m.marcador ? [m.marcador.parametro] : []));
  const numeros = unicos.flatMap((m) => ("desde" in m.marcador ? [m.marcador.desde] : [])).sort((a, b) => a - b);
  if (parametros.length === 1 && numeros.every((n) => n >= 1)) return { desde: 0, hasta: null, parametro: parametros[0]!, expresion };
  if (parametros.length > 0) return undefined;
  if (numeros.length === 1 && numeros[0]! <= 0) return { desde: numeros[0]!, hasta: null, expresion };
  if (numeros.length === 2 && numeros[0]! <= 0) return { desde: numeros[0]!, hasta: numeros[1]! >= 1 ? null : numeros[1]!, expresion };
  return undefined;
}

// --- las consultas de Prisma ---

const OPERACIONES_PRISMA = "findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|groupBy|aggregate|count|create|createMany|update|updateMany|upsert|delete|deleteMany";

function consultaPrisma(expresion: string, variables: ReadonlyMap<string, string>): ConsultaPrisma | undefined {
  const t = sinCadenas(expresion);
  const m = new RegExp(`\\b[A-Za-z_$][\\w$]*\\.([a-z][\\w$]*)\\.(${OPERACIONES_PRISMA})\\(`).exec(t);
  if (m === null) return undefined;
  const consulta: ConsultaPrisma = { modelo: m[1]!, operacion: m[2]! };
  const abre = m.index + m[0].length - 1;
  const cierra = cierreDe(expresion, abre) ?? expresion.length;
  const argumentos = expresion.slice(abre + 1, cierra);
  const objeto = /^\s*\{/.test(argumentos) ? argumentos.trim().slice(1, -1) : "";
  for (const entrada of entradasDeObjeto(objeto)) {
    const e = /^(\w+)\s*:\s*([\s\S]*)$/.exec(entrada);
    if (!e) continue;
    const [, clave, valor] = e as unknown as [string, string, string];
    if (clave === "take") {
      const v = literal(valor);
      if (typeof v === "number") consulta.tope = v;
      else if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(valor.trim()) && variables.has(valor.trim())) consulta.tope = variables.get(valor.trim())!;
    } else if (clave === "orderBy") {
      const orden = [...valor.matchAll(/(\w+)\s*:\s*["'](asc|desc)["']/g)].map((o) => `${o[1]} ${o[2]}`);
      if (orden.length > 0) consulta.orden = orden;
    } else if (clave === "include" && valor.trim().startsWith("{")) {
      const incluye = entradasDeObjeto(valor.trim().slice(1, -1)).map((x) => /^(\w+)/.exec(x)?.[1]).filter((x): x is string => x !== undefined);
      if (incluye.length > 0) consulta.incluye = incluye;
    } else if (clave === "by") {
      const agrupa = [...valor.matchAll(/["'](\w+)["']/g)].map((x) => x[1]!);
      if (agrupa.length > 0) consulta.agrupa = agrupa;
    }
  }
  return consulta;
}

// --- seguir una expresión hasta sus definiciones ---

type Seguimiento = { periodo?: PeriodoInferido; consulta?: ConsultaPrisma };

/**
 * Sigue una expresión por las definiciones de las que depende, nivel a nivel: el periodo es el del
 * primer nivel en el que aparece alguna fecha relativa (si ahí no forma uno claro, no hay periodo),
 * y la consulta de Prisma solo cuenta si está en la expresión o en lo que define a sus variables
 * directas: más lejos, el valor ya es una cuenta sobre ella (una suma, un total), no ella.
 */
function seguir(expresion: string, definiciones: ReadonlyMap<string, Definicion>, variables: ReadonlyMap<string, string>): Seguimiento {
  const resultado: Seguimiento = {};
  const vistos = new Set<string>();
  const topes = new Set<string>();
  let nivel = [expresion];
  let deVariable: (string | undefined)[] = [undefined];
  for (let profundidad = 0, periodoDecidido = false; profundidad < 6 && nivel.length > 0; profundidad++) {
    for (const e of nivel) for (const c of cotas(e)) topes.add(c);
    if (!periodoDecidido) {
      const encontrados = nivel.flatMap((e, i) => (topes.has(deVariable[i] ?? "") ? [] : marcadores(e, variables)));
      if (encontrados.length > 0) {
        periodoDecidido = true;
        const periodo = periodoDe(encontrados);
        if (periodo !== undefined) resultado.periodo = periodo;
      }
    }
    if (resultado.consulta === undefined && profundidad <= 1) {
      for (const e of nivel) {
        const c = consultaPrisma(e, variables);
        if (c !== undefined) {
          resultado.consulta = c;
          break;
        }
      }
    }
    const siguiente: string[] = [];
    const variablesSiguientes: string[] = [];
    for (const e of nivel) {
      for (const id of identificadores(e)) {
        if (vistos.has(id)) continue;
        vistos.add(id);
        const d = definiciones.get(id);
        if (d !== undefined) {
          siguiente.push(d.expresion);
          variablesSiguientes.push(id);
        }
      }
    }
    nivel = siguiente;
    deVariable = variablesSiguientes;
  }
  return resultado;
}

// --- la respuesta ---

/** `x` → lo que define a `x`, mientras sea una variable sola: `ok(ventas)` habla de la consulta que da `ventas`. */
function desenvolver(valor: string, definiciones: ReadonlyMap<string, Definicion>): string {
  let actual = valor.trim();
  for (let i = 0; i < 4; i++) {
    const nombre = /^(?:await\s+)?([A-Za-z_$][\w$]*)$/.exec(actual)?.[1];
    const d = nombre === undefined ? undefined : definiciones.get(nombre);
    if (d === undefined) break;
    actual = d.expresion.trim();
  }
  return actual;
}

/** Si el valor es la lista misma (una consulta, o una variable con `.map`/`.filter`/`.sort` encima), no una cuenta sobre ella. */
function esLaLista(valor: string): boolean {
  const c = cadena(valor.replace(/^await\s+/, ""));
  return new RegExp(`^[A-Za-z_$][\\w$]*(\\.[A-Za-z_$][\\w$]*)*\\.(${OPERACIONES_PRISMA})\\(\\)$`).test(c) ||
    /^[A-Za-z_$][\w$]*(\??\.(map|filter|sort|slice|reverse|toSorted|flat|flatMap)\(\))*$/.test(c);
}

/** Las llamadas que responden: `NextResponse.json(…)`, `Response.json(…)`, `res.status(200).json(…)` o un ayudante `ok(…)`/`json(…)`. */
const RESPONDE = /(?:\bNextResponse\.json|\bResponse\.json|\b(?:res|response)(?:\.status\(\s*(\d{3})\s*\))?\.(?:json|send)|(?<![\w$.])(?:ok|exito|success|json|responder|respond|jsonResponse|respuesta))\s*\(/g;

function claves(cuerpo: string, definiciones: ReadonlyMap<string, Definicion>, variables: ReadonlyMap<string, string>, profundidad: number): ClaveDeRespuesta[] {
  return entradasDeObjeto(cuerpo).flatMap((entrada): ClaveDeRespuesta[] => {
    if (entrada.startsWith("...")) return [];
    const m = /^["']?([A-Za-z_$][\w$]*)["']?\s*(?::\s*([\s\S]+))?$/.exec(entrada);
    if (!m) return [];
    const valor = (m[2] ?? m[1]!).trim();
    if (valor.startsWith("{") && profundidad < 3) {
      const cierra = cierreDe(valor, 0);
      if (cierra === valor.length - 1) return [{ nombre: m[1]!, claves: claves(valor.slice(1, -1), definiciones, variables, profundidad + 1) }];
    }
    // Más adentro de la primera capa solo se nombran las claves: seguirlas da periodos de lo que no son.
    if (profundidad > 2) return [{ nombre: m[1]! }];
    const desenvuelto = desenvolver(valor, definiciones);
    const s = seguir(desenvuelto, definiciones, variables);
    const lista = s.consulta !== undefined && /^(findMany|groupBy)$/.test(s.consulta.operacion) && esLaLista(desenvuelto);
    return [{ nombre: m[1]!, ...(s.periodo !== undefined ? { periodo: s.periodo } : {}), ...(lista ? { consulta: s.consulta } : {}) }];
  });
}

/** Las claves que se añaden a cada elemento en `.map((x) => ({ ...x, clave }))`. */
function anadidas(expresion: string): string[] {
  const m = /\.map\(\s*\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>\s*\(\s*\{/.exec(sinCadenas(expresion));
  if (m === null) return [];
  const abre = m.index + m[0].length - 1;
  const cierra = cierreDe(expresion, abre);
  if (cierra === undefined) return [];
  const entradas = entradasDeObjeto(expresion.slice(abre + 1, cierra));
  if (!entradas.some((e) => e.startsWith("..."))) return [];
  return entradas.filter((e) => !e.startsWith("...")).map((e) => /^["']?([A-Za-z_$][\w$]*)/.exec(e)?.[1]).filter((x): x is string => x !== undefined);
}

/**
 * Lo que devuelve el manejador al salir bien: la última llamada que responde sin un estado de
 * error (≥ 400). `tramo` es el cuerpo del manejador; `archivo`, el archivo entero, para las
 * constantes de módulo. `parametros` dice qué variable guarda cada parámetro de consulta.
 */
export function respuestaDe(tramo: string, lineaDelTramo: number, archivo: string, parametros: readonly ParametroDeConsulta[]): RespuestaInferida | undefined {
  const limpio = sinCadenas(tramo);
  const llamadas: { indice: number; argumentos: string[]; estado?: number }[] = [];
  for (const m of limpio.matchAll(RESPONDE)) {
    const abre = m.index + m[0].length - 1;
    const cierra = cierreDe(tramo, abre);
    if (cierra === undefined) continue;
    const argumentos = entradasDeObjeto(tramo.slice(abre + 1, cierra));
    if (argumentos.length === 0) continue;
    const segundo = argumentos[1] ?? "";
    const estado = Number(m[1] ?? (/^\d{3}$/.test(segundo.trim()) ? segundo.trim() : /\bstatus\s*:\s*(\d{3})/.exec(segundo)?.[1] ?? NaN));
    if (Number.isFinite(estado) && estado >= 400) continue;
    if (/^\{\s*error\s*:/.test(argumentos[0]!)) continue;
    llamadas.push({ indice: m.index, argumentos, ...(Number.isFinite(estado) ? { estado } : {}) });
  }
  const llamada = llamadas.at(-1);
  if (llamada === undefined) return undefined;
  const modulo = definicionesDeVariables(archivo.split("\n").filter((l) => /^(export\s+)?(const|let|var)\b/.test(l)).join("\n"));
  const definiciones = new Map<string, Definicion>([...modulo, ...definicionesDeVariables(tramo)].map((d) => [d.nombre, d]));
  const variables = new Map(parametros.filter((p) => p.variable !== undefined).map((p) => [p.variable!, p.nombre]));
  const valor = llamada.argumentos[0]!.trim();
  const base = { linea: lineaDelTramo + lineaDe(tramo, llamada.indice) - 1, ...(llamada.estado !== undefined ? { estado: llamada.estado } : {}) };
  if (valor.startsWith("{") && cierreDe(valor, 0) === valor.length - 1) {
    return { ...base, forma: "objeto", claves: claves(valor.slice(1, -1), definiciones, variables, 1) };
  }
  const desenvuelto = desenvolver(valor, definiciones);
  const s = seguir(desenvuelto, definiciones, variables);
  const directa = definiciones.get(/^(?:await\s+)?([A-Za-z_$][\w$]*)/.exec(desenvuelto)?.[1] ?? "")?.expresion ?? "";
  const anade = [...new Set([...anadidas(desenvuelto), ...anadidas(directa)])];
  if (s.consulta !== undefined && !esLaLista(desenvuelto)) delete s.consulta;
  const forma: RespuestaInferida["forma"] = s.consulta === undefined
    ? "desconocida"
    : /^(findMany|groupBy)$/.test(s.consulta.operacion) ? "lista" : /^(count|aggregate|createMany|updateMany|deleteMany)$/.test(s.consulta.operacion) ? "desconocida" : "registro";
  return {
    ...base,
    forma,
    ...(s.consulta !== undefined ? { consulta: s.consulta } : {}),
    ...(s.periodo !== undefined ? { periodo: s.periodo } : {}),
    ...(anade.length > 0 ? { anade } : {}),
  };
}

/** El JSDoc (o los comentarios `//`) justo encima de la línea `linea` (1-based), sin delimitadores. */
export function documentacionDe(lineas: readonly string[], linea: number): string | undefined {
  let i = linea - 2;
  const partes: string[] = [];
  if (i >= 0 && /\*\/\s*$/.test(lineas[i]!)) {
    for (; i >= 0; i--) {
      partes.unshift(lineas[i]!);
      if (/^\s*\/\*\*/.test(lineas[i]!)) break;
      if (/^\s*\/\*/.test(lineas[i]!)) return undefined;
    }
    if (i < 0) return undefined;
    const texto = partes.join(" ").replace(/^\s*\/\*\*/, "").replace(/\*\/\s*$/, "").replace(/\s*\*\s+/g, " ").replace(/\s*@\w+[^@]*/g, " ").replace(/\s+/g, " ").trim();
    return texto === "" ? undefined : texto.slice(0, 400);
  }
  for (; i >= 0 && /^\s*\/\/(?!\/)/.test(lineas[i]!); i--) partes.unshift(lineas[i]!.replace(/^\s*\/\/\s?/, ""));
  const texto = partes.join(" ").replace(/\s+/g, " ").trim();
  return texto === "" ? undefined : texto.slice(0, 400);
}
