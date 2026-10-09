// Los verbos del contrato: salen de las superficies que ya vio el analizador (CLI primero, luego
// las tools de MCP, y las rutas HTTP solo si no hay ninguna de las dos) y se completan con lo que
// AX exige a un verbo de escritura: ensayo por defecto, huella de lectura y estado nuevo. Lo que
// es cerrar o aprobar no llega aquí: es una transición vedada (vedadas.ts).
//
// Sin CLI ni MCP, cada método de cada ruta HTTP es un verbo (`GET /api/productos/:id` →
// «leer-productos»), que el CLI generado implementa llamando a esa ruta (implementacion `http`).
import type {
  ArchivoDeEstado, CampoDelCuerpo, CuerpoInferido, EntradaDelVerbo, ErrorDelVerbo, Implementacion, Inventario, Lectura, ModeloDeDatos,
  RutaApi, TipoDeCampo, VerboDelContrato,
} from "../modelo/index.ts";
import { contarTokens } from "../medicion/index.ts";
import { describirCampo, describirParametro, describirRespuesta, describirVerboHttp } from "./descripciones.ts";
import { VERBOS_DE_CIERRE, VERBOS_DE_LECTURA, criterioJson } from "../rubrica/index.ts";

/** Las lecturas que son «el resumen»: su presupuesto es el umbral de cumple de costo-del-resumen. */
const LECTURA_RESUMEN = /^(estado|status|resumen|contexto|summary)$/;
const VERBO_DE_ENTREGA = /^(entregar|entrega|submit|deliver|completar|complete|terminar|finish)([-_]|$)/;
/** Banderas que ya cubre la convención del contrato (o no son entradas): no se repiten. */
const BANDERAS_DE_ENSAYO = /^--(dry-run|dry|simular|ensayo|ensayar|preview|plan|what-if|aplicar|apply|huella)$/;
const BANDERAS_DE_PRESENTACION = /^--(help|version|json|formato|format|verbose|quiet|silencioso|color|no-color)$/;
const BANDERAS_BOOLEANAS = /^--(todo|todos|all|force|forzar|recursivo|recursive|incluir-hechas)$/;

type Visto = VerboDelContrato["visto_en"][number];
type MetodoDelVerbo = Extract<Implementacion, { tipo: "http" }>["metodo"];
type ParametroDeRuta = { nombre: string; resto: boolean; opcional: boolean };
/** Lo que hace falta para llamar a una ruta HTTP: un candidato por método y ruta, si no hay CLI ni MCP. */
type LlamadaHttp = {
  metodo: MetodoDelVerbo; ruta: string; parametros: ParametroDeRuta[]; consulta: string[]; cuerpo: CuerpoInferido | undefined; sinMetodo: boolean;
  /** La ruta tal como la vio el analizador: de ahí salen las descripciones. */
  api: RutaApi;
};
type Candidato = {
  nombre: string; vistos: Visto[]; banderas: Set<string>; posicionales: string[]; escrituraHttp: boolean | undefined; http?: LlamadaHttp;
};

const ORDEN_DE_METODOS = ["get", "all", "post", "put", "patch", "delete"];

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

/** El parámetro de un segmento de ruta: `:id`, `:slug*` (el resto), `:slug*?`, `{id}`, `<int:id>`. */
function parametroDe(segmento: string): ParametroDeRuta | undefined {
  const express = /^:(\w+)(\*)?(\?)?$/.exec(segmento);
  if (express) return { nombre: express[1]!, resto: express[2] !== undefined, opcional: express[3] !== undefined };
  const otro = /^\{(\w+)\}$/.exec(segmento)?.[1] ?? /^<(?:\w+:)?(\w+)>$/.exec(segmento)?.[1];
  return otro === undefined ? undefined : { nombre: otro, resto: false, opcional: false };
}

/** El último segmento que no es parámetro (`/tareas/:id/entregar` → «entregar») y sus parámetros. */
function rutaHttp(ruta: string): { nombre: string; parametros: string[] } {
  const segmentos = ruta.split("/").filter(Boolean);
  const nombre = [...segmentos].reverse().find((s) => parametroDe(s) === undefined) ?? "raiz";
  return { nombre: slug(nombre), parametros: segmentos.flatMap((s) => parametroDe(s)?.nombre ?? []) };
}

/** Un segmento que ya es la acción (`/tareas/:id/entregar`, `/pedidos/:id/cancel`), no un recurso. */
const SEGMENTO_DE_ACCION = /^([a-z]+(ar|er|ir)|sync|submit|approve|close|login|logout|search|refresh|import|export|send|cancel|publish|archive|restore|reset|verify|validate|confirm|merge)$/;
const SEGMENTO_DE_RESUMEN = /^(estado|status|resumen|contexto|summary)$/;
/** Prefijos de ruta que no dicen nada del recurso. */
const PREFIJO_DE_API = /^(api|v\d+)$/;

/**
 * El nombre del verbo de una ruta HTTP: la acción del método y el recurso (`GET /api/productos` →
 * «listar-productos», `GET /api/productos/:id` → «leer-productos», POST «crear-», PUT/PATCH
 * «actualizar-» (o PUT «reemplazar-» si la ruta también tiene PATCH), DELETE «borrar-»). Si el último
 * segmento ya es una acción tras otro segmento (`POST /tareas/:id/entregar`) o un resumen (`GET
 * /estado`), el verbo es ese segmento. `profundidad` toma más segmentos del recurso para desempatar.
 */
function nombreHttp(r: RutaApi, conPatch: boolean, profundidad: number): string {
  const segmentos = r.ruta.split("/").filter(Boolean);
  const fijos = segmentos.filter((s) => parametroDe(s) === undefined);
  const recurso = fijos.filter((s, i) => !(i === 0 && PREFIJO_DE_API.test(s)) && !(i > 0 && PREFIJO_DE_API.test(s) && PREFIJO_DE_API.test(fijos[i - 1]!)));
  const ultimo = segmentos.at(-1) ?? "";
  const terminaEnParametro = parametroDe(ultimo) !== undefined;
  const nombreRecurso = slug(recurso.slice(-profundidad).join("-")) || "raiz";
  if (!terminaEnParametro && recurso.length > 0) {
    const segmento = slug(ultimo);
    if (r.metodo === "get" && SEGMENTO_DE_RESUMEN.test(segmento)) return segmento;
    if (r.metodo !== "get" && segmentos.length > 1 && SEGMENTO_DE_ACCION.test(segmento)) {
      return profundidad === 1 ? segmento : `${segmento}-${slug(recurso.slice(-profundidad, -1).join("-"))}`;
    }
  }
  const accion = {
    get: terminaEnParametro ? "leer" : "listar",
    all: terminaEnParametro ? "leer" : "listar",
    post: "crear",
    put: conPatch ? "reemplazar" : "actualizar",
    patch: "actualizar",
    delete: "borrar",
  }[r.metodo];
  return `${accion}-${nombreRecurso}`;
}

/** Un nombre por ruta y método, sin choques: si dos dan el mismo, se alarga el recurso de los dos. */
function nombresHttp(rutas: readonly RutaApi[]): string[] {
  const conPatch = new Set(rutas.filter((r) => r.metodo === "patch").map((r) => r.ruta));
  const profundidad = rutas.map(() => 1);
  for (let vuelta = 0; vuelta < 6; vuelta++) {
    const nombres = rutas.map((r, i) => nombreHttp(r, conPatch.has(r.ruta), profundidad[i]!));
    const repetidos = nombres.map((n, i) => nombres.indexOf(n) !== i || nombres.lastIndexOf(n) !== i);
    if (!repetidos.some(Boolean)) return nombres;
    repetidos.forEach((r, i) => {
      if (r) profundidad[i]!++;
    });
  }
  const nombres = rutas.map((r, i) => nombreHttp(r, conPatch.has(r.ruta), profundidad[i]!));
  return nombres.map((n, i) => (nombres.indexOf(n) !== i ? `${n}-${i + 1}` : n));
}

function llamadaHttp(r: RutaApi): LlamadaHttp {
  const parametros = r.ruta.split("/").flatMap((s) => parametroDe(s) ?? []);
  const metodo: MetodoDelVerbo = r.metodo === "all" ? "GET" : (r.metodo.toUpperCase() as MetodoDelVerbo);
  return { metodo, ruta: r.ruta, parametros, consulta: r.consulta ?? [], cuerpo: r.cuerpo, sinMetodo: r.metodo === "all", api: r };
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
  if (sinCliNiMcp) {
    // Sin CLI ni MCP, cada método de cada ruta es un verbo que el CLI generado implementa llamándola.
    const rutas = [...inventario.superficies.api].sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : ORDEN_DE_METODOS.indexOf(a.metodo) - ORDEN_DE_METODOS.indexOf(b.metodo)));
    const nombres = nombresHttp(rutas);
    rutas.forEach((r, i) => {
      const http = llamadaHttp(r);
      const c = tomar(nombres[i]!);
      c.vistos.push({ archivo: r.archivo, linea: r.linea, via: "api" });
      c.posicionales = http.parametros.map((p) => p.nombre);
      c.escrituraHttp = http.metodo !== "GET";
      c.http = http;
    });
    return [...porNombre.values()].filter((c) => c.nombre !== "");
  }
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

const TIPO_LEGIBLE: Record<TipoDeCampo, string> = {
  texto: "texto", numero: "número", entero: "entero", booleano: "booleano", fecha: "fecha", lista: "lista", objeto: "objeto", otro: "cualquiera",
};

function describirCuerpo(forma: CuerpoInferido | null, metodo: string): string {
  if (forma === null) {
    return `El cuerpo JSON de la petición ${metodo}. No se pudo inferir su forma: va tal cual, sin validar (mira las notas del contrato).`;
  }
  const campos = forma.campos.map((c) => describirCampo(c, TIPO_LEGIBLE[c.tipo])).join(", ");
  const de = forma.origen === "zod" ? `del esquema zod «${forma.nombre}»` : `del modelo de Prisma «${forma.nombre}»`;
  return `El cuerpo JSON de la petición ${metodo}, un objeto con ${campos || "ningún campo visto"}; sale ${de} (${forma.desde.archivo}:${forma.desde.linea}).`;
}

function entradasHttp(c: Candidato, http: LlamadaHttp, cuerpo: CuerpoInferido | null): EntradaDelVerbo[] {
  const donde = c.vistos.map((v) => `${v.archivo}:${v.linea}`).join(", ");
  const entradas: EntradaDelVerbo[] = http.parametros.map((p, i) => ({
    nombre: snake(p.nombre),
    tipo: "texto",
    requerida: !p.opcional,
    descripcion: p.resto
      ? `El resto de la ruta en «${p.nombre}» (${http.ruta}): uno o varios segmentos separados por «/» (${donde}).`
      : `El «${p.nombre}» de la ruta ${http.ruta} (${donde}).`,
    como: "posicional",
    posicion: i,
  }));
  for (const q of http.consulta) {
    const nombre = snake(q);
    if (entradas.some((e) => e.nombre === nombre)) continue;
    const detalle = http.api.consulta_detalle?.find((p) => p.nombre === q);
    entradas.push({ nombre, tipo: "texto", requerida: detalle?.requerido === true, descripcion: describirParametro(q, detalle, http.api, donde), como: "bandera", bandera: `--${slug(q)}` });
  }
  if (tieneCuerpo(http.metodo)) {
    entradas.push({
      nombre: "cuerpo",
      tipo: "texto",
      requerida: cuerpo !== null && cuerpo.campos.some((x) => x.requerido),
      descripcion: describirCuerpo(cuerpo, http.metodo),
      como: "bandera",
      bandera: "--cuerpo",
    });
  }
  if (http.metodo !== "GET") {
    entradas.push({ nombre: "aplicar", tipo: "booleano", requerida: false, descripcion: "Sin ella es un ensayo: dice qué petición haría y no la hace.", como: "bandera", bandera: "--aplicar" });
  }
  return entradas;
}

function tieneCuerpo(metodo: MetodoDelVerbo): boolean {
  return metodo === "POST" || metodo === "PUT" || metodo === "PATCH";
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

/**
 * Los archivos de estado del dominio: lo que el agente tendría que leer entero sin una lectura
 * barata. Un esquema de Prisma no: es la forma del estado, que vive en la base de datos.
 */
export function estadoDelDominio(inventario: Inventario): ArchivoDeEstado[] {
  return inventario.estado.filter((e) => e.rol === "dominio" && e.formato !== "prisma");
}

/** Los modelos de Prisma que vio el analizador, de todos los esquemas. */
export function modelosDelDominio(inventario: Inventario): (ModeloDeDatos & { archivo: string })[] {
  return inventario.estado.flatMap((e) => (e.modelos ?? []).map((m) => ({ ...m, archivo: e.ruta })));
}

/**
 * Los verbos sin su implementación: la pone implementacion.ts, que es quien mira el dominio. Los
 * que llaman a una ruta HTTP ya la traen (`http`), porque no dependen del estado en archivos.
 */
export type VerboSinImplementar = Omit<VerboDelContrato, "implementacion"> & { implementacion?: Implementacion };

const TIPO_PRISMA: Record<string, TipoDeCampo> = {
  String: "texto", Int: "entero", BigInt: "entero", Float: "numero", Decimal: "numero", Boolean: "booleano", DateTime: "fecha", Json: "objeto", Bytes: "texto",
};

/**
 * El cuerpo de una escritura sacado del modelo de Prisma que se llama como el recurso de la ruta
 * (`/api/productos` → `Producto` o `@@map("productos")`): sus columnas sin la clave autogenerada,
 * sin relaciones y sin las fechas que pone Prisma. Requeridas las que no son opcionales ni tienen
 * valor por defecto; en un PATCH, ninguna.
 */
function cuerpoDesdePrisma(http: LlamadaHttp, modelos: ReturnType<typeof modelosDelDominio>): CuerpoInferido | undefined {
  const recurso = [...http.ruta.split("/").filter((s) => s !== "" && parametroDe(s) === undefined)].reverse().find((s) => !PREFIJO_DE_API.test(s));
  if (recurso === undefined) return undefined;
  const r = slug(recurso);
  const candidatos = new Set([r, r.replace(/s$/, ""), r.replace(/es$/, "")]);
  const modelo = modelos.find((m) => candidatos.has(slug(m.nombre)) || (m.tabla !== undefined && slug(m.tabla) === r));
  if (modelo === undefined) return undefined;
  const campos = modelo.campos
    .filter((c) => !c.relacion && !(c.id && c.por_defecto) && !(c.por_defecto && /^(createdAt|updatedAt|creadoEn|actualizadoEn|created_at|updated_at)$/.test(c.nombre)))
    .map((c): CampoDelCuerpo => ({
      nombre: c.nombre,
      tipo: c.lista ? "lista" : (TIPO_PRISMA[c.tipo] ?? (c.enumerado ? "texto" : "otro")),
      requerido: http.metodo !== "PATCH" && !c.opcional && !c.por_defecto,
    }));
  return { origen: "prisma", nombre: modelo.nombre, desde: { archivo: modelo.archivo, linea: modelo.linea }, campos };
}

function erroresHttp(tipo: "lectura" | "escritura", conParametros: boolean): ErrorDelVerbo[] {
  const errores: ErrorDelVerbo[] = [
    {
      codigo: 2,
      cuando: `Falta una entrada, el cuerpo no es JSON o le falta un campo requerido, o el servidor rechaza la petición (400, 422${conParametros ? ", o 404: no existe lo que dice el parámetro" : ""}).`,
      salida: "Corrige las entradas según el esquema del verbo (y la respuesta del servidor, si la trae) y vuelve a llamarlo.",
      reintentable: false,
    },
    {
      codigo: 3,
      cuando: "El servidor no responde, responde 5xx o 429, o la ruta no existe en él.",
      salida: "Comprueba que el servidor está levantado en la URL base (AX_BASE_URL); si responde 5xx o 429, espera y reintenta; si se repite igual, avisa a una persona.",
      reintentable: true,
    },
    { codigo: 5, cuando: "El servidor pide credenciales o las niega (401, 403).", salida: "Hace falta una persona: el CLI no maneja credenciales; pídele acceso o que haga la operación.", reintentable: false },
  ];
  if (tipo === "escritura") {
    errores.push({ codigo: 4, cuando: "El servidor dice que hay un conflicto con el estado actual (409, 412).", salida: "Vuelve a leer lo que ibas a cambiar, ensaya otra vez y luego aplica.", reintentable: true });
  }
  return errores;
}

function verboHttp(c: Candidato, http: LlamadaHttp, modelos: ReturnType<typeof modelosDelDominio>): VerboSinImplementar {
  const tipo = http.metodo === "GET" ? "lectura" : "escritura";
  const forma = tieneCuerpo(http.metodo) ? (http.cuerpo ?? cuerpoDesdePrisma(http, modelos) ?? null) : null;
  const peticion = `${http.metodo} ${http.ruta}`;
  const entradas = entradasHttp(c, http, forma);
  const respuesta = describirRespuesta(http.api.respuesta, modelos, http.api.consulta_detalle);
  const enRespuesta = respuesta !== undefined ? ` En «respuesta», ${respuesta}.` : "";
  return {
    nombre: c.nombre,
    tipo,
    descripcion: describirVerboHttp(http.api, http.metodo, tieneCuerpo(http.metodo), modelos),
    argv: [c.nombre],
    entradas,
    salida: tipo === "lectura"
      ? { descripcion: `JSON con esquema, la petición hecha, el estado HTTP y la respuesta (recortada si pasa del presupuesto).${enRespuesta}`, claves: ["esquema", "peticion", "estado", "respuesta"] }
      : { descripcion: `JSON con esquema; en el ensayo, la petición que haría; al aplicar, la petición, el estado HTTP y la respuesta.${enRespuesta}`, claves: ["esquema", "ensayo", "peticion", "estado", "respuesta"] },
    errores: erroresHttp(tipo, http.parametros.length > 0),
    ensayo_por_defecto: tipo === "escritura",
    evidencia: tipo === "lectura" ? { exige: [], devuelve: ["peticion", "estado", "respuesta"] } : { exige: [], devuelve: ["peticion", "estado", "respuesta"] },
    origen: "existente",
    motivo: `Ya existe en el repo como ruta HTTP ${peticion} (${c.vistos.map((v) => `${v.archivo}:${v.linea}`).join(", ")}).`,
    visto_en: c.vistos,
    implementacion: {
      tipo: "http",
      metodo: http.metodo,
      ruta: http.ruta,
      parametros: http.parametros.map((p) => ({ entrada: snake(p.nombre), segmento: p.nombre, resto: p.resto })),
      consulta: http.consulta.map((q) => ({ entrada: snake(q), parametro: q })),
      cuerpo: tieneCuerpo(http.metodo) ? { entrada: "cuerpo", forma } : null,
    },
  };
}

/** Lo que se aproximó en los verbos HTTP y conviene que una persona revise. */
export function notasHttp(inventario: Inventario, verbos: readonly VerboDelContrato[]): string[] {
  const notas: string[] = [];
  const candidatosHttp = candidatos(inventario).filter((c) => c.http !== undefined);
  for (const v of verbos) {
    if (v.implementacion.tipo !== "http") continue;
    const peticion = `${v.implementacion.metodo} ${v.implementacion.ruta}`;
    const cuerpo = v.implementacion.cuerpo;
    if (cuerpo !== null && cuerpo.forma === null) {
      notas.push(`No se pudo inferir el cuerpo de «${v.nombre}» (${peticion}): ni un esquema zod que valide su manejador ni un modelo de Prisma con el nombre del recurso. El CLI lo envía tal cual, sin validarlo.`);
    } else if (cuerpo !== null && cuerpo.forma?.origen === "prisma") {
      notas.push(`El cuerpo de «${v.nombre}» (${peticion}) sale del modelo de Prisma «${cuerpo.forma.nombre}», no de lo que valida su manejador: revísalo.`);
    }
    if (candidatosHttp.find((c) => c.nombre === v.nombre)?.http?.sinMetodo) {
      notas.push(`«${v.nombre}» (${v.visto_en.map((x) => `${x.archivo}:${x.linea}`).join(", ")}) no compara req.method con ningún método: se tomó como GET; revísalo.`);
    }
  }
  return notas;
}

export function verbosDe(inventario: Inventario, hayVedadas: boolean): VerboSinImplementar[] {
  const vistos = candidatos(inventario).filter((c) => !esCierre(c.nombre));
  const dominio = estadoDelDominio(inventario);
  const modelos = modelosDelDominio(inventario);
  const lecturaVista = vistos.find((c) => esLectura(c) && LECTURA_RESUMEN.test(c.nombre));
  const propuestos: Candidato[] = [];
  // Sin lectura barata y con estado de dominio, el contrato propone la lectura «estado».
  if (lecturaVista === undefined && dominio.length > 0) {
    propuestos.push({ nombre: "estado", vistos: [], banderas: new Set(), posicionales: [], escrituraHttp: false });
  }
  const resumen = lecturaVista?.nombre ?? (propuestos.length > 0 ? "estado" : undefined);
  return [...propuestos, ...vistos].map((c): VerboSinImplementar => {
    if (c.http !== undefined) return verboHttp(c, c.http, modelos);
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
      const http = v.implementacion.tipo === "http";
      return {
        verbo: v.nombre,
        descripcion: http
          ? `Una lectura acotada por la API HTTP (${v.implementacion.tipo === "http" ? `${v.implementacion.metodo} ${v.implementacion.ruta}` : ""}): su respuesta se recorta al presupuesto.`
          : esResumen ? "El resumen: lo primero que lee un agente para enterarse del estado." : "Una lectura acotada del dominio.",
        fuente: http ? [] : dominio.map((e) => e.ruta),
        presupuesto_tokens: esResumen ? resumen.cumple.valor : resumen.parcial.valor,
        tokens_camino_caro: !http && dominio.length > 0 ? contarTokens(caracteres) : null,
      };
    });
}
