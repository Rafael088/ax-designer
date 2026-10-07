// Las transiciones vedadas al agente: no son verbos del CLI ni tools del MCP. Salen de tres sitios,
// todos con evidencia: los verbos de cierre que ya existen (aprobar, publicar…), las filas de una
// tabla de dueños en las guías que dan la transición a una persona, y —si hay estado del dominio—
// editarlo a mano, que se salta el ensayo, la huella y la evidencia.
import type { Inventario, TransicionVedada } from "../modelo/index.ts";
import { cierresVistos, estadoDelDominio, slug } from "./verbos.ts";

/** `| pendiente → hecha | persona |` (también `->` y `=>`): la transición y su dueño. */
const FILA_DE_DUENO = /^\s*\|\s*([^|]+?)\s*(?:→|->|=>)\s*([^|]+?)\s*\|\s*(persona|humano|humana|usuario|usuaria|revisor|person|human|owner)\b[^|]*\|/i;

function filasDeDueno(inventario: Inventario): TransicionVedada[] {
  return inventario.guias.flatMap((guia) =>
    guia.contenido.split("\n").flatMap((linea, i): TransicionVedada[] => {
      const m = FILA_DE_DUENO.exec(linea);
      if (!m) return [];
      const [, desde, hacia] = m;
      return [{
        nombre: `${slug(desde!)}-a-${slug(hacia!)}`,
        que: `Pasar de «${desde}» a «${hacia}».`,
        dueno: "persona",
        motivo: `${guia.ruta} le da esta transición a una persona.`,
        evidencia: [{ archivo: guia.ruta, linea: i + 1 }],
      }];
    }),
  );
}

export function vedadasDe(inventario: Inventario): TransicionVedada[] {
  const vedadas: TransicionVedada[] = [
    ...cierresVistos(inventario).map((c): TransicionVedada => ({
      nombre: c.nombre,
      que: `El verbo «${c.nombre}» que ya existe en el repo.`,
      dueno: "persona",
      motivo: "Aprobar o cerrar el trabajo del agente es de una persona: si el agente pudiera, se aprobaría solo.",
      evidencia: c.vistos.map((v) => ({ archivo: v.archivo, linea: v.linea })),
    })),
    ...filasDeDueno(inventario),
  ];
  const dominio = estadoDelDominio(inventario);
  if (dominio.length > 0) {
    vedadas.push({
      nombre: "editar-el-estado-a-mano",
      que: `Escribir directamente en ${dominio.map((e) => e.ruta).join(", ")}.`,
      dueno: "persona",
      motivo: "El estado cambia solo con los verbos: editarlo a mano se salta el ensayo, la huella y la evidencia.",
      evidencia: dominio.map((e) => ({ archivo: e.ruta, linea: 1 })),
    });
  }
  const vistas = new Set<string>();
  return vedadas.filter((v) => !vistas.has(v.nombre) && vistas.add(v.nombre));
}
