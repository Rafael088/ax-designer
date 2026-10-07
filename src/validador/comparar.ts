// La comparación «sin» contra «con» de cada tarea: medianas sobre las repeticiones que corrieron
// (las que fallaron en el motor no cuentan, pero se dicen). Primero manda terminar la tarea; con
// la misma tasa de terminado, gastar menos.
import type { Comparacion, ComparacionDeTarea, ResultadoDeCorrida, ResumenDeVariante, Variante, Veredicto } from "../modelo/index.ts";

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 === 1 ? orden[medio]! : (orden[medio - 1]! + orden[medio]!) / 2;
}

export function resumir(resultados: readonly ResultadoDeCorrida[]): ResumenDeVariante {
  const corridas = resultados.flatMap((r) => (r.estado === "corrida" ? [r] : []));
  const terminadas = corridas.filter((r) => r.termino).length;
  const usd = corridas.flatMap((r) => (r.usd === null ? [] : [r.usd]));
  return {
    corridas: corridas.length,
    fallos_del_motor: resultados.length - corridas.length,
    terminadas,
    tasa_terminado: corridas.length === 0 ? null : terminadas / corridas.length,
    rondas: mediana(corridas.map((r) => r.rondas)),
    tokens: mediana(corridas.map((r) => r.tokens)),
    usd: usd.length === corridas.length ? mediana(usd) : null,
  };
}

function resta(con: number | null, sin: number | null): number | null {
  return con === null || sin === null ? null : Math.round((con - sin) * 10_000) / 10_000;
}

function veredicto(sin: ResumenDeVariante, con: ResumenDeVariante, d: ComparacionDeTarea["diferencia"]): { veredicto: Veredicto; por_que: string } {
  if (sin.corridas === 0 || con.corridas === 0) {
    return { veredicto: "sin-datos", por_que: `No hay corridas válidas de «${sin.corridas === 0 ? "sin" : "con"}»: el motor falló en todas.` };
  }
  if (d.tasa_terminado! > 0) return { veredicto: "con-mejor", por_que: `Con la herramienta termina más veces (${con.terminadas}/${con.corridas} contra ${sin.terminadas}/${sin.corridas}).` };
  if (d.tasa_terminado! < 0) return { veredicto: "con-peor", por_que: `Con la herramienta termina menos veces (${con.terminadas}/${con.corridas} contra ${sin.terminadas}/${sin.corridas}).` };
  const tokens = d.tokens!;
  const rondas = d.rondas!;
  if (sin.terminadas === 0) return { veredicto: "empate", por_que: "Ninguna variante terminó la tarea: gastar menos sin terminar no es mejorar." };
  if (tokens < 0 && rondas <= 0) return { veredicto: "con-mejor", por_que: `Terminan igual y con la herramienta gasta ${-tokens} tokens y ${-rondas} rondas menos (medianas).` };
  if (tokens > 0 && rondas >= 0) return { veredicto: "con-peor", por_que: `Terminan igual y con la herramienta gasta ${tokens} tokens y ${rondas} rondas más (medianas).` };
  return { veredicto: "empate", por_que: tokens === 0 && rondas === 0 ? "Terminan igual y gastan lo mismo." : `Terminan igual; tokens (${tokens >= 0 ? "+" : ""}${tokens}) y rondas (${rondas >= 0 ? "+" : ""}${rondas}) van en sentidos opuestos.` };
}

export function comparar(resultados: readonly ResultadoDeCorrida[]): Comparacion {
  const ids = [...new Set(resultados.map((r) => r.tarea))];
  const de = (tarea: string, variante: Variante) => resumir(resultados.filter((r) => r.tarea === tarea && r.variante === variante));
  const tareas = ids.map((tarea): ComparacionDeTarea => {
    const sin = de(tarea, "sin");
    const con = de(tarea, "con");
    const diferencia = { tasa_terminado: resta(con.tasa_terminado, sin.tasa_terminado), rondas: resta(con.rondas, sin.rondas), tokens: resta(con.tokens, sin.tokens), usd: resta(con.usd, sin.usd) };
    return { tarea, sin, con, diferencia, ...veredicto(sin, con, diferencia) };
  });
  const veredictos: Record<Veredicto, number> = { "con-mejor": 0, "con-peor": 0, empate: 0, "sin-datos": 0 };
  for (const t of tareas) veredictos[t.veredicto]++;
  return { tareas, veredictos };
}
