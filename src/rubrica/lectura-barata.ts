// Eje 1 — Lectura barata: ¿puede el agente conocer el estado en una llamada, en formato de
// máquina y en milisegundos? Los seis criterios giran alrededor del mismo hallazgo: el camino de
// resumen (un verbo, un endpoint, una tool de MCP, o en su defecto un archivo de estado del
// dominio con nombre de resumen). Si no hay camino de resumen, los otros cuatro de inventario
// salen no-aplica: no hay nada que describir.
import type { CriterioDecidido, Inventario, Manejador, Medicion, Ruta } from "../modelo/index.ts";
import { contarTokens } from "../medicion/index.ts";
import {
  criterioJson, cumple, evidenciaArchivo, evidenciaAusencia, evidenciaMedicion,
  haySenalEnElVerbo, noAplica, noCumple, parcial, porMetrica, sinEvidencia,
} from "./comun.ts";

const EJE = "lectura-barata";
const NOMBRE_RESUMEN = /^(estado|status|resumen|contexto|summary)$/i;

export type Resumen =
  | { tipo: "verbo"; nombre: string; archivo: Ruta; linea: number; manejador?: Manejador | undefined }
  | { tipo: "archivo"; ruta: Ruta; formato: string; caracteres: number; claves: string[] | undefined };

/** El camino de solo lectura al estado resumido: un verbo con nombre de estado, o el archivo de
 *  estado del dominio que más se le parece. Verbos primero: son lo que de verdad llama un agente.
 *  La usa también contexto-progresivo, para no duplicar la misma heurística en dos ejes. */
export function buscarResumen(inventario: Inventario): Resumen | undefined {
  const verbo = inventario.superficies.cli.find((v) => NOMBRE_RESUMEN.test(v.nombre));
  if (verbo) return { tipo: "verbo", nombre: verbo.nombre, archivo: verbo.archivo, linea: verbo.linea, manejador: verbo.manejador };
  const api = inventario.superficies.api.find((r) => NOMBRE_RESUMEN.test(ultimoSegmento(r.ruta)));
  if (api) return { tipo: "verbo", nombre: api.ruta, archivo: api.archivo, linea: api.linea };
  const tool = inventario.superficies.mcp_tools.find((t) => NOMBRE_RESUMEN.test(t.nombre));
  if (tool) return { tipo: "verbo", nombre: tool.nombre, archivo: tool.archivo, linea: tool.linea };
  const archivo = inventario.estado.find((e) => e.rol === "dominio" && NOMBRE_RESUMEN.test(nombreSinExtension(e.ruta)));
  if (archivo) return { tipo: "archivo", ruta: archivo.ruta, formato: archivo.formato, caracteres: archivo.caracteres, claves: archivo.claves };
  return undefined;
}

function ultimoSegmento(ruta: string): string {
  return ruta.split("/").filter(Boolean).pop() ?? "";
}

function nombreSinExtension(ruta: Ruta): string {
  return (ruta.split("/").pop() ?? ruta).replace(/\.[^.]+$/, "");
}

function nombreDe(resumen: Resumen): string {
  return resumen.tipo === "verbo" ? resumen.nombre : resumen.ruta;
}

function mencionadoEnGuias(inventario: Inventario, resumen: Resumen): boolean {
  const palabra = resumen.tipo === "verbo" ? resumen.nombre : nombreSinExtension(resumen.ruta);
  return inventario.guias.some((g) => g.contenido.includes(palabra) || g.comandos.some((cmd) => cmd.texto.includes(palabra)));
}

function resumenExiste(inventario: Inventario, resumen: Resumen | undefined): CriterioDecidido {
  const c = criterioJson(EJE, "resumen-existe");
  if (resumen === undefined) {
    return noCumple(c, "No hay un verbo, endpoint, tool ni archivo de estado con nombre de resumen.", [
      evidenciaAusencia(
        "verbo, endpoint o tool con nombre estado, status, resumen, contexto o summary, o un archivo de estado del dominio con ese nombre",
        "superficies.cli, superficies.api, superficies.mcp_tools y estado[] del Inventario",
      ),
    ]);
  }
  const ev = resumen.tipo === "verbo" ? evidenciaArchivo(resumen.archivo, resumen.linea) : evidenciaArchivo(resumen.ruta, 1);
  if (mencionadoEnGuias(inventario, resumen)) return cumple(c, `«${nombreDe(resumen)}» existe y lo nombra una guía o el README.`, [ev]);
  return parcial(c, `«${nombreDe(resumen)}» existe pero solo se descubre leyendo el código.`, [ev]);
}

function formatoDeMaquina(inventario: Inventario, resumen: Resumen | undefined): CriterioDecidido {
  const c = criterioJson(EJE, "formato-de-maquina");
  if (resumen === undefined) return noAplica(c, "No existe camino de resumen.");
  if (resumen.tipo === "archivo") {
    const ev = evidenciaArchivo(resumen.ruta, 1);
    if (resumen.formato === "json" || resumen.formato === "jsonl" || resumen.formato === "yaml" || resumen.formato === "toml") {
      return cumple(c, `El archivo de resumen es ${resumen.formato}.`, [ev]);
    }
    if (resumen.formato === "csv") return parcial(c, "El archivo de resumen es CSV: tabular, sin claves con nombre.", [ev]);
    return noCumple(c, `El archivo de resumen es ${resumen.formato}, no un formato de máquina.`, [ev]);
  }
  const serializa = haySenalEnElVerbo(inventario, resumen, ["serializa-json"]);
  if (serializa) return cumple(c, "Serializa JSON cerca de donde se declara el verbo de resumen.", [evidenciaArchivo(serializa.archivo, serializa.linea)]);
  // Un CLI que imprime en un solo sitio (`imprimir(resultado)` con JSON.stringify) y cuyos
  // manejadores solo arman el objeto: si el del resumen arma uno con clave de esquema y el mismo
  // archivo serializa JSON, la salida por defecto es JSON aunque no se vea junto al verbo.
  const versionado = resumen.manejador !== undefined ? haySenalEnElVerbo(inventario, resumen, ["clave-de-esquema"]) : undefined;
  const archivoDelManejador = resumen.manejador?.archivo ?? resumen.archivo;
  const serializaciones = inventario.senales.filter((s) => s.tipo === "serializa-json" && s.archivo === archivoDelManejador);
  const central = serializaciones.find((s) => /JSON\.stringify|json\.dumps?/.test(s.texto)) ?? serializaciones[0];
  if (versionado && central) {
    return cumple(c, "El manejador del resumen arma un objeto con clave de esquema y el archivo lo serializa a JSON en un solo sitio.", [
      evidenciaArchivo(versionado.archivo, versionado.linea), evidenciaArchivo(central.archivo, central.linea),
    ]);
  }
  const conJson = inventario.superficies.banderas.find((b) => b.archivo === resumen.archivo)?.banderas.includes("--json") ?? false;
  if (conJson) return parcial(c, "Solo sale en JSON con --json.", [evidenciaArchivo(resumen.archivo, resumen.linea)]);
  return noCumple(c, "No se ve una serialización JSON cerca del verbo de resumen.", [
    evidenciaAusencia("JSON.stringify, json.dumps o --format json cerca del verbo", `${resumen.archivo} desde la línea ${resumen.linea}`),
  ]);
}

function esquemaVersionado(inventario: Inventario, resumen: Resumen | undefined): CriterioDecidido {
  const c = criterioJson(EJE, "esquema-versionado");
  if (resumen === undefined) return noAplica(c, "No existe camino de resumen.");
  const reglaEscrita = inventario.guias.some((g) => /no se renombran|se agregan.{0,20}claves|esquema versionado/i.test(g.contenido));
  if (resumen.tipo === "archivo") {
    const tieneClave = resumen.claves?.some((k) => /^(esquema|schema|version|schema_?version)$/i.test(k)) ?? false;
    if (!tieneClave) return noCumple(c, "El archivo de resumen no declara una clave de esquema o versión.", [evidenciaAusencia("clave esquema, schema o version", resumen.ruta)]);
    const ev = evidenciaArchivo(resumen.ruta, 1);
    return reglaEscrita
      ? cumple(c, "Declara su versión y una guía da la regla de evolución.", [ev])
      : parcial(c, "Declara su versión, sin una regla de evolución escrita.", [ev]);
  }
  const senal = haySenalEnElVerbo(inventario, resumen, ["clave-de-esquema"]);
  if (senal === undefined) {
    return noCumple(c, "No hay una clave de esquema serializada cerca del verbo de resumen.", [
      evidenciaAusencia("clave esquema, schema o version serializada cerca del verbo", `${resumen.archivo} desde la línea ${resumen.linea}`),
    ]);
  }
  const ev = evidenciaArchivo(senal.archivo, senal.linea);
  return reglaEscrita
    ? cumple(c, "Declara su versión y una guía da la regla de evolución.", [ev])
    : parcial(c, "Declara su versión, sin una regla de evolución escrita.", [ev]);
}

function costoDelResumen(medicion: Medicion, resumen: Resumen | undefined): CriterioDecidido {
  const c = criterioJson(EJE, "costo-del-resumen");
  if (resumen === undefined) return noAplica(c, "No existe camino de resumen.");
  if (resumen.tipo === "verbo") {
    return sinEvidencia(c, `«${resumen.nombre}» es un verbo: medir lo que imprime exige correrlo (axd validar --correr).`);
  }
  const tokens = contarTokens(resumen.caracteres);
  return porMetrica(c, tokens, [evidenciaMedicion("resumen (archivo)", tokens, [resumen.ruta])]);
}

function ahorroFrenteAlCaminoCaro(medicion: Medicion): CriterioDecidido {
  const c = criterioJson(EJE, "ahorro-frente-al-camino-caro");
  const { tokens_camino_caro: caro, tokens_resumen: barato, razon_caro_barato: razon } = medicion.metricas;
  if (caro === null) return noAplica(c, "El analizador no encontró archivos de estado del dominio que medir.");
  if (caro < 500) return noAplica(c, `El estado del dominio entero cabe en ${caro} tokens: no hay nada que abaratar.`);
  const caminoCaro = medicion.caminos.find((cm) => cm.id === "estado-dominio");
  if (razon === null || barato === null) {
    return noCumple(c, `No hay camino barato: el camino caro cuesta ${caro} tokens.`, [evidenciaMedicion("estado-dominio", caro, caminoCaro?.archivos)]);
  }
  return porMetrica(c, razon, [evidenciaMedicion("estado-dominio / resumen", razon, caminoCaro?.archivos)]);
}

function sinCargarLaApp(inventario: Inventario, resumen: Resumen | undefined): CriterioDecidido {
  const c = criterioJson(EJE, "sin-cargar-la-app");
  if (resumen === undefined) return noAplica(c, "No existe camino de resumen.");
  if (resumen.tipo === "archivo") return cumple(c, "Es un archivo de datos: leerlo no carga nada de interfaz.", [evidenciaArchivo(resumen.ruta, 1)]);
  const hayInterfazEnElRepo = inventario.senales.some((s) => s.tipo === "importa-interfaz");
  if (!hayInterfazEnElRepo) return noAplica(c, "El proyecto no tiene interfaz.");
  const directa = inventario.senales.find((s) => s.tipo === "importa-interfaz" && s.archivo === resumen.archivo);
  if (directa !== undefined) return noCumple(c, "El módulo del verbo de resumen importa la interfaz.", [evidenciaArchivo(directa.archivo, directa.linea)]);
  const modulo = inventario.modulos.find((m) => m.ruta === resumen.archivo);
  const indirecta = (modulo?.imports_locales ?? []).flatMap((ruta) => inventario.senales.filter((s) => s.tipo === "importa-interfaz" && s.archivo === ruta));
  if (indirecta.length > 0) return parcial(c, "El resumen no importa la interfaz directo, pero algo que importa sí.", [evidenciaArchivo(indirecta[0]!.archivo, indirecta[0]!.linea)]);
  return cumple(c, "Ni el módulo del resumen ni lo que importa traen la interfaz.", [evidenciaArchivo(resumen.archivo, resumen.linea)]);
}

export function evaluar(inventario: Inventario, medicion: Medicion): CriterioDecidido[] {
  const resumen = buscarResumen(inventario);
  return [
    resumenExiste(inventario, resumen),
    formatoDeMaquina(inventario, resumen),
    esquemaVersionado(inventario, resumen),
    costoDelResumen(medicion, resumen),
    ahorroFrenteAlCaminoCaro(medicion),
    sinCargarLaApp(inventario, resumen),
  ];
}
