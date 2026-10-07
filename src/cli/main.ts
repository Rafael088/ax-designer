#!/usr/bin/env node
import { parseArgs } from "node:util";
import { analizar, leerEntrada, lectorDeDisco, lectorSinOcultos } from "../analizador/index.ts";
import { generarContrato } from "../contrato/index.ts";
import { GENERADORES, esGeneradoPorAxd, generar, type Generador } from "../generadores/index.ts";
import { generarInforme, renderizarMarkdown } from "../informe/index.ts";
import { medir } from "../medicion/index.ts";
import { ErrorAx } from "../modelo/index.ts";
import { evaluarRubrica } from "../rubrica/index.ts";
import { correrValidacion, ensayarValidacion, leerPrecios, leerTareas, validarRepeticiones } from "../validador/index.ts";
import { MOTORES, verificador } from "../validador/motores/index.ts";

// Sincronizada con package.json; pruebas/cli.test.ts comprueba que no se separe.
const VERSION = "0.1.0";

const VERBOS = [
  { verbo: "analizar [repo]", descripcion: "El Inventario en JSON. No escribe ni gasta." },
  { verbo: "medir [repo]", descripcion: "El costo de descubrimiento, camino por camino." },
  { verbo: "auditar [repo] [--formato json|md]", descripcion: "El informe por los 7 ejes con puntuación." },
  { verbo: "contrato [repo]", descripcion: "El contrato propuesto." },
  { verbo: "generar <cli|mcp> [repo] [--aplicar] [--huella <h>]", descripcion: "Sin --aplicar, el ensayo: qué archivos crearía y por qué. Con --huella del ensayo, sale con 4 si el destino cambió." },
  { verbo: "validar [repo] --tareas <archivo> [--correr] [--motor claude|mentira] [--repeticiones N] [--precios <archivo>]", descripcion: "Sin --correr, el plan de corridas (cada tarea sin y con lo generado) y su costo estimado; no copia, no escribe ni gasta. Con --correr las corre (con el motor claude, GASTA), compara rondas, tokens, costo y si terminó, y lo deja en .ax-corridas/." },
];

type Resultado = { codigo: number; cuerpo: Record<string, unknown>; texto?: string };

export function manejar(argv: readonly string[]): Resultado {
  const [primero, ...resto] = argv;
  if (primero === undefined || primero === "--help" || primero === "-h" || (primero === "--" && resto[0] === undefined)) {
    return primero === undefined
      ? usoIncorrecto("Falta el verbo. `axd` sin argumentos no hace nada: mira `axd --help`.")
      : ayuda();
  }
  if (primero === "--version" || primero === "-v") {
    return { codigo: 0, cuerpo: { esquema: 1, nombre: "axd", version: VERSION } };
  }
  switch (primero) {
    case "analizar":
      return conErrores(() => verboAnalizar(resto));
    case "medir":
      return conErrores(() => verboMedir(resto));
    case "auditar":
      return conErrores(() => verboAuditar(resto));
    case "contrato":
      return conErrores(() => verboContrato(resto));
    case "generar":
      return conErrores(() => verboGenerar(resto));
    case "validar":
      return conErrores(() => verboValidar(resto));
    default:
      return usoIncorrecto(`Verbo o bandera desconocida: «${primero}».`);
  }
}

function verboAnalizar(argv: readonly string[]): Resultado {
  const ruta = unaRuta("analizar", argv);
  if (typeof ruta !== "string") return ruta;
  return { codigo: 0, cuerpo: analizar(lectorDeDisco(ruta)) };
}

function verboMedir(argv: readonly string[]): Resultado {
  const ruta = unaRuta("medir", argv);
  if (typeof ruta !== "string") return ruta;
  return { codigo: 0, cuerpo: medir(analizar(lectorDeDisco(ruta))) };
}

function verboAuditar(argv: readonly string[]): Resultado {
  let positionals: string[];
  let formatoPedido: string | undefined;
  try {
    const analizado = parseArgs({ args: [...argv], options: { formato: { type: "string" } }, allowPositionals: true, strict: true });
    positionals = analizado.positionals;
    formatoPedido = analizado.values.formato;
  } catch (e) {
    return usoIncorrecto(`axd auditar: ${(e as Error).message}`);
  }
  if (positionals.length > 1) return usoIncorrecto("axd auditar recibe una sola ruta: `axd auditar [repo] [--formato json|md]`.");
  const formato = formatoPedido ?? "json";
  if (formato !== "json" && formato !== "md") return usoIncorrecto(`axd auditar: --formato «${formato}» desconocido. Usa json o md.`);
  const ruta = positionals[0] ?? ".";
  const inventario = analizar(lectorDeDisco(ruta));
  const medicion = medir(inventario);
  const ejes = evaluarRubrica(inventario, medicion);
  const informe = generarInforme(inventario.raiz, ejes);
  if (formato === "md") return { codigo: 0, cuerpo: informe, texto: renderizarMarkdown(informe) };
  return { codigo: 0, cuerpo: informe };
}

/** El contrato sale del repo sin lo que generó axd, para que regenerar no lo cambie. */
function contratoDe(ruta: string) {
  return contratoYMedicionDe(ruta).contrato;
}

function contratoYMedicionDe(ruta: string) {
  const inventario = analizar(lectorSinOcultos(lectorDeDisco(ruta), esGeneradoPorAxd));
  const medicion = medir(inventario);
  const informe = generarInforme(inventario.raiz, evaluarRubrica(inventario, medicion));
  return { contrato: generarContrato(informe, inventario), medicion };
}

function verboContrato(argv: readonly string[]): Resultado {
  const ruta = unaRuta("contrato", argv);
  if (typeof ruta !== "string") return ruta;
  return { codigo: 0, cuerpo: contratoDe(ruta) };
}

function verboGenerar(argv: readonly string[]): Resultado {
  let positionals: string[];
  let valores: { aplicar?: boolean; huella?: string };
  try {
    const analizado = parseArgs({ args: [...argv], options: { aplicar: { type: "boolean" }, huella: { type: "string" } }, allowPositionals: true, strict: true });
    positionals = analizado.positionals;
    valores = analizado.values;
  } catch (e) {
    return usoIncorrecto(`axd generar: ${(e as Error).message}`);
  }
  const [generador, ruta, ...sobra] = positionals;
  if (generador === undefined) return usoIncorrecto("axd generar necesita qué generar: `axd generar <cli|mcp> [repo] [--aplicar]`.");
  if (!(GENERADORES as readonly string[]).includes(generador)) return usoIncorrecto(`axd generar: «${generador}» no es un generador. Usa cli o mcp.`);
  if (sobra.length > 0) return usoIncorrecto("axd generar recibe una sola ruta: `axd generar <cli|mcp> [repo] [--aplicar]`.");
  if (valores.huella !== undefined && valores.aplicar !== true) return usoIncorrecto("axd generar: --huella solo tiene sentido con --aplicar (es la huella_del_destino que dio el ensayo).");
  const raiz = ruta ?? ".";
  const contrato = contratoDe(raiz);
  const opciones = valores.huella !== undefined ? { aplicar: true, huella: valores.huella } : { aplicar: valores.aplicar === true };
  const generado = generar(generador as Generador, contrato, raiz, opciones);
  const resumen = { huella: contrato.huella, verbos: contrato.verbos.length, vedadas: contrato.vedadas.length };
  if (generado.ensayo) {
    const { ensayo, generador: g, raiz: r, huella_del_destino, archivos } = generado;
    return {
      codigo: 0,
      cuerpo: {
        esquema: 1, ensayo, generador: g, raiz: r, contrato: resumen, huella_del_destino, archivos,
        salida: `Es un ensayo: no se escribió nada. Para escribir: \`axd generar ${g} ${r} --aplicar --huella ${huella_del_destino}\`.`,
      },
    };
  }
  const { ensayo, generador: g, raiz: r, escritos, sin_cambios } = generado;
  return {
    codigo: 0,
    cuerpo: {
      esquema: 1, ensayo, generador: g, raiz: r, contrato: resumen, escritos, sin_cambios,
      salida: escritos.length === 0
        ? "No había nada que escribir: todo estaba igual a lo que se genera."
        : g === "mcp"
          ? "Escrito. Instala el MCP con `cd ax/mcp && npm install` y regístralo como dice ax/mcp/README.md; necesita el CLI del contrato (`axd generar cli`)."
          : `Escrito. Pruébalo con \`${[contrato.cli.programa, ...contrato.cli.argumentos].join(" ")} --help\` en la raíz del repo (ax/cli.md dice qué hace cada verbo); para exponerlo por MCP, \`axd generar mcp\`.`,
    },
  };
}

function verboValidar(argv: readonly string[]): Resultado {
  let positionals: string[];
  let v: { tareas?: string; correr?: boolean; motor?: string; repeticiones?: string; precios?: string };
  try {
    const analizado = parseArgs({
      args: [...argv],
      options: { tareas: { type: "string" }, correr: { type: "boolean" }, motor: { type: "string" }, repeticiones: { type: "string" }, precios: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    positionals = analizado.positionals;
    v = analizado.values;
  } catch (e) {
    return usoIncorrecto(`axd validar: ${(e as Error).message}`);
  }
  const uso = "`axd validar [repo] --tareas <archivo> [--correr] [--motor claude|mentira] [--repeticiones N] [--precios <archivo>]`";
  if (positionals.length > 1) return usoIncorrecto(`axd validar recibe una sola ruta: ${uso}.`);
  if (v.tareas === undefined) return usoIncorrecto(`axd validar necesita --tareas con el archivo de tareas de prueba (formato en docs/validador.md): ${uso}.`);
  const nombreDelMotor = v.motor ?? "claude";
  const fabrica = MOTORES[nombreDelMotor];
  if (fabrica === undefined) return usoIncorrecto(`axd validar: --motor «${nombreDelMotor}» desconocido. Usa ${Object.keys(MOTORES).join(" o ")}.`);
  let repeticiones: number | undefined;
  if (v.repeticiones !== undefined) {
    if (!/^[0-9]+$/.test(v.repeticiones)) return usoIncorrecto(`axd validar: --repeticiones tiene que ser un entero mayor que 0, no «${v.repeticiones}».`);
    repeticiones = validarRepeticiones(Number(v.repeticiones), "--repeticiones");
  }
  const raiz = positionals[0] ?? ".";
  const tareas = leerTareas(leerEntrada(v.tareas, "el archivo de tareas"));
  const tabla = v.precios === undefined ? undefined : leerPrecios(leerEntrada(v.precios, "la tabla de precios"));
  const { contrato, medicion } = contratoYMedicionDe(raiz);
  const pedido = { raiz, tareas, medicion, contrato, motor: fabrica(), ...(repeticiones !== undefined ? { repeticiones } : {}), ...(tabla !== undefined ? { tabla } : {}) };
  const comando = ["axd validar", raiz, "--tareas", v.tareas, ...(v.motor !== undefined ? ["--motor", v.motor] : []), ...(v.repeticiones !== undefined ? ["--repeticiones", v.repeticiones] : []), ...(v.precios !== undefined ? ["--precios", v.precios] : []), "--correr"].join(" ");
  if (v.correr !== true) {
    const plan = ensayarValidacion(pedido);
    const gasto = nombreDelMotor === "mentira" ? "no gasta nada: el motor de mentira no lanza ningún agente" : `gastaría unos ${plan.total.usd ?? "?"} USD según la estimación, y como mucho ${plan.total.usd_tope} USD (el tope de cada corrida)`;
    return { codigo: 0, cuerpo: { ...plan, salida: `Es un ensayo: no se copió, escribió ni gastó nada. Para correr las ${plan.total.corridas} corridas, \`${comando}\`; ${gasto}.` } };
  }
  const hecho = correrValidacion(pedido, verificador());
  const fallidas = hecho.resultados.filter((r) => r.estado === "fallo-motor").length;
  const cuerpo = { esquema: 1, ensayo: false, fecha: hecho.fecha, raiz, motor: hecho.plan.motor, modelo: hecho.plan.modelo, contrato: hecho.plan.contrato, comparacion: hecho.comparacion, resultados: hecho.resultados, escrito: hecho.escrito };
  if (fallidas === hecho.resultados.length) {
    return { codigo: 3, cuerpo: { ...cuerpo, error: `El motor falló en las ${fallidas} corridas: no hay nada que comparar.`, salida: `Mira «detalle» en los resultados (o ${hecho.escrito.ruta}), arregla lo que diga y vuelve a correr.`, reintentable: true } };
  }
  return { codigo: 0, cuerpo: { ...cuerpo, salida: `Corrido y guardado en ${hecho.escrito.ruta}${fallidas > 0 ? `; ${fallidas} corrida(s) fallaron en el motor y no cuentan en la comparación` : ""}.` } };
}

/** `[repo]` opcional y una sola vez: devuelve la ruta o el Resultado de uso incorrecto. */
function unaRuta(verbo: string, argv: readonly string[]): string | Resultado {
  let posicionales: string[];
  try {
    posicionales = parseArgs({ args: [...argv], options: {}, allowPositionals: true, strict: true }).positionals;
  } catch (e) {
    return usoIncorrecto(`axd ${verbo}: ${(e as Error).message}`);
  }
  if (posicionales.length > 1) return usoIncorrecto(`axd ${verbo} recibe una sola ruta: \`axd ${verbo} [repo]\`.`);
  return posicionales[0] ?? ".";
}

/** Un ErrorAx sale con su código; cualquier otra excepción es un 3 que no se reintenta a ciegas. */
function conErrores(verbo: () => Resultado): Resultado {
  try {
    return verbo();
  } catch (e) {
    if (e instanceof ErrorAx) {
      return { codigo: e.codigo, cuerpo: { esquema: 1, error: e.message, salida: e.salida, reintentable: e.reintentable, ...e.datos } };
    }
    return error(3, `Falló inesperadamente: ${(e as Error).message}`, "Revisa permisos y que la ruta sea un repo legible; si se repite, es un fallo de axd: repórtalo con este mensaje.");
  }
}

function ayuda(): Resultado {
  return {
    codigo: 0,
    cuerpo: {
      esquema: 1,
      nombre: "axd",
      version: VERSION,
      descripcion: "Audita la Agent Experience (AX) de un repositorio y genera el código para que un agente lo opere con menos tokens y menos errores.",
      verbos: VERBOS,
      banderas: ["--version", "--help"],
      codigos: { 0: "bien", 2: "uso incorrecto", 3: "error", 4: "el destino cambió: vuelve a ensayar", 5: "hace falta una persona" },
      salida: "Elige un verbo. Todo lo que escribe o gasta es un ensayo hasta que digas --aplicar o --correr.",
    },
  };
}

function usoIncorrecto(error: string): Resultado {
  return { codigo: 2, cuerpo: { esquema: 1, error, salida: "Corre `axd --help` para ver los verbos.", reintentable: false } };
}

function error(codigo: number, mensaje: string, salida: string): Resultado {
  return { codigo, cuerpo: { esquema: 1, error: mensaje, salida, reintentable: false } };
}

function imprimir(resultado: Resultado): void {
  const salida = resultado.texto ?? JSON.stringify(resultado.cuerpo, null, 2) + "\n";
  process.stdout.write(salida);
}

const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();
const resultado = manejar(argv);
imprimir(resultado);
process.exitCode = resultado.codigo;
