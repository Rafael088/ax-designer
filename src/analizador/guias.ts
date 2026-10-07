// README y guías para agentes: lo primero que lee quien llega al repo.
import { posix } from "node:path";
import type { Guia, Ruta, TipoDeGuia } from "../modelo/index.ts";
import { contarLineas } from "./codigo.ts";
import type { ArchivoVisto } from "./recorrido.ts";

export const GUIAS_BUSCADAS = [
  "README* (raíz)",
  "AGENTS.md (cualquier carpeta)",
  "CLAUDE.md (cualquier carpeta), .claude/CLAUDE.md",
  "llms.txt, llms-full.txt (raíz y docs/)",
  "GEMINI.md, .cursorrules, .windsurfrules, .cursor/rules/*, .github/copilot-instructions.md",
];

const LENGUAJES_DE_CONSOLA = new Set(["sh", "bash", "shell", "console", "zsh", "fish", "shell-session"]);

export function tipoDeGuia(archivo: ArchivoVisto): { tipo: TipoDeGuia; seCarga: boolean } | undefined {
  const { ruta, nombre, profundidad } = archivo;
  const raiz = profundidad === 0;
  if (raiz && /^readme(\.(md|markdown|rst|txt))?$/i.test(nombre)) return { tipo: "readme", seCarga: false };
  if (nombre === "AGENTS.md") return { tipo: "agents", seCarga: raiz };
  if (nombre === "CLAUDE.md" || nombre === "CLAUDE.local.md") {
    return { tipo: "claude", seCarga: raiz || ruta === ".claude/CLAUDE.md" };
  }
  if ((raiz || ruta.startsWith("docs/")) && /^llms(-full)?\.txt$/.test(nombre)) return { tipo: "llms", seCarga: false };
  if (
    (raiz && ["GEMINI.md", ".cursorrules", ".windsurfrules"].includes(nombre)) ||
    ruta === ".github/copilot-instructions.md" ||
    ruta.startsWith(".cursor/rules/")
  ) {
    return { tipo: "otra-guia-de-agente", seCarga: raiz };
  }
  return undefined;
}

export function leerGuia(
  archivo: ArchivoVisto,
  texto: string,
  existentes: ReadonlySet<Ruta>,
  maxContenido: number,
): Guia {
  const { tipo, seCarga } = tipoDeGuia(archivo)!;
  const titulos: Guia["titulos"] = [];
  const comandos: Guia["comandos"] = [];
  const incluye = new Set<Ruta>();
  const carpeta = posix.dirname(archivo.ruta);
  let enBloque: string | undefined;
  texto.split("\n").forEach((linea, i) => {
    const valla = /^\s*(```|~~~)\s*([\w-]*)/.exec(linea);
    if (valla) {
      enBloque = enBloque === undefined ? (valla[2] ?? "").toLowerCase() : undefined;
      return;
    }
    if (enBloque !== undefined) {
      if (!LENGUAJES_DE_CONSOLA.has(enBloque)) return;
      const comando = linea.replace(/^\s*\$\s+/, "").trim();
      if (comando !== "" && !comando.startsWith("#")) comandos.push({ texto: comando, linea: i + 1 });
      return;
    }
    const titulo = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(linea);
    if (titulo) titulos.push({ nivel: titulo[1]!.length, texto: titulo[2]!, linea: i + 1 });
    for (const m of linea.matchAll(/(?:^|\s)@([\w./~-]+\.[\w]+)/g)) {
      const destino = posix.normalize(posix.join(carpeta, m[1]!));
      if (existentes.has(destino)) incluye.add(destino);
    }
  });
  return {
    tipo,
    ruta: archivo.ruta,
    bytes: archivo.bytes,
    caracteres: texto.length,
    lineas: contarLineas(texto),
    se_carga_al_entrar: seCarga,
    titulos,
    incluye: [...incluye],
    comandos,
    contenido: texto.length > maxContenido ? texto.slice(0, maxContenido) : texto,
    truncado: texto.length > maxContenido,
  };
}
