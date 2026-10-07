#!/usr/bin/env node
import { leerEstado, guardar } from "./almacen.ts";

function main(argv: string[]) {
  switch (argv[0]) {
    case "estado":
      return console.log(JSON.stringify({ esquema: 1, ...leerEstado() }));
    case "listar":
      return listar(argv.includes("--estado"));
    case "entregar":
      if (!argv.includes("--evidencia")) {
        console.log(JSON.stringify({ error: "Falta la evidencia.", salida: "Pasa --evidencia.", reintentable: false }));
        process.exitCode = 2;
        return;
      }
      return guardar(argv.includes("--dry-run"));
    default:
      throw new Error("verbo desconocido");
  }
}

function listar(_porEstado: boolean) {
  try {
    console.log(JSON.stringify(leerEstado().tareas));
  } catch {}
}

main(process.argv.slice(2));
