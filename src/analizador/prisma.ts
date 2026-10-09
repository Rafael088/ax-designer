// Los modelos de un esquema de Prisma (`prisma/schema.prisma`, o varios `.prisma` en
// `prisma/schema/`). Los datos viven en la base, no en el archivo: el esquema es la forma del estado
// del dominio, y de ahí el contrato saca el cuerpo de una escritura cuando no hay un esquema zod.
import type { CampoDelModelo, ModeloDeDatos, Ruta } from "../modelo/index.ts";

const ESCALARES = new Set(["String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes", "Unsupported"]);

export function esEsquemaPrisma(ruta: Ruta): boolean {
  return /\.prisma$/.test(ruta);
}

export function modelosPrisma(texto: string): ModeloDeDatos[] {
  const lineas = texto.split("\n");
  const enums = new Set([...texto.matchAll(/^\s*enum\s+(\w+)\s*\{/gm)].map((m) => m[1]!));
  const nombres = new Set([...texto.matchAll(/^\s*(?:model|view)\s+(\w+)\s*\{/gm)].map((m) => m[1]!));
  const modelos: ModeloDeDatos[] = [];
  let actual: ModeloDeDatos | undefined;
  lineas.forEach((bruta, i) => {
    const linea = bruta.replace(/\/\/.*$/, "").trim();
    const inicio = /^(?:model|view)\s+(\w+)\s*\{$/.exec(linea);
    if (inicio) {
      actual = { nombre: inicio[1]!, linea: i + 1, campos: [] };
      modelos.push(actual);
      return;
    }
    if (actual === undefined) return;
    if (linea === "}") {
      actual = undefined;
      return;
    }
    const tabla = /^@@map\(\s*["']([^"']+)["']/.exec(linea);
    if (tabla) {
      actual.tabla = tabla[1]!;
      return;
    }
    const campo = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(linea);
    if (!campo) return;
    const [, nombre, tipo, lista, opcional, atributos] = campo;
    const c: CampoDelModelo = {
      nombre: nombre!,
      tipo: tipo!,
      lista: lista !== undefined,
      opcional: opcional !== undefined,
      por_defecto: /@default\(|@updatedAt\b/.test(atributos!),
      id: /@id\b/.test(atributos!),
      relacion: nombres.has(tipo!) && !ESCALARES.has(tipo!) && !enums.has(tipo!),
      enumerado: enums.has(tipo!),
      linea: i + 1,
    };
    actual.campos.push(c);
  });
  return modelos;
}
