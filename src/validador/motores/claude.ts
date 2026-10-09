// El motor de verdad: Claude Code sin interfaz (`claude -p --output-format stream-json --verbose`),
// que imprime un evento JSON por línea —lo que hace el agente paso a paso— y al acabar el evento
// `result` con num_turns, usage y total_cost_usd. La salida entera es la transcripción que el
// validador guarda en .ax-corridas/. CUESTA DINERO: solo corre desde `axd validar --correr`, y las
// pruebas le inyectan un lanzador que no ejecuta nada.
//
// Las dos variantes corren con --strict-mcp-config, para que los MCP que tenga configurados quien
// lo lanza no entren en ninguna; el «con» suma solo el MCP generado, por --mcp-config.
// Las banderas son las de Claude Code documentadas para el modo sin interfaz y no se comprobaron
// contra `claude --help` al escribir esto (no se lanzó claude): si alguna no existe, claude sale
// sin el JSON de resultado y la corrida queda como fallo del motor, sin gastar.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SalidaDelMotor } from "../../modelo/index.ts";
import { ErrorAx } from "../../modelo/index.ts";
import type { Motor, NoDisponible, PedidoDeCorrida } from "../motor.ts";
import { buscarEnPath, lanzarDeVerdad, type Buscador, type Lanzador } from "./lanzador.ts";

/** Las herramientas propias del agente que se permiten en las dos variantes, para que la comparación sea justa. */
export const HERRAMIENTAS_BASE = ["Read", "Grep", "Glob", "Edit", "Write", "Bash"] as const;

export type OpcionesDeClaude = {
  programa?: string;
  lanzador?: Lanzador;
  buscar?: Buscador;
  herramientas?: readonly string[];
};

/** La ruta de la config del MCP que se le pasa a claude en «con». */
export function rutaDeConfigMcp(pedido: PedidoDeCorrida): string {
  return join(pedido.temporal, `mcp-${pedido.corrida.id.replaceAll("/", "-")}.json`);
}

export function configMcp(mcp: NonNullable<PedidoDeCorrida["mcp"]>): string {
  return JSON.stringify({ mcpServers: { [mcp.nombre]: { command: "node", args: [mcp.servidor] } } }, null, 2) + "\n";
}

/** El argv de `claude` para una corrida. Sin shell: el enunciado va como un solo argumento. */
export function argvDeClaude(pedido: PedidoDeCorrida, herramientas: readonly string[] = HERRAMIENTAS_BASE): string[] {
  const permitidas = pedido.mcp === null ? [...herramientas] : [...herramientas, `mcp__${pedido.mcp.nombre}`];
  const argv = [
    "-p", pedido.enunciado,
    // stream-json en modo -p exige --verbose; da la transcripción y, al final, el mismo evento result que json.
    "--output-format", "stream-json",
    "--verbose",
    "--model", pedido.modelo,
    // --max-turns no sale en `claude --help`, pero claude 2.1.291 la define (`--max-turns <turns>`).
    "--max-turns", String(pedido.presupuesto.rondas),
    "--max-budget-usd", String(pedido.presupuesto.usd),
    "--permission-mode", "acceptEdits",
    "--allowedTools", permitidas.join(","),
    "--strict-mcp-config",
  ];
  if (pedido.mcp !== null) argv.push("--mcp-config", rutaDeConfigMcp(pedido));
  return argv;
}

function entero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Una línea que no es JSON no es un evento (claude puede imprimir avisos sueltos); cualquier otro fallo sube. */
function objeto(texto: string): Record<string, unknown> | undefined {
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    v = undefined;
  }
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** El evento `result`: el último de la transcripción stream-json, o el JSON entero de `--output-format json`. */
function eventoDeResultado(stdout: string): Record<string, unknown> | undefined {
  const entero = objeto(stdout.trim());
  if (entero?.["type"] === "result") return entero;
  const lineas = stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lineas.length - 1; i >= 0; i--) {
    const evento = objeto(lineas[i]!);
    if (evento?.["type"] === "result") return evento;
  }
  return undefined;
}

/** Lo que imprime `claude -p --output-format stream-json --verbose` (o `json`) → SalidaDelMotor, con la transcripción. */
export function leerSalidaDeClaude(stdout: string, stderr: string, codigo: number | null, error: string | null): SalidaDelMotor {
  const json = eventoDeResultado(stdout);
  const transcripcion = stdout.trim() !== "" ? { transcripcion: stdout } : {};
  if (json === undefined) {
    const detalle = [error, stderr.trim().slice(0, 2000), stdout.trim().slice(-500)].filter((x) => x !== null && x !== "").join(" · ");
    return { ok: false, error: `claude no devolvió el evento de resultado (código ${codigo ?? "ninguno"}).`, detalle: detalle || "sin salida", ...transcripcion };
  }
  const usage = (typeof json["usage"] === "object" && json["usage"] !== null ? json["usage"] : {}) as Record<string, unknown>;
  const subtipo = typeof json["subtype"] === "string" ? json["subtype"] : "desconocido";
  const acabo = subtipo === "success" && json["is_error"] !== true;
  return {
    ok: true,
    rondas: entero(json["num_turns"]),
    uso: {
      entrada: entero(usage["input_tokens"]),
      salida: entero(usage["output_tokens"]),
      escritura_cache: entero(usage["cache_creation_input_tokens"]),
      lectura_cache: entero(usage["cache_read_input_tokens"]),
    },
    usd: typeof json["total_cost_usd"] === "number" ? json["total_cost_usd"] : null,
    acabo,
    motivo: acabo ? "success" : error ?? subtipo,
    respuesta: typeof json["result"] === "string" ? json["result"] : "",
    duracion_ms: entero(json["duration_ms"]),
    ...transcripcion,
  };
}

export function motorClaude(opciones: OpcionesDeClaude = {}): Motor {
  const programa = opciones.programa ?? "claude";
  const lanzar = opciones.lanzador ?? lanzarDeVerdad;
  const buscar = opciones.buscar ?? buscarEnPath;
  const herramientas = opciones.herramientas ?? HERRAMIENTAS_BASE;
  return {
    nombre: "claude",
    guia: "CLAUDE.md",
    disponible({ con, mcp = true }): NoDisponible | null {
      if (buscar(programa) === null) {
        return {
          error: `No encuentro «${programa}» en el PATH: el motor claude necesita Claude Code instalado.`,
          salida: "Instala Claude Code (`npm install -g @anthropic-ai/claude-code`), entra una vez con `claude` para iniciar sesión y vuelve a ensayar; o prueba la tubería con `--motor mentira`, que no corre ningún agente.",
        };
      }
      if (con && mcp && buscar("npm") === null) {
        return { error: "No encuentro «npm» en el PATH: el «con» necesita instalar el SDK del MCP generado.", salida: "Instala Node.js con npm y vuelve a ensayar." };
      }
      return null;
    },
    prepararCon(copia) {
      const r = lanzar("npm", ["install", "--no-audit", "--no-fund", "--omit=dev"], { cwd: join(copia, "ax", "mcp"), segundos: 600 });
      if (r.codigo !== 0) {
        throw new ErrorAx(`No se pudo instalar el SDK del MCP generado (npm install en ax/mcp salió con ${r.codigo ?? r.error}).`, {
          codigo: 3,
          salida: "Revisa la red y npm (la salida de npm va en «detalle») y vuelve a correr; no se lanzó ningún agente.",
          reintentable: true,
          datos: { detalle: (r.error ?? r.stderr).slice(0, 2000) },
        });
      }
    },
    correr(pedido) {
      if (pedido.mcp !== null) writeFileSync(rutaDeConfigMcp(pedido), configMcp(pedido.mcp), "utf8");
      const r = lanzar(programa, argvDeClaude(pedido, herramientas), { cwd: pedido.cwd, segundos: pedido.presupuesto.segundos });
      return leerSalidaDeClaude(r.stdout, r.stderr, r.codigo, r.error);
    },
  };
}
