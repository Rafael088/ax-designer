// Eje 4 — Escritura verificada e idempotente: ¿comprueba que lo leído sigue igual antes de
// escribir, escribe atómico y reintentar es seguro? Las dos primeras se leen de qué otras señales
// acompañan a cada `escribe-archivo` en el mismo archivo; `reintento-seguro` es de fuente
// `corrida`: `axd auditar` no ejecuta nada, así que sale sin-evidencia siempre.
import type { CriterioDecidido, Inventario, Ruta } from "../modelo/index.ts";
import { criterioJson, cumple, evidenciaArchivo, evidenciaAusencia, noAplica, noCumple, parcial, senalesDeTipo, sinEvidencia } from "./comun.ts";

const EJE = "escritura-verificada";

function archivosConEscritura(inventario: Inventario): Ruta[] {
  return [...new Set(senalesDeTipo(inventario, "escribe-archivo").map((s) => s.archivo))];
}

function huellaDeLectura(inventario: Inventario, archivosEscritura: Ruta[]): CriterioDecidido {
  const c = criterioJson(EJE, "huella-de-lectura");
  if (archivosEscritura.length === 0) return noAplica(c, "El proyecto no escribe estado del dominio.");
  const conHuella = archivosEscritura.filter((a) => senalesDeTipo(inventario, "compara-huella", [a]).length > 0);
  if (conHuella.length === 0) {
    return noCumple(c, "Ninguna escritura verifica una huella antes de escribir: se pisa en silencio.", [
      evidenciaAusencia("hash, etag, mtime o versión esperada cerca de una escritura", archivosEscritura.join(", ")),
    ]);
  }
  const ev = senalesDeTipo(inventario, "compara-huella", conHuella).slice(0, 2).map((s) => evidenciaArchivo(s.archivo, s.linea));
  if (conHuella.length === archivosEscritura.length) return cumple(c, "Toda escritura del dominio verifica una huella antes de escribir.", ev);
  return parcial(c, "Algunas escrituras verifican una huella y otras no.", ev);
}

function escrituraAtomica(inventario: Inventario, archivosEscritura: Ruta[]): CriterioDecidido {
  const c = criterioJson(EJE, "escritura-atomica");
  if (archivosEscritura.length === 0) return noAplica(c, "El proyecto no escribe estado del dominio.");
  const conAtomica = archivosEscritura.filter(
    (a) => senalesDeTipo(inventario, "reemplazo-atomico", [a]).length > 0 || senalesDeTipo(inventario, "transaccion", [a]).length > 0,
  );
  if (conAtomica.length === 0) {
    return noCumple(c, "Ninguna escritura es atómica: un corte a medias deja el dato roto.", [
      evidenciaAusencia("rename/os.replace o BEGIN/COMMIT cerca de una escritura", archivosEscritura.join(", ")),
    ]);
  }
  const ev = [...senalesDeTipo(inventario, "reemplazo-atomico", conAtomica), ...senalesDeTipo(inventario, "transaccion", conAtomica)]
    .slice(0, 2)
    .map((s) => evidenciaArchivo(s.archivo, s.linea));
  if (conAtomica.length === archivosEscritura.length) return cumple(c, "Todas las escrituras del dominio son atómicas.", ev);
  return parcial(c, "Algunas escrituras son atómicas y otras no.", ev);
}

function reintentoSeguro(archivosEscritura: Ruta[]): CriterioDecidido {
  const c = criterioJson(EJE, "reintento-seguro");
  if (archivosEscritura.length === 0) return noAplica(c, "El proyecto no escribe estado del dominio.");
  return sinEvidencia(c, "Comprobar que correr dos veces deja el mismo estado exige correr el repo objetivo: es de axd validar --correr.");
}

/**
 * El patrón de `bandera-de-ensayo` captura tanto las banderas que piden el efecto real
 * (`--aplicar`, `--correr`) como las que piden el ensayo (`--dry-run`, `--simular`): son
 * semánticamente opuestas. Se distinguen por las palabras de la propia señal.
 */
function ensayoAntesDeEscribir(inventario: Inventario, archivosEscritura: Ruta[]): CriterioDecidido {
  const c = criterioJson(EJE, "ensayo-antes-de-escribir");
  if (archivosEscritura.length === 0) return noAplica(c, "No hay operaciones de efecto grande o irreversible: el proyecto no escribe estado del dominio.");
  const ensayo = senalesDeTipo(inventario, "bandera-de-ensayo", archivosEscritura)[0];
  if (ensayo === undefined) {
    return noCumple(c, "No hay una bandera de ensayo cerca de lo que escribe.", [evidenciaAusencia("--dry-run, --aplicar, --simular o --ensayo", archivosEscritura.join(", "))]);
  }
  const ev = [evidenciaArchivo(ensayo.archivo, ensayo.linea)];
  const pideLoReal = /--(aplicar|apply|correr|confirm)\b/.test(ensayo.texto);
  return pideLoReal
    ? cumple(c, "El ensayo es lo que pasa por defecto: hace falta pedir el efecto real.", ev)
    : parcial(c, "Hay una bandera de ensayo, pero hay que pedirla explícitamente.", ev);
}

export function evaluar(inventario: Inventario): CriterioDecidido[] {
  const archivosEscritura = archivosConEscritura(inventario);
  return [
    huellaDeLectura(inventario, archivosEscritura),
    escrituraAtomica(inventario, archivosEscritura),
    reintentoSeguro(archivosEscritura),
    ensayoAntesDeEscribir(inventario, archivosEscritura),
  ];
}
