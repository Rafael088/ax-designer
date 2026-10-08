// El único sitio de axd que escribe en el repo objetivo. Para comprobar que puede, lee solo los
// archivos que va a escribir —nada más del repo—: la cabecera que dejó al generarlos dice de qué
// contrato salieron y el sha256 de su contenido, así que un archivo que no tiene cabecera (no lo
// generó axd) o cuyo contenido ya no coincide (alguien lo editó) no se pisa: código 5.
//
// `ensayar` no toca nada y falla donde fallaría `aplicar`. `aplicar` vuelve a ensayar,
// y si se le pasa la huella del destino que dio el ensayo y el destino cambió desde entonces, sale
// con 4 sin escribir nada. Cada archivo se escribe en un temporal y se mueve a su sitio.
import { constants, copyFileSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { jsonCanonico, sha256 } from "../contrato/index.ts";
import { ErrorAx } from "../modelo/index.ts";
import type { Ruta } from "../modelo/index.ts";

/** Cómo lleva la cabecera cada tipo de archivo: comentario de línea, comentario HTML o una clave «//» de JSON. */
export type Comentario = "//" | "#" | "html" | "json";

export type ArchivoGenerado = {
  ruta: Ruta;
  /** El contenido sin cabecera: la pone el escritor. */
  contenido: string;
  comentario: Comentario;
  /** Por qué existe este archivo, para el ensayo. */
  motivo: string;
};

export type Accion = "crear" | "actualizar" | "sin-cambios" | "negado";

export type PasoDelPlan = {
  ruta: Ruta;
  accion: Accion;
  motivo: string;
  /** Por qué se crea, se actualiza, se deja o se niega. */
  por_que: string;
  bytes: number;
  /** sha256 del archivo tal como quedaría escrito, cabecera incluida. */
  sha256: string;
  /** sha256 de lo que hay hoy en el destino; null si no existe. */
  sha256_actual: string | null;
};

export type Plan = {
  raiz: string;
  contrato: string;
  /** sha256 del estado actual de los destinos: lo que `aplicar --huella` compara. */
  huella_del_destino: string;
  archivos: PasoDelPlan[];
  negados: number;
};

export type Escrito = { ruta: Ruta; accion: "crear" | "actualizar"; bytes: number; sha256: string };

export type Aplicado = { raiz: string; contrato: string; escritos: Escrito[]; sin_cambios: Ruta[] };

const MARCA = /generado por axd · contrato sha256:([0-9a-f]{64}) · contenido sha256:([0-9a-f]{64})/;
const LINEAS_DE_CABECERA = 3;

function lineaDeCabecera(comentario: Comentario, contrato: string, contenido: string): string {
  const texto = `generado por axd · contrato sha256:${contrato} · contenido sha256:${contenido} · no lo edites: cambia el contrato y vuelve a correr \`axd generar\``;
  switch (comentario) {
    case "//":
    case "#":
      return `${comentario} ${texto}`;
    case "html":
      return `<!-- ${texto} -->`;
    case "json":
      return `  "//": ${JSON.stringify(texto)},`;
  }
}

/** Dónde va la cabecera: tras el shebang, tras la `{` de un JSON, o en la primera línea. */
function posicionDeCabecera(comentario: Comentario, lineas: readonly string[]): number {
  if (comentario === "json") {
    if (lineas[0] !== "{" || lineas.length < 3) throw new ErrorAx("Un JSON generado tiene que empezar con «{» en su propia línea y tener al menos una clave.", {
      codigo: 3,
      salida: "Es un fallo de la plantilla de axd: repórtalo con este mensaje y el archivo que se iba a generar.",
    });
    return 1;
  }
  return lineas[0]?.startsWith("#!") ? 1 : 0;
}

/** El texto final del archivo: el contenido con la cabecera insertada. */
export function conCabecera(archivo: ArchivoGenerado, contrato: string): string {
  const lineas = archivo.contenido.split("\n");
  const donde = posicionDeCabecera(archivo.comentario, lineas);
  const cabecera = lineaDeCabecera(archivo.comentario, contrato, sha256(archivo.contenido));
  return [...lineas.slice(0, donde), cabecera, ...lineas.slice(donde)].join("\n");
}

/** La cabecera de un archivo ya escrito, si la tiene, y si su contenido sigue siendo el que generó axd. */
export function leerCabecera(texto: string): { contrato: string; intacto: boolean } | undefined {
  const lineas = texto.split("\n");
  const i = lineas.slice(0, LINEAS_DE_CABECERA).findIndex((l) => MARCA.test(l));
  if (i === -1) return undefined;
  const [, contrato, contenido] = MARCA.exec(lineas[i]!)!;
  const sinCabecera = [...lineas.slice(0, i), ...lineas.slice(i + 1)].join("\n");
  return { contrato: contrato!, intacto: sha256(sinCabecera) === contenido };
}

/** La carpeta donde escriben los generadores. */
export const CARPETA_GENERADA = "ax";

/** Si un archivo del repo lo generó axd: vive en ax/ y lleva su cabecera (esté o no intacto). */
export function esGeneradoPorAxd(ruta: Ruta, leer: () => string): boolean {
  if (!ruta.startsWith(`${CARPETA_GENERADA}/`)) return false;
  try {
    return leerCabecera(leer()) !== undefined;
  } catch {
    return false;
  }
}

function comprobarRuta(ruta: Ruta): void {
  const segmentos = ruta.split("/");
  if (ruta === "" || ruta.startsWith("/") || ruta.includes("\\") || segmentos.some((s) => s === "" || s === "." || s === "..")) {
    throw new ErrorAx(`El generador pidió escribir en «${ruta}», que no es una ruta relativa dentro del repo.`, {
      codigo: 3,
      salida: "Es un fallo de axd, no del repo: repórtalo con este mensaje.",
    });
  }
}

type Actual = { tipo: "ausente" } | { tipo: "otro" } | { tipo: "archivo"; texto: string };

/** Las carpetas del camino que ya existen tienen que ser carpetas de verdad: un enlace podría sacar la escritura del repo. */
function caminoSeguro(raiz: string, ruta: Ruta): boolean {
  const segmentos = ruta.split("/").slice(0, -1);
  for (let i = 1; i <= segmentos.length; i++) {
    let info: ReturnType<typeof lstatSync>;
    try {
      info = lstatSync(join(raiz, ...segmentos.slice(0, i)));
    } catch {
      return true;
    }
    if (!info.isDirectory()) return false;
  }
  return true;
}

function leerActual(absoluta: string): Actual {
  let info: ReturnType<typeof lstatSync>;
  try {
    info = lstatSync(absoluta);
  } catch {
    return { tipo: "ausente" };
  }
  if (!info.isFile()) return { tipo: "otro" };
  return { tipo: "archivo", texto: readFileSync(absoluta, "utf8") };
}

function huellaDeActual(actual: Actual): string | null {
  if (actual.tipo === "ausente") return null;
  if (actual.tipo === "otro") return "no-es-un-archivo";
  return sha256(actual.texto);
}

function comprobarRaiz(raiz: string): string {
  const absoluta = resolve(raiz);
  let info: ReturnType<typeof lstatSync> | undefined;
  try {
    info = lstatSync(absoluta);
  } catch {
    info = undefined;
  }
  if (info === undefined || !info.isDirectory()) {
    throw new ErrorAx(`«${raiz}» no es una carpeta: no hay dónde escribir.`, { codigo: 2, salida: "Pasa la carpeta raíz del repo objetivo." });
  }
  return absoluta;
}

function paso(archivo: ArchivoGenerado, contrato: string, actual: Actual): PasoDelPlan {
  const texto = conCabecera(archivo, contrato);
  const base = { ruta: archivo.ruta, motivo: archivo.motivo, bytes: Buffer.byteLength(texto, "utf8"), sha256: sha256(texto), sha256_actual: huellaDeActual(actual) };
  if (actual.tipo === "ausente") return { ...base, accion: "crear", por_que: "No existe." };
  if (actual.tipo === "otro") return { ...base, accion: "negado", por_que: "Existe y no es un archivo normal, o una carpeta de su camino es un enlace o un archivo: no se toca." };
  const cabecera = leerCabecera(actual.texto);
  if (cabecera === undefined) return { ...base, accion: "negado", por_que: "Existe y no lo generó axd (no tiene su cabecera): no se pisa." };
  if (!cabecera.intacto) return { ...base, accion: "negado", por_que: "Lo generó axd pero alguien lo cambió desde entonces: no se pisa." };
  if (actual.texto === texto) return { ...base, accion: "sin-cambios", por_que: "Ya está igual a lo que se generaría." };
  return {
    ...base,
    accion: "actualizar",
    por_que: cabecera.contrato === contrato ? "Lo generó axd y está intacto; la plantilla cambió." : `Lo generó axd desde el contrato ${cabecera.contrato.slice(0, 12)} y está intacto; el contrato cambió.`,
  };
}

/** Qué crearía, cambiaría, dejaría o se negaría a pisar. No escribe nada. */
export function ensayar(raiz: string, contrato: string, archivos: readonly ArchivoGenerado[]): Plan {
  const absoluta = comprobarRaiz(raiz);
  const rutas = new Set<Ruta>();
  const pasos = archivos.map((archivo) => {
    comprobarRuta(archivo.ruta);
    if (rutas.has(archivo.ruta)) throw new ErrorAx(`El generador pidió escribir dos veces «${archivo.ruta}».`, { codigo: 3, salida: "Es un fallo de axd: repórtalo con este mensaje." });
    rutas.add(archivo.ruta);
    const actual: Actual = caminoSeguro(absoluta, archivo.ruta) ? leerActual(join(absoluta, archivo.ruta)) : { tipo: "otro" };
    return paso(archivo, contrato, actual);
  });
  const huella_del_destino = sha256(jsonCanonico(pasos.map((p) => [p.ruta, p.sha256_actual]).sort()));
  return { raiz, contrato, huella_del_destino, archivos: pasos, negados: pasos.filter((p) => p.accion === "negado").length };
}

/** Lanza el 5 que daría `aplicar` si el plan tiene archivos que no se pueden pisar. */
export function exigirSinNegados(plan: Plan): void {
  if (plan.negados === 0) return;
  const negados = plan.archivos.filter((p) => p.accion === "negado");
  throw new ErrorAx(`Hay ${negados.length} archivo(s) que axd no puede pisar: ${negados.map((p) => p.ruta).join(", ")}.`, {
    codigo: 5,
    salida: "Una persona tiene que decidir: mover o borrar esos archivos, o devolverlos a lo que generó axd, y volver a ensayar.",
    datos: { archivos: negados.map(({ ruta, por_que, sha256_actual }) => ({ ruta, por_que, sha256_actual })) },
  });
}

function destinoCambio(ruta: Ruta): ErrorAx {
  return new ErrorAx(`«${ruta}» cambió mientras se escribía.`, {
    codigo: 4,
    salida: "Vuelve a ensayar y aplica con la huella nueva.",
    reintentable: true,
  });
}

function escribirUno(absoluta: string, p: PasoDelPlan, texto: string): void {
  const destino = join(absoluta, p.ruta);
  mkdirSync(dirname(destino), { recursive: true });
  const temporal = `${destino}.axd-${process.pid}-${Date.now()}.tmp`;
  writeFileSync(temporal, texto, { encoding: "utf8", flag: "wx" });
  try {
    if (p.accion === "crear") {
      // link falla si el destino apareció desde el ensayo: no se pisa algo que no se vio.
      try {
        linkSync(temporal, destino);
      } catch (e) {
        const codigo = (e as NodeJS.ErrnoException).code;
        if (codigo === "EEXIST") throw destinoCambio(p.ruta);
        // Sin enlaces duros (algunos sistemas de archivos): copia exclusiva, que también falla si ya existe.
        if (codigo !== "EPERM" && codigo !== "ENOTSUP" && codigo !== "ENOSYS" && codigo !== "EXDEV") throw e;
        try {
          copyFileSync(temporal, destino, constants.COPYFILE_EXCL);
        } catch (e2) {
          if ((e2 as NodeJS.ErrnoException).code === "EEXIST") throw destinoCambio(p.ruta);
          throw e2;
        }
      }
      return;
    }
    if (huellaDeActual(leerActual(destino)) !== p.sha256_actual) throw destinoCambio(p.ruta);
    renameSync(temporal, destino);
  } finally {
    rmSync(temporal, { force: true });
  }
}

/**
 * Escribe lo que el ensayo diría que escribe. Con `huellaDelEnsayo`, sale con 4 si el destino ya
 * no es el que se ensayó; con archivos negados, sale con 5 sin escribir ninguno.
 */
export function aplicar(raiz: string, contrato: string, archivos: readonly ArchivoGenerado[], opciones: { huellaDelEnsayo?: string } = {}): Aplicado {
  const plan = ensayar(raiz, contrato, archivos);
  if (opciones.huellaDelEnsayo !== undefined && opciones.huellaDelEnsayo !== plan.huella_del_destino) {
    throw new ErrorAx("El destino cambió desde el ensayo: la huella no coincide.", {
      codigo: 4,
      salida: "Vuelve a ensayar sin --aplicar, revisa el plan y aplica con la huella nueva.",
      reintentable: true,
      datos: { huella_del_destino: plan.huella_del_destino },
    });
  }
  exigirSinNegados(plan);
  const absoluta = resolve(raiz);
  const escritos: Escrito[] = [];
  const sin_cambios: Ruta[] = [];
  for (const [i, p] of plan.archivos.entries()) {
    if (p.accion === "sin-cambios") {
      sin_cambios.push(p.ruta);
      continue;
    }
    if (p.accion !== "crear" && p.accion !== "actualizar") continue;
    escribirUno(absoluta, p, conCabecera(archivos[i]!, contrato));
    escritos.push({ ruta: p.ruta, accion: p.accion, bytes: p.bytes, sha256: p.sha256 });
  }
  return { raiz, contrato, escritos, sin_cambios };
}

// Lo que escribe el validador: sus copias temporales del repo (fuera del repo objetivo) y el
// resultado de cada `axd validar --correr`, en .ax-corridas/ del repo objetivo. Ninguno pisa nada.

const PREFIJO_TEMPORAL = "axd-validar-";

/** Una carpeta nueva y vacía en el temporal del sistema, para las copias de una validación. */
export function crearCarpetaTemporal(): string {
  return mkdtempSync(join(tmpdir(), PREFIJO_TEMPORAL));
}

/** Escribe una copia del repo en `destino`, que tiene que no existir o estar vacío. */
export function escribirCopia(destino: string, archivos: readonly { ruta: Ruta; contenido: Buffer }[]): void {
  let vacia = true;
  try {
    vacia = readdirSync(destino).length === 0;
  } catch {
    vacia = true;
  }
  if (!vacia) throw new ErrorAx(`«${destino}» no está vacía: la copia no se escribe encima de nada.`, { codigo: 3, salida: "Es un fallo de axd: repórtalo con este mensaje." });
  for (const archivo of archivos) {
    comprobarRuta(archivo.ruta);
    const absoluta = join(destino, archivo.ruta);
    mkdirSync(dirname(absoluta), { recursive: true });
    writeFileSync(absoluta, archivo.contenido, { flag: "wx" });
  }
}

/** Borra una carpeta de `crearCarpetaTemporal`; cualquier otra ruta se niega, para no borrar de más. */
export function borrarCarpetaTemporal(ruta: string): void {
  const absoluta = resolve(ruta);
  const dentro = relative(resolve(tmpdir()), absoluta);
  if (dentro.startsWith("..") || dentro.includes(sep) || !basename(absoluta).startsWith(PREFIJO_TEMPORAL)) {
    throw new ErrorAx(`«${ruta}» no es una carpeta temporal del validador: no se borra.`, { codigo: 3, salida: "Es un fallo de axd: repórtalo con este mensaje." });
  }
  rmSync(absoluta, { recursive: true, force: true });
}

export const CARPETA_DE_CORRIDAS = ".ax-corridas";

/** Escribe `.ax-corridas/<nombre>.json` en el repo objetivo; si ya existe, sale con 4 sin pisarlo. */
export function escribirCorrida(raiz: string, nombre: string, contenido: string): Escrito {
  const absoluta = comprobarRaiz(raiz);
  const ruta = `${CARPETA_DE_CORRIDAS}/${nombre}.json`;
  comprobarRuta(ruta);
  if (!caminoSeguro(absoluta, ruta)) {
    throw new ErrorAx(`${CARPETA_DE_CORRIDAS} existe y no es una carpeta: no se escribe ahí.`, { codigo: 5, salida: `Una persona tiene que mover o borrar ${CARPETA_DE_CORRIDAS} y volver a correr.` });
  }
  const destino = join(absoluta, ruta);
  mkdirSync(dirname(destino), { recursive: true });
  try {
    writeFileSync(destino, contenido, { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw destinoCambio(ruta);
    throw e;
  }
  return { ruta, accion: "crear", bytes: Buffer.byteLength(contenido, "utf8"), sha256: sha256(contenido) };
}
