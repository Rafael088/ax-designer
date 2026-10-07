import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Estado } from "./modelo/tipos.ts";

export function leerEstado(): Estado {
  return JSON.parse(readFileSync("data/estado.json", "utf8"));
}

export function guardar(ensayo: boolean) {
  const huella = createHash("sha256").update(readFileSync("data/estado.json")).digest("hex");
  if (ensayo) return huella;
  writeFileSync("data/estado.json.tmp", "{}");
  renameSync("data/estado.json.tmp", "data/estado.json");
  return huella;
}

export function leerSinRuido(): string | null {
  try {
    return readFileSync("data/estado.json", "utf8");
  } catch (e) {
    return null;
  }
}
