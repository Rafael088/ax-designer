// Plantillas de ax/mcp/package.json y ax/mcp/README.md. El SDK de MCP es dependencia de este
// paquete del repo objetivo —nunca de axd—, y va en su propia carpeta para no tocar el
// package.json del repo, que no generó axd.
import type { Contrato } from "../../../modelo/index.ts";

/** La versión del SDK con la que se probó el servidor generado. */
export const VERSION_DEL_SDK = "^1.30.0";

export function nombreDelPaquete(contrato: Contrato): string {
  return `${contrato.proyecto.nombre}-ax-mcp`;
}

export function plantillaDePaquete(contrato: Contrato): string {
  const nombre = nombreDelPaquete(contrato);
  const paquete = {
    name: nombre,
    version: "0.0.0",
    private: true,
    description: `MCP server de ${contrato.proyecto.nombre}: envuelve al CLI de AX (${contrato.cli.ruta}), una tool por verbo del contrato.`,
    type: "module",
    bin: { [nombre]: "servidor.mjs" },
    scripts: { start: "node servidor.mjs" },
    engines: { node: ">=20" },
    dependencies: { "@modelcontextprotocol/sdk": VERSION_DEL_SDK },
  };
  return JSON.stringify(paquete, null, 2) + "\n";
}

function celda(texto: string): string {
  return texto.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function plantillaDeLeeme(contrato: Contrato, rutaDelServidor: string): string {
  const nombre = nombreDelPaquete(contrato);
  const filas = contrato.verbos.map((v) => {
    const entradas = v.entradas.map((e) => `${e.nombre}${e.requerida ? "*" : ""}`).join(", ") || "—";
    return `| \`${v.nombre}\` | ${v.tipo} | ${entradas} | ${celda(v.descripcion)} |`;
  });
  const vedadas = contrato.vedadas.map((v) => `- \`${v.nombre}\`: ${v.que} ${v.motivo}`);
  const config = { mcpServers: { [contrato.proyecto.nombre]: { command: "node", args: [rutaDelServidor] } } };
  return [
    `# ${nombre}`,
    "",
    `MCP server de **${contrato.proyecto.nombre}**, generado por \`axd generar mcp\` desde el contrato`,
    `\`${contrato.huella.slice(0, 12)}\` (\`ax/contrato.json\`). Envuelve al CLI de AX: cada tool llama a`,
    `\`${[contrato.cli.programa, ...contrato.cli.argumentos].join(" ")} <verbo>\` en la raíz del repo y devuelve su JSON;`,
    "los errores llegan con `error`, `salida` y `reintentable`.",
    "",
    "## Ponerlo en marcha",
    "",
    "```sh",
    "cd ax/mcp && npm install     # trae @modelcontextprotocol/sdk, la única dependencia",
    "```",
    "",
    `El CLI tiene que existir en \`${contrato.cli.ruta}\` (lo crea \`axd generar cli --aplicar\`); si no, cada tool`,
    "contesta con un error que lo dice.",
    "",
    "Y regístralo en el `.mcp.json` del repo (o en la configuración de tu cliente):",
    "",
    "```json",
    JSON.stringify(config, null, 2),
    "```",
    "",
    "## Tools",
    "",
    "Una por verbo del contrato. `*` es una entrada requerida. Las de escritura son un ensayo hasta que",
    "se pasa `aplicar: true`; pásales la `huella` de la última lectura.",
    "",
    "| Tool | Tipo | Entradas | Qué hace |",
    "| --- | --- | --- | --- |",
    ...filas,
    "",
    "## Lo que no es una tool",
    "",
    vedadas.length > 0 ? "Estas transiciones son de una persona y no se exponen a propósito:" : "El contrato no veda ninguna transición.",
    "",
    ...vedadas,
    "",
    "## Cambiarlo",
    "",
    "No edites estos archivos: `axd generar` se niega a pisar lo que cambió a mano. Si el repo cambió,",
    "mira el contrato nuevo con `axd contrato` y vuelve a correr `axd generar mcp --aplicar`.",
    "",
  ].join("\n");
}
