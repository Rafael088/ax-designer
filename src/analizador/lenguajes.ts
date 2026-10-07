import type { Lenguaje } from "../modelo/index.ts";

const POR_EXTENSION: Record<string, Lenguaje> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  go: "go",
  rs: "rust",
  rb: "ruby",
};

/** Lenguajes de los que se extraen imports, superficies y señales. Del resto solo se cuentan archivos. */
export const LENGUAJES_CON_SOPORTE = new Set<Lenguaje>(["typescript", "javascript", "python"]);

export function lenguajeDe(archivo: { extension: string }): Lenguaje | undefined {
  return POR_EXTENSION[archivo.extension];
}
