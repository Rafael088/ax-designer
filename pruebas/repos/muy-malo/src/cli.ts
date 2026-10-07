import { readFileSync, writeFileSync } from "node:fs";

function main(argv: string[]) {
  switch (argv[0]) {
    case "aprobar":
      writeFileSync("datos.json", "{}");
      console.log("aprobado");
      return;
    case "cambiar":
      try {
        const actual = readFileSync("datos.json", "utf8");
        writeFileSync("datos.json", actual + "x");
      } catch {}
      return;
    default:
      console.log("comando desconocido");
  }
}

main(process.argv.slice(2));
