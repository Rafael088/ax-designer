// generar cli: Contrato → el CLI de verbos estrechos del repo objetivo, en `contrato.cli.ruta`
// (ax/cli.mjs con node, o ax/cli.py con python3), más ax/contrato.json y ax/cli.md. Es el CLI que
// envuelve el MCP generado: un verbo por verbo del contrato, con su implementación
// sobre el estado del dominio; las transiciones vedadas no son verbos. Lo generado no tiene
// dependencias: solo node:* o la biblioteca estándar de Python.
import type { Contrato, Implementacion } from "../../modelo/index.ts";
import { ErrorAx } from "../../modelo/index.ts";
import { archivoDelContrato } from "../contrato-en-el-repo.ts";
import { CARPETA_GENERADA, type ArchivoGenerado } from "../escritor.ts";
import { datosDelCli } from "./plantillas/datos.ts";
import { plantillaCliNode } from "./plantillas/node.ts";
import { plantillaCliPython } from "./plantillas/python.ts";

export { datosDelCli, type DatosDelCli } from "./plantillas/datos.ts";

export const RUTA_DEL_LEEME_DEL_CLI = `${CARPETA_GENERADA}/cli.md`;

function celda(texto: string): string {
  return texto.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function queHace(impl: Implementacion): string {
  switch (impl.tipo) {
    case "resumen":
      return "Resume cada fuente del dominio (claves, colecciones, registros, últimos de la bitácora) dentro de su presupuesto.";
    case "listar":
      return `Lista los registros de \`${impl.coleccion}\`${impl.filtros.length > 0 ? `, filtrando por ${impl.filtros.map((f) => `\`${f}\``).join(", ")}` : ""}.`;
    case "leer":
      return `Lee el registro de \`${impl.coleccion}\` cuyo \`${impl.campo}\` es la entrada \`${impl.entrada}\`.`;
    case "buscar":
      return `Busca el texto de \`${impl.entrada}\` en los registros de \`${impl.coleccion}\`.`;
    case "anexar":
      return `Anexa a \`${impl.destino}\` un registro \`${impl.evento}\` con ${impl.campos.length > 0 ? impl.campos.map((c) => `\`${c}\``).join(", ") + " y " : ""}la fecha${impl.existe ? `, si existe en \`${impl.existe.coleccion}\` un registro con ese \`${impl.existe.campo}\`` : ""}.`;
    case "http":
      return `Llama a \`${impl.metodo} ${impl.ruta}\` en la URL base${impl.cuerpo !== null ? ` con \`--cuerpo\` como JSON${impl.cuerpo.forma === null ? " (sin validar: no se supo su forma)" : ` (campos de \`${impl.cuerpo.forma.nombre}\`)`}` : ""}.`;
    case "sin-implementar":
      return `**Sin implementar: sale con 5.** Falta: ${impl.falta}`;
  }
}

function plantillaDeLeemeDelCli(contrato: Contrato): string {
  const programa = [contrato.cli.programa, ...contrato.cli.argumentos].join(" ");
  const filas = contrato.verbos.map((v) => {
    const entradas = v.entradas.map((e) => (e.como === "posicional" ? `<${e.nombre}>` : e.bandera!) + (e.requerida ? "*" : "")).join(" ") || "—";
    return `| \`${v.nombre}\` | ${v.tipo} | ${celda(entradas)} | ${celda(queHace(v.implementacion))} |`;
  });
  const pendientes = contrato.verbos.filter((v) => v.implementacion.tipo === "sin-implementar");
  const lectura = contrato.verbos.find((v) => v.implementacion.tipo === "resumen") ?? contrato.verbos.find((v) => v.tipo === "lectura");
  const escritura = contrato.verbos.find((v) => v.implementacion.tipo === "anexar");
  const escrituraHttp = contrato.verbos.find((v) => v.implementacion.tipo === "http" && v.tipo === "escritura");
  const conRequeridas = (v: (typeof contrato.verbos)[number]) =>
    v.entradas.filter((e) => e.requerida).map((e) => (e.como === "posicional" ? `<${e.nombre}>` : `${e.bandera}=<${e.nombre}>`)).join(" ");
  const ejemplo = [
    ...(lectura !== undefined ? [`${programa} ${lectura.nombre}`] : []),
    ...(escritura !== undefined ? [`${programa} ${escritura.nombre} ${escritura.entradas.filter((e) => e.requerida).map((e) => (e.como === "posicional" ? `<${e.nombre}>` : `${e.bandera}=<${e.nombre}>`)).join(" ")}`.trimEnd() + "            # ensayo", `${programa} ${escritura.nombre} … --aplicar --huella=<huella de la lectura>`] : []),
    ...(escrituraHttp !== undefined ? [`${programa} ${escrituraHttp.nombre} ${conRequeridas(escrituraHttp)}`.trimEnd() + "            # ensayo: dice qué petición haría", `${programa} ${escrituraHttp.nombre} … --aplicar`] : []),
  ];
  const http = contrato.http === undefined
    ? []
    : [
      `- Los verbos que llaman a la API HTTP del repo usan la URL base de \`${contrato.http.base_url.variable}\` (por defecto \`${contrato.http.base_url.por_defecto}\`, ${contrato.http.base_url.motivo}): el servidor tiene que estar levantado. Cada respuesta se espera hasta \`${contrato.http.espera_ms.variable}\` ms (por defecto ${contrato.http.espera_ms.por_defecto}).`,
      "- Por HTTP: 400/422 (y 404 de un parámetro) salen con 2, 401/403 con 5, 409/412 con 4, y si no responde, 5xx o 429 con 3 reintentable. El JSON trae `peticion`, `estado` (el HTTP) y `respuesta`.",
    ];
  return [
    `# CLI de AX de ${contrato.proyecto.nombre}`,
    "",
    `Generado por \`axd generar cli\` desde el contrato \`${contrato.huella.slice(0, 12)}\` (\`ax/contrato.json\`). Un verbo por`,
    "verbo del contrato, sin dependencias, con JSON por stdout (`\"esquema\": 1`), también en los errores",
    "(`error`, `salida`, `reintentable`). El MCP de `ax/mcp/` lo envuelve: cada tool llama a un verbo.",
    "",
    "```sh",
    `${programa} --help`,
    ...ejemplo,
    "```",
    "",
    "- Se corre desde la raíz del repo; las entradas van como posicionales y `--bandera=valor` (sin espacio), los booleanos solos.",
    `- Las escrituras son un ensayo hasta \`--aplicar\`. Con \`--huella\` (la que devuelve cualquier lectura) salen con 4 si el estado cambió.`,
    "- Escriben con reemplazo atómico (temporal y rename) y devuelven `estado_nuevo` y la `huella` nueva; repetir la misma escritura no cambia nada.",
    ...http,
    `- Códigos: ${Object.entries(contrato.codigos).map(([c, d]) => `\`${c}\` ${d}`).join(" · ")}.`,
    "",
    "## Verbos",
    "",
    "`*` es una entrada requerida.",
    "",
    "| Verbo | Tipo | Entradas | Qué hace |",
    "| --- | --- | --- | --- |",
    ...filas,
    "",
    `La huella: ${contrato.dominio.huella} Fuentes: ${contrato.dominio.fuentes.map((f) => `\`${f.ruta}\``).join(", ") || "ninguna"}.`,
    "",
    ...(pendientes.length > 0
      ? [
        "## Lo que no se pudo implementar",
        "",
        "El contrato no da información suficiente para estos verbos: existen para que el agente reciba un error",
        "accionable (código 5 y su `salida`) en vez de un stub que finja que funcionó.",
        "",
        ...pendientes.map((v) => `- \`${v.nombre}\`: ${v.implementacion.tipo === "sin-implementar" ? `${v.implementacion.falta} ${v.implementacion.salida}` : ""}`),
        "",
      ]
      : []),
    "## Lo que no es un verbo",
    "",
    contrato.vedadas.length > 0 ? "Estas transiciones son de una persona; si se piden por nombre, el CLI sale con 5:" : "El contrato no veda ninguna transición.",
    "",
    ...contrato.vedadas.map((v) => `- \`${v.nombre}\`: ${v.que} ${v.motivo}`),
    "",
    "## Cambiarlo",
    "",
    "No edites estos archivos: `axd generar` se niega a pisar lo que cambió a mano. Si el repo cambió, mira",
    "el contrato nuevo con `axd contrato` y vuelve a correr `axd generar cli --aplicar`.",
    "",
  ].join("\n");
}

export function archivosCli(contrato: Contrato): ArchivoGenerado[] {
  if (contrato.verbos.length === 0) {
    throw new ErrorAx("El contrato no tiene verbos: no hay ningún verbo que implementar.", {
      codigo: 5,
      salida: "Revisa `axd contrato` y sus notas: hace falta que el repo exponga algún verbo o tenga estado del dominio del que proponer la lectura.",
    });
  }
  const datos = datosDelCli(contrato);
  const python = contrato.cli.lenguaje === "python";
  const pendientes = contrato.verbos.filter((v) => v.implementacion.tipo === "sin-implementar").length;
  return [
    archivoDelContrato(contrato),
    {
      ruta: contrato.cli.ruta,
      contenido: python ? plantillaCliPython(datos) : plantillaCliNode(datos),
      comentario: python ? "#" : "//",
      motivo: `El CLI de los ${contrato.verbos.length} verbos del contrato (${python ? "python3, solo biblioteca estándar" : "node, solo node:*"})` +
        (pendientes > 0 ? `; ${pendientes} sale(n) con 5 porque el contrato no dice cómo implementarlos.` : "."),
    },
    { ruta: RUTA_DEL_LEEME_DEL_CLI, contenido: plantillaDeLeemeDelCli(contrato), comentario: "html", motivo: "Cómo se usa el CLI, qué hace cada verbo y qué no se pudo implementar." },
  ];
}
