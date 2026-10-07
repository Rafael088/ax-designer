// informe: Eje[] → Informe. Calcula la puntuación global (media simple de los ejes con nivel) y
// expone los hallazgos de los 7 ejes ya ordenados por rubrica.ts. `renderizarMarkdown` es la
// única prosa para personas de axd: el JSON (--formato json, el por defecto) es el contrato que
// cita `auditar`; `--formato md` es para leer, y nunca es lo que otro módulo consume.
import { COBERTURA_MINIMA, ordenarHallazgos } from "../rubrica/index.ts";
import type { Eje, Evidencia, Hallazgo, Informe } from "../modelo/index.ts";

export function generarInforme(raiz: string, ejes: readonly Eje[]): Informe {
  const conNivel = ejes.filter((e) => e.nivel !== null);
  const puntuacion_global = conNivel.length === 0 ? null : Math.round(conNivel.reduce((a, e) => a + (e.puntuacion as number), 0) / conNivel.length);
  return {
    esquema: 1,
    raiz,
    puntuacion_global,
    cobertura_minima: COBERTURA_MINIMA,
    ejes: [...ejes],
    hallazgos: ordenarHallazgos(ejes),
  };
}

function evidenciaTexto(e: Evidencia): string {
  switch (e.tipo) {
    case "archivo":
      return `${e.ruta}:${e.linea}`;
    case "medicion":
      return `${e.camino} = ${e.tokens}${e.archivos !== undefined ? ` (${e.archivos.join(", ")})` : ""}`;
    case "ausencia":
      return `se buscó ${e.buscado} en ${e.en}`;
    case "corrida":
      return `${e.comando} → código ${e.codigo}: ${e.salida}`;
  }
}

function filaDeEje(eje: Eje): string {
  if (eje.no_aplica) return `| ${eje.numero}. ${eje.nombre} | — | no-aplica | — |`;
  const nivel = eje.nombre_nivel ?? "sin evaluar";
  return `| ${eje.numero}. ${eje.nombre} | ${eje.puntuacion ?? "—"} | ${nivel} | ${eje.cobertura ?? "—"} |`;
}

function lineaDeHallazgo(h: Hallazgo, i: number): string {
  const etiqueta = h.critico ? " · **crítico**" : "";
  const ahorro = h.ahorro_tokens !== null ? ` · ahorraría ~${h.ahorro_tokens} tokens` : "";
  const evidencia = h.evidencia.map(evidenciaTexto).join("; ");
  return [
    `${i + 1}. **${h.criterio}** (${h.resultado}, eje ${h.numero_eje}${etiqueta}${ahorro})`,
    `   ${h.motivo}`,
    evidencia !== "" ? `   Evidencia: ${evidencia}` : undefined,
  ]
    .filter((l): l is string => l !== undefined)
    .join("\n");
}

/** El informe en Markdown, con el formato del informe de la rúbrica (docs/rubrica.md): para que lo lea una
 *  persona, nunca para que lo vuelva a parsear otro módulo de axd. */
export function renderizarMarkdown(informe: Informe): string {
  const partes: string[] = [];
  partes.push(`# Auditoría AX — ${informe.raiz}`);
  partes.push(informe.puntuacion_global === null ? "Puntuación global: **sin evaluar** (ningún eje llegó a la cobertura mínima)." : `Puntuación global: **${informe.puntuacion_global}/100**.`);
  partes.push(["| Eje | Puntuación | Nivel | Cobertura |", "| --- | --- | --- | --- |", ...informe.ejes.map(filaDeEje)].join("\n"));
  if (informe.hallazgos.length === 0) {
    partes.push("Sin hallazgos: todo lo decidible salió cumple.");
  } else {
    partes.push(["## Hallazgos", "", "De más a menos lo que ahorran o el riesgo que quitan, no lo fácil que son de arreglar.", "", ...informe.hallazgos.map((h, i) => lineaDeHallazgo(h, i))].join("\n\n"));
  }
  return partes.join("\n\n") + "\n";
}
