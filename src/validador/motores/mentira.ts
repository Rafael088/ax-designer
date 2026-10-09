// Un motor que no lanza ningún agente: devuelve lo que diga su guion y, si el guion lo pide, deja
// archivos en la copia como si el agente los hubiera escrito. Es el de las pruebas y el de
// `axd validar --motor mentira`, que sirve para probar la tubería sin gastar.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SalidaDelMotor } from "../../modelo/index.ts";
import type { Motor, NoDisponible, PedidoDeCorrida } from "../motor.ts";

/** Lo que hace el «agente» en una corrida: su salida y, opcionalmente, archivos que escribe en la copia. */
export type Jugada = SalidaDelMotor & { escribe?: Record<string, string> };

export type Guion = (pedido: PedidoDeCorrida) => Jugada;

/** El guion por defecto: repite la estimación del plan, no toca nada y dice que no corrió nada. */
export const guionEstimado: Guion = (pedido) => {
  const e = pedido.corrida.estimacion;
  return {
    ok: true,
    rondas: e.rondas,
    uso: { entrada: e.tokens_entrada, salida: e.tokens_salida, escritura_cache: 0, lectura_cache: 0 },
    usd: 0,
    acabo: true,
    motivo: "mentira",
    respuesta: "(motor de mentira: no corrió ningún agente; estos números son la estimación del plan)",
    duracion_ms: 0,
  };
};

export type OpcionesDeMentira = {
  guion?: Guion;
  noDisponible?: NoDisponible;
  /** Lo que hace prepararCon; por defecto, nada. */
  prepararCon?: (copia: string) => void;
};

export function motorDeMentira(opciones: OpcionesDeMentira = {}): Motor & { pedidos: PedidoDeCorrida[] } {
  const guion = opciones.guion ?? guionEstimado;
  const pedidos: PedidoDeCorrida[] = [];
  return {
    nombre: "mentira",
    guia: "CLAUDE.md",
    pedidos,
    disponible: () => opciones.noDisponible ?? null,
    prepararCon: (copia) => opciones.prepararCon?.(copia),
    correr(pedido) {
      pedidos.push(pedido);
      const { escribe, ...salida } = guion(pedido);
      for (const [ruta, contenido] of Object.entries(escribe ?? {})) {
        const destino = join(pedido.cwd, ruta);
        mkdirSync(dirname(destino), { recursive: true });
        writeFileSync(destino, contenido, "utf8");
      }
      return salida;
    },
  };
}
