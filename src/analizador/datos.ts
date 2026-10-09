// Archivos de datos: el estado que persiste el repo, sus contratos (schemas, tipos), las tareas,
// las bitácoras y la configuración de MCP. Se reconocen por nombre y carpeta; el contenido solo se
// lee para sacar claves y contar registros.
import type {
  ArchivoDeContrato, ArchivoDeEstado, ArchivoDeTareas, FormatoDeDatos, RolDeEstado, Ruta, Trazabilidad, Ubicacion,
} from "../modelo/index.ts";
import type { ArchivoVisto } from "./recorrido.ts";

export const ESTADO_BUSCADO = [
  "*.jsonl, *.ndjson, *.sqlite, *.sqlite3, *.db (cualquier carpeta)",
  "estado.*, state.*, status.*, store.*, datos.*, data.*, db.*, tareas.*, tasks.*, bitacora.*, events.* (json, yaml, toml, csv)",
  "cualquier json, yaml, toml, csv o md bajo data/, datos/, estado/, state/, db/, store/, storage/",
  "preferencias, settings, ui, vista, layout, tema (json, yaml, toml), como estado de interfaz",
  "*.prisma (los modelos de Prisma: la forma del estado que vive en la base)",
];

export const TAREAS_BUSCADAS = ["tareas.md", "tasks.md", "TODO.md", "BACKLOG.md", "ROADMAP.md", "*.md bajo tareas/ o tasks/"];

export const MCP_BUSCADO = [
  ".mcp.json", "mcp.json", ".cursor/mcp.json", ".vscode/mcp.json", ".claude/settings.json", ".claude/settings.local.json",
  "claude_desktop_config.json", "dependencias @modelcontextprotocol/*, mcp, fastmcp",
];

const FORMATOS: Record<string, FormatoDeDatos> = {
  json: "json", jsonl: "jsonl", ndjson: "jsonl", yaml: "yaml", yml: "yaml", toml: "toml", csv: "csv",
  md: "markdown", sqlite: "sqlite", sqlite3: "sqlite", db: "sqlite",
};

const CARPETAS_DE_ESTADO = new Set(["data", "datos", "estado", "state", "db", "store", "storage"]);
const CARPETAS_DE_CONFIGURACION = /^(\.github|\.vscode|\.idea|\.devcontainer|\.claude|\.cursor|\.husky|docs?|pruebas|tests?|__tests__|fixtures?)$/;
const NOMBRE_DE_ESTADO = /^(estado|state|status|store|datos|data|db|database|tareas|tasks|bitacora|eventos|events|historial|history|journal)([._-]|$)/i;
const NOMBRE_DE_INTERFAZ = /(^|[._-])(ui|interfaz|vista|view|prefs|preferencias|preferences|settings|ajustes|ventana|window|layout|tema|theme)([._-]|$)/i;
const CONFIGURACION = /^(package(-lock)?\.json|tsconfig.*\.json|jsconfig\.json|deno\.jsonc?|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|poetry\.lock|Cargo\.lock|pyproject\.toml|Cargo\.toml|\.?(eslint|prettier|babel|stylelint|lint-staged|renovate|biome|commitlint)rc.*|renovate\.json|biome\.json|\.mcp\.json|mcp\.json|vercel\.json|netlify\.toml|docker-compose.*|compose\.ya?ml|.*\.config\.[cm]?[jt]s|.*\.schema\.json|openapi\..*|swagger\..*|mkdocs\.ya?ml|\.pre-commit-config\.yaml|codecov\.ya?ml)$/i;

export function formatoDe(archivo: ArchivoVisto): FormatoDeDatos | undefined {
  return FORMATOS[archivo.extension];
}

/** Si un archivo parece estado persistido, con su rol y el porqué; si no, undefined. */
export function clasificarEstado(archivo: ArchivoVisto): { formato: FormatoDeDatos; rol: RolDeEstado; motivo: string } | undefined {
  const formato = formatoDe(archivo);
  if (formato === undefined || CONFIGURACION.test(archivo.nombre)) return undefined;
  const carpetas = archivo.ruta.split("/").slice(0, -1);
  if (carpetas.some((c) => CARPETAS_DE_CONFIGURACION.test(c))) return undefined;
  const carpetaDeEstado = carpetas.find((c) => CARPETAS_DE_ESTADO.has(c));
  const raiz = archivo.nombre.replace(/\.[^.]+$/, "");
  const deInterfaz = formato !== "markdown" && NOMBRE_DE_INTERFAZ.test(raiz);
  let motivo: string | undefined;
  if (formato === "jsonl" || formato === "sqlite") motivo = `formato ${formato}`;
  else if (carpetaDeEstado !== undefined) motivo = `bajo ${carpetaDeEstado}/`;
  else if (formato !== "markdown" && NOMBRE_DE_ESTADO.test(raiz)) motivo = `nombre «${archivo.nombre}»`;
  else if (deInterfaz) motivo = `nombre de interfaz «${archivo.nombre}»`;
  if (motivo === undefined) return undefined;
  const rol: RolDeEstado = deInterfaz ? "interfaz" : carpetaDeEstado !== undefined || NOMBRE_DE_ESTADO.test(raiz) || formato === "jsonl" ? "dominio" : "desconocido";
  return { formato, rol, motivo };
}

export function leerEstado(archivo: ArchivoVisto, clase: NonNullable<ReturnType<typeof clasificarEstado>>, texto: string | undefined): ArchivoDeEstado {
  const estado: ArchivoDeEstado = {
    ruta: archivo.ruta,
    formato: clase.formato,
    rol: clase.rol,
    bytes: archivo.bytes,
    caracteres: texto?.length ?? archivo.bytes,
    motivo: clase.motivo,
  };
  if (texto === undefined) return estado;
  const { claves, registros } = clavesDe(clase.formato, texto);
  return { ...estado, ...(claves !== undefined ? { claves } : {}), ...(registros !== undefined ? { registros } : {}) };
}

export function clavesDe(formato: FormatoDeDatos, texto: string): { claves?: string[]; registros?: number } {
  switch (formato) {
    case "json": {
      const valor = jsonOIndefinido(texto);
      const objeto = Array.isArray(valor) ? valor[0] : valor;
      const r = Array.isArray(valor) ? { registros: valor.length } : {};
      return esObjeto(objeto) ? { claves: Object.keys(objeto), ...r } : r;
    }
    case "jsonl": {
      const lineas = texto.split("\n").filter((l) => l.trim() !== "");
      const claves = new Set<string>();
      for (const linea of lineas.slice(0, 20)) {
        const valor = jsonOIndefinido(linea);
        if (esObjeto(valor)) for (const c of Object.keys(valor)) claves.add(c);
      }
      return { claves: [...claves], registros: lineas.length };
    }
    case "yaml":
      return { claves: [...new Set([...texto.matchAll(/^([\w-]+)\s*:/gm)].map((m) => m[1]!))] };
    case "toml":
      return {
        claves: [...new Set([...texto.matchAll(/^\s*(?:\[\[?\s*([\w.-]+)\s*\]\]?|([\w-]+)\s*=)/gm)].map((m) => (m[1] ?? m[2])!.split(".")[0]!))],
      };
    case "csv": {
      const lineas = texto.split("\n").filter((l) => l.trim() !== "");
      return { claves: (lineas[0] ?? "").split(",").map((c) => c.trim().replace(/^"|"$/g, "")), registros: Math.max(0, lineas.length - 1) };
    }
    case "markdown": {
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(texto)?.[1];
      const claves = frontmatter === undefined ? [] : [...new Set([...frontmatter.matchAll(/^([\w-]+)\s*:/gm)].map((m) => m[1]!))];
      if (!claves.includes("id") && listaConIdsDeBloque(texto)) claves.push("id");
      return claves.length === 0 ? {} : { claves };
    }
    default:
      return {};
  }
}

/** Un id de bloque de Obsidian al final de la línea: «- [ ] Hacer algo ^tarea-a1b2». */
const ID_DE_BLOQUE = /\s\^([A-Za-z0-9][\w-]*)\s*$/;
const ITEM_DE_LISTA = /^\s*(?:[-*+]|\d+[.)])\s+\S/;

/**
 * Si la lista del cuerpo identifica cada ítem con un id de bloque (`^abc` al final de la línea,
 * como guardan algunos gestores cada tarea en `datos/tareas.md`): la entidad es la línea y su id va en el
 * cuerpo, no en el frontmatter. Cuenta si al menos la mitad de los ítems lo llevan, para no tomar
 * por identificador un `^ancla` suelto que solo sirve para enlazar un párrafo.
 */
function listaConIdsDeBloque(texto: string): boolean {
  const items = texto.split("\n").filter((l) => ITEM_DE_LISTA.test(l));
  const conId = items.filter((l) => ID_DE_BLOQUE.test(l)).length;
  return conId > 0 && conId * 2 >= items.length;
}

function jsonOIndefinido(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    // Un archivo de datos con JSON roto es un dato más: se informa sin claves, no se cae el análisis.
    return undefined;
  }
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

// --- contratos ---

const CARPETAS_DE_MODELO = /^(modelo|modelos|model|models|domain|dominio|entities|entidades)$/;
const CARPETAS_DE_TIPOS = /^(types|tipos|typings|schemas?|esquemas?|contracts?|contratos?)$/;
const DOC_DE_FORMATO = /(formato|format|schema|esquema|contrato|contract|modelo-de-datos|data-model)/i;
const CODIGO = /^(ts|tsx|mts|cts|js|mjs|cjs|py|go|rs|rb)$/;

export function clasificarContrato(archivo: ArchivoVisto, esPrueba: boolean): ArchivoDeContrato | undefined {
  if (esPrueba) return undefined;
  const { ruta, nombre, extension } = archivo;
  const carpetas = ruta.split("/").slice(0, -1);
  if (/\.schema\.json$/i.test(nombre) || (extension === "json" && carpetas.some((c) => /^(schemas?|esquemas?)$/.test(c)))) {
    return { ruta, tipo: "json-schema", motivo: "JSON Schema" };
  }
  if (/^(openapi|swagger)\.(json|ya?ml)$/i.test(nombre)) return { ruta, tipo: "openapi", motivo: "especificación OpenAPI" };
  if (nombre.endsWith(".d.ts")) return { ruta, tipo: "tipos", motivo: "declaración de tipos" };
  if (CODIGO.test(extension)) {
    const carpeta = carpetas.find((c) => CARPETAS_DE_MODELO.test(c));
    if (carpeta) return { ruta, tipo: "modelo", motivo: `bajo ${carpeta}/` };
    const tipos = carpetas.find((c) => CARPETAS_DE_TIPOS.test(c));
    if (tipos) return { ruta, tipo: "tipos", motivo: `bajo ${tipos}/` };
    if (/^(models?|modelo|types|tipos|schemas?)\.(ts|py|js)$/.test(nombre)) return { ruta, tipo: "modelo", motivo: `nombre «${nombre}»` };
    return undefined;
  }
  if (extension === "md" && (carpetas[0] === "docs" || carpetas.length === 0) && DOC_DE_FORMATO.test(nombre)) {
    return { ruta, tipo: "documento", motivo: `documento «${nombre}»` };
  }
  return undefined;
}

// --- tareas ---

export function esArchivoDeTareas(archivo: ArchivoVisto): boolean {
  if (archivo.extension !== "md") return false;
  if (/^(tareas|tasks|todo|backlog|roadmap)\.md$/i.test(archivo.nombre)) return true;
  return archivo.ruta.split("/").slice(0, -1).some((c) => /^(tareas|tasks)$/i.test(c));
}

const CRITERIO = /hecho cuando|criterio de (hecho|aceptaci[oó]n)|aceptaci[oó]n|acceptance|done when|definition of done|debe pasar|must pass|--prueba|verificar con|se comprueba/i;

export function leerTareas(ruta: Ruta, texto: string): ArchivoDeTareas {
  const lineas = texto.split("\n");
  const items: { indent: number; linea: number; hecha: boolean }[] = [];
  lineas.forEach((l, i) => {
    const m = /^(\s*)[-*+]\s+\[([ xX])\]\s+/.exec(l);
    if (m) items.push({ indent: m[1]!.replace(/\t/g, "  ").length, linea: i, hecha: m[2] !== " " });
  });
  const raiz = items.length === 0 ? 0 : Math.min(...items.map((t) => t.indent));
  const principales = items.filter((t) => t.indent === raiz);
  let conCriterio = 0;
  let hechas = 0;
  const sinCriterio: Ubicacion[] = [];
  principales.forEach((t, k) => {
    if (t.hecha) hechas++;
    const fin = principales[k + 1]?.linea ?? lineas.length;
    const bloque = lineas.slice(t.linea, fin);
    const tieneSubcasillas = items.some((s) => s.linea > t.linea && s.linea < fin && s.indent > raiz);
    const continuacion = bloque.filter((l, j) => j === 0 || /^\s+\S/.test(l) || l.trim() === "");
    if (tieneSubcasillas || CRITERIO.test(continuacion.join("\n"))) conCriterio++;
    else sinCriterio.push({ archivo: ruta, linea: t.linea + 1 });
  });
  return { ruta, tareas: principales.length, hechas, con_criterio: conCriterio, sin_criterio: sinCriterio };
}

// --- bitácoras y MCP ---

const NOMBRE_DE_BITACORA = /(bitacora|log|audit|auditoria|historial|history|events|eventos|journal|registro)/i;
const CARPETA_DE_BITACORA = /^(bitacoras?|logs?|journal|diario|historial|history|registros?|auditoria|audit)$/i;
const DIA = /^\d{4}-\d{2}-\d{2}\.md$/;

export function esBitacora(archivo: ArchivoVisto): boolean {
  if (archivo.extension === "jsonl" || archivo.extension === "ndjson") return NOMBRE_DE_BITACORA.test(archivo.ruta);
  return esBitacoraPorDia(archivo);
}

/** Una bitácora de un archivo por día en Markdown: `bitacora/AAAA-MM-DD.md` (por
 *  ejemplo `bitacora/2026-10-04.md` con frontmatter `fecha:`). El nombre fechado y la carpeta
 *  con nombre de bitácora van juntos: un `docs/2026-10-04.md` suelto no es una bitácora. */
export function esBitacoraPorDia(archivo: ArchivoVisto): boolean {
  if (archivo.extension !== "md" || !DIA.test(archivo.nombre)) return false;
  const carpeta = archivo.ruta.split("/").slice(-2, -1)[0];
  return carpeta !== undefined && CARPETA_DE_BITACORA.test(carpeta);
}

/**
 * Anota una bitácora en `bitacoras`. Las de un archivo por día se juntan en una sola entrada por
 * carpeta (365 días no son 365 bitácoras): `ruta` es el día más reciente, `registros` la suma de
 * los ítems de lista de todos los días, `claves` las del frontmatter y `archivos` cuántos días hay.
 */
export function anotarBitacora(bitacoras: Trazabilidad["bitacoras"], archivo: ArchivoVisto, texto: string): void {
  if (!esBitacoraPorDia(archivo)) {
    const { claves = [], registros = 0 } = clavesDe("jsonl", texto);
    bitacoras.push({ ruta: archivo.ruta, registros, claves });
    return;
  }
  const carpeta = archivo.ruta.slice(0, archivo.ruta.length - archivo.nombre.length);
  const claves = clavesDe("markdown", texto).claves ?? [];
  const registros = texto.split("\n").filter((l) => /^\s*[-*+]\s+\S/.test(l)).length;
  const previa = bitacoras.find((b) => b.archivos !== undefined && b.ruta.startsWith(carpeta) && !b.ruta.slice(carpeta.length).includes("/"));
  if (previa === undefined) {
    bitacoras.push({ ruta: archivo.ruta, registros, claves, archivos: 1 });
    return;
  }
  previa.registros += registros;
  previa.claves = [...new Set([...previa.claves, ...claves])];
  previa.archivos! += 1;
  if (archivo.ruta > previa.ruta) previa.ruta = archivo.ruta;
}

export function esConfiguracionMcp(ruta: Ruta): boolean {
  return [".mcp.json", "mcp.json", ".cursor/mcp.json", ".vscode/mcp.json", ".claude/settings.json", ".claude/settings.local.json", "claude_desktop_config.json"].includes(ruta);
}

/** Nombres de servidores de una configuración MCP, o undefined si no es JSON. */
export function servidoresMcp(texto: string): string[] | undefined {
  const datos = jsonOIndefinido(texto);
  if (!esObjeto(datos)) return undefined;
  const mcp = esObjeto(datos["mcp"]) ? datos["mcp"] : {};
  for (const fuente of [datos["mcpServers"], datos["servers"], mcp["servers"]]) {
    if (esObjeto(fuente)) return Object.keys(fuente);
  }
  return [];
}

export function esSdkMcp(dependencia: string): boolean {
  return /modelcontextprotocol/.test(dependencia) || ["mcp", "fastmcp", "mcp-go", "rmcp", "github.com/mark3labs/mcp-go"].includes(dependencia);
}
