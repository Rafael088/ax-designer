// Comprueba el criterio de terminado de una tarea sobre la copia en la que trabajó el agente. No
// pregunta a ningún agente: corre un comando del repo, mira un archivo o la respuesta.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Comprobacion, Verificador } from "../motor.ts";
import { lanzarDeVerdad, type Lanzador } from "./lanzador.ts";

export function verificador(lanzar: Lanzador = lanzarDeVerdad): Verificador {
  return {
    comprobar(criterio, copia, respuesta, segundos): Comprobacion {
      switch (criterio.tipo) {
        case "respuesta-contiene": {
          const termino = respuesta.includes(criterio.texto);
          return { termino, comprobacion: `La respuesta ${termino ? "contiene" : "no contiene"} «${criterio.texto}».` };
        }
        case "archivo-contiene": {
          let texto: string | null;
          try {
            texto = readFileSync(join(copia, criterio.ruta), "utf8");
          } catch {
            texto = null;
          }
          if (texto === null) return { termino: false, comprobacion: `${criterio.ruta} no existe en la copia.` };
          const termino = texto.includes(criterio.texto);
          return { termino, comprobacion: `${criterio.ruta} ${termino ? "contiene" : "no contiene"} «${criterio.texto}».` };
        }
        case "comando": {
          const [programa, ...argv] = criterio.argv;
          const esperado = criterio.codigo ?? 0;
          const r = lanzar(programa!, argv, { cwd: copia, segundos });
          const termino = r.error === null && r.codigo === esperado;
          return { termino, comprobacion: `\`${criterio.argv.join(" ")}\` salió con ${r.codigo ?? r.error} (se esperaba ${esperado}).` };
        }
      }
    },
  };
}
