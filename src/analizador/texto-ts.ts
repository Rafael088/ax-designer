// Utilidades para leer TypeScript/JavaScript como texto: emparejar llaves, partir por
// comas de primer nivel, encontrar el final de una sentencia y las definiciones `const x = …`. No
// es un parser: sirve para seguir lo que hace un manejador HTTP sin dependencias.

export function lineaDe(texto: string, indice: number): number {
  return texto.slice(0, indice).split("\n").length;
}

/** El índice de la llave, corchete o paréntesis que cierra el que abre en `abre`, saltando cadenas. */
export function cierreDe(texto: string, abre: number): number | undefined {
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

/** Parte el cuerpo de un objeto (o de una lista, o los argumentos de una llamada) por las comas de primer nivel. */
export function entradasDeObjeto(cuerpo: string): string[] {
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
export function cadena(expresion: string): string {
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

/** Las llamadas de primer nivel de una cadena (`z.number().int().max(200)`), con el texto de sus argumentos. */
export function llamadasDeCadena(expresion: string): { nombre: string; argumentos: string }[] {
  const llamadas: { nombre: string; argumentos: string }[] = [];
  const re = /([A-Za-z_$][\w$]*)\s*\(/g;
  let i = 0;
  while (i < expresion.length) {
    re.lastIndex = i;
    const m = re.exec(expresion);
    if (m === null) break;
    const abre = m.index + m[0].length - 1;
    const cierra = cierreDe(expresion, abre);
    if (cierra === undefined) break;
    llamadas.push({ nombre: m[1]!, argumentos: expresion.slice(abre + 1, cierra) });
    i = cierra + 1;
  }
  return llamadas;
}

/** El texto con el contenido de las cadenas y los comentarios cambiado por espacios: las mismas posiciones, sin falsos positivos. */
export function sinCadenas(texto: string): string {
  let salida = "";
  let comilla: string | undefined;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (comilla !== undefined) {
      if (c === "\\") {
        salida += "  ";
        i++;
      } else if (c === comilla) {
        comilla = undefined;
        salida += c;
      } else salida += c === "\n" ? "\n" : " ";
      continue;
    }
    if (c === "/" && texto[i + 1] === "/") {
      const fin = texto.indexOf("\n", i);
      const hasta = fin === -1 ? texto.length : fin;
      salida += " ".repeat(hasta - i);
      i = hasta - 1;
      continue;
    }
    if (c === "/" && texto[i + 1] === "*") {
      const fin = texto.indexOf("*/", i + 2);
      const hasta = fin === -1 ? texto.length : fin + 2;
      salida += texto.slice(i, hasta).replace(/[^\n]/g, " ");
      i = hasta - 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") comilla = c;
    salida += c;
  }
  return salida;
}

const EMPIEZA_SENTENCIA = /^\s*(?:(?:const|let|var|return|if|for|while|do|await|export|function|async|try|throw|switch|break|continue)\b|\}|\/\/|\/\*)/;

/**
 * Dónde acaba la sentencia que empieza en `desde`: en el `;` de primer nivel, en un salto de línea
 * de primer nivel tras el que empieza otra sentencia, o donde se cierra el bloque que la contiene.
 */
export function finDeSentencia(texto: string, desde: number): number {
  const limpio = sinCadenas(texto);
  let profundidad = 0;
  for (let i = desde; i < limpio.length; i++) {
    const c = limpio[i]!;
    if (c === "{" || c === "(" || c === "[") profundidad++;
    else if (c === "}" || c === ")" || c === "]") {
      if (profundidad === 0) return i;
      profundidad--;
    } else if (profundidad === 0 && c === ";") return i;
    else if (profundidad === 0 && c === "\n") {
      const siguiente = limpio.slice(i + 1, limpio.indexOf("\n", i + 1) === -1 ? limpio.length : limpio.indexOf("\n", i + 1));
      if (siguiente.trim() !== "" && EMPIEZA_SENTENCIA.test(siguiente) && !/^\s*[.?:|&+\-*/,]/.test(siguiente)) return i;
    }
  }
  return limpio.length;
}

const RESERVADAS = new Set([
  "await", "new", "true", "false", "null", "undefined", "typeof", "instanceof", "in", "of", "async", "return", "const", "let", "var",
  "if", "else", "function", "this", "void", "delete", "as", "satisfies", "Math", "Number", "String", "Date", "Object", "Array",
  "Promise", "JSON", "Boolean", "Map", "Set", "parseInt", "parseFloat", "console", "z",
]);

/** Los identificadores que usa una expresión, en orden y sin repetir: ni propiedades (`x.y`), ni claves (`y:`), ni palabras reservadas. */
export function identificadores(expresion: string): string[] {
  const t = sinCadenas(expresion);
  const vistos: string[] = [];
  for (const m of t.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const antes = t[m.index - 1];
    if (antes !== undefined && /[\w$]/.test(antes)) continue;
    if (antes === "." && t.slice(Math.max(0, m.index - 3), m.index) !== "...") continue;
    if (/^\s*:(?!:)/.test(t.slice(m.index + m[0].length)) && /[{,]\s*$/.test(t.slice(0, m.index))) continue;
    if (RESERVADAS.has(m[0]) || /^\d/.test(m[0])) continue;
    if (!vistos.includes(m[0])) vistos.push(m[0]);
  }
  return vistos;
}

export type Definicion = { nombre: string; expresion: string; inicio: number; fin: number; por_defecto?: string };

/**
 * Las definiciones `const|let|var x = …` del texto, con su expresión. Una desestructuración de
 * lista sobre `Promise.all([a, b])` da a cada nombre su elemento; una de objeto, la expresión
 * entera (y el valor por defecto de cada nombre, si lo tiene). Las funciones no cuentan.
 */
export function definicionesDeVariables(texto: string): Definicion[] {
  const limpio = sinCadenas(texto);
  const definiciones: Definicion[] = [];
  for (const m of limpio.matchAll(/\b(?:const|let|var)\s+(\[[^\]]*\]|\{[^}]*\}|[A-Za-z_$][\w$]*)\s*(?::[^=;\n]+?)?=(?![=>])/g)) {
    const desde = m.index + m[0].length;
    const fin = finDeSentencia(texto, desde);
    const expresion = texto.slice(desde, fin).trim();
    if (/^(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(expresion) || /^(async\s+)?function\b/.test(expresion)) continue;
    const patron = texto.slice(m.index, m.index + m[0].length).replace(/^\s*(const|let|var)\s+/, "").replace(/\s*(?::[^=]+)?=$/, "").trim();
    if (patron.startsWith("[")) {
      const nombres = patron.slice(1, -1).split(",").map((n) => n.trim());
      const lista = /^(?:await\s+)?Promise\.all(?:Settled)?\(\s*\[/.exec(expresion);
      const elementos = lista ? (() => {
        const abre = expresion.indexOf("[", lista.index);
        const cierra = cierreDe(expresion, abre);
        return cierra === undefined ? [] : entradasDeObjeto(expresion.slice(abre + 1, cierra));
      })() : [];
      nombres.forEach((n, i) => {
        if (/^[A-Za-z_$][\w$]*$/.test(n)) definiciones.push({ nombre: n, expresion: elementos[i] ?? expresion, inicio: m.index, fin });
      });
    } else if (patron.startsWith("{")) {
      for (const parte of entradasDeObjeto(patron.slice(1, -1))) {
        const d = /^(?:\.\.\.)?([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?(?:\s*=\s*([\s\S]+))?$/.exec(parte);
        if (d) definiciones.push({ nombre: d[2] ?? d[1]!, expresion, inicio: m.index, fin, ...(d[3] !== undefined ? { por_defecto: d[3].trim() } : {}) });
      }
    } else {
      definiciones.push({ nombre: patron, expresion, inicio: m.index, fin });
    }
  }
  return definiciones;
}

/** Un literal de JS como valor: número (con `_`), cadena o booleano; undefined si no lo es. */
export function literal(texto: string): string | number | boolean | undefined {
  const t = texto.trim();
  if (/^-?\d[\d_]*(\.\d+)?$/.test(t)) return Number(t.replace(/_/g, ""));
  const cadenaLiteral = /^(["'`])([^"'`]*)\1$/.exec(t);
  if (cadenaLiteral) return cadenaLiteral[2]!;
  if (t === "true" || t === "false") return t === "true";
  return undefined;
}
