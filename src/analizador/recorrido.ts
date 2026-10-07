// Recorre el repo objetivo con un tope, en orden estable, y saca la lista de archivos que el resto
// del analizador mira. No lee contenidos: eso lo pide cada extractor.
import type { Lector } from "./lector.ts";
import type { Estructura, Ruta } from "../modelo/index.ts";
import { lenguajeDe } from "./lenguajes.ts";

export const CARPETAS_IGNORADAS = [
  ".git", "node_modules", "dist", "build", "out", "target", "vendor", ".venv", "venv",
  "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox", "coverage", ".nyc_output",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".parcel-cache", ".cache", ".idea", "site-packages",
  // Lo que escribe `axd validar --correr`: medirlo cambiaría la auditoría de la que salió.
  ".ax-corridas",
] as const;

const IGNORADAS = new Set<string>(CARPETAS_IGNORADAS);

export type ArchivoVisto = {
  ruta: Ruta;
  nombre: string;
  /** Extensión en minúsculas sin el punto; `""` si no tiene. */
  extension: string;
  bytes: number;
  profundidad: number;
};

export type Recorrido = {
  archivos: ArchivoVisto[];
  carpetas: Ruta[];
  /** Si en la raíz hay `.git` (carpeta, o archivo en un worktree). */
  git: boolean;
  truncado: boolean;
};

export function recorrer(lector: Lector, maxArchivos: number): Recorrido {
  const archivos: ArchivoVisto[] = [];
  const carpetas: Ruta[] = [];
  let git = false;
  let truncado = false;
  const pendientes: { ruta: Ruta; profundidad: number }[] = [{ ruta: "", profundidad: 0 }];
  while (pendientes.length > 0) {
    const { ruta, profundidad } = pendientes.shift()!;
    for (const entrada of lector.listar(ruta)) {
      const camino = ruta === "" ? entrada.nombre : `${ruta}/${entrada.nombre}`;
      if (ruta === "" && entrada.nombre === ".git") git = true;
      if (entrada.tipo === "carpeta") {
        if (IGNORADAS.has(entrada.nombre)) continue;
        carpetas.push(camino);
        pendientes.push({ ruta: camino, profundidad: profundidad + 1 });
      } else if (entrada.tipo === "archivo") {
        if (archivos.length >= maxArchivos) {
          truncado = true;
          continue;
        }
        archivos.push({
          ruta: camino,
          nombre: entrada.nombre,
          extension: extensionDe(entrada.nombre),
          bytes: entrada.bytes,
          profundidad,
        });
      }
    }
  }
  return { archivos, carpetas, git, truncado };
}

export function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf(".");
  return punto <= 0 ? "" : nombre.slice(punto + 1).toLowerCase();
}

export function estructuraDe(recorrido: Recorrido): Estructura {
  const porExtension: Record<string, number> = {};
  const lenguajes: Record<string, number> = {};
  const debajo = new Map<Ruta, number>();
  let bytes = 0;
  for (const a of recorrido.archivos) {
    bytes += a.bytes;
    const clave = a.extension === "" ? "(sin extensión)" : a.extension;
    porExtension[clave] = (porExtension[clave] ?? 0) + 1;
    const lenguaje = lenguajeDe(a);
    if (lenguaje !== undefined) lenguajes[lenguaje] = (lenguajes[lenguaje] ?? 0) + 1;
    const partes = a.ruta.split("/").slice(0, -1);
    for (let i = 1; i <= Math.min(2, partes.length); i++) {
      const carpeta = partes.slice(0, i).join("/");
      debajo.set(carpeta, (debajo.get(carpeta) ?? 0) + 1);
    }
  }
  return {
    archivos: recorrido.archivos.length,
    carpetas: recorrido.carpetas.length,
    bytes,
    por_extension: porExtension,
    raiz: {
      archivos: recorrido.archivos.filter((a) => a.profundidad === 0).map((a) => a.ruta),
      carpetas: recorrido.carpetas.filter((c) => !c.includes("/")),
    },
    carpetas_principales: [...debajo.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([ruta, archivos]) => ({ ruta, archivos })),
    lenguajes,
  };
}
