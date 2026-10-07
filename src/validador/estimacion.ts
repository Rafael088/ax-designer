// Cuánto costaría una corrida, sin correrla. Lo leído sale de la Medicion (sin) y del Contrato
// (con), en tokens del Contador; lo que no se puede medir sin un agente —lo que el agente manda en
// cada ronda y lo que escribe— es un supuesto declarado en la tabla de precios. Es un orden de
// magnitud para decidir si correr, no una factura: la corrida real trae el uso medido.
import type { Contrato, Estimacion, LecturaEstimada, Medicion, Precio, TablaDePrecios, TareaDePrueba, Variante } from "../modelo/index.ts";
import { contarTokens } from "../medicion/index.ts";
import { esquemaDeEntrada } from "../generadores/index.ts";
import { redondear } from "./precios.ts";

export const FORMULA =
  "rondas = min(presupuesto.rondas, rondas de lectura + 1); fijo = contexto_base + enunciado + guía de entrada (+ definiciones de las tools en «con»); " +
  "tokens_entrada = fijo × rondas + leído × ⌈rondas / 2⌉; tokens_salida = rondas × salida_por_ronda; " +
  "usd = (fijo + leído) × escritura_cache + (tokens_entrada − fijo − leído) × lectura_cache + tokens_salida × salida. " +
  "No cuenta que la salida de cada ronda vuelve a entrar en la siguiente ni los reintentos del agente; usd_tope es presupuesto.usd, el límite que se le pasa al motor.";

/** Lo que el agente lee para enterarse en cada variante, y en cuántas rondas. */
export function lecturasDe(variante: Variante, medicion: Medicion, contrato: Contrato): { fijas: LecturaEstimada[]; leidas: LecturaEstimada[]; rondas: number } {
  const camino = (id: string) => medicion.caminos.find((c) => c.id === id);
  const guia = camino("guia-de-entrada");
  const fijas: LecturaEstimada[] = guia === undefined ? [] : [{ que: "La guía de entrada, que el agente carga sola.", archivos: guia.archivos, tokens: guia.tokens }];
  const trabajo = camino("estado-dominio") ?? camino("resumen") ?? camino("lectura-todo")!;
  const sinHerramienta = { leidas: [{ que: trabajo.que, archivos: trabajo.archivos, tokens: trabajo.tokens }], rondas: trabajo.rondas_estimadas };
  if (variante === "sin") return { fijas, ...sinHerramienta };

  const tools = contrato.verbos.map((v) => JSON.stringify({ name: v.nombre, description: v.descripcion, inputSchema: esquemaDeEntrada(v) }));
  fijas.push({ que: `Las definiciones de las ${tools.length} tools del MCP generado, que el agente recibe en cada ronda.`, archivos: ["ax/mcp/herramientas.mjs"], tokens: contarTokens(tools.join("").length) });
  const barata = [...contrato.lecturas].sort((a, b) => a.presupuesto_tokens - b.presupuesto_tokens)[0];
  if (barata === undefined) return { fijas, ...sinHerramienta };
  return {
    fijas,
    leidas: [{ que: `La tool «${barata.verbo}», como mucho su presupuesto del contrato.`, archivos: barata.fuente, tokens: barata.presupuesto_tokens }],
    rondas: 1,
  };
}

export function estimar(tarea: TareaDePrueba, variante: Variante, medicion: Medicion, contrato: Contrato, tabla: TablaDePrecios, precio: Precio | null): Estimacion {
  const { fijas, leidas, rondas: rondasDeLectura } = lecturasDe(variante, medicion, contrato);
  const enunciado = contarTokens(tarea.enunciado.length);
  const fijo = tabla.supuestos.contexto_base_tokens + enunciado + fijas.reduce((a, l) => a + l.tokens, 0);
  const leido = leidas.reduce((a, l) => a + l.tokens, 0);
  const rondas = Math.max(1, Math.min(tarea.presupuesto.rondas, rondasDeLectura + 1));
  const tokens_entrada = fijo * rondas + leido * Math.ceil(rondas / 2);
  const tokens_salida = rondas * tabla.supuestos.salida_por_ronda_tokens;
  const usd = precio === null
    ? null
    : redondear(((fijo + leido) * precio.escritura_cache + (tokens_entrada - fijo - leido) * precio.lectura_cache + tokens_salida * precio.salida) / 1_000_000);
  return {
    rondas,
    tokens_entrada,
    tokens_salida,
    usd,
    usd_tope: tarea.presupuesto.usd,
    lecturas: [{ que: "El enunciado de la tarea.", archivos: [], tokens: enunciado }, ...fijas, ...leidas],
  };
}
