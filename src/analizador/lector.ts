// El único sitio de axd que lee el repo objetivo. Todo el analizador pasa por un `Lector`, así
// que en pruebas se le puede dar un repo en memoria y el resto del código no sabe la diferencia.
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ErrorAx } from "../modelo/index.ts";
import type { Ruta } from "../modelo/index.ts";

export type Entrada = { nombre: string; tipo: "archivo" | "carpeta" | "otro"; bytes: number };

export interface Lector {
  /** Cómo se llama la raíz para quien lee el Inventario. */
  readonly raiz: string;
  /** Las entradas de una carpeta, ordenadas por nombre. `""` es la raíz. */
  listar(ruta: Ruta): Entrada[];
  /** El archivo entero como UTF-8. */
  leer(ruta: Ruta): string;
}

/** Lee del disco. Los enlaces simbólicos no se siguen: salen como `otro`, para no salir del repo. */
export function lectorDeDisco(raiz: string): Lector {
  const absoluta = resolve(raiz);
  let tipo: ReturnType<typeof lstatSync> | undefined;
  try {
    tipo = lstatSync(absoluta);
  } catch {
    throw new ErrorAx(`No existe la ruta «${raiz}».`, {
      codigo: 2,
      salida: "Pasa la ruta de la carpeta del repo que quieres analizar, p. ej. `axd analizar ../mi-repo`.",
    });
  }
  if (!tipo.isDirectory()) {
    throw new ErrorAx(`«${raiz}» no es una carpeta.`, {
      codigo: 2,
      salida: "Pasa la carpeta raíz del repo, no un archivo de dentro.",
    });
  }
  return {
    raiz,
    listar(ruta) {
      const carpeta = join(absoluta, ruta);
      return readdirSync(carpeta, { withFileTypes: true })
        .map((d): Entrada => {
          if (d.isDirectory()) return { nombre: d.name, tipo: "carpeta", bytes: 0 };
          if (d.isFile()) return { nombre: d.name, tipo: "archivo", bytes: lstatSync(join(carpeta, d.name)).size };
          return { nombre: d.name, tipo: "otro", bytes: 0 };
        })
        .sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
    },
    leer(ruta) {
      return readFileSync(join(absoluta, ruta), "utf8");
    },
  };
}

/** Un repo hecho de un objeto { ruta: contenido }. Para pruebas de casos que no merecen carpeta. */
export function lectorEnMemoria(archivos: Record<Ruta, string>, raiz = "(memoria)"): Lector {
  return {
    raiz,
    listar(ruta) {
      const prefijo = ruta === "" ? "" : `${ruta}/`;
      const vistas = new Map<string, Entrada>();
      for (const [camino, contenido] of Object.entries(archivos)) {
        if (!camino.startsWith(prefijo)) continue;
        const [nombre, ...resto] = camino.slice(prefijo.length).split("/");
        if (nombre === undefined || nombre === "") continue;
        vistas.set(
          nombre,
          resto.length > 0
            ? { nombre, tipo: "carpeta", bytes: 0 }
            : { nombre, tipo: "archivo", bytes: Buffer.byteLength(contenido, "utf8") },
        );
      }
      return [...vistas.values()].sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
    },
    leer(ruta) {
      const contenido = archivos[ruta];
      if (contenido === undefined) throw new Error(`ENOENT: ${ruta}`);
      return contenido;
    },
  };
}

/**
 * El mismo repo sin los archivos para los que `oculto(ruta, leer)` dice que sí. Lo usan `axd
 * contrato` y `axd generar` para no ver lo que generó axd: si no, cada generación cambiaría el
 * contrato del que sale la siguiente.
 */
export function lectorSinOcultos(lector: Lector, oculto: (ruta: Ruta, leer: () => string) => boolean): Lector {
  return {
    raiz: lector.raiz,
    listar(ruta) {
      return lector.listar(ruta).filter((e) => {
        if (e.tipo !== "archivo") return true;
        const camino = ruta === "" ? e.nombre : `${ruta}/${e.nombre}`;
        return !oculto(camino, () => lector.leer(camino));
      });
    },
    leer(ruta) {
      return lector.leer(ruta);
    },
  };
}

export type ArchivoDelArbol = { ruta: Ruta; contenido: Buffer };

/**
 * Todos los archivos del repo en bytes, para copiarlo (lo usa el validador para preparar sus
 * copias temporales). Salta las carpetas `excluidas` en cualquier nivel, los enlaces y lo que
 * `oculto` diga; no sigue enlaces simbólicos, como `lectorDeDisco`.
 */
export function leerArbol(raiz: string, excluidas: readonly string[], oculto: (ruta: Ruta, leer: () => string) => boolean = () => false): ArchivoDelArbol[] {
  const lector = lectorDeDisco(raiz);
  const absoluta = resolve(raiz);
  const saltar = new Set(excluidas);
  const archivos: ArchivoDelArbol[] = [];
  const pendientes: Ruta[] = [""];
  while (pendientes.length > 0) {
    const ruta = pendientes.shift()!;
    for (const entrada of lector.listar(ruta)) {
      const camino = ruta === "" ? entrada.nombre : `${ruta}/${entrada.nombre}`;
      if (entrada.tipo === "carpeta") {
        if (!saltar.has(entrada.nombre)) pendientes.push(camino);
      } else if (entrada.tipo === "archivo" && !oculto(camino, () => lector.leer(camino))) {
        archivos.push({ ruta: camino, contenido: readFileSync(join(absoluta, camino)) });
      }
    }
  }
  return archivos;
}

/** Un archivo de entrada de axd que no es del repo objetivo (p. ej. el de `--tareas`), como texto. */
export function leerEntrada(ruta: string, para: string): string {
  try {
    return readFileSync(resolve(ruta), "utf8");
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code;
    throw new ErrorAx(`No se pudo leer ${para} «${ruta}»${codigo !== undefined ? ` (${codigo})` : ""}.`, {
      codigo: 2,
      salida: `Pasa la ruta de ${para}, relativa a la carpeta donde corres axd o absoluta.`,
    });
  }
}
