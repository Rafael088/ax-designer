// Plantilla de ax/mcp/herramientas.mjs: la parte del MCP server que no depende del SDK. Traduce los
// argumentos de una tool a argv del CLI que declara el contrato, lo corre y devuelve su JSON. Lo
// propio del repo entra como un objeto JSON (`datos`); el resto es código fijo.
//
// El código fijo va en una plantilla de texto de TypeScript, así que no lleva comillas invertidas,
// `${` ni barras invertidas: se escribe tal cual en el archivo generado.

export type DatosDeHerramientas = {
  nombre: string;
  version: string;
  contrato: string;
  hasta_la_raiz: string;
  cli: { programa: string; argumentos: string[]; ruta: string };
  herramientas: unknown[];
  vedadas: { nombre: string; que: string; motivo: string }[];
  instrucciones: string;
};

export function plantillaDeHerramientas(datos: DatosDeHerramientas): string {
  return `// Las tools de este MCP server: una por verbo del contrato de AX (ax/contrato.json). Cada una
// traduce sus argumentos a argv, llama al CLI del repo y devuelve su JSON tal cual; los errores
// conservan error, salida y reintentable. Las transiciones vedadas no son tools.
// No importa el SDK de MCP: se puede probar sin él (servidor.mjs es quien lo usa).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATOS = ${JSON.stringify(datos, null, 2)};

export const NOMBRE = DATOS.nombre;
export const VERSION = DATOS.version;
export const CONTRATO = DATOS.contrato;
export const CLI = DATOS.cli;
export const HERRAMIENTAS = DATOS.herramientas;
export const VEDADAS = DATOS.vedadas;
export const INSTRUCCIONES = DATOS.instrucciones;
/** La raíz del repo, desde donde se corre el CLI. */
export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), DATOS.hasta_la_raiz);

const ESPERA_MS = Number(process.env.AX_MCP_ESPERA_MS) > 0 ? Number(process.env.AX_MCP_ESPERA_MS) : 120000;
const MAX_SALIDA = 8 * 1024 * 1024;

/** Lo que devuelve tools/list. */
export function listar() {
  return HERRAMIENTAS.map((h) => ({
    name: h.nombre,
    description: h.descripcion,
    inputSchema: h.esquema,
    annotations: { readOnlyHint: h.tipo === "lectura", destructiveHint: false, idempotentHint: h.tipo === "lectura", openWorldHint: false },
  }));
}

function errorDeUso(mensaje, herramienta) {
  return {
    esquema: 1,
    error: mensaje,
    salida: herramienta
      ? "Revisa el inputSchema de «" + herramienta.nombre + "» y vuelve a llamarla."
      : "Pide la lista de tools (tools/list) y usa una de ellas.",
    reintentable: false,
  };
}

function tipoIncorrecto(entrada, valor) {
  if (entrada.tipo === "texto" && typeof valor !== "string") return "tiene que ser texto";
  if (entrada.tipo === "entero" && !Number.isInteger(valor)) return "tiene que ser un entero";
  if (entrada.tipo === "booleano" && typeof valor !== "boolean") return "tiene que ser true o false";
  if (entrada.tipo === "lista" && (!Array.isArray(valor) || valor.some((v) => typeof v !== "string"))) return "tiene que ser una lista de textos";
  if (entrada.como === "posicional" && String(valor).startsWith("-")) return "no puede empezar por «-»: el CLI lo tomaría por una bandera";
  return undefined;
}

/**
 * Los argumentos de la tool, traducidos a argv del CLI según la convención del contrato:
 * prefijo, verbo, posicionales en orden y luego «--bandera=valor» (los booleanos, solo
 * «--bandera» si son true; las listas, una vez por elemento). Valida antes de lanzar nada.
 */
export function argvDe(herramienta, argumentos) {
  const args = argumentos === undefined || argumentos === null ? {} : argumentos;
  if (typeof args !== "object" || Array.isArray(args)) return { error: errorDeUso("Los argumentos tienen que ser un objeto.", herramienta) };
  const conocidas = new Set(herramienta.entradas.map((e) => e.nombre));
  for (const clave of Object.keys(args)) {
    if (!conocidas.has(clave)) return { error: errorDeUso("«" + clave + "» no es una entrada de «" + herramienta.nombre + "».", herramienta) };
  }
  const posicionales = [];
  const banderas = [];
  for (const entrada of herramienta.entradas) {
    const valor = args[entrada.nombre];
    if (valor === undefined || valor === null) {
      if (entrada.requerida) return { error: errorDeUso("Falta «" + entrada.nombre + "»: " + entrada.descripcion, herramienta) };
      continue;
    }
    const problema = tipoIncorrecto(entrada, valor);
    if (problema) return { error: errorDeUso("«" + entrada.nombre + "» " + problema + ".", herramienta) };
    if (entrada.como === "posicional") posicionales[entrada.posicion] = String(valor);
    else if (entrada.tipo === "booleano") {
      if (valor) banderas.push(entrada.bandera);
    } else if (entrada.tipo === "lista") {
      for (const v of valor) banderas.push(entrada.bandera + "=" + v);
    } else banderas.push(entrada.bandera + "=" + String(valor));
  }
  return { argv: [...CLI.argumentos, ...herramienta.argv, ...posicionales.filter((p) => p !== undefined), ...banderas] };
}

function correr(argv) {
  return new Promise((terminar) => {
    let hijo;
    try {
      hijo = spawn(CLI.programa, argv, { cwd: RAIZ, stdio: ["ignore", "pipe", "pipe"], timeout: ESPERA_MS, windowsHide: true });
    } catch (fallo) {
      terminar({ fallo });
      return;
    }
    const salida = [];
    const errores = [];
    let bytes = 0;
    let bytesDeErrores = 0;
    hijo.stdout.on("data", (trozo) => {
      bytes += trozo.length;
      if (bytes <= MAX_SALIDA) salida.push(trozo);
    });
    hijo.stderr.on("data", (trozo) => {
      bytesDeErrores += trozo.length;
      if (bytesDeErrores <= 64 * 1024) errores.push(trozo);
    });
    hijo.on("error", (fallo) => terminar({ fallo }));
    hijo.on("close", (codigo, senal) =>
      terminar({
        codigo,
        senal,
        stdout: Buffer.concat(salida).toString("utf8"),
        stderr: Buffer.concat(errores).toString("utf8"),
        excedido: bytes > MAX_SALIDA,
      }),
    );
  });
}

function cola(texto) {
  const limpio = (texto || "").trim();
  return limpio === "" ? "(vacía)" : limpio.slice(-500);
}

function fallo(codigo, error, salida, reintentable) {
  return { esError: true, codigo, json: { esquema: 1, error, salida, reintentable } };
}

/**
 * Llama a la tool «nombre»: { esError, codigo, json }. «codigo» es el código de salida del CLI
 * (null si no llegó a correr). Nunca lanza: todo fallo vuelve como JSON con error y salida.
 */
export async function llamar(nombre, argumentos) {
  const herramienta = HERRAMIENTAS.find((h) => h.nombre === nombre);
  if (!herramienta) {
    const vedada = VEDADAS.find((v) => v.nombre === nombre);
    if (vedada) {
      return fallo(null, "«" + nombre + "» no es una tool: es una transición vedada al agente. " + vedada.motivo, "No la reintentes: pídesela a una persona.", false);
    }
    return { esError: true, codigo: null, json: errorDeUso("No hay ninguna tool «" + nombre + "».") };
  }
  const traducido = argvDe(herramienta, argumentos);
  if (traducido.error) return { esError: true, codigo: 2, json: traducido.error };
  if (!existsSync(resolve(RAIZ, CLI.ruta))) {
    return fallo(null, "El CLI del contrato todavía no existe: falta " + CLI.ruta + ".", "Genéralo con «axd generar cli --aplicar» en la raíz del repo y vuelve a llamar a la tool.", false);
  }
  const comando = [CLI.programa, ...traducido.argv].join(" ");
  const corrida = await correr(traducido.argv);
  if (corrida.fallo) {
    const falta = corrida.fallo.code === "ENOENT";
    return fallo(
      null,
      "No se pudo lanzar «" + comando + "»: " + corrida.fallo.message,
      falta ? "Instala «" + CLI.programa + "» o ponlo en el PATH del cliente MCP." : "Lee el mensaje; si se repite, avisa a una persona.",
      false,
    );
  }
  if (corrida.senal) {
    return fallo(null, "«" + comando + "» no terminó (señal " + corrida.senal + ", espera de " + ESPERA_MS + " ms).", "Si es lento de verdad, sube AX_MCP_ESPERA_MS; si se colgó, avisa a una persona.", true);
  }
  let json;
  try {
    json = JSON.parse(corrida.stdout);
  } catch {
    json = undefined;
  }
  if (json === undefined || json === null || typeof json !== "object" || corrida.excedido) {
    return fallo(
      corrida.codigo,
      "«" + comando + "» salió con código " + corrida.codigo + " y no devolvió JSON" + (corrida.excedido ? " (la salida pasó de 8 MB)." : "."),
      "El CLI tiene que responder JSON por stdout. Su salida de errores: " + cola(corrida.stderr),
      false,
    );
  }
  if (corrida.codigo === 0) return { esError: false, codigo: 0, json };
  const cuerpo = Array.isArray(json) ? { resultado: json } : json;
  return {
    esError: true,
    codigo: corrida.codigo,
    json: {
      ...cuerpo,
      error: typeof cuerpo.error === "string" ? cuerpo.error : "«" + comando + "» salió con código " + corrida.codigo + ".",
      salida: typeof cuerpo.salida === "string" ? cuerpo.salida : "El CLI no dijo el siguiente paso: lee el error.",
      reintentable: typeof cuerpo.reintentable === "boolean" ? cuerpo.reintentable : corrida.codigo === 4,
      codigo_de_salida: corrida.codigo,
    },
  };
}
`;
}
