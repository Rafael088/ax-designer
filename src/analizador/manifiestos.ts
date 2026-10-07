// Manifiestos: scripts, dependencias y lo que declaran como programa (bin, scripts de consola).
// Se leen con parsers mínimos (JSON nativo, TOML y Makefile a mano): cero dependencias.
import { posix } from "node:path";
import type { Manifiesto, PuntoDeEntrada, Ruta, Script, TipoDeManifiesto } from "../modelo/index.ts";
import type { ArchivoVisto } from "./recorrido.ts";

export const MANIFIESTOS_BUSCADOS = [
  "package.json", "deno.json", "pyproject.toml", "Makefile", "justfile", "Cargo.toml", "go.mod",
];

export function tipoDeManifiesto(nombre: string): TipoDeManifiesto | undefined {
  if (nombre === "package.json") return "package.json";
  if (nombre === "deno.json" || nombre === "deno.jsonc") return "deno.json";
  if (nombre === "pyproject.toml") return "pyproject.toml";
  if (nombre === "Makefile" || nombre === "makefile" || nombre === "GNUmakefile") return "makefile";
  if (nombre === "justfile" || nombre === "Justfile" || nombre === ".justfile") return "justfile";
  if (nombre === "Cargo.toml") return "cargo.toml";
  if (nombre === "go.mod") return "go.mod";
  return undefined;
}

export type ManifiestoLeido = { manifiesto: Manifiesto; puntos: PuntoDeEntrada[] };

export function leerManifiesto(archivo: ArchivoVisto, texto: string, existentes: ReadonlySet<Ruta>): ManifiestoLeido {
  const tipo = tipoDeManifiesto(archivo.nombre)!;
  const base: Manifiesto = { tipo, ruta: archivo.ruta, scripts: [], dependencias: [], dependencias_de_desarrollo: [] };
  const lineas = texto.split("\n");
  switch (tipo) {
    case "package.json":
    case "deno.json":
      return leerPaquete(base, texto, lineas, existentes);
    case "pyproject.toml":
      return leerPyproject(base, lineas, existentes);
    case "makefile":
    case "justfile":
      return { manifiesto: { ...base, scripts: leerRecetas(lineas, tipo) }, puntos: [] };
    case "cargo.toml":
      return leerCargo(base, lineas, existentes);
    case "go.mod":
      return leerGoMod(base, lineas);
  }
}

function lineaDe(lineas: readonly string[], patron: RegExp, desde = 0): number {
  for (let i = desde; i < lineas.length; i++) if (patron.test(lineas[i]!)) return i + 1;
  return 1;
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resuelve el destino de un bin o main a un archivo del repo; prueba también la fuente .ts de un dist/*.js. */
export function resolverDestino(carpeta: string, destino: string, existentes: ReadonlySet<Ruta>): Ruta | undefined {
  const directa = posix.normalize(posix.join(carpeta, destino));
  if (existentes.has(directa)) return directa;
  const candidatos = [directa.replace(/\.(m|c)?js$/, ".ts"), directa.replace(/\.(m|c)?js$/, ".mts")];
  for (const compilado of ["dist/", "build/", "lib/", "out/"]) {
    const prefijo = carpeta === "." ? compilado : `${carpeta}/${compilado}`;
    if (directa.startsWith(prefijo)) {
      const fuente = directa.replace(prefijo, prefijo.slice(0, -compilado.length) + "src/");
      candidatos.push(fuente, fuente.replace(/\.(m|c)?js$/, ".ts"));
    }
  }
  return candidatos.find((c) => existentes.has(c));
}

function leerPaquete(base: Manifiesto, texto: string, lineas: string[], existentes: ReadonlySet<Ruta>): ManifiestoLeido {
  let datos: Record<string, unknown>;
  try {
    datos = JSON.parse(texto.replace(/^﻿/, "")) as Record<string, unknown>;
  } catch (e) {
    return { manifiesto: { ...base, error: `No es JSON válido: ${(e as Error).message}` }, puntos: [] };
  }
  const carpeta = posix.dirname(base.ruta);
  const nombre = typeof datos["name"] === "string" ? datos["name"] : undefined;
  const lineaScripts = lineaDe(lineas, /"(scripts|tasks)"\s*:/);
  const scripts: Script[] = Object.entries(objeto(datos["scripts"] ?? datos["tasks"]))
    .filter((par): par is [string, string] => typeof par[1] === "string")
    .map(([n, comando]) => ({ nombre: n, comando, linea: lineaDe(lineas, new RegExp(`"${escapar(n)}"\\s*:`), lineaScripts - 1) }));
  const puntos: PuntoDeEntrada[] = [];
  const declarado = (clave: string) => ({ archivo: base.ruta, linea: lineaDe(lineas, new RegExp(`"${clave}"\\s*:`)) });
  const bin = datos["bin"];
  const bins: [string, unknown][] =
    typeof bin === "string" ? [[(nombre ?? "").replace(/^@[^/]+\//, ""), bin]] : Object.entries(objeto(bin));
  for (const [n, destino] of bins) {
    if (typeof destino !== "string") continue;
    puntos.push({ tipo: "bin", nombre: n, ruta: resolverDestino(carpeta, destino, existentes), destino, declarado_en: declarado("bin") });
  }
  if (typeof datos["main"] === "string") {
    const destino = datos["main"];
    puntos.push({ tipo: "main", ruta: resolverDestino(carpeta, destino, existentes), destino, declarado_en: declarado("main") });
  }
  const exportado = exportPrincipal(datos["exports"]);
  if (exportado !== undefined) {
    puntos.push({ tipo: "exports", ruta: resolverDestino(carpeta, exportado, existentes), destino: exportado, declarado_en: declarado("exports") });
  }
  const dependencias = [
    ...Object.keys(objeto(datos["dependencies"])),
    ...Object.keys(objeto(datos["optionalDependencies"])),
    ...Object.keys(objeto(datos["peerDependencies"])),
    ...Object.keys(objeto(datos["imports"])),
  ];
  return {
    manifiesto: {
      ...base,
      ...(nombre !== undefined ? { nombre } : {}),
      ...(typeof datos["version"] === "string" ? { version: datos["version"] } : {}),
      scripts,
      dependencias,
      dependencias_de_desarrollo: Object.keys(objeto(datos["devDependencies"])),
    },
    puntos: puntos.map(sinIndefinidos),
  };
}

function exportPrincipal(exports: unknown): string | undefined {
  if (typeof exports === "string") return exports;
  const punto = objeto(exports)["."] ?? exports;
  if (typeof punto === "string") return punto;
  const o = objeto(punto);
  for (const clave of ["import", "default", "require", "node"]) {
    const v = o[clave];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function sinIndefinidos<T extends object>(valor: T): T {
  return Object.fromEntries(Object.entries(valor).filter(([, v]) => v !== undefined)) as T;
}

// --- TOML mínimo: secciones, clave = valor de una línea y arrays de varias líneas. ---

type Toml = { seccion: string; clave: string; valor: string; linea: number }[];

function leerToml(lineas: readonly string[]): Toml {
  const pares: Toml = [];
  let seccion = "";
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]!.replace(/\s+#.*$/, "").trim();
    const cabecera = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(linea);
    if (cabecera) {
      seccion = cabecera[1]!.replace(/["']/g, "");
      continue;
    }
    const par = /^("?[\w.-]+"?)\s*=\s*(.*)$/.exec(linea);
    if (!par) continue;
    let valor = par[2]!;
    const inicio = i;
    if (valor.startsWith("[") && !cierraArray(valor)) {
      while (i + 1 < lineas.length && !cierraArray(valor)) valor += " " + lineas[++i]!.replace(/\s+#.*$/, "").trim();
    }
    pares.push({ seccion, clave: par[1]!.replace(/"/g, ""), valor, linea: inicio + 1 });
  }
  return pares;
}

function cierraArray(valor: string): boolean {
  return (valor.match(/\[/g)?.length ?? 0) <= (valor.match(/\]/g)?.length ?? 0);
}

function cadena(valor: string): string | undefined {
  const m = /^(["'])(.*)\1$/.exec(valor.trim());
  return m ? m[2] : undefined;
}

function cadenasDeArray(valor: string): string[] {
  return [...valor.matchAll(/(["'])(.*?)\1/g)].map((m) => m[2]!);
}

function nombreDeRequisito(requisito: string): string {
  return requisito.split(/[\s<>=!~;\[(@]/)[0]!.trim();
}

function leerPyproject(base: Manifiesto, lineas: string[], existentes: ReadonlySet<Ruta>): ManifiestoLeido {
  const toml = leerToml(lineas);
  const valor = (seccion: string, clave: string) => toml.find((p) => p.seccion === seccion && p.clave === clave);
  const nombre = cadena(valor("project", "name")?.valor ?? "") ?? cadena(valor("tool.poetry", "name")?.valor ?? "");
  const version = cadena(valor("project", "version")?.valor ?? "") ?? cadena(valor("tool.poetry", "version")?.valor ?? "");
  const puntos: PuntoDeEntrada[] = toml
    .filter((p) => p.seccion === "project.scripts" || p.seccion === "tool.poetry.scripts")
    .map((p) => {
      const destino = cadena(p.valor) ?? p.valor;
      const modulo = destino.split(":")[0]!.replace(/\./g, "/");
      const ruta = [`${modulo}.py`, `${modulo}/__init__.py`, `src/${modulo}.py`, `src/${modulo}/__init__.py`].find((r) => existentes.has(r));
      return sinIndefinidos({ tipo: "script-de-consola" as const, nombre: p.clave, ruta, destino, declarado_en: { archivo: base.ruta, linea: p.linea } });
    });
  const scripts: Script[] = toml
    .filter((p) => /^tool\.(poe\.tasks|pdm\.scripts|hatch\.envs\.[\w-]+\.scripts|taskipy\.tasks)$/.test(p.seccion))
    .map((p) => ({ nombre: p.clave, comando: cadena(p.valor) ?? cadenasDeArray(p.valor).join(" && "), linea: p.linea }));
  const dependencias = [
    ...cadenasDeArray(valor("project", "dependencies")?.valor ?? "").map(nombreDeRequisito),
    ...toml.filter((p) => p.seccion === "tool.poetry.dependencies" && p.clave !== "python").map((p) => p.clave),
  ];
  const dependencias_de_desarrollo = [
    ...toml.filter((p) => p.seccion === "project.optional-dependencies" || p.seccion === "dependency-groups")
      .flatMap((p) => cadenasDeArray(p.valor).map(nombreDeRequisito)),
    ...toml.filter((p) => /^tool\.poetry\.(dev-dependencies|group\.[\w-]+\.dependencies)$/.test(p.seccion)).map((p) => p.clave),
  ];
  return {
    manifiesto: { ...base, ...(nombre ? { nombre } : {}), ...(version ? { version } : {}), scripts, dependencias, dependencias_de_desarrollo },
    puntos,
  };
}

function leerCargo(base: Manifiesto, lineas: string[], existentes: ReadonlySet<Ruta>): ManifiestoLeido {
  const toml = leerToml(lineas);
  const carpeta = posix.dirname(base.ruta);
  const nombre = cadena(toml.find((p) => p.seccion === "package" && p.clave === "name")?.valor ?? "");
  const version = cadena(toml.find((p) => p.seccion === "package" && p.clave === "version")?.valor ?? "");
  const puntos: PuntoDeEntrada[] = [];
  const principal = posix.normalize(posix.join(carpeta, "src/main.rs"));
  if (existentes.has(principal)) {
    puntos.push({ tipo: "bin", ...(nombre ? { nombre } : {}), ruta: principal, destino: "src/main.rs", declarado_en: { archivo: base.ruta, linea: 1 } });
  }
  for (const p of toml.filter((p) => p.seccion === "bin" && p.clave === "path")) {
    const destino = cadena(p.valor) ?? p.valor;
    puntos.push(sinIndefinidos({ tipo: "bin" as const, ruta: resolverDestino(carpeta, destino, existentes), destino, declarado_en: { archivo: base.ruta, linea: p.linea } }));
  }
  return {
    manifiesto: {
      ...base,
      ...(nombre ? { nombre } : {}),
      ...(version ? { version } : {}),
      dependencias: toml.filter((p) => p.seccion === "dependencies").map((p) => p.clave),
      dependencias_de_desarrollo: toml.filter((p) => p.seccion === "dev-dependencies").map((p) => p.clave),
    },
    puntos,
  };
}

function leerGoMod(base: Manifiesto, lineas: string[]): ManifiestoLeido {
  const modulo = lineas.map((l) => /^module\s+(\S+)/.exec(l)?.[1]).find((m) => m !== undefined);
  const dependencias: string[] = [];
  let enBloque = false;
  for (const linea of lineas) {
    if (/^require\s*\($/.test(linea.trim())) enBloque = true;
    else if (enBloque && linea.trim() === ")") enBloque = false;
    else if (enBloque || /^require\s+\S/.test(linea)) {
      const dep = linea.replace(/^require\s+/, "").trim().split(/\s+/)[0];
      if (dep && dep !== ")" && !dep.startsWith("//")) dependencias.push(dep);
    }
  }
  return { manifiesto: { ...base, ...(modulo ? { nombre: modulo } : {}), dependencias }, puntos: [] };
}

/** Objetivos de Makefile o recetas de justfile, con su receta en una línea. */
function leerRecetas(lineas: readonly string[], tipo: "makefile" | "justfile"): Script[] {
  const scripts: Script[] = [];
  const cabecera = tipo === "makefile" ? /^([A-Za-z0-9_][\w.-]*)\s*:(?!=)/ : /^@?([A-Za-z0-9_][\w-]*)(\s+[^:=]*)?:(?!=)/;
  lineas.forEach((linea, i) => {
    const m = cabecera.exec(linea);
    if (!m) return;
    const receta: string[] = [];
    for (let j = i + 1; j < lineas.length && /^(\t| {2,})\S/.test(lineas[j]!); j++) receta.push(lineas[j]!.trim().replace(/^@/, ""));
    scripts.push({ nombre: m[1]!, comando: receta.join(" && "), linea: i + 1 });
  });
  return scripts;
}
