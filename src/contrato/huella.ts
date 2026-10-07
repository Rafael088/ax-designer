// La huella de un contrato: sha256 de su JSON canónico (claves ordenadas), sin `raiz` ni `huella`.
// Así el mismo repo da la misma huella se pida como «.» o con su ruta absoluta, y la cabecera de
// lo generado dice de qué contrato salió.
import { createHash } from "node:crypto";
import type { Contrato } from "../modelo/index.ts";

export function jsonCanonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;
  if (valor !== null && typeof valor === "object") {
    const claves = Object.keys(valor as Record<string, unknown>)
      .filter((k) => (valor as Record<string, unknown>)[k] !== undefined)
      .sort();
    return `{${claves.map((k) => `${JSON.stringify(k)}:${jsonCanonico((valor as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** Lo que se firma y se escribe en el repo objetivo: el contrato sin lo que depende de cómo se pidió. */
export function cuerpoFirmado(contrato: Omit<Contrato, "huella"> | Contrato): Omit<Contrato, "huella" | "raiz"> {
  const { raiz: _raiz, ...resto } = contrato as Contrato;
  const { huella: _huella, ...cuerpo } = resto;
  return cuerpo;
}

export function huellaDe(contrato: Omit<Contrato, "huella"> | Contrato): string {
  return sha256(jsonCanonico(cuerpoFirmado(contrato)));
}
