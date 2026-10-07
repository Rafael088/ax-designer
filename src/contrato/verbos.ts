// Los verbos del contrato: salen de las superficies que ya vio el analizador (CLI primero, luego
// las tools de MCP, y las rutas HTTP solo si no hay ninguna de las dos) y se completan con lo que
// AX exige a un verbo de escritura: ensayo por defecto, huella de lectura y estado nuevo. Lo que
// es cerrar o aprobar no llega aquí: es una transición vedada (vedadas.ts).
import type {
  ArchivoDeEstado, EntradaDelVerbo, ErrorDelVerbo, Inventario, Lectura, VerboDelContrato,
} from "../modelo/index.ts";
import { contarTokens } from "../medicion/index.ts";
import { VERBOS_DE_CIERRE, VERBOS_DE_LECTURA, criterioJson } from "../rubrica/index.ts";

/** Las lecturas que son «el resumen»: su presupuesto es el umbral de cumple de costo-del-resumen. */
const LECTURA_RESUMEN = /^(estado|status|resumen|contexto|summary)$/;
const VERBO_DE_ENTREGA = /^(entregar|entrega|submit|deliver|completar|complete|terminar|finish)([-_]|$)/;
/** Banderas que ya cubre la convención del contrato (o no son entradas): no se repiten. */
const BANDERAS_DE_ENSAYO = /^--(dry-run|dry|simular|ensayo|ensayar|preview|plan|what-if|aplicar|apply|huella)$/;
const BANDERAS_DE_PRESENTACION = /^--(help|version|json|formato|format|verbose|quiet|silencioso|color|no-color)$/;
const BANDERAS_BOOLEANAS = /^--(todo|todos|all|force|forzar|recursivo|recursive|incluir-hechas)$/;

type Visto = VerboDelContrato["visto_en"][number];
type Candidato = { nombre: string; vistos: Visto[]; banderas: Set<string>; posicionales: string[]; escrituraHttp: boolean | undefined };

export function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function snake(bandera: string): string {
  return slug(bandera).replace(/-/g, "_");
}

/** El último segmento que no es parámetro (`/tareas/:id/entregar` → «entregar») y sus parámetros. */
function rutaHttp(ruta: string): { nombre: string; parametros: string[] } {
  const segmentos = ruta.split("/").filter(Boolean);
  const parametro = (s: string) => /^:(\w+)$/.exec(s)?.[1] ?? /^\{(\w+)\}$/.exec(s)?.[1] ?? /^<(?:\w+:)?(\w+)>$/.exec(s)?.[1];
  const nombre = [...segmentos].reverse().find((s) => parametro(s) === undefined) ?? "raiz";
  return { nombre: slug(nombre), parametros: segmentos.flatMap((s) => parametro(s) ?? []) };
}

function candidatos(inventario: Inventario): Candidato[] {
  const porNombre = new Map<string, Candidato>();
  const tomar = (nombre: string): Candidato => {
    let c = porNombre.get(nombre);
    if (c === undefined) {
      c = { nombre, vistos: [], banderas: new Set(), posicionales: [], escrituraHttp: undefined };
      porNombre.set(nombre, c);
    }
    return c;
  };
  for (const v of inventario.superficies.cli) {
    const c = tomar(slug(v.nombre));
    c.vistos.push({ archivo: v.archivo, linea: v.linea, via: "cli" });
    for (const b of v.banderas ?? []) c.banderas.add(b);
  }
  for (const t of inventario.superficies.mcp_tools) tomar(slug(t.nombre)).vistos.push({ archivo: t.archivo, linea: t.linea, via: "mcp" });
  const sinCliNiMcp = porNombre.size === 0;
  for (const r of inventario.superficies.api) {
    const { nombre, parametros } = rutaHttp(r.ruta);
    const existente = porNombre.get(nombre);
    // Una ruta HTTP solo aporta un verbo nuevo si no hay CLI ni MCP; si no, completa al que ya hay.
    if (existente === undefined && !sinCliNiMcp) continue;
    const c = existente ?? tomar(nombre);
    c.vistos.push({ archivo: r.archivo, linea: r.linea, via: "api" });
    for (const p of parametros) if (!c.posicionales.includes(p)) c.posicionales.push(p);
    if (sinCliNiMcp) c.escrituraHttp = (c.escrituraHttp ?? false) || r.metodo !== "get";
  }
  return [...porNombre.values()].filter((c) => c.nombre !== "");
}

export function esCierre(nombre: string): boolean {
  return VERBOS_DE_CIERRE.test(nombre);
}

/** Los verbos de cierre que se vieron en el repo, para vedarlos en vez de exponerlos. */
export function cierresVistos(inventario: Inventario): { nombre: string; vistos: Visto[] }[] {
  return candidatos(inventario)
    .filter((c) => esCierre(c.nombre))
    .map((c) => ({ nombre: c.nombre, vistos: c.vistos }));
}

function esLectura(c: Candidato): boolean {
  if (c.escrituraHttp !== undefined) return !c.escrituraHttp;
  return VERBOS_DE_LECTURA.test(c.nombre) || /^(listar|ver|leer|buscar|mostrar|list|show|get|read|search)-/.test(c.nombre);
}

function entradasDe(c: Candidato, tipo: "lectura" | "escritura", entrega: boolean): EntradaDelVerbo[] {
  const donde = c.vistos.map((v) => `${v.archivo}:${v.linea}`).join(", ");
  const entradas: EntradaDelVerbo[] = c.posicionales.map((p, i) => ({
    nombre: snake(p),
    tipo: "texto",
    requerida: true,
    descripcion: `El «${p}» de la ruta HTTP del verbo (${donde}).`,
    como: "posicional",
    posicion: i,
  }));
  for (const bandera of [...c.banderas].sort()) {
    if (BANDERAS_DE_ENSAYO.test(bandera) || BANDERAS_DE_PRESENTACION.test(bandera)) continue;
    const nombre = snake(bandera);
    if (entradas.some((e) => e.nombre === nombre)) continue;
    entradas.push({
      nombre,
      tipo: BANDERAS_BOOLEANAS.test(bandera) ? "booleano" : "texto",
      requerida: entrega && nombre === "evidencia",
      descripcion: nombre === "evidencia"
        ? "Lo que demuestra que está hecho: archivos, comando de las pruebas y su salida, commit."
        : `La bandera «${bandera}» que el verbo ya lee en el repo (${donde}).`,
      como: "bandera",
      bandera,
    });
  }
  if (entrega && !entradas.some((e) => e.nombre === "evidencia")) {
    entradas.push({
      nombre: "evidencia",
      tipo: "texto",
      requerida: true,
      descripcion: "Lo que demuestra que está hecho: archivos, comando de las pruebas y su salida, commit.",
      como: "bandera",
      bandera: "--evidencia",
    });
  }
  if (tipo === "escritura") {
    entradas.push(
      {
        nombre: "aplicar",
        tipo: "booleano",
        requerida: false,
        descripcion: "Sin ella es un ensayo: dice qué cambiaría y no toca nada.",
        como: "bandera",
        bandera: "--aplicar",
      },
      {
        nombre: "huella",
        tipo: "texto",
        requerida: false,
        descripcion: "La huella que devolvió la última lectura; si el estado cambió desde entonces sale con 4 y no escribe.",
        como: "bandera",
        bandera: "--huella",
      },
    );
  }
  return entradas;
}

function erroresDe(tipo: "lectura" | "escritura", lecturaResumen: string | undefined, hayVedadas: boolean): ErrorDelVerbo[] {
  const errores: ErrorDelVerbo[] = [
    { codigo: 2, cuando: "Falta una entrada requerida, sobra una o tiene otro tipo.", salida: "Corrige las entradas según el esquema del verbo y vuelve a llamarlo.", reintentable: false },
    { codigo: 3, cuando: "No se pudo leer o escribir el estado del dominio.", salida: "Lee el mensaje de error; si se repite igual, avisa a una persona con él.", reintentable: false },
  ];
  if (tipo === "escritura") {
    const relee = lecturaResumen !== undefined ? `Vuelve a leer con «${lecturaResumen}»` : "Vuelve a leer el estado";
    errores.push({ codigo: 4, cuando: "El estado cambió desde la huella que se pasó.", salida: `${relee}, ensaya otra vez con la huella nueva y luego aplica.`, reintentable: true });
    if (hayVedadas) {
      errores.push({ codigo: 5, cuando: "El cambio pedido es una transición que es de una persona.", salida: "No lo reintentes: pídeselo a una persona.", reintentable: false });
    }
  }
  return errores;
}

/** Los archivos de estado del dominio: lo que el agente tendría que leer entero sin una lectura barata. */
export function estadoDelDominio(inventario: Inventario): ArchivoDeEstado[] {
  return inventario.estado.filter((e) => e.rol === "dominio");
}

/** Los verbos sin su implementación: la pone implementacion.ts, que es quien mira el dominio. */
export type VerboSinImplementar = Omit<VerboDelContrato, "implementacion">;

export function verbosDe(inventario: Inventario, hayVedadas: boolean): VerboSinImplementar[] {
  const vistos = candidatos(inventario).filter((c) => !esCierre(c.nombre));
  const dominio = estadoDelDominio(inventario);
  const lecturaVista = vistos.find((c) => esLectura(c) && LECTURA_RESUMEN.test(c.nombre));
  const propuestos: Candidato[] = [];
  // Sin lectura barata y con estado de dominio, el contrato propone la lectura «estado».
  if (lecturaVista === undefined && dominio.length > 0) {
    propuestos.push({ nombre: "estado", vistos: [], banderas: new Set(), posicionales: [], escrituraHttp: false });
  }
  const resumen = lecturaVista?.nombre ?? (propuestos.length > 0 ? "estado" : undefined);
  return [...propuestos, ...vistos].map((c): VerboSinImplementar => {
    const tipo = esLectura(c) ? "lectura" : "escritura";
    const entrega = tipo === "escritura" && VERBO_DE_ENTREGA.test(c.nombre);
    const propuesto = c.vistos.length === 0;
    const fuente = dominio.map((e) => e.ruta).join(", ");
    return {
      nombre: c.nombre,
      tipo,
      descripcion: tipo === "lectura"
        ? LECTURA_RESUMEN.test(c.nombre)
          ? `El estado del dominio resumido en JSON${fuente !== "" ? `, para no leer ${fuente}` : ""}. No cambia nada.`
          : `Lee «${c.nombre}» en JSON, acotado. No cambia nada.`
        : `Hace «${c.nombre}» sobre el estado del dominio. Sin aplicar es un ensayo que dice qué cambiaría.`,
      argv: [c.nombre],
      entradas: entradasDe(c, tipo, entrega),
      salida: tipo === "lectura"
        ? { descripcion: "JSON con esquema y la huella del estado leído, para pasarla a los verbos de escritura.", claves: ["esquema", "huella"] }
        : { descripcion: "JSON con esquema; en el ensayo, lo que cambiaría; al aplicar, el estado nuevo y su huella.", claves: ["esquema", "ensayo", "cambios", "estado_nuevo", "huella"] },
      errores: erroresDe(tipo, resumen, hayVedadas),
      ensayo_por_defecto: tipo === "escritura",
      evidencia: tipo === "lectura"
        ? { exige: [], devuelve: ["huella"] }
        : { exige: entrega ? ["evidencia"] : [], devuelve: ["cambios", "estado_nuevo", "huella"] },
      origen: propuesto ? "propuesto" : "existente",
      motivo: propuesto
        ? "No hay una lectura barata del estado: el agente lee los archivos del dominio enteros para enterarse."
        : `Ya existe en el repo (${c.vistos.map((v) => `${v.via} ${v.archivo}:${v.linea}`).join(", ")}).`,
      visto_en: c.vistos,
    };
  });
}

export function lecturasDe(inventario: Inventario, verbos: readonly VerboDelContrato[]): Lectura[] {
  const dominio = estadoDelDominio(inventario);
  const caracteres = dominio.reduce((a, e) => a + e.caracteres, 0);
  const resumen = criterioJson("lectura-barata", "costo-del-resumen").metrica!;
  return verbos
    .filter((v) => v.tipo === "lectura")
    .map((v) => {
      const esResumen = LECTURA_RESUMEN.test(v.nombre);
      return {
        verbo: v.nombre,
        descripcion: esResumen ? "El resumen: lo primero que lee un agente para enterarse del estado." : "Una lectura acotada del dominio.",
        fuente: dominio.map((e) => e.ruta),
        presupuesto_tokens: esResumen ? resumen.cumple.valor : resumen.parcial.valor,
        tokens_camino_caro: dominio.length > 0 ? contarTokens(caracteres) : null,
      };
    });
}
