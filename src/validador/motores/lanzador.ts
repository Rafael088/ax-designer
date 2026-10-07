// Cómo lanzan procesos los motores y el verificador. Se inyecta: en pruebas se pasa un lanzador
// que anota lo que se le pidió y no ejecuta nada.
import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export type Lanzamiento = { cwd: string; segundos: number; entorno?: Record<string, string> };

export type Lanzado = { codigo: number | null; stdout: string; stderr: string; error: string | null };

export type Lanzador = (programa: string, argv: readonly string[], opciones: Lanzamiento) => Lanzado;

const MAX_SALIDA = 64 * 1024 * 1024;

/** El lanzador de verdad: sin shell, con tope de tiempo y stdin cerrado (nadie va a contestar). */
export const lanzarDeVerdad: Lanzador = (programa, argv, opciones) => {
  const r = spawnSync(programa, [...argv], {
    cwd: opciones.cwd,
    encoding: "utf8",
    timeout: opciones.segundos * 1000,
    maxBuffer: MAX_SALIDA,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...opciones.entorno },
  });
  const error = r.error === undefined ? null : (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT" ? `pasó el tope de ${opciones.segundos} s` : r.error.message;
  return { codigo: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error };
};

export type Buscador = (programa: string) => string | null;

/** Busca un ejecutable en el PATH sin ejecutarlo. */
export const buscarEnPath: Buscador = (programa) => {
  for (const carpeta of (process.env["PATH"] ?? "").split(delimiter)) {
    if (carpeta === "") continue;
    const ruta = join(carpeta, programa);
    try {
      accessSync(ruta, constants.X_OK);
      return ruta;
    } catch {
      continue;
    }
  }
  return null;
};
