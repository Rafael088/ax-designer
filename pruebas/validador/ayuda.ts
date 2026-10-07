// Lo que comparten las pruebas del validador: copias temporales de los repos de mentira, el
// pedido armado como lo arma la CLI y una huella del árbol para comprobar que nada se tocó.
// Nunca se usa un motor de verdad: los motores salen de motorDeMentira o llevan un lanzador falso.
import { cpSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { analizar, lectorDeDisco, lectorSinOcultos } from "../../src/analizador/index.ts";
import { generarContrato } from "../../src/contrato/index.ts";
import { esGeneradoPorAxd } from "../../src/generadores/index.ts";
import { generarInforme } from "../../src/informe/index.ts";
import { medir } from "../../src/medicion/index.ts";
import { evaluarRubrica } from "../../src/rubrica/index.ts";
import { leerTareas, type Motor, type PedidoDeValidacion } from "../../src/validador/index.ts";

export const RAIZ = join(import.meta.dirname, "..", "..");
export const REPOS = join(RAIZ, "pruebas", "repos");
export const TAREAS_NODE_CLI = join(RAIZ, "pruebas", "validador", "node-cli.tareas.json");

export function copiaDe(repo: string): string {
  const destino = join(mkdtempSync(join(tmpdir(), "axd-validador-")), repo);
  cpSync(join(REPOS, repo), destino, { recursive: true });
  return destino;
}

export function tareasDeNodeCli() {
  return leerTareas(readFileSync(TAREAS_NODE_CLI, "utf8"));
}

export function pedidoPara(raiz: string, motor: Motor, extra: Partial<PedidoDeValidacion> = {}): PedidoDeValidacion {
  const inventario = analizar(lectorSinOcultos(lectorDeDisco(raiz), esGeneradoPorAxd));
  const medicion = medir(inventario);
  const contrato = generarContrato(generarInforme(inventario.raiz, evaluarRubrica(inventario, medicion)), inventario);
  return { raiz, tareas: tareasDeNodeCli(), medicion, contrato, motor, ...extra };
}

/** sha256 de cada archivo del árbol (salvo lo que se pida ignorar), en orden: si cambia algo, cambia. */
export function huellaDelArbol(raiz: string, ignorar: readonly string[] = []): string {
  const h = createHash("sha256");
  const recorrer = (carpeta: string, prefijo: string) => {
    for (const e of readdirSync(join(raiz, carpeta), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const ruta = prefijo === "" ? e.name : `${prefijo}/${e.name}`;
      if (ignorar.includes(e.name)) continue;
      if (e.isDirectory()) recorrer(join(carpeta, e.name), ruta);
      else h.update(ruta).update("\0").update(readFileSync(join(raiz, carpeta, e.name))).update("\0");
    }
  };
  recorrer("", "");
  return h.digest("hex");
}
