// Qué hace de verdad cada verbo en el CLI generado: una operación genérica sobre el estado del
// dominio (resumir, listar, leer, buscar, anexar a la bitácora), elegida por el nombre del verbo,
// sus entradas y los formatos de las fuentes. Si no hay con qué, el verbo queda `sin-implementar`
// con lo que falta y el siguiente paso: el CLI sale con 5 en vez de fingir que funcionó.
import type {
  DominioDelContrato, EntradaDelVerbo, FuenteDelDominio, Implementacion, Inventario, VerboDelContrato,
} from "../modelo/index.ts";
import { estadoDelDominio, slug, type VerboSinImplementar } from "./verbos.ts";

const RESUMEN = /^(estado|status|resumen|contexto|summary)$/;
const LISTAR = /^(listar|list|ls)([-_]|$)/;
const LEER = /^(leer|ver|get|show|mostrar|read)([-_]|$)/;
const BUSCAR = /^(buscar|search|find|grep)([-_]|$)/;
const ENTRADA_DE_BUSQUEDA = /^(texto|consulta|q|query|patron|buscar|termino)$/;
/** Las entradas que pone la convención del contrato, no el dominio: no van al registro ni filtran. */
const COMUNES = new Set(["aplicar", "huella"]);
const LEGIBLES = new Set(["json", "csv", "jsonl"]);

export const COMO_SE_CALCULA_LA_HUELLA =
  "sha256 del JSON canónico (claves ordenadas, sin espacios) de la lista [ruta, sha256 del contenido o null si no existe] de cada fuente, en orden de ruta.";

export function dominioDe(inventario: Inventario): DominioDelContrato {
  const bitacoras = new Set(inventario.trazabilidad.bitacoras.map((b) => b.ruta));
  const fuentes = estadoDelDominio(inventario)
    .map((e): FuenteDelDominio => ({ ruta: e.ruta, formato: e.formato, bitacora: e.formato === "jsonl" && bitacoras.has(e.ruta) }))
    .sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));
  return { fuentes, huella: COMO_SE_CALCULA_LA_HUELLA };
}

/** La colección de registros que trata el verbo: la que se llama como su sufijo (listar-tareas → tareas.*), o la primera legible. */
function coleccionPara(verbo: string, dominio: DominioDelContrato): FuenteDelDominio | undefined {
  const legibles = dominio.fuentes.filter((f) => !f.bitacora && LEGIBLES.has(f.formato));
  const sufijo = verbo.split("-").slice(1).join("-");
  const base = (f: FuenteDelDominio) => slug(f.ruta.split("/").pop()!.replace(/\.[^.]+$/, ""));
  const porNombre = sufijo === "" ? undefined : legibles.find((f) => base(f) === sufijo || base(f) === `${sufijo}s` || `${base(f)}s` === sufijo);
  const orden = ["json", "csv", "jsonl"];
  return porNombre ?? [...legibles].sort((a, b) => orden.indexOf(a.formato) - orden.indexOf(b.formato))[0];
}

function propias(verbo: VerboSinImplementar): EntradaDelVerbo[] {
  return verbo.entradas.filter((e) => !COMUNES.has(e.nombre));
}

function sinImplementar(falta: string, salida: string): Implementacion {
  return { tipo: "sin-implementar", falta, salida };
}

const REGENERAR = "y vuelve a correr `axd contrato` y `axd generar cli --aplicar`";

function deLectura(verbo: VerboSinImplementar, dominio: DominioDelContrato): Implementacion {
  const nombres = dominio.fuentes.map((f) => f.ruta).join(", ");
  if (RESUMEN.test(verbo.nombre)) {
    return dominio.fuentes.length > 0
      ? { tipo: "resumen" }
      : sinImplementar("Archivos de estado del dominio que resumir: el análisis no vio ninguno.", `Hace falta una persona: di dónde vive el estado (data/, estado.json…) ${REGENERAR}.`);
  }
  const coleccion = coleccionPara(verbo.nombre, dominio);
  const sinColeccion = () => sinImplementar(
    `Una colección de registros en JSON, CSV o JSONL que «${verbo.nombre}» pueda leer: el estado del dominio es ${nombres === "" ? "(ninguno)" : nombres}.`,
    `Hace falta una persona: guarda los registros en JSON, CSV o JSONL ${REGENERAR}. Mientras tanto, lee el resumen del estado.`,
  );
  if (LISTAR.test(verbo.nombre)) {
    if (coleccion === undefined) return sinColeccion();
    const filtros = propias(verbo).filter((e) => e.como === "bandera" && (e.tipo === "texto" || e.tipo === "entero")).map((e) => e.nombre);
    return { tipo: "listar", coleccion: coleccion.ruta, filtros };
  }
  if (LEER.test(verbo.nombre)) {
    if (coleccion === undefined) return sinColeccion();
    const entrada = propias(verbo).find((e) => e.como === "posicional") ?? propias(verbo).find((e) => e.nombre === "id");
    if (entrada === undefined) {
      return sinImplementar(
        `La entrada que dice qué registro lee «${verbo.nombre}» (p. ej. «id»): el repo no la declara cerca del verbo.`,
        `Hace falta una persona: añade la entrada al verbo en el repo (una bandera --id o un parámetro de ruta) ${REGENERAR}. Mientras tanto, usa la lectura que lista.`,
      );
    }
    return { tipo: "leer", coleccion: coleccion.ruta, entrada: entrada.nombre, campo: entrada.nombre };
  }
  if (BUSCAR.test(verbo.nombre)) {
    if (coleccion === undefined) return sinColeccion();
    const textos = propias(verbo).filter((e) => e.tipo === "texto");
    const entrada = textos.find((e) => ENTRADA_DE_BUSQUEDA.test(e.nombre)) ?? textos[0];
    if (entrada === undefined) {
      return sinImplementar(
        `La entrada con el texto que busca «${verbo.nombre}»: el repo no la declara cerca del verbo.`,
        `Hace falta una persona: añade una bandera de texto al verbo en el repo (p. ej. --texto) ${REGENERAR}. Mientras tanto, usa la lectura que lista.`,
      );
    }
    return { tipo: "buscar", coleccion: coleccion.ruta, entrada: entrada.nombre };
  }
  return sinImplementar(
    `Qué lee «${verbo.nombre}»: su nombre no dice si resume, lista, lee un registro o busca.`,
    `Hace falta una persona: renómbralo en el repo (estado, listar-*, leer-*, buscar-*) ${REGENERAR}.`,
  );
}

function deEscritura(verbo: VerboSinImplementar, dominio: DominioDelContrato): Implementacion {
  const bitacora = dominio.fuentes.find((f) => f.bitacora);
  if (bitacora === undefined) {
    const nombres = dominio.fuentes.map((f) => f.ruta).join(", ");
    return sinImplementar(
      `Dónde deja su registro «${verbo.nombre}»: el estado del dominio (${nombres === "" ? "ninguno" : nombres}) no tiene una bitácora JSONL, ` +
        "y el contrato no dice qué campo de qué archivo cambia el verbo.",
      `Hace falta una persona: no lo hagas editando el estado a mano. Añade una bitácora JSONL al dominio (p. ej. data/bitacora.jsonl) o implementa «${verbo.nombre}» en el CLI del repo, ${REGENERAR}.`,
    );
  }
  const campos = propias(verbo).map((e) => e.nombre);
  const clave = propias(verbo).find((e) => e.como === "posicional") ?? propias(verbo).find((e) => e.nombre === "id");
  const coleccion = clave !== undefined ? coleccionPara(verbo.nombre, dominio) : undefined;
  return {
    tipo: "anexar",
    destino: bitacora.ruta,
    evento: verbo.nombre,
    campos,
    ...(clave !== undefined && coleccion !== undefined ? { existe: { entrada: clave.nombre, coleccion: coleccion.ruta, campo: clave.nombre } } : {}),
  };
}

/** Cada verbo con su implementación; los que quedan sin implementar ganan el error 5 que darán. */
export function conImplementacion(verbos: readonly VerboSinImplementar[], dominio: DominioDelContrato): VerboDelContrato[] {
  return verbos.map((v) => {
    const implementacion = v.tipo === "lectura" ? deLectura(v, dominio) : deEscritura(v, dominio);
    if (implementacion.tipo !== "sin-implementar") return { ...v, implementacion };
    return {
      ...v,
      errores: [...v.errores, { codigo: 5, cuando: `El contrato no tiene con qué implementar «${v.nombre}» en el CLI generado (implementacion.falta lo dice).`, salida: implementacion.salida, reintentable: false }],
      implementacion,
    };
  });
}
