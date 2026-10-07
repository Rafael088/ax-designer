// medir: Inventario → Medicion. Cuánto cuesta enterarse del repo por cada camino, en tokens del
// Contador y en rondas estimadas. Describe costos, no puntúa: comparar contra los umbrales es de
// la rúbrica. No lee disco ni lanza comandos: si el resumen de un repo es un comando, medirlo le
// toca al validador (`axd validar --correr`), y aquí queda dicho en las notas.

import type { Camino, Guia, Inventario, Medicion, Ruta } from "../modelo/index.ts";
import { CARACTERES_POR_TOKEN, contarTokens } from "./contador.ts";

export { CARACTERES_POR_TOKEN, contarTokens } from "./contador.ts";

export function medir(inventario: Inventario): Medicion {
  const notas: string[] = [];
  const caminos: Camino[] = [];

  const guia = caminoGuiaDeEntrada(inventario);
  if (guia !== null) caminos.push(guia);
  else notas.push("Sin guía de entrada: no hay AGENTS.md, CLAUDE.md ni llms.txt que el agente cargue solo al entrar.");

  const readme = inventario.guias.find((g) => g.tipo === "readme");
  const resumen = caminoResumen(guia, readme);
  if (resumen !== null) caminos.push(resumen);
  else notas.push("Sin camino de resumen medible: no hay guía de entrada ni README. Si el resumen es un comando, medirlo le toca al validador (`axd validar --correr`).");

  const caro = caminoEstadoDominio(inventario, guia, notas);
  if (caro !== null) caminos.push(caro);

  caminos.push(caminoLecturaTodo(inventario));

  const tokensResumen = resumen?.tokens ?? null;
  const tokensCaro = caro?.tokens ?? null;
  let razon: number | null = null;
  if (tokensCaro !== null && tokensResumen !== null && tokensResumen > 0) {
    razon = Math.round((tokensCaro / tokensResumen) * 10) / 10;
  } else if (tokensCaro !== null && tokensResumen === null) {
    notas.push("No hay camino barato: se reporta el costo del camino caro como evidencia del no-cumple.");
  }

  return {
    esquema: 1,
    raiz: inventario.raiz,
    caracteres_por_token: CARACTERES_POR_TOKEN,
    caminos,
    metricas: {
      tokens_guia_de_entrada: guia?.tokens ?? null,
      tokens_resumen: tokensResumen,
      tokens_camino_caro: tokensCaro,
      razon_caro_barato: razon,
    },
    notas,
  };
}

/** La guía que el agente carga sola al entrar, siguiendo lo que importa (`@AGENTS.md`), sin repetir archivos. */
function caminoGuiaDeEntrada(inventario: Inventario): Camino | null {
  const porRuta = new Map<Ruta, number>(inventario.guias.map((g) => [g.ruta, g.caracteres]));
  const cadena = new Map<Ruta, number>();
  const pendientes = inventario.guias.filter((g) => g.se_carga_al_entrar).map((g) => g.ruta);
  for (const ruta of pendientes) {
    if (cadena.has(ruta)) continue;
    const caracteres = porRuta.get(ruta);
    if (caracteres === undefined) continue;
    cadena.set(ruta, caracteres);
    const guia = inventario.guias.find((g) => g.ruta === ruta);
    for (const incluida of guia?.incluye ?? []) pendientes.push(incluida);
  }
  if (cadena.size === 0) return null;
  const caracteres = [...cadena.values()].reduce((a, b) => a + b, 0);
  const archivos = [...cadena.keys()];
  return {
    id: "guia-de-entrada",
    que: `Leer ${archivos.length === 1 ? "la guía que se carga sola al entrar" : "las guías que se cargan solas al entrar"}, con lo que importan.`,
    archivos,
    caracteres,
    tokens: contarTokens(caracteres),
    rondas_estimadas: archivos.length,
  };
}

/**
 * El resumen es el camino más barato para saber qué es el repo: la guía de entrada o el README,
 * el que cueste menos. Si la guía es la barata, el README no aporta nada al descubrimiento.
 */
function caminoResumen(guia: Camino | null, readme: Guia | undefined): Camino | null {
  const readmeCamino: Camino | null =
    readme === undefined
      ? null
      : {
          id: "resumen",
          que: "Leer el README.",
          archivos: [readme.ruta],
          caracteres: readme.caracteres,
          tokens: contarTokens(readme.caracteres),
          rondas_estimadas: 1,
        };
  if (guia === null) return readmeCamino;
  if (readmeCamino === null) return { ...guia, id: "resumen", que: `${guia.que} Es la lectura más barata para enterarse.` };
  return readmeCamino.tokens <= guia.tokens ? readmeCamino : { ...guia, id: "resumen", que: `${guia.que} Es la lectura más barata para enterarse.` };
}

/**
 * El camino caro: leer los archivos de estado del dominio para enterarse de lo mismo.
 * Si algún archivo de dominio llega sin claves (opaco para el analizador), se suma la guía de
 * entrada, porque el agente tendría que leerla para interpretar el estado.
 */
function caminoEstadoDominio(inventario: Inventario, guia: Camino | null, notas: string[]): Camino | null {
  const dominio = inventario.estado.filter((e) => e.rol === "dominio");
  if (dominio.length === 0) {
    notas.push("Sin camino caro: el analizador no encontró archivos de estado del dominio.");
    return null;
  }
  let archivos = dominio.map((e) => e.ruta);
  let caracteres = dominio.reduce((a, e) => a + e.caracteres, 0);
  const opacos = dominio.filter((e) => e.claves === undefined).length;
  if (opacos > 0 && guia !== null) {
    archivos = [...new Set([...archivos, ...guia.archivos])];
    caracteres += guia.caracteres;
  }
  return {
    id: "estado-dominio",
    que: `Leer los ${dominio.length} ${dominio.length === 1 ? "archivo de estado del dominio" : "archivos de estado del dominio"}${opacos > 0 && guia !== null ? ", más la guía para interpretarlos" : ""}.`,
    archivos,
    caracteres,
    tokens: contarTokens(caracteres),
    rondas_estimadas: archivos.length,
  };
}

/** El peor caso: enterarse del repo leyendo todo. Usa bytes como estimación de caracteres. */
function caminoLecturaTodo(inventario: Inventario): Camino {
  const { archivos, bytes } = inventario.estructura;
  return {
    id: "lectura-todo",
    que: `Listar la raíz y leer los ${archivos} archivos del repo, uno por ronda. La lista se omite: son todos los del Inventario.`,
    archivos: [],
    caracteres: bytes,
    tokens: contarTokens(bytes),
    rondas_estimadas: archivos + 1,
  };
}
