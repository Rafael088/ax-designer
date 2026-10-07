#!/usr/bin/env node
function main(argv: string[]) {
  switch (argv[0]) {
    case "estado":
      return console.log(JSON.stringify({ esquema: 1, total: 0 }));
    case "generar":
      return console.log(JSON.stringify({ esquema: 1, generado: true }));
    default:
      throw new Error("verbo desconocido");
  }
}

main(process.argv.slice(2));
