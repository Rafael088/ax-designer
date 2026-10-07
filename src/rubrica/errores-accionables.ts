// Eje 6 — Errores que dicen qué hacer: ¿el error nombra la causa y la salida, y distingue lo
// reintentable? Todo de inventario, leído de las señales que ya marcó el analizador
// (`construye-error`, `campo-de-salida`, `campo-reintentable`, `codigo-de-salida`,
// `manejador-de-errores`, `fallo-silencioso`): aquí solo se cuentan y se relacionan por archivo.
import type { CriterioDecidido, Inventario } from "../modelo/index.ts";
import { criterioJson, cumple, evidenciaArchivo, evidenciaAusencia, haySenalCerca, noAplica, noCumple, parcial, porMetrica, proporcion, senalesDeTipo, sinEvidencia } from "./comun.ts";

const EJE = "errores-accionables";

function hayExposicion(inventario: Inventario): boolean {
  return inventario.superficies.cli.length + inventario.superficies.api.length + inventario.superficies.mcp_tools.length + inventario.puntos_de_entrada.length > 0;
}

function erroresEstructurados(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "errores-estructurados");
  if (!hayExposicion(inventario)) return noAplica(c, "El proyecto no expone nada al agente (ni CLI, ni API, ni MCP).");
  const manejador = senalesDeTipo(inventario, "manejador-de-errores");
  const construye = senalesDeTipo(inventario, "construye-error");
  if (manejador.length > 0 && construye.length > 0) {
    return cumple(c, "Hay un manejador de errores y construcciones de error estructuradas.", [evidenciaArchivo(manejador[0]!.archivo, manejador[0]!.linea)]);
  }
  if (construye.length > 0) {
    return parcial(c, "Hay errores que se construyen estructurados, pero no se ve un manejador central.", [evidenciaArchivo(construye[0]!.archivo, construye[0]!.linea)]);
  }
  return noCumple(c, "No se ve ningún error construido de forma estructurada: puede que escapen como excepción cruda.", [
    evidenciaAusencia("throw new Error con campos, o un manejador de errores", "senales[] del Inventario"),
  ]);
}

function nombranLaSalida(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "nombran-la-salida");
  if (!hayExposicion(inventario)) return noAplica(c, "El proyecto no expone nada al agente.");
  const construye = senalesDeTipo(inventario, "construye-error");
  if (construye.length === 0) return sinEvidencia(c, "No se encontraron construcciones de error para medir qué proporción dice el siguiente paso.");
  const conSalida = construye.filter((s) => haySenalCerca(inventario, s.archivo, s.linea, ["campo-de-salida"]) !== undefined || haySenalCerca(inventario, s.archivo, Math.max(1, s.linea - 5), ["campo-de-salida"], 10) !== undefined);
  const prop = proporcion(conSalida.length, construye.length)!;
  const ev = (conSalida.length > 0 ? conSalida : construye).slice(0, 2).map((s) => evidenciaArchivo(s.archivo, s.linea));
  return porMetrica(c, prop, ev);
}

function reintentableDistinguido(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "reintentable-distinguido");
  if (!hayExposicion(inventario)) return noAplica(c, "El proyecto no expone nada al agente.");
  const campo = senalesDeTipo(inventario, "campo-reintentable");
  const codigos = senalesDeTipo(inventario, "codigo-de-salida");
  const numeros = new Set(codigos.map((s) => s.texto.match(/-?\d+/)?.[0]).filter((n): n is string => n !== undefined));
  if (campo.length === 0 && numeros.size <= 1) {
    return noCumple(c, "No hay campo de reintento ni más de un código de salida: todo error es igual.", [
      evidenciaAusencia("reintentable/retryable, o más de un código de salida distinto", "senales[] del Inventario"),
    ]);
  }
  const documentado = inventario.guias.some((g) => /c[oó]digo(s)? de salida|exit code|reintentable|retryable/i.test(g.contenido));
  const ev = (campo.length > 0 ? campo : codigos).slice(0, 2).map((s) => evidenciaArchivo(s.archivo, s.linea));
  return documentado
    ? cumple(c, "Hay campo de reintento o códigos distintos, documentados en una guía.", ev)
    : parcial(c, "Hay campo de reintento o códigos distintos, pero sin documentar.", ev);
}

function fallosVisibles(inventario: Inventario): CriterioDecidido {
  const c = criterioJson(EJE, "fallos-visibles");
  const sitios = senalesDeTipo(inventario, "fallo-silencioso");
  return porMetrica(c, sitios.length, sitios.slice(0, 3).map((s) => evidenciaArchivo(s.archivo, s.linea)));
}

export function evaluar(inventario: Inventario): CriterioDecidido[] {
  return [erroresEstructurados(inventario), nombranLaSalida(inventario), reintentableDistinguido(inventario), fallosVisibles(inventario)];
}
