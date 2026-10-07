// contrato: Informe + Inventario → Contrato. El diseño AX del repo objetivo, del que salen los dos
// generadores. Función pura: no lee disco ni sabe de plantillas ni lenguajes de destino
// más allá de cómo se invoca el CLI que los dos comparten.
import type { Atencion, Contrato, Informe, Inventario, InvocacionDelCli, Lenguaje, TransicionVedada, VerboDelContrato } from "../modelo/index.ts";
import { huellaDe } from "./huella.ts";
import { conImplementacion, dominioDe } from "./implementacion.ts";
import { vedadasDe } from "./vedadas.ts";
import { lecturasDe, slug, verbosDe } from "./verbos.ts";

export { cuerpoFirmado, huellaDe, jsonCanonico, sha256 } from "./huella.ts";

const CODIGOS: Contrato["codigos"] = {
  "0": "bien",
  "2": "uso incorrecto: corrige las entradas",
  "3": "error: lee el mensaje",
  "4": "el estado cambió desde la huella: vuelve a leer y a ensayar",
  "5": "hace falta una persona",
};

const CONVENCION =
  "programa ...argumentos verbo [posicionales en el orden de `posicion`, nunca empezando por «-»] " +
  "[--bandera=valor por cada entrada de texto o entero] [--bandera sola si un booleano es true; nada si es false] " +
  "[--bandera=valor repetida por cada elemento de una lista]. Siempre JSON por stdout, también los errores.";

export function generarContrato(informe: Informe, inventario: Inventario): Contrato {
  const vedadas = vedadasDe(inventario);
  const dominio = dominioDe(inventario);
  const verbos = conImplementacion(verbosDe(inventario, vedadas.length > 0), dominio);
  const lecturas = lecturasDe(inventario, verbos);
  const lenguaje = lenguajePrincipal(inventario);
  const sinHuella: Omit<Contrato, "huella"> = {
    esquema: 1,
    raiz: inventario.raiz,
    proyecto: { nombre: nombreDelProyecto(inventario), lenguaje },
    cli: invocacion(lenguaje === "python" ? "python" : "javascript"),
    lecturas,
    dominio,
    verbos,
    vedadas,
    codigos: CODIGOS,
    atiende: atencionesDe(informe, verbos, vedadas),
    notas: notasDe(inventario, verbos),
  };
  return { ...sinHuella, huella: huellaDe(sinHuella) };
}

function invocacion(lenguaje: "javascript" | "python"): InvocacionDelCli {
  const ruta = lenguaje === "python" ? "ax/cli.py" : "ax/cli.mjs";
  return {
    origen: "generado",
    generador: "axd generar cli",
    lenguaje,
    ruta,
    programa: lenguaje === "python" ? "python3" : "node",
    argumentos: [ruta],
    cwd: "raiz",
    salida: "json",
    banderas: { aplicar: "--aplicar", huella: "--huella" },
    convencion: CONVENCION,
  };
}

/** El lenguaje con más archivos de código; null si no hay código. */
function lenguajePrincipal(inventario: Inventario): Lenguaje | null {
  const orden = Object.entries(inventario.estructura.lenguajes).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return (orden[0]?.[0] as Lenguaje | undefined) ?? null;
}

function nombreDelProyecto(inventario: Inventario): string {
  const declarado = inventario.manifiestos.find((m) => m.nombre !== undefined)?.nombre;
  const nombre = slug((declarado ?? "").replace(/^@[^/]+\//, ""));
  return nombre === "" ? "repo" : nombre;
}

/** Qué hace el contrato con cada hallazgo del Informe que sabe atender; el resto no se lista. */
function atencionesDe(informe: Informe, verbos: readonly VerboDelContrato[], vedadas: readonly TransicionVedada[]): Atencion[] {
  const lectura = verbos.find((v) => v.tipo === "lectura")?.nombre;
  const escritura = verbos.filter((v) => v.tipo === "escritura");
  const entrega = escritura.find((v) => v.evidencia.exige.includes("evidencia"))?.nombre;
  const como = (criterio: string): string | undefined => {
    const [eje] = criterio.split("/");
    if (eje === "lectura-barata" && lectura !== undefined && !criterio.endsWith("/sin-cargar-la-app")) {
      return `La lectura «${lectura}» devuelve JSON con esquema y huella, con presupuesto de tokens en lecturas[].`;
    }
    if (eje === "errores-accionables") return "El CLI generado responde los errores en JSON con error, salida y reintentable, y sale con 2/3/4/5.";
    switch (criterio) {
      case "contrato-separado-de-la-vista/lectura-sin-la-vista":
      case "contrato-separado-de-la-vista/dominio-legible":
        return lectura !== undefined ? "Las lecturas salen del estado del dominio, no de la vista." : undefined;
      case "contrato-separado-de-la-vista/contrato-documentado":
        return "ax/contrato.json documenta verbos, entradas, salidas y errores.";
      case "verbos-estrechos/operaciones-con-nombre":
      case "verbos-estrechos/superficie-estrecha":
        return verbos.length > 0 ? `${verbos.length} verbos con nombre, uno por operación.` : undefined;
      case "verbos-estrechos/transiciones-con-dueno":
      case "verbos-estrechos/sin-autoaprobacion":
        return vedadas.length > 0 ? `${vedadas.length} transiciones vedadas al agente, con su dueño; no son verbos ni tools.` : undefined;
      case "verbos-estrechos/devuelve-estado-nuevo":
        return escritura.length > 0 ? "Los verbos de escritura devuelven estado_nuevo y huella." : undefined;
      case "escritura-verificada/huella-de-lectura":
      case "escritura-verificada/reintento-seguro":
        return escritura.length > 0 ? "Los verbos de escritura aceptan --huella y salen con 4 si el estado cambió." : undefined;
      case "escritura-verificada/ensayo-antes-de-escribir":
        return escritura.length > 0 ? "Los verbos de escritura son un ensayo sin --aplicar." : undefined;
      case "evidencia-y-trazabilidad/entrega-con-evidencia":
        return entrega !== undefined ? `«${entrega}» exige --evidencia.` : undefined;
      default:
        return undefined;
    }
  };
  return informe.hallazgos.flatMap((h): Atencion[] => {
    const texto = como(h.criterio);
    return texto === undefined ? [] : [{ criterio: h.criterio, resultado: h.resultado, como: texto }];
  });
}

function notasDe(inventario: Inventario, verbos: readonly VerboDelContrato[]): string[] {
  const notas = [
    "Lectura o escritura se decide por el nombre del verbo (o el método HTTP): revísalo antes de generar.",
    "Las entradas salen de las banderas vistas cerca de cada verbo y de los parámetros de sus rutas HTTP; lo que el código lee de otra forma no se ve.",
  ];
  if (verbos.length === 0) notas.push("No hay verbos: ni superficies en el código ni estado del dominio del que proponer una lectura.");
  if (inventario.superficies.api.length > 0 && (inventario.superficies.cli.length > 0 || inventario.superficies.mcp_tools.length > 0)) {
    notas.push("Las rutas HTTP solo completan a los verbos de CLI o MCP con el mismo nombre: no añaden verbos nuevos.");
  }
  for (const v of verbos) {
    if (v.implementacion.tipo === "sin-implementar") {
      notas.push(`«${v.nombre}» se genera como un verbo que sale con 5 y dice qué falta: ${v.implementacion.falta}`);
    }
  }
  if (verbos.some((v) => v.implementacion.tipo === "anexar")) {
    notas.push("Las escrituras anexan un registro a la bitácora del dominio (evento, entradas y fecha); no cambian otros archivos ni hacen transiciones vedadas.");
  }
  if (inventario.limites.truncado) notas.push("El análisis se cortó por tope de archivos: puede haber verbos que no se vieron.");
  return notas;
}
