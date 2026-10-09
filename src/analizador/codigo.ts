// Lo que se saca del código sin ejecutarlo: imports, superficies expuestas (CLI, HTTP, MCP) y
// señales línea a línea. Son expresiones regulares sobre el texto, no un parser: pueden coincidir
// en comentarios o cadenas. Por eso cada coincidencia trae su línea, para que quien la use la mire.
import { posix } from "node:path";
import type {
  Lenguaje, MetodoHttp, Modulo, Ruta, RutaApi, Senal, TipoDeSenal, ToolMcp, VerboCli, ViaDeVerbo,
} from "../modelo/index.ts";
import { rutasNext } from "./next.ts";

export type CodigoLeido = {
  modulo: Modulo;
  verbos: VerboCli[];
  api: RutaApi[];
  tools: ToolMcp[];
  banderas: string[];
  senales: Senal[];
  /** Tiene shebang o el `if __name__ == "__main__"` de Python. */
  principal: { tipo: "shebang" | "modulo-principal"; linea: number } | undefined;
  /** Verbos que despachan a una función de otro módulo del repo: `analizar()` les pone el
   *  `manejador` cuando ya puede leer ese módulo (ver `manejadorEnOtroModulo`). */
  despachos: DespachoPendiente[];
};

export type DespachoPendiente = { verbo: VerboCli; archivo: Ruta; funcion: string };

const MAX_TEXTO_SENAL = 160;
const MAX_SENALES_POR_TIPO = 50;

export function contarLineas(texto: string): number {
  if (texto === "") return 0;
  return texto.split("\n").length - (texto.endsWith("\n") ? 1 : 0);
}

export function esPrueba(ruta: Ruta): boolean {
  return (
    /(^|\/)(tests?|pruebas|__tests__|spec|specs|e2e)\//.test(ruta) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(ruta) ||
    /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(ruta) ||
    /(^|\/)conftest\.py$/.test(ruta)
  );
}

export function leerCodigo(ruta: Ruta, lenguaje: Lenguaje, texto: string, existentes: ReadonlySet<Ruta>, esEntrada: boolean): CodigoLeido {
  const lineas = texto.split("\n");
  const prueba = esPrueba(ruta);
  const imports = lenguaje === "python" ? importsPython(lineas) : importsJs(texto);
  const modulo: Modulo = {
    ruta,
    lenguaje,
    lineas: contarLineas(texto),
    caracteres: texto.length,
    imports: imports.map((i) => i.especificador),
    imports_locales: [...new Set(imports.flatMap((i) => resolverImport(ruta, lenguaje, i.especificador, existentes) ?? []))],
    es_prueba: prueba,
  };
  const principal = principalDe(lineas, ruta);
  if (prueba) return { modulo, verbos: [], api: [], tools: [], banderas: [], senales: [], principal, despachos: [] };

  const libreria = (patron: RegExp) => modulo.imports.some((i) => patron.test(i));
  // Una ruta con /cli/ o /bin/ no es entrada de verdad si vive bajo un generador o una
  // plantilla: ese switch/case describe qué genera, no qué expone el propio repo (hallazgo de
  // auditar axd contra sí mismo: `src/generadores/cli/index.ts` tiene `case "resumen":`,
  // `case "listar":`… que
  // enumeran tipos de Implementacion, y sin esta exclusión el analizador los contaba como
  // verbos propios de axd). Un shebang o `esEntrada` de verdad siguen contando igual.
  const esGeneradorOPlantilla = /(^|\/)(generadores?|generators?|plantillas?|templates?)(\/|\.)/.test(ruta);
  const verbos = verbosCli(ruta, lineas, lenguaje, {
    typer: libreria(/^typer\b/),
    yargs: libreria(/^yargs\b/),
    switch: esEntrada || principal !== undefined || (!esGeneradorOPlantilla && /(^|\/)(cli|bin|comandos|commands)(\/|\.)/.test(ruta)),
  });
  const api = lenguaje === "python" ? rutasApi(ruta, lineas, lenguaje) : [...rutasApi(ruta, lineas, lenguaje), ...rutasNext(ruta, texto)];
  const tools = toolsMcp(ruta, lineas, lenguaje);
  const parseaArgv = libreria(/^(argparse|click|typer|commander|yargs|node:util|util|cac|meow|minimist|clipanion|docopt)$/);
  const conBanderas = verbos.length > 0 || esEntrada || principal !== undefined || parseaArgv;
  const banderas = conBanderas ? [...new Set([...texto.matchAll(/["'`](--[a-z][a-z0-9-]*)/g)].map((m) => m[1]!))].sort() : [];
  if (conBanderas) asignarBanderas(verbos, lineas);
  const despachos = asignarManejadores(verbos, lineas, lenguaje, importados(ruta, lenguaje, texto, existentes));
  const senales = senalesDe(ruta, lineas, lenguaje, imports, esEntrada || principal !== undefined);
  return { modulo, verbos, api, tools, banderas, senales, principal, despachos };
}

// --- imports ---

type Import = { especificador: string; linea: number };

function importsJs(texto: string): Import[] {
  const encontrados: Import[] = [];
  const patrones = [
    /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g,
    /\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const patron of patrones) {
    for (const m of texto.matchAll(patron)) {
      encontrados.push({ especificador: m[1]!, linea: texto.slice(0, m.index).split("\n").length });
    }
  }
  return unicos(encontrados);
}

function importsPython(lineas: readonly string[]): Import[] {
  const encontrados: Import[] = [];
  lineas.forEach((linea, i) => {
    const desde = /^\s*from\s+(\.*[\w.]*)\s+import\s+/.exec(linea);
    if (desde) {
      encontrados.push({ especificador: desde[1]!, linea: i + 1 });
      return;
    }
    const importa = /^\s*import\s+(.+)$/.exec(linea);
    if (importa) {
      for (const parte of importa[1]!.split(",")) {
        const nombre = parte.trim().split(/\s+/)[0];
        if (nombre) encontrados.push({ especificador: nombre, linea: i + 1 });
      }
    }
  });
  return unicos(encontrados);
}

function unicos(imports: Import[]): Import[] {
  const vistos = new Set<string>();
  return imports
    .sort((a, b) => a.linea - b.linea)
    .filter((i) => (vistos.has(i.especificador) ? false : (vistos.add(i.especificador), true)));
}

function resolverImport(desde: Ruta, lenguaje: Lenguaje, especificador: string, existentes: ReadonlySet<Ruta>): Ruta | undefined {
  const carpeta = posix.dirname(desde);
  if (lenguaje === "python") {
    const puntos = /^\.*/.exec(especificador)![0].length;
    const resto = especificador.slice(puntos).replace(/\./g, "/");
    let bases: string[];
    if (puntos > 0) {
      let base = carpeta;
      for (let i = 1; i < puntos; i++) base = posix.dirname(base);
      bases = [base];
    } else {
      bases = [".", "src"];
    }
    for (const base of bases) {
      const camino = posix.normalize(posix.join(base, resto));
      const encontrado = [`${camino}.py`, `${camino}/__init__.py`].find((c) => existentes.has(c));
      if (encontrado) return encontrado;
    }
    return undefined;
  }
  if (!especificador.startsWith(".")) return undefined;
  const camino = posix.normalize(posix.join(carpeta, especificador));
  const sinJs = camino.replace(/\.(m|c)?js$/, "");
  const candidatos = [
    camino, `${sinJs}.ts`, `${sinJs}.tsx`, `${sinJs}.mts`, `${camino}.ts`, `${camino}.tsx`, `${camino}.js`, `${camino}.mjs`,
    `${camino}/index.ts`, `${camino}/index.js`,
  ];
  return candidatos.find((c) => existentes.has(c));
}

// --- superficies ---

function principalDe(lineas: readonly string[], ruta: Ruta): CodigoLeido["principal"] {
  if (/^#!.*\b(node|python[\d.]*|deno|bun|tsx|ts-node|sh|bash|env)\b/.test(lineas[0] ?? "")) return { tipo: "shebang", linea: 1 };
  if (ruta.endsWith("__main__.py")) return { tipo: "modulo-principal", linea: 1 };
  const i = lineas.findIndex((l) => /^if\s+__name__\s*==\s*["']__main__["']\s*:/.test(l));
  return i >= 0 ? { tipo: "modulo-principal", linea: i + 1 } : undefined;
}

function verbosCli(
  ruta: Ruta,
  lineas: readonly string[],
  lenguaje: Lenguaje,
  contexto: { typer: boolean; yargs: boolean; switch: boolean },
): VerboCli[] {
  const verbos: VerboCli[] = [];
  const agregar = (nombre: string, linea: number, via: ViaDeVerbo) => verbos.push({ nombre, archivo: ruta, linea, via, banderas: [] });
  lineas.forEach((linea, i) => {
    if (lenguaje === "python") {
      for (const m of linea.matchAll(/\badd_parser\(\s*["']([\w:-]+)["']/g)) agregar(m[1]!, i + 1, "argparse");
      // `add_parser(` que termina la línea y el nombre entre comillas queda en la siguiente:
      // el formateador de Python (black) envuelve así la llamada en cuanto lleva `help=`, y la
      // regla de una sola línea la dejaba sin ver (hallazgo en un repo Python real: `buscar` y
      // `leer` de su argparse no salían en superficies.cli).
      if (/\badd_parser\(\s*$/.test(linea)) {
        const m = /^\s*["']([\w:-]+)["']/.exec(lineas[i + 1] ?? "");
        if (m) agregar(m[1]!, i + 1, "argparse");
      }
      const decorador = /^\s*@([\w.]+)\.command\(\s*(?:(?:name\s*=\s*)?["']([\w:-]+)["'])?/.exec(linea);
      if (decorador) {
        const via: ViaDeVerbo = contexto.typer ? "typer" : "click";
        const nombre = decorador[2] ?? funcionSiguiente(lineas, i)?.replace(/_/g, "-");
        if (nombre) agregar(nombre, i + 1, via);
      }
    } else {
      for (const m of linea.matchAll(/\.command\(\s*["'`]([\w:-]+)/g)) agregar(m[1]!, i + 1, contexto.yargs ? "yargs" : "commander");
    }
    if (contexto.switch && lenguaje !== "python") {
      for (const m of linea.matchAll(/\bcase\s+["']([a-z][\w-]*)["']\s*:/g)) agregar(m[1]!, i + 1, "switch");
    }
    if (contexto.switch && lenguaje === "python") {
      for (const m of linea.matchAll(/^\s*case\s+["']([a-z][\w-]*)["']\s*:/g)) agregar(m[1]!, i + 1, "switch");
    }
  });
  return verbos;
}

/** Cuántas líneas tras un verbo se miran buscando sus banderas si no viene otro verbo antes. */
const VENTANA_DE_BANDERAS = 20;
const BANDERA = /["'`](--[a-z][a-z0-9-]*)/g;

/** Las banderas de cada verbo: las de su ventana, hasta el siguiente verbo del mismo archivo. */
function asignarBanderas(verbos: VerboCli[], lineas: readonly string[]): void {
  const inicios = verbos.map((v) => v.linea).sort((a, b) => a - b);
  for (const verbo of verbos) {
    const siguiente = inicios.find((l) => l > verbo.linea) ?? Number.POSITIVE_INFINITY;
    const fin = Math.min(siguiente - 1, verbo.linea - 1 + VENTANA_DE_BANDERAS, lineas.length);
    const texto = lineas.slice(verbo.linea - 1, fin).join("\n");
    verbo.banderas = [...new Set([...texto.matchAll(BANDERA)].map((m) => m[1]!))].sort();
    const requeridas = [...new Set([...texto.matchAll(BANDERA)].filter((m) => esRequerida(texto, m.index!)).map((m) => m[1]!))].sort();
    if (requeridas.length > 0) verbo.banderas_requeridas = requeridas;
  }
}

/** Lo que exige una opción al parser: `required=True` (argparse, click, typer), `required: true`
 *  o `demandOption: true` (yargs y parecidos). */
const REQUERIDA = /\brequired\s*=\s*True\b|\b(required|demandOption)\s*:\s*true\b/;

/**
 * Si la bandera que empieza en `inicio` (su comilla) se declara obligatoria: `.requiredOption("--x"`
 * de commander, o dentro de la misma llamada (de la bandera al paréntesis que la cierra, hasta 400
 * caracteres) un `required=True`. Con eso el parser aborta solo si falta: el código del verbo no
 * construye ningún error y aun así se niega (p. ej. `entregar.add_argument("--evidencia",
 * required=True, ...)`).
 */
function esRequerida(texto: string, inicio: number): boolean {
  if (/\.requiredOption\(\s*$/.test(texto.slice(Math.max(0, inicio - 40), inicio))) return true;
  let profundidad = 1;
  let fin = inicio;
  for (; fin < Math.min(texto.length, inicio + 400) && profundidad > 0; fin++) {
    const ch = texto[fin];
    if (ch === "(" || ch === "[" || ch === "{") profundidad++;
    else if (ch === ")" || ch === "]" || ch === "}") profundidad--;
  }
  return REQUERIDA.test(texto.slice(inicio, fin));
}

/** Una función local de JS/TS: `function nombre(` o `const nombre = (…) =>`, con su sangría. */
const DEFINICION_DE_FUNCION = /^(\s*)(?:export\s+)?(?:(?:async\s+)?function\s*\*?\s*(\w+)\s*[(<]|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]*)?=>)/;
const DEFINICION_PYTHON = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/;
/** Llamadas de una línea, con un calificador opcional: `verboGenerar(`, `estado.main(`. */
const LLAMADA = /\b((?:\w+\.)?\w+)\s*\(/g;
/** Cuántos saltos se siguen dentro del módulo del manejador, y hasta cuántas funciones. */
const SALTOS_LOCALES = 2;
const MAX_LLAMADAS = 8;

type Rango = { linea: number; hasta: number };

/** Las funciones definidas en el archivo, con su rango: en JS/TS de la definición a la primera `}`
 *  con su misma sangría; en Python, hasta la última línea más sangrada que el `def`. */
export function definicionesDe(lineas: readonly string[], lenguaje: Lenguaje): Map<string, Rango> {
  const definiciones = new Map<string, Rango>();
  lineas.forEach((l, i) => {
    if (lenguaje === "python") {
      const m = DEFINICION_PYTHON.exec(l);
      if (!m || definiciones.has(m[2]!)) return;
      let hasta = i + 1;
      for (let j = i + 1; j < lineas.length; j++) {
        const t = lineas[j]!;
        if (t.trim() === "" || t.trim().startsWith("#")) continue;
        if (/^\s*/.exec(t)![0].length <= m[1]!.length) break;
        hasta = j + 1;
      }
      if (hasta > i + 1) definiciones.set(m[2]!, { linea: i + 1, hasta });
      return;
    }
    const m = DEFINICION_DE_FUNCION.exec(l);
    const nombre = m?.[2] ?? m?.[3];
    if (!m || !nombre || definiciones.has(nombre)) return;
    const cierre = new RegExp(`^${m[1]!}\\}`);
    for (let j = i + 1; j < lineas.length; j++) {
      if (cierre.test(lineas[j]!)) {
        definiciones.set(nombre, { linea: i + 1, hasta: j + 1 });
        return;
      }
    }
  });
  return definiciones;
}

/** Lo que un archivo importa de otros módulos del repo, por el nombre con que lo usa: un módulo
 *  entero (`from . import estado`, `import * as estado from "./estado.ts"`) o un símbolo de él
 *  (`from .estado import main`, `import { main } from "./estado.ts"`). */
type Importado = { archivo: Ruta; simbolo?: string };

function importados(ruta: Ruta, lenguaje: Lenguaje, texto: string, existentes: ReadonlySet<Ruta>): Map<string, Importado> {
  const nombres = new Map<string, Importado>();
  const poner = (nombre: string, valor: Importado | undefined) => {
    if (valor !== undefined && !nombres.has(nombre)) nombres.set(nombre, valor);
  };
  const resolver = (especificador: string) => resolverImport(ruta, lenguaje, especificador, existentes);
  if (lenguaje === "python") {
    for (const m of texto.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]*)/gm)) {
      const desde = m[1]!;
      const partes = m[2]!.replace(/#[^\n]*/g, "").replace(/[()\\]/g, "").split(",");
      for (const parte of partes) {
        const [nombre, alias] = parte.trim().split(/\s+as\s+/);
        if (!nombre || !/^\w+$/.test(nombre)) continue;
        const comoModulo = resolver(desde.endsWith(".") ? desde + nombre : `${desde}.${nombre}`);
        const desdeArchivo = resolver(desde);
        poner(alias ?? nombre, comoModulo !== undefined ? { archivo: comoModulo } : desdeArchivo !== undefined ? { archivo: desdeArchivo, simbolo: nombre } : undefined);
      }
    }
    for (const m of texto.matchAll(/^[ \t]*import[ \t]+([^\n#]+)/gm)) {
      for (const parte of m[1]!.split(",")) {
        const [nombre, alias] = parte.trim().split(/\s+as\s+/);
        if (!nombre || (alias === undefined && nombre.includes("."))) continue;
        const archivo = resolver(nombre);
        poner(alias ?? nombre, archivo !== undefined ? { archivo } : undefined);
      }
    }
    return nombres;
  }
  for (const m of texto.matchAll(/\bimport\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["']/g)) {
    const archivo = resolver(m[2]!);
    poner(m[1]!, archivo !== undefined ? { archivo } : undefined);
  }
  for (const m of texto.matchAll(/\bimport\s+(?:type\s+)?(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const archivo = resolver(m[2]!);
    if (archivo === undefined) continue;
    for (const parte of m[1]!.split(",")) {
      const [nombre, alias] = parte.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      if (nombre && /^\w+$/.test(nombre)) poner(alias ?? nombre, { archivo, simbolo: nombre });
    }
  }
  return nombres;
}

/** Las llamadas de un tramo de líneas, en orden. */
function llamadasEn(lineas: readonly string[], desde: number, hasta: number): string[] {
  return lineas.slice(desde - 1, hasta).flatMap((l) => [...l.replace(/#.*$|\/\/.*$/, "").matchAll(LLAMADA)].map((m) => m[1]!));
}

/**
 * Las funciones del mismo módulo a las que llama la que va de `rango`, hasta SALTOS_LOCALES saltos
 * y MAX_LLAMADAS funciones: un manejador que arma el resultado con `resumir()` y lo imprime con
 * `imprimir()` hace su trabajo ahí, no en sus propias líneas.
 */
function alcanceLocal(lineas: readonly string[], definiciones: Map<string, Rango>, rango: Rango): Rango[] {
  const vistos = new Set<number>([rango.linea]);
  const alcance: Rango[] = [];
  let frontera = [rango];
  for (let salto = 0; salto < SALTOS_LOCALES && alcance.length < MAX_LLAMADAS; salto++) {
    const siguiente: Rango[] = [];
    for (const r of frontera) {
      for (const nombre of llamadasEn(lineas, r.linea + 1, r.hasta)) {
        const def = definiciones.get(nombre);
        if (def === undefined || vistos.has(def.linea) || alcance.length >= MAX_LLAMADAS) continue;
        vistos.add(def.linea);
        alcance.push(def);
        siguiente.push(def);
      }
    }
    frontera = siguiente;
  }
  return alcance;
}

function manejadorDe(lineas: readonly string[], definiciones: Map<string, Rango>, rango: Rango): NonNullable<VerboCli["manejador"]> {
  const llama = alcanceLocal(lineas, definiciones, rango);
  return llama.length > 0 ? { ...rango, llama } : { ...rango };
}

/** El manejador de un verbo que despacha a `funcion` de otro módulo, ya leído; undefined si ese
 *  módulo no la define. Lo usa `analizar()` en un segundo paso, cuando tiene todos los archivos. */
export function manejadorEnOtroModulo(archivo: Ruta, lenguaje: Lenguaje, texto: string, funcion: string): VerboCli["manejador"] {
  const lineas = texto.split("\n");
  const definiciones = definicionesDe(lineas, lenguaje);
  const rango = definiciones.get(funcion);
  return rango === undefined ? undefined : { archivo, ...manejadorDe(lineas, definiciones, rango) };
}

/** Las llamadas con las que un verbo despacha su trabajo, de la preferida a la última opción. */
function llamadasDeDespacho(verbo: VerboCli, lineas: readonly string[], verbos: readonly VerboCli[]): string[] {
  if (verbo.via === "switch") {
    // De las llamadas en la línea del case o en las dos siguientes (hasta otro case o un
    // break/return), la última: `return conErrores(() => verboGenerar(resto))` despacha a verboGenerar.
    const llamadas: string[] = [];
    for (let j = verbo.linea - 1; j < Math.min(lineas.length, verbo.linea + 2); j++) {
      const texto = j === verbo.linea - 1 ? lineas[j]!.replace(/^.*?\bcase\s+["'][\w-]+["']\s*:/, "") : lineas[j]!;
      if (j > verbo.linea - 1 && /^\s*(case\b|default\s*:)/.test(texto)) break;
      llamadas.push(...[...texto.matchAll(LLAMADA)].map((m) => m[1]!));
      if (/\b(break|return)\b/.test(texto)) break;
    }
    return llamadas.reverse();
  }
  if (verbo.via === "click" || verbo.via === "typer") {
    const funcion = funcionSiguiente(lineas, verbo.linea - 1);
    return funcion === undefined ? [] : [funcion];
  }
  if (verbo.via !== "argparse") return [];
  // argparse: `verbo.set_defaults(funcion=cmd_verbo)` antes del siguiente add_parser…
  const siguiente = verbos.filter((v) => v.archivo === verbo.archivo && v.linea > verbo.linea).reduce((a, v) => Math.min(a, v.linea), Number.POSITIVE_INFINITY);
  const fin = Math.min(siguiente - 1, verbo.linea - 1 + VENTANA_DE_BANDERAS, lineas.length);
  const porDefecto = lineas.slice(verbo.linea - 1, fin).join("\n").match(/\.set_defaults\(([^)]*)\)/)?.[1];
  if (porDefecto !== undefined) return [...porDefecto.matchAll(/\w+\s*=\s*((?:\w+\.)?\w+)/g)].map((m) => m[1]!);
  // …o, sin set_defaults, un `if` que compara con el nombre del verbo y despacha en su cuerpo
  // (p. ej. `if argumentos[:1] in (["--estado"], ["estado"]):` y debajo `return estado.main()`).
  const literal = new RegExp(`^\\s*(?:el)?if\\b[^#]*(?:==|\\bin\\b)[^#]*["']${verbo.nombre.replace(/[-]/g, "\\-")}["']|^\\s*(?:el)?if\\b[^#]*["']${verbo.nombre.replace(/[-]/g, "\\-")}["'][^#]*(?:==|\\bin\\b)`);
  const i = lineas.findIndex((l) => literal.test(l));
  if (i < 0) return [];
  // El cuerpo va en la línea siguiente si el `if` acaba en «:»; si no, tras los «:» del `if` en
  // la misma línea (`if c == "x": return f()`), que no son los de un subíndice como `[:1]`.
  const condicion = lineas[i]!.replace(/#.*$/, "").trimEnd();
  const tras = condicion.endsWith(":") ? undefined : /:\s*((?:return\s+)?[\w.]+\s*\(.*)$/.exec(condicion)?.[1];
  const cuerpo = tras ?? lineas.slice(i + 1).find((l) => l.trim() !== "" && !l.trim().startsWith("#")) ?? "";
  return [...cuerpo.matchAll(LLAMADA)].map((m) => m[1]!).reverse();
}

/**
 * Un verbo de CLI casi nunca hace el trabajo donde se declara: un `case "verbo":` llama a una
 * función (`return conErrores(() => verboGenerar(resto))`) que vive más abajo, un `add_parser`
 * de argparse la nombra en `set_defaults(funcion=cmd_verbo)` o un `if` del main despacha con
 * `return estado.main()` a otro módulo. Mirar una ventana tras la declaración no ve lo que esa
 * función devuelve (un hallazgo de axd sobre sí mismo y sobre otros repos auditados).
 * Así que a cada verbo se le anota su `manejador`: la función a la que despacha, de su inicio a su
 * fin, más las funciones de ese mismo módulo a las que llama (`llama`, hasta dos saltos). Si la
 * función es de otro módulo del repo (importado), queda pendiente para `analizar()`.
 */
function asignarManejadores(verbos: VerboCli[], lineas: readonly string[], lenguaje: Lenguaje, nombres: Map<string, Importado>): DespachoPendiente[] {
  const definiciones = definicionesDe(lineas, lenguaje);
  const pendientes: DespachoPendiente[] = [];
  for (const verbo of verbos) {
    for (const llamada of llamadasDeDespacho(verbo, lineas, verbos)) {
      const [primero, segundo] = llamada.split(".");
      const local = segundo === undefined ? definiciones.get(primero!) : undefined;
      if (local !== undefined) {
        verbo.manejador = manejadorDe(lineas, definiciones, local);
        break;
      }
      const importado = nombres.get(primero!);
      if (importado === undefined) continue;
      const funcion = segundo === undefined ? importado.simbolo : importado.simbolo === undefined ? segundo : undefined;
      if (funcion === undefined) continue;
      pendientes.push({ verbo, archivo: importado.archivo, funcion });
      break;
    }
  }
  return pendientes;
}

function funcionSiguiente(lineas: readonly string[], desde: number): string | undefined {
  for (let j = desde + 1; j < Math.min(lineas.length, desde + 8); j++) {
    const m = /^\s*(?:async\s+)?def\s+(\w+)/.exec(lineas[j]!);
    if (m) return m[1];
  }
  return undefined;
}

function rutasApi(ruta: Ruta, lineas: readonly string[], lenguaje: Lenguaje): RutaApi[] {
  const rutas: RutaApi[] = [];
  lineas.forEach((linea, i) => {
    if (lenguaje === "python") {
      const m = /^\s*@\w+\.(get|post|put|patch|delete|route|api_route)\(\s*["'](\/[^"']*)["']/.exec(linea);
      if (!m) return;
      const declarados = /methods\s*=\s*\[([^\]]*)\]/.exec(linea)?.[1];
      const metodos = m[1] === "route" || m[1] === "api_route"
        ? (declarados ? [...declarados.matchAll(/["'](\w+)["']/g)].map((x) => x[1]!.toLowerCase()) : ["get"])
        : [m[1]!];
      for (const metodo of metodos) rutas.push({ metodo: metodo as MetodoHttp, ruta: m[2]!, archivo: ruta, linea: i + 1 });
    } else {
      for (const m of linea.matchAll(/\b(?:app|router|server|api|fastify|routes?)\.(get|post|put|patch|delete|all)\(\s*["'`](\/[^"'`]*)/g)) {
        rutas.push({ metodo: m[1] as MetodoHttp, ruta: m[2]!, archivo: ruta, linea: i + 1 });
      }
    }
  });
  return rutas;
}

function toolsMcp(ruta: Ruta, lineas: readonly string[], lenguaje: Lenguaje): ToolMcp[] {
  const tools: ToolMcp[] = [];
  lineas.forEach((linea, i) => {
    if (lenguaje === "python") {
      const m = /^\s*@[\w.]*\btool\(\s*(?:(?:name\s*=\s*)?["']([\w.-]+)["'])?/.exec(linea) ?? /^\s*@[\w.]*\btool\s*$/.exec(linea);
      if (m) {
        const nombre = m[1] ?? funcionSiguiente(lineas, i);
        if (nombre) tools.push({ nombre, archivo: ruta, linea: i + 1 });
      }
    } else {
      for (const m of linea.matchAll(/\.(?:tool|registerTool)\(\s*["'`]([\w.-]+)["'`]/g)) tools.push({ nombre: m[1]!, archivo: ruta, linea: i + 1 });
    }
  });
  return tools;
}

// --- señales ---

const INTERFAZ = /^(gi|gi\.repository.*|PyQt\d.*|PySide\d.*|tkinter|wx|curses|textual.*|urwid|react|react-dom.*|preact|vue|svelte.*|@angular\/.*|solid-js|electron|ink|blessed|@tauri-apps\/.*|express|fastify|koa|hono|@nestjs\/.*|next|flask|fastapi|django.*|aiohttp|starlette|streamlit|gradio)$/;

type Patron = { tipo: TipoDeSenal; patron: RegExp; soloEntrada?: boolean };

const PATRONES: Patron[] = [
  { tipo: "serializa-json", patron: /JSON\.stringify\(|\bjson\.dumps?\(|application\/json|["']--json["']|--format(?:o)?[= ]json|\bres\.json\(|\bjsonify\(/ },
  { tipo: "clave-de-esquema", patron: /["']?\b(esquema|schema_?version|schemaVersion|format_?version|formatVersion)\b["']?\s*[:=]|["']\$schema["']\s*:/ },
  // Por subíndice: `datos["esquema"] = ESQUEMA` (p. ej. en un estado.py de Python), no una comparación.
  { tipo: "clave-de-esquema", patron: /\[\s*["'](esquema|schema_?version|schemaVersion|format_?version|formatVersion|\$schema)["']\s*\]\s*=(?!=)/ },
  { tipo: "escribe-archivo", patron: /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\(|\.write_(text|bytes)\(|\bopen\([^)]*["'][wax]b?\+?["']/ },
  { tipo: "reemplazo-atomico", patron: /\b(renameSync|rename)\(|\bos\.(replace|rename)\(|\.replace\(\s*[\w.]+\s*\)\s*$|write-file-atomic|atomicwrites/ },
  { tipo: "transaccion", patron: /\bBEGIN(\s+(IMMEDIATE|EXCLUSIVE|TRANSACTION))?\b|\bCOMMIT\b|\.transaction\(|\.commit\(\)/ },
  { tipo: "compara-huella", patron: /\bcreateHash\(|\bhashlib\.|\b(etag|if-match|st_mtime|mtimeMs)\b|version[_-]?esperada|expected[_-]?(version|hash|revision|sha)/i },
  { tipo: "compara-huella", patron: /\b\w*(huella|hash|sha\d*|etag|mtime|revision)\w*\s*(!==?|===?)|(!==?|===?)\s*\w*(huella|hash|sha\d*|etag|mtime|revision)\w*\b/i },
  { tipo: "bandera-de-ensayo", patron: /--(dry-?run|aplicar|apply|simular|ensayo|correr|confirm)\b|\bdry_?run\b|\bdryRun\b/ },
  { tipo: "construye-error", patron: /\bthrow\s+new\s+\w*Error\b|\braise\s+\w*(Error|Exception)\b|\{\s*error\s*:|["']error["']\s*:/ },
  { tipo: "campo-de-salida", patron: /["']?\b(salida|hint|sugerencia|siguiente_paso|next_?step|nextStep|suggestion|remedy|remediation)\b["']?\s*:/ },
  { tipo: "campo-reintentable", patron: /\b(reintentable|retryable|retriable)\b/i },
  { tipo: "codigo-de-salida", patron: /\bprocess\.exit\(\s*\d|\bprocess\.exitCode\s*=|\bsys\.exit\(\s*\d|\bSystemExit\(\s*\d|\bos\._exit\(|\bDeno\.exit\(/ },
  { tipo: "manejador-de-errores", patron: /process\.on\(\s*["'](uncaughtException|unhandledRejection)["']|sys\.excepthook/ },
  { tipo: "manejador-de-errores", patron: /\bcatch\s*(\(|\{)|^\s*except\b/, soloEntrada: true },
  { tipo: "tabla-de-auditoria", patron: /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?["`]?\w*(audit|log|bitacora|historial|eventos?|events?|history)\w*/i },
];

function senalesDe(ruta: Ruta, lineas: readonly string[], lenguaje: Lenguaje, imports: Import[], esEntrada: boolean): Senal[] {
  const senales: Senal[] = [];
  const cuenta = new Map<TipoDeSenal, number>();
  const agregar = (tipo: TipoDeSenal, i: number) => {
    const n = cuenta.get(tipo) ?? 0;
    if (n >= MAX_SENALES_POR_TIPO) return;
    if (senales.some((s) => s.linea === i + 1 && s.tipo === tipo)) return;
    cuenta.set(tipo, n + 1);
    senales.push({ tipo, archivo: ruta, linea: i + 1, texto: lineas[i]!.trim().slice(0, MAX_TEXTO_SENAL) });
  };
  for (const i of imports) if (INTERFAZ.test(i.especificador)) agregar("importa-interfaz", i.linea - 1);
  lineas.forEach((linea, i) => {
    for (const p of PATRONES) {
      if (p.soloEntrada && !esEntrada) continue;
      if (p.patron.test(linea)) agregar(p.tipo, i);
    }
    if (falloSilencioso(lineas, i, lenguaje)) agregar("fallo-silencioso", i);
  });
  return senales.sort((a, b) => a.linea - b.linea);
}

/** Un manejador que se traga el error: vacío, o que solo devuelve un valor por defecto. */
function falloSilencioso(lineas: readonly string[], i: number, lenguaje: Lenguaje): boolean {
  const linea = lineas[i]!;
  const siguiente = (lineas[i + 1] ?? "").trim();
  const tras = (lineas[i + 2] ?? "").trim();
  const porDefecto = lenguaje === "python"
    ? /^(pass|continue|return(\s+(None|\[\]|\{\}|""|''|False|0))?)$/
    : /^(return(\s+(null|undefined|\[\]|\{\}|""|''|false|0))?;?|\/\/.*)?$/;
  if (lenguaje === "python") {
    const m = /^\s*except\b[^:]*:\s*(.*)$/.exec(linea);
    if (!m) return false;
    const resto = m[1]!.replace(/#.*$/, "").trim();
    return resto !== "" ? porDefecto.test(resto) : porDefecto.test(siguiente) && siguiente !== "";
  }
  if (/\.catch\(\s*(\(\s*\w*\s*\)|\w+)\s*=>\s*(\{\s*\}|null|undefined|\[\]|\(\s*\{\s*\}\s*\)|false)\s*\)/.test(linea)) return true;
  const m = /\bcatch\s*(\(\s*\w*\s*\))?\s*\{(.*)$/.exec(linea);
  if (!m) return false;
  const enLinea = m[2]!.trim();
  if (enLinea.startsWith("}")) return true;
  const cuerpoEnLinea = /^(.*?)\}/.exec(enLinea)?.[1]?.trim();
  if (cuerpoEnLinea !== undefined) return porDefecto.test(cuerpoEnLinea);
  if (enLinea !== "") return false;
  if (siguiente.startsWith("}")) return true;
  return porDefecto.test(siguiente) && siguiente !== "" && tras.startsWith("}");
}
