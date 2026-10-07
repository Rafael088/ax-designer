// La tabla de precios es un dato con su fuente (precios.json), no una constante del código: el
// ensayo dice de dónde salió cada número y si alguien lo comprobó. `--precios <archivo>` la
// reemplaza entera con una del mismo formato.
import type { Precio, TablaDePrecios, Uso } from "../modelo/index.ts";
import { ErrorAx } from "../modelo/index.ts";
import tabla from "./precios.json" with { type: "json" };

export const PRECIOS_POR_DEFECTO: TablaDePrecios = tabla;

function malo(que: string): ErrorAx {
  return new ErrorAx(`Tabla de precios: ${que}.`, {
    codigo: 2,
    salida: "Usa el formato de src/validador/precios.json: fuente, fecha, verificado, supuestos y modelos con entrada, salida, escritura_cache y lectura_cache en dólares por millón de tokens.",
  });
}

function numero(v: unknown, donde: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw malo(`${donde} tiene que ser un número ≥ 0`);
  return v;
}

export function leerPrecios(contenido: string): TablaDePrecios {
  let json: Record<string, any>;
  try {
    json = JSON.parse(contenido);
  } catch (e) {
    throw malo(`no es JSON válido (${(e as Error).message})`);
  }
  if (typeof json !== "object" || json === null) throw malo("la raíz tiene que ser un objeto");
  if (typeof json["fuente"] !== "string" || json["fuente"].trim() === "") throw malo("falta «fuente»: un precio sin fuente no vale como estimación");
  if (typeof json["fecha"] !== "string") throw malo("falta «fecha»");
  if (typeof json["verificado"] !== "boolean") throw malo("falta «verificado» (true o false)");
  const s = json["supuestos"];
  if (typeof s !== "object" || s === null || typeof s["fuente"] !== "string") throw malo("falta «supuestos» con contexto_base_tokens, salida_por_ronda_tokens y fuente");
  const modelos: Record<string, Precio> = {};
  if (typeof json["modelos"] !== "object" || json["modelos"] === null) throw malo("falta «modelos»");
  for (const [nombre, p] of Object.entries(json["modelos"] as Record<string, any>)) {
    modelos[nombre] = {
      entrada: numero(p?.entrada, `modelos.${nombre}.entrada`),
      salida: numero(p?.salida, `modelos.${nombre}.salida`),
      escritura_cache: numero(p?.escritura_cache, `modelos.${nombre}.escritura_cache`),
      lectura_cache: numero(p?.lectura_cache, `modelos.${nombre}.lectura_cache`),
    };
  }
  return {
    fuente: json["fuente"],
    fecha: json["fecha"],
    verificado: json["verificado"],
    supuestos: {
      contexto_base_tokens: numero(s["contexto_base_tokens"], "supuestos.contexto_base_tokens"),
      salida_por_ronda_tokens: numero(s["salida_por_ronda_tokens"], "supuestos.salida_por_ronda_tokens"),
      fuente: s["fuente"],
    },
    modelos,
  };
}

/** El precio de un modelo por su alias o por un id que lo contenga («claude-sonnet-…» → sonnet). */
export function precioDe(tabla: TablaDePrecios, modelo: string): Precio | null {
  const exacto = tabla.modelos[modelo];
  if (exacto !== undefined) return exacto;
  const familia = Object.keys(tabla.modelos).find((alias) => modelo.toLowerCase().includes(alias));
  return familia === undefined ? null : tabla.modelos[familia]!;
}

/** Lo que cuesta un uso medido, por la tabla. */
export function costoDeUso(uso: Uso, precio: Precio): number {
  const usd = (uso.entrada * precio.entrada + uso.salida * precio.salida + uso.escritura_cache * precio.escritura_cache + uso.lectura_cache * precio.lectura_cache) / 1_000_000;
  return redondear(usd);
}

export function redondear(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}
