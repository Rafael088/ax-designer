// generar mcp: Contrato → archivos de ax/mcp/. Un MCP server por stdio que envuelve al CLI que
// declara el contrato: una tool por verbo, con el inputSchema sacado de sus entradas;
// las transiciones vedadas no son tools. El SDK de MCP es dependencia de ax/mcp/package.json, en
// el repo objetivo; axd no lo importa nunca.
import type { Contrato, EntradaDelVerbo, VerboDelContrato } from "../../modelo/index.ts";
import { ErrorAx } from "../../modelo/index.ts";
import { archivoDelContrato } from "../contrato-en-el-repo.ts";
import { CARPETA_GENERADA, type ArchivoGenerado } from "../escritor.ts";
import { plantillaDeHerramientas } from "./plantillas/herramientas.ts";
import { nombreDelPaquete, plantillaDeLeeme, plantillaDePaquete } from "./plantillas/paquete.ts";
import { plantillaDeServidor } from "./plantillas/servidor.ts";

export { RUTA_DEL_CONTRATO, contratoParaElRepo } from "../contrato-en-el-repo.ts";

export const CARPETA_MCP = `${CARPETA_GENERADA}/mcp`;

const TIPO_JSON: Record<EntradaDelVerbo["tipo"], string> = { texto: "string", entero: "integer", booleano: "boolean", lista: "array" };

/** El inputSchema de la tool: un JSON Schema con una propiedad por entrada del verbo. */
export function esquemaDeEntrada(verbo: VerboDelContrato): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const e of verbo.entradas) {
    properties[e.nombre] = e.tipo === "lista"
      ? { type: "array", items: { type: "string" }, description: e.descripcion }
      : { type: TIPO_JSON[e.tipo], description: e.descripcion };
  }
  return { type: "object", properties, required: verbo.entradas.filter((e) => e.requerida).map((e) => e.nombre), additionalProperties: false };
}

function descripcionDeTool(verbo: VerboDelContrato): string {
  const partes = [verbo.descripcion];
  if (verbo.ensayo_por_defecto) {
    partes.push(verbo.implementacion.tipo === "http" ? "Sin aplicar=true es un ensayo que dice qué petición haría." : "Sin aplicar=true es un ensayo; pasa la huella de la última lectura.");
  }
  if (verbo.evidencia.exige.length > 0) partes.push(`Exige ${verbo.evidencia.exige.join(", ")}.`);
  const reintento = verbo.errores.find((e) => e.reintentable);
  if (reintento !== undefined) partes.push(`Si sale con ${reintento.codigo}: ${reintento.salida}`);
  return partes.join(" ");
}

function herramientaDe(verbo: VerboDelContrato) {
  return {
    nombre: verbo.nombre,
    tipo: verbo.tipo,
    /** Llama a un servidor HTTP: lo que pasa ahí no lo controla el repo (openWorldHint). */
    abierta: verbo.implementacion.tipo === "http",
    descripcion: descripcionDeTool(verbo),
    argv: verbo.argv,
    entradas: verbo.entradas.map(({ nombre, tipo, requerida, descripcion, como, posicion, bandera }) => ({ nombre, tipo, requerida, descripcion, como, posicion, bandera })),
    esquema: esquemaDeEntrada(verbo),
  };
}

function instrucciones(contrato: Contrato): string {
  const lectura = contrato.lecturas.find((l) => l.presupuesto_tokens === Math.min(...contrato.lecturas.map((x) => x.presupuesto_tokens)));
  const partes = [`Tools de ${contrato.proyecto.nombre}, una por verbo de su contrato de AX (ax/contrato.json); cada una corre su CLI y devuelve JSON.`];
  if (lectura !== undefined) partes.push(`Empieza por «${lectura.verbo}»: es la lectura barata y trae la huella.`);
  if (contrato.verbos.some((v) => v.ensayo_por_defecto && v.implementacion.tipo !== "http")) {
    partes.push("Las de escritura son un ensayo hasta que pases aplicar=true; pásales la huella de la última lectura y, si salen con 4, vuelve a leer.");
  } else if (contrato.verbos.some((v) => v.ensayo_por_defecto)) {
    partes.push("Las de escritura son un ensayo hasta que pases aplicar=true; si salen con 4, vuelve a leer.");
  }
  if (contrato.http !== undefined) partes.push(`Las tools llaman a la API HTTP del repo en ${contrato.http.base_url.variable} (por defecto ${contrato.http.base_url.por_defecto}): si salen con 3 reintentable, comprueba que el servidor está levantado.`);
  if (contrato.vedadas.length > 0) partes.push(`No hay tools para ${contrato.vedadas.map((v) => v.nombre).join(", ")}: son de una persona.`);
  return partes.join(" ");
}

export function archivosMcp(contrato: Contrato): ArchivoGenerado[] {
  if (contrato.verbos.length === 0) {
    throw new ErrorAx("El contrato no tiene verbos: no hay ninguna tool que exponer.", {
      codigo: 5,
      salida: "Revisa `axd contrato` y sus notas: hace falta que el repo exponga algún verbo o tenga estado del dominio del que proponer la lectura.",
    });
  }
  const datos = {
    nombre: nombreDelPaquete(contrato),
    version: `0.0.0+${contrato.huella.slice(0, 12)}`,
    contrato: contrato.huella,
    hasta_la_raiz: "../..",
    cli: { programa: contrato.cli.programa, argumentos: contrato.cli.argumentos, ruta: contrato.cli.ruta },
    herramientas: contrato.verbos.map(herramientaDe),
    vedadas: contrato.vedadas.map(({ nombre, que, motivo }) => ({ nombre, que, motivo })),
    instrucciones: instrucciones(contrato),
  };
  return [
    archivoDelContrato(contrato),
    { ruta: `${CARPETA_MCP}/herramientas.mjs`, contenido: plantillaDeHerramientas(datos), comentario: "//", motivo: `Las ${contrato.verbos.length} tools (una por verbo) y la traducción de sus argumentos a argv del CLI.` },
    { ruta: `${CARPETA_MCP}/servidor.mjs`, contenido: plantillaDeServidor(), comentario: "//", motivo: "El MCP server por stdio que cablea el SDK con las tools." },
    { ruta: `${CARPETA_MCP}/package.json`, contenido: plantillaDePaquete(contrato), comentario: "json", motivo: "Declara @modelcontextprotocol/sdk como dependencia del MCP, aparte del package.json del repo." },
    { ruta: `${CARPETA_MCP}/README.md`, contenido: plantillaDeLeeme(contrato, `${CARPETA_MCP}/servidor.mjs`), comentario: "html", motivo: "Cómo instalarlo y registrarlo, y qué tools hay y cuáles no." },
  ];
}
