// El archivo de tareas de prueba (`axd validar --tareas <archivo>`): JSON, porque axd no tiene
// dependencias y un agente lo escribe sin dudar. Se valida entero antes de planear nada, y cada
// error dice qué clave arreglar: un archivo mal escrito es uso incorrecto (2), no un fallo.
import type { TareasDePrueba, CriterioDeTerminado, Presupuesto, TareaDePrueba } from "../modelo/index.ts";
import { ErrorAx } from "../modelo/index.ts";

/** Lo que se toma si el archivo no lo dice. El modelo es un alias de Claude Code. */
export const POR_DEFECTO = { modelo: "sonnet", repeticiones: 1, presupuesto: { rondas: 20, usd: 1, segundos: 600 } } as const;

export const MAX_REPETICIONES = 10;

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function malo(donde: string, que: string): ErrorAx {
  return new ErrorAx(`Archivo de tareas: ${donde} ${que}.`, {
    codigo: 2,
    salida: "Corrige el archivo de tareas (su formato está en docs/validador.md) y vuelve a ensayar.",
  });
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function texto(v: unknown, donde: string): string {
  if (typeof v !== "string" || v.trim() === "") throw malo(donde, "tiene que ser un texto no vacío");
  return v;
}

function positivo(v: unknown, donde: string, entero: boolean): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || (entero && !Number.isInteger(v))) {
    throw malo(donde, `tiene que ser un número ${entero ? "entero " : ""}mayor que 0`);
  }
  return v;
}

export function validarRepeticiones(v: unknown, donde: string): number {
  const n = positivo(v, donde, true);
  if (n > MAX_REPETICIONES) throw malo(donde, `no puede pasar de ${MAX_REPETICIONES}: cada repetición es una corrida paga por variante`);
  return n;
}

function criterio(v: unknown, donde: string): CriterioDeTerminado {
  if (!esObjeto(v)) throw malo(donde, "tiene que ser un objeto con «tipo»: comando, archivo-contiene o respuesta-contiene");
  switch (v["tipo"]) {
    case "comando": {
      const argv = v["argv"];
      if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== "string" || a === "")) {
        throw malo(`${donde}.argv`, "tiene que ser una lista no vacía de textos (programa y argumentos, sin shell)");
      }
      const codigo = v["codigo"];
      if (codigo !== undefined && (typeof codigo !== "number" || !Number.isInteger(codigo) || codigo < 0)) throw malo(`${donde}.codigo`, "tiene que ser un entero ≥ 0");
      return codigo === undefined ? { tipo: "comando", argv: argv as string[] } : { tipo: "comando", argv: argv as string[], codigo };
    }
    case "archivo-contiene": {
      const ruta = texto(v["ruta"], `${donde}.ruta`);
      if (ruta.startsWith("/") || ruta.split("/").includes("..")) throw malo(`${donde}.ruta`, "tiene que ser relativa a la raíz del repo y no salir de él");
      return { tipo: "archivo-contiene", ruta, texto: texto(v["texto"], `${donde}.texto`) };
    }
    case "respuesta-contiene":
      return { tipo: "respuesta-contiene", texto: texto(v["texto"], `${donde}.texto`) };
    default:
      throw malo(`${donde}.tipo`, "tiene que ser comando, archivo-contiene o respuesta-contiene");
  }
}

function presupuesto(v: unknown, donde: string): Presupuesto {
  if (v === undefined) return { ...POR_DEFECTO.presupuesto };
  if (!esObjeto(v)) throw malo(donde, "tiene que ser un objeto con rondas, usd y segundos");
  return {
    rondas: v["rondas"] === undefined ? POR_DEFECTO.presupuesto.rondas : positivo(v["rondas"], `${donde}.rondas`, true),
    usd: v["usd"] === undefined ? POR_DEFECTO.presupuesto.usd : positivo(v["usd"], `${donde}.usd`, false),
    segundos: v["segundos"] === undefined ? POR_DEFECTO.presupuesto.segundos : positivo(v["segundos"], `${donde}.segundos`, true),
  };
}

function tarea(v: unknown, i: number): TareaDePrueba {
  const donde = `tareas[${i}]`;
  if (!esObjeto(v)) throw malo(donde, "tiene que ser un objeto con id, enunciado y terminado");
  const id = texto(v["id"], `${donde}.id`);
  if (!ID.test(id)) throw malo(`${donde}.id`, "tiene que ser minúsculas, números y guiones (máx. 64)");
  return { id, enunciado: texto(v["enunciado"], `${donde}.enunciado`), terminado: criterio(v["terminado"], `${donde}.terminado`), presupuesto: presupuesto(v["presupuesto"], `${donde}.presupuesto`) };
}

/** El texto del archivo → TareasDePrueba validado, o un ErrorAx con código 2. */
export function leerTareas(contenido: string): TareasDePrueba {
  let json: unknown;
  try {
    json = JSON.parse(contenido);
  } catch (e) {
    throw malo("el archivo", `no es JSON válido (${(e as Error).message})`);
  }
  if (!esObjeto(json)) throw malo("la raíz", "tiene que ser un objeto");
  if (json["esquema"] !== 1) throw malo("«esquema»", "tiene que ser 1");
  const lista = json["tareas"];
  if (!Array.isArray(lista) || lista.length === 0) throw malo("«tareas»", "tiene que ser una lista con al menos una tarea");
  const tareas = lista.map(tarea);
  const vistos = new Set<string>();
  for (const t of tareas) {
    if (vistos.has(t.id)) throw malo(`la tarea «${t.id}»`, "está repetida");
    vistos.add(t.id);
  }
  return {
    esquema: 1,
    modelo: json["modelo"] === undefined ? POR_DEFECTO.modelo : texto(json["modelo"], "«modelo»"),
    repeticiones: json["repeticiones"] === undefined ? POR_DEFECTO.repeticiones : validarRepeticiones(json["repeticiones"], "«repeticiones»"),
    tareas,
  };
}
