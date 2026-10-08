// estado: el camino barato de «cómo está este repo respecto a axd». Junta lo que ya calculan los
// otros pasos (la puntuación del informe y la huella del contrato) con lo que hay en disco (lo
// generado en ax/ y las corridas en .ax-corridas/), y dice el siguiente paso. No escribe ni gasta:
// lee a través del Lector, como el analizador, y deja fuera todo lo que no quepa en < 1k tokens
// (los hallazgos completos son de `axd auditar`).
import type { Lector } from "../analizador/index.ts";
import { CARPETA_DE_CORRIDAS, CARPETA_GENERADA, leerCabecera } from "../generadores/index.ts";
import type { Contrato, Informe, Ruta } from "../modelo/index.ts";

/** Cuántas rutas se nombran como mucho en cada lista: el resto va solo en la cuenta. */
const MAX_RUTAS = 5;

export type Estado = {
  raiz: string;
  auditoria: {
    puntuacion_global: number | null;
    ejes: { numero: number; id: string; puntuacion: number | null; nivel: string | null }[];
    /** Los criterios críticos en parcial o no-cumple, `eje/criterio (resultado)`. */
    criticos: string[];
    hallazgos: number;
  };
  contrato: { huella: string; verbos: number };
  generados: {
    archivos: number;
    cli: boolean;
    mcp: boolean;
    /** true si todo lo generado lleva la huella del contrato actual; null si no hay nada generado. */
    al_dia: boolean | null;
    de_otro_contrato: number;
    editados_a_mano: Ruta[];
  };
  corridas: { total: number; ultima: Ruta | null };
  salida: string;
};

type Generado = { ruta: Ruta; contrato: string; intacto: boolean };

/** Si `carpeta` (un solo nivel bajo la raíz) existe y es una carpeta de verdad: se mira en la
 *  lista de la raíz en vez de capturar el ENOENT, para que un fallo de lectura no se calle. */
function hayCarpeta(lector: Lector, carpeta: string): boolean {
  return lector.listar("").some((e) => e.nombre === carpeta && e.tipo === "carpeta");
}

/** Los archivos de ax/ con la cabecera de axd. Salta node_modules (el MCP instalado) y lo ajeno.
 *  Un archivo que no se puede leer no se esconde: sale como error de axd (código 3). */
function generadosEn(lector: Lector): Generado[] {
  if (!hayCarpeta(lector, CARPETA_GENERADA)) return [];
  const hallados: Generado[] = [];
  const pendientes: Ruta[] = [CARPETA_GENERADA];
  while (pendientes.length > 0) {
    const carpeta = pendientes.shift()!;
    for (const e of lector.listar(carpeta)) {
      const ruta = `${carpeta}/${e.nombre}`;
      if (e.tipo === "carpeta" && e.nombre !== "node_modules") pendientes.push(ruta);
      if (e.tipo !== "archivo") continue;
      const cabecera = leerCabecera(lector.leer(ruta));
      if (cabecera !== undefined) hallados.push({ ruta, ...cabecera });
    }
  }
  return hallados;
}

/** Las corridas guardadas, ordenadas por nombre (empiezan por la fecha): la última es la más nueva. */
function corridasEn(lector: Lector): Ruta[] {
  if (!hayCarpeta(lector, CARPETA_DE_CORRIDAS)) return [];
  return lector
    .listar(CARPETA_DE_CORRIDAS)
    .filter((e) => e.tipo === "archivo" && e.nombre.endsWith(".json"))
    .map((e) => `${CARPETA_DE_CORRIDAS}/${e.nombre}`);
}

function siguientePaso(raiz: string, g: Estado["generados"], editados: number, corridas: Estado["corridas"], criticos: string[]): string {
  const urgente = criticos.length > 0 ? ` Lo más urgente de la rúbrica: ${criticos[0]}; \`axd auditar ${raiz} --formato md\` da el detalle.` : "";
  if (editados > 0) {
    return `Hay ${editados} archivo(s) de ${CARPETA_GENERADA}/ editados a mano: axd generar no los pisa (sale con 5). Una persona decide si se borran o si el cambio va al contrato.${urgente}`;
  }
  if (g.archivos === 0) return `No hay nada generado: \`axd generar cli ${raiz}\` es el ensayo de lo que crearía.${urgente}`;
  if (g.al_dia === false) {
    const regenerar = [g.cli ? `\`axd generar cli ${raiz}\`` : undefined, g.mcp ? `\`axd generar mcp ${raiz}\`` : undefined].filter(Boolean).join(" y luego ");
    return `Lo generado salió de un contrato que ya no es el actual: ${regenerar} ensaya regenerarlo.${urgente}`;
  }
  if (corridas.total === 0) return `Lo generado está al día. Para medir si le sirve a un agente: \`axd validar ${raiz} --tareas <archivo>\` (ensayo, no gasta).${urgente}`;
  return `Lo generado está al día y la última corrida está en ${corridas.ultima}.${urgente || ` Sin críticos pendientes: \`axd auditar ${raiz} --formato md\` para el resto.`}`;
}

export function estadoDe(lector: Lector, informe: Informe, contrato: Contrato): Estado {
  const criticos = informe.hallazgos.filter((h) => h.critico).map((h) => `${h.criterio} (${h.resultado})`);
  const auditoria = {
    puntuacion_global: informe.puntuacion_global,
    ejes: informe.ejes.map((e) => ({ numero: e.numero, id: e.id, puntuacion: e.puntuacion, nivel: e.nombre_nivel })),
    criticos,
    hallazgos: informe.hallazgos.length,
  };
  const archivos = generadosEn(lector);
  const deOtro = archivos.filter((a) => a.contrato !== contrato.huella).length;
  const editados = archivos.filter((a) => !a.intacto).map((a) => a.ruta);
  const generados = {
    archivos: archivos.length,
    cli: archivos.some((a) => !a.ruta.startsWith(`${CARPETA_GENERADA}/mcp/`)),
    mcp: archivos.some((a) => a.ruta.startsWith(`${CARPETA_GENERADA}/mcp/`)),
    al_dia: archivos.length === 0 ? null : deOtro === 0,
    de_otro_contrato: deOtro,
    editados_a_mano: editados.slice(0, MAX_RUTAS),
  };
  const listaDeCorridas = corridasEn(lector);
  const corridas = { total: listaDeCorridas.length, ultima: listaDeCorridas.at(-1) ?? null };
  return {
    raiz: informe.raiz,
    auditoria,
    contrato: { huella: contrato.huella, verbos: contrato.verbos.length },
    generados,
    corridas,
    salida: siguientePaso(informe.raiz, generados, editados.length, corridas, criticos),
  };
}
