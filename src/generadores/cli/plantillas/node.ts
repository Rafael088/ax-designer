// Plantilla de ax/cli.mjs: el CLI de verbos estrechos para un repo de Node. Solo usa node:*. Lo
// propio del repo entra como un objeto JSON (DatosDelCli); el resto es código fijo, en String.raw
// para que las barras invertidas lleguen tal cual: no lleva comillas invertidas ni `${`.
import type { DatosDelCli } from "./datos.ts";

export function plantillaCliNode(datos: DatosDelCli): string {
  return CABEZA + "const DATOS = " + JSON.stringify(datos, null, 2) + ";\n" + CUERPO;
}

const CABEZA = String.raw`#!/usr/bin/env node
// El CLI de AX de este repo: un verbo por verbo del contrato (ax/contrato.json), cada uno sobre el
// estado del dominio. JSON por stdout con "esquema": 1, también los errores (error, salida,
// reintentable). Códigos: 0 bien, 2 uso, 3 error, 4 el estado cambió desde la huella, 5 hace
// falta una persona. Las escrituras son un ensayo hasta --aplicar; con --huella salen con 4 si el
// estado cambió desde esa lectura. Las transiciones vedadas no son verbos.
// Sin dependencias: solo node:*. Para cambiarlo, cambia el contrato y vuelve a generar.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

`;

const CUERPO = String.raw`
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), DATOS.hasta_la_raiz);
const PROGRAMA = DATOS.programa;
const CARACTERES_POR_TOKEN = 4;
const MAX_IDS = 20;
const ULTIMOS = 3;

class Fallo extends Error {
  constructor(codigo, error, salida, reintentable, datos) {
    super(error);
    this.codigo = codigo;
    this.salida = salida;
    this.reintentable = reintentable === true;
    this.datos = datos || {};
  }
}

function uso(error, verbo) {
  const salida = verbo
    ? "Corrige las entradas de «" + verbo.nombre + "» (míralas con «" + PROGRAMA + " --help») y vuelve a llamarlo."
    : "Mira los verbos con «" + PROGRAMA + " --help».";
  return new Fallo(2, error, salida, false);
}

function relee() {
  return DATOS.relectura
    ? "Vuelve a leer con «" + PROGRAMA + " " + DATOS.relectura + "», ensaya otra vez con la huella nueva y luego aplica."
    : "Vuelve a leer el estado, ensaya otra vez con la huella nueva y luego aplica.";
}

function jsonCanonico(valor) {
  if (Array.isArray(valor)) return "[" + valor.map(jsonCanonico).join(",") + "]";
  if (valor !== null && typeof valor === "object") {
    const claves = Object.keys(valor).filter((k) => valor[k] !== undefined).sort();
    return "{" + claves.map((k) => JSON.stringify(k) + ":" + jsonCanonico(valor[k])).join(",") + "}";
  }
  return JSON.stringify(valor);
}

function sha256(datos) {
  return createHash("sha256").update(datos).digest("hex");
}

function tokens(texto) {
  return Math.round(texto.length / CARACTERES_POR_TOKEN);
}

function esObjeto(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// --- argv: verbo, posicionales en orden, --bandera=valor, booleanos solos ---

function parsear(verbo, argv) {
  const valores = {};
  const posicionales = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const i = arg.indexOf("=");
      const bandera = i === -1 ? arg : arg.slice(0, i);
      const entrada = verbo.entradas.find((e) => e.como === "bandera" && e.bandera === bandera);
      if (!entrada) throw uso("«" + bandera + "» no es una bandera de «" + verbo.nombre + "».", verbo);
      if (entrada.tipo === "booleano") {
        if (i !== -1) throw uso("«" + bandera + "» es un booleano: va sola, sin «=valor».", verbo);
        valores[entrada.nombre] = true;
        continue;
      }
      if (i === -1) throw uso("«" + bandera + "» necesita un valor: escríbelo como «" + bandera + "=valor», sin espacio.", verbo);
      const texto = arg.slice(i + 1);
      if (entrada.tipo === "lista") {
        if (!valores[entrada.nombre]) valores[entrada.nombre] = [];
        valores[entrada.nombre].push(texto);
        continue;
      }
      if (valores[entrada.nombre] !== undefined) throw uso("«" + bandera + "» va una sola vez.", verbo);
      if (entrada.tipo === "entero") {
        if (!/^-?\d+$/.test(texto)) throw uso("«" + bandera + "» tiene que ser un entero.", verbo);
        valores[entrada.nombre] = Number(texto);
      } else valores[entrada.nombre] = texto;
    } else if (arg.startsWith("-")) {
      throw uso("«" + arg + "» no es una entrada: las banderas llevan dos guiones y los posicionales no empiezan por «-».", verbo);
    } else posicionales.push(arg);
  }
  const esperados = verbo.entradas.filter((e) => e.como === "posicional").sort((a, b) => a.posicion - b.posicion);
  if (posicionales.length > esperados.length) {
    throw uso("«" + verbo.nombre + "» recibe " + esperados.length + " posicional(es) y llegaron " + posicionales.length + ".", verbo);
  }
  esperados.forEach((e, i) => {
    if (posicionales[i] !== undefined) valores[e.nombre] = posicionales[i];
  });
  for (const e of verbo.entradas) {
    if (e.requerida && (valores[e.nombre] === undefined || valores[e.nombre] === "")) throw uso("Falta «" + e.nombre + "»: " + e.descripcion, verbo);
  }
  return valores;
}

// --- el estado del dominio ---

function leerFuente(fuente) {
  let datos;
  try {
    datos = readFileSync(join(RAIZ, fuente.ruta));
  } catch (e) {
    if (e && e.code === "ENOENT") return { ...fuente, existe: false, sha256: null, datos: null };
    throw new Fallo(3, "No se pudo leer " + fuente.ruta + ": " + (e && e.message), "Revisa los permisos de " + fuente.ruta + "; si se repite igual, avisa a una persona con este mensaje.", false);
  }
  return { ...fuente, existe: true, sha256: sha256(datos), datos };
}

function leerDominio() {
  return DATOS.fuentes.map(leerFuente);
}

/** sha256 del JSON canónico de [ruta, sha256 o null] de cada fuente, en orden de ruta (ax/contrato.json, dominio.huella). */
function huellaDe(leidas) {
  const pares = leidas.map((l) => [l.ruta, l.sha256]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256(jsonCanonico(pares));
}

function textoDe(leida) {
  return leida.datos.toString("utf8").replace(/^﻿/, "");
}

function ilegible(leida, detalle) {
  return new Fallo(3, leida.ruta + " no se puede leer como " + leida.formato + ": " + detalle, "Hay que revisarlo a mano: no lo reescribas desde el agente; avisa a una persona con este mensaje.", false);
}

function parsearCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  const utiles = filas.filter((f) => !(f.length === 1 && f[0] === ""));
  if (utiles.length === 0) return { columnas: [], registros: [] };
  const [columnas, ...resto] = utiles;
  return { columnas, registros: resto.map((f) => Object.fromEntries(columnas.map((c, i) => [c, f[i] === undefined ? "" : f[i]]))) };
}

function lineasJsonl(leida) {
  const registros = [];
  textoDe(leida).split("\n").forEach((linea, i) => {
    if (linea.trim() === "") return;
    try {
      registros.push(JSON.parse(linea));
    } catch (e) {
      throw ilegible(leida, "la línea " + (i + 1) + " no es JSON (" + e.message + ")");
    }
  });
  return registros;
}

/** Los registros de una fuente: la lista raíz o la primera lista de primer nivel (JSON), cada línea (JSONL) o cada fila (CSV). */
function registrosDe(leida) {
  if (!leida.existe) throw new Fallo(3, "No existe " + leida.ruta + ".", "El estado del dominio no está donde dice el contrato: revisa la ruta o vuelve a generar con «axd generar cli».", false);
  if (leida.formato === "json") {
    let valor;
    try {
      valor = JSON.parse(textoDe(leida));
    } catch (e) {
      throw ilegible(leida, e.message);
    }
    if (Array.isArray(valor)) return { registros: valor, en: null };
    if (esObjeto(valor)) {
      const clave = Object.keys(valor).find((k) => Array.isArray(valor[k]));
      if (clave !== undefined) return { registros: valor[clave], en: clave };
    }
    throw ilegible(leida, "no tiene una lista de registros (ni en la raíz ni en una clave de primer nivel)");
  }
  if (leida.formato === "jsonl") return { registros: lineasJsonl(leida), en: null };
  if (leida.formato === "csv") return { registros: parsearCsv(textoDe(leida)).registros, en: null };
  throw ilegible(leida, "el CLI solo lee registros de JSON, JSONL y CSV");
}

function idsDe(registros) {
  const ids = registros.filter((r) => esObjeto(r) && r.id !== undefined).map((r) => String(r.id));
  return ids.length > 0 ? ids.slice(0, MAX_IDS) : undefined;
}

function resumenDeFuente(leida) {
  const r = { ruta: leida.ruta, formato: leida.formato, existe: leida.existe };
  if (!leida.existe) return r;
  r.bytes = leida.datos.length;
  try {
    if (leida.formato === "json") {
      const valor = JSON.parse(textoDe(leida));
      if (Array.isArray(valor)) {
        r.registros = valor.length;
        if (esObjeto(valor[0])) r.claves = Object.keys(valor[0]);
        r.ids = idsDe(valor);
      } else if (esObjeto(valor)) {
        r.claves = Object.keys(valor);
        const colecciones = Object.keys(valor).filter((k) => Array.isArray(valor[k]));
        if (colecciones.length > 0) {
          r.colecciones = Object.fromEntries(colecciones.map((k) => [k, valor[k].length]));
          r.ids = idsDe(valor[colecciones[0]]);
        }
      }
    } else if (leida.formato === "jsonl") {
      const registros = lineasJsonl(leida);
      r.registros = registros.length;
      r.claves = [...new Set(registros.slice(0, 20).flatMap((x) => (esObjeto(x) ? Object.keys(x) : [])))];
      r.ultimos = registros.slice(-ULTIMOS);
    } else if (leida.formato === "csv") {
      const { columnas, registros } = parsearCsv(textoDe(leida));
      r.registros = registros.length;
      r.columnas = columnas;
      r.ids = idsDe(registros);
    } else if (leida.formato !== "sqlite") {
      const texto = textoDe(leida);
      r.lineas = texto.split("\n").filter((l) => l.trim() !== "").length;
      if (leida.formato === "yaml") r.claves = [...new Set([...texto.matchAll(/^([\w-]+)\s*:/gm)].map((m) => m[1]))];
      r.nota = "Formato sin lector en la biblioteca estándar: se resume por líneas.";
    } else r.nota = "Base de datos binaria: solo se informa su tamaño.";
  } catch (e) {
    r.error = e instanceof Fallo ? e.message : String(e && e.message);
  }
  if (r.ids === undefined) delete r.ids;
  return r;
}

/** Aplica recortes en orden hasta que la salida cabe en el presupuesto; marca truncado si recortó algo. */
function ajustar(cuerpo, recortes) {
  for (const recortar of recortes) {
    if (tokens(JSON.stringify(cuerpo)) <= cuerpo.presupuesto_tokens) return cuerpo;
    if (recortar(cuerpo)) cuerpo.truncado = true;
  }
  return cuerpo;
}

function recortesDelResumen(fuentes) {
  const cadaUna = (f) => () => fuentes.reduce((hubo, x) => f(x) || hubo, false);
  return [
    cadaUna((x) => (x.ultimos && x.ultimos.length > 1 ? ((x.ultimos = x.ultimos.slice(-1)), true) : false)),
    cadaUna((x) => (x.ultimos ? (delete x.ultimos, true) : false)),
    cadaUna((x) => (x.ids && x.ids.length > 5 ? ((x.ids = x.ids.slice(0, 5)), true) : false)),
    cadaUna((x) => (x.ids ? (delete x.ids, true) : false)),
    cadaUna((x) => (x.claves && x.claves.length > 10 ? ((x.claves = x.claves.slice(0, 10)), true) : false)),
    cadaUna((x) => (x.columnas && x.columnas.length > 10 ? ((x.columnas = x.columnas.slice(0, 10)), true) : false)),
    cadaUna((x) => (x.colecciones ? (delete x.colecciones, true) : false)),
  ];
}

function resumenDelDominio(leidas, presupuesto) {
  const fuentes = leidas.map(resumenDeFuente);
  const cuerpo = ajustar({ fuentes, presupuesto_tokens: presupuesto, truncado: false }, recortesDelResumen(fuentes));
  return cuerpo;
}

function recortarRegistros(cuerpo) {
  if (cuerpo.registros.length === 0) return false;
  cuerpo.registros = cuerpo.registros.slice(0, Math.floor(cuerpo.registros.length * 0.8));
  cuerpo.mostrados = cuerpo.registros.length;
  return true;
}

function ajustarRegistros(cuerpo) {
  for (let i = 0; i < 200 && tokens(JSON.stringify(cuerpo)) > cuerpo.presupuesto_tokens; i++) {
    if (!recortarRegistros(cuerpo)) break;
    cuerpo.truncado = true;
  }
  if (cuerpo.truncado) {
    cuerpo.salida = "Hay " + cuerpo.total + " y se muestran " + cuerpo.mostrados + " para no pasar de " + cuerpo.presupuesto_tokens + " tokens: acota con los filtros del verbo.";
  }
  return cuerpo;
}

function coleccion(leidas, ruta) {
  const leida = leidas.find((l) => l.ruta === ruta);
  if (!leida) throw new Fallo(3, "El contrato no declara " + ruta + " como fuente del dominio.", "Es un fallo del CLI generado: vuelve a generarlo con «axd generar cli --aplicar».", false);
  return registrosDe(leida).registros;
}

function igual(registro, campo, valor) {
  return esObjeto(registro) && registro[campo] !== undefined && registro[campo] !== null && String(registro[campo]) === String(valor);
}

// --- los verbos ---

function hacerResumen(verbo) {
  const leidas = leerDominio();
  const cuerpo = { esquema: 1, verbo: verbo.nombre, huella: huellaDe(leidas), ...resumenDelDominio(leidas, verbo.presupuesto_tokens) };
  if (cuerpo.truncado) cuerpo.salida = "Recortado para no pasar de " + cuerpo.presupuesto_tokens + " tokens: usa las lecturas acotadas para el detalle.";
  return cuerpo;
}

function hacerListar(verbo, valores) {
  const impl = verbo.implementacion;
  const leidas = leerDominio();
  const filtros = Object.fromEntries(impl.filtros.filter((f) => valores[f] !== undefined).map((f) => [f, valores[f]]));
  const elegidos = coleccion(leidas, impl.coleccion).filter((r) => Object.keys(filtros).every((f) => igual(r, f, filtros[f])));
  const cuerpo = {
    esquema: 1, verbo: verbo.nombre, coleccion: impl.coleccion, huella: huellaDe(leidas), filtros,
    total: elegidos.length, mostrados: elegidos.length, registros: elegidos, presupuesto_tokens: verbo.presupuesto_tokens, truncado: false,
  };
  return ajustarRegistros(cuerpo);
}

function hacerBuscar(verbo, valores) {
  const impl = verbo.implementacion;
  const leidas = leerDominio();
  const texto = String(valores[impl.entrada] === undefined ? "" : valores[impl.entrada]).toLowerCase();
  if (texto === "") throw uso("Falta el texto que buscar en «" + impl.entrada + "».", verbo);
  const elegidos = coleccion(leidas, impl.coleccion).filter((r) => JSON.stringify(r).toLowerCase().includes(texto));
  const cuerpo = {
    esquema: 1, verbo: verbo.nombre, coleccion: impl.coleccion, huella: huellaDe(leidas), texto: valores[impl.entrada],
    total: elegidos.length, mostrados: elegidos.length, registros: elegidos, presupuesto_tokens: verbo.presupuesto_tokens, truncado: false,
  };
  return ajustarRegistros(cuerpo);
}

function noEsta(campo, valor, ruta) {
  const donde = DATOS.relectura ? " Mira los que hay con «" + PROGRAMA + " " + DATOS.relectura + "»." : "";
  return new Fallo(2, "No hay ningún registro con " + campo + "=" + valor + " en " + ruta + ".", "Corrige «" + campo + "»." + donde, false);
}

function hacerLeer(verbo, valores) {
  const impl = verbo.implementacion;
  const leidas = leerDominio();
  const valor = valores[impl.entrada];
  if (valor === undefined) throw uso("Falta «" + impl.entrada + "»: dice qué registro leer.", verbo);
  const registro = coleccion(leidas, impl.coleccion).find((r) => igual(r, impl.campo, valor));
  if (registro === undefined) throw noEsta(impl.campo, valor, impl.coleccion);
  return { esquema: 1, verbo: verbo.nombre, coleccion: impl.coleccion, huella: huellaDe(leidas), registro };
}

function sinFecha(registro) {
  if (!esObjeto(registro)) return jsonCanonico(registro);
  const { fecha: _fecha, ...resto } = registro;
  return jsonCanonico(resto);
}

/** Reemplazo atómico: temporal en la misma carpeta y rename, solo si el dominio sigue con la huella leída. */
function reemplazar(ruta, texto, huella) {
  const destino = join(RAIZ, ruta);
  try {
    if (!lstatSync(destino).isFile()) throw new Fallo(5, ruta + " no es un archivo normal (¿un enlace o una carpeta?): no se escribe.", "Hace falta una persona: deja " + ruta + " como un archivo normal y vuelve a ensayar.", false);
  } catch (e) {
    if (e instanceof Fallo) throw e;
    if (!e || e.code !== "ENOENT") throw e;
  }
  const temporal = destino + ".ax-" + process.pid + "-" + Date.now() + ".tmp";
  try {
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(temporal, texto, { encoding: "utf8", flag: "wx" });
    if (huellaDe(leerDominio()) !== huella) {
      throw new Fallo(4, "El estado cambió mientras se escribía: no se escribió nada.", relee(), true);
    }
    renameSync(temporal, destino);
  } catch (e) {
    if (e instanceof Fallo) throw e;
    throw new Fallo(3, "No se pudo escribir " + ruta + ": " + (e && e.message), "Revisa los permisos de " + ruta + "; si se repite igual, avisa a una persona con este mensaje.", false);
  } finally {
    rmSync(temporal, { force: true });
  }
}

function hacerAnexar(verbo, valores, argv) {
  const impl = verbo.implementacion;
  const leidas = leerDominio();
  const huella = huellaDe(leidas);
  if (valores.huella !== undefined && valores.huella !== huella) {
    throw new Fallo(4, "El estado cambió desde la huella que pasaste: no se escribió nada.", relee(), true, { huella_actual: huella });
  }
  if (impl.existe) {
    const valor = valores[impl.existe.entrada];
    if (valor !== undefined && !coleccion(leidas, impl.existe.coleccion).some((r) => igual(r, impl.existe.campo, valor))) {
      throw noEsta(impl.existe.campo, valor, impl.existe.coleccion);
    }
  }
  const destino = leidas.find((l) => l.ruta === impl.destino);
  const anteriores = destino.existe ? lineasJsonl(destino) : [];
  const registro = { evento: impl.evento };
  for (const campo of impl.campos) if (valores[campo] !== undefined) registro[campo] = valores[campo];
  registro.fecha = new Date().toISOString();
  const aplicar = valores.aplicar === true;
  if (anteriores.some((r) => sinFecha(r) === sinFecha(registro))) {
    return {
      esquema: 1, ensayo: !aplicar, verbo: verbo.nombre, cambios: [], sin_cambios: true,
      estado_nuevo: aplicar ? resumenDelDominio(leidas, DATOS.presupuesto_del_estado_nuevo) : null, huella,
      salida: "Ya está registrado igual en " + impl.destino + ": no hay nada que escribir.",
    };
  }
  const cambios = [{ ruta: impl.destino, accion: "anexar", registro }];
  if (!aplicar) {
    const sinHuella = argv.filter((a) => !a.startsWith("--huella=") && a !== "--aplicar");
    return {
      esquema: 1, ensayo: true, verbo: verbo.nombre, cambios, estado_nuevo: null, huella,
      para_aplicar: [verbo.nombre, ...sinHuella, "--aplicar", "--huella=" + huella],
      salida: "Es un ensayo: no se escribió nada. Para escribir, repite la llamada con --aplicar --huella=" + huella + ".",
    };
  }
  const anterior = destino.existe ? textoDe(destino) : "";
  const nuevo = anterior + (anterior === "" || anterior.endsWith("\n") ? "" : "\n") + JSON.stringify(registro) + "\n";
  reemplazar(impl.destino, nuevo, huella);
  const despues = leerDominio();
  return {
    esquema: 1, ensayo: false, verbo: verbo.nombre, cambios,
    estado_nuevo: resumenDelDominio(despues, DATOS.presupuesto_del_estado_nuevo),
    huella: huellaDe(despues), huella_anterior: huella,
    salida: "Escrito en " + impl.destino + ". Pasa la huella nueva a la próxima escritura.",
  };
}

function sinImplementar(verbo) {
  const impl = verbo.implementacion;
  throw new Fallo(5, "«" + verbo.nombre + "» no está implementado en este CLI. Falta: " + impl.falta, impl.salida, false, { verbo: verbo.nombre });
}

function ejecutar(verbo, valores, argv) {
  switch (verbo.implementacion.tipo) {
    case "resumen":
      return hacerResumen(verbo);
    case "listar":
      return hacerListar(verbo, valores);
    case "leer":
      return hacerLeer(verbo, valores);
    case "buscar":
      return hacerBuscar(verbo, valores);
    case "anexar":
      return hacerAnexar(verbo, valores, argv);
    default:
      return sinImplementar(verbo);
  }
}

function ayuda() {
  return {
    esquema: 1,
    nombre: DATOS.nombre,
    contrato: DATOS.contrato,
    uso: PROGRAMA + " <verbo> [posicionales] [--bandera=valor] [--booleano]",
    verbos: DATOS.verbos.map((v) => ({
      nombre: v.nombre,
      tipo: v.tipo,
      descripcion: v.descripcion,
      entradas: v.entradas.map((e) => (e.como === "posicional" ? "<" + e.nombre + ">" : e.bandera + (e.tipo === "booleano" ? "" : "=…")) + (e.requerida ? " (requerida)" : "")),
      implementado: v.implementacion.tipo !== "sin-implementar",
    })),
    vedadas: DATOS.vedadas.map((v) => v.nombre),
    codigos: DATOS.codigos,
    salida: DATOS.relectura ? "Empieza por «" + PROGRAMA + " " + DATOS.relectura + "»: trae la huella que piden las escrituras." : "Elige un verbo.",
  };
}

function principal(argv) {
  const [nombre, ...resto] = argv;
  if (nombre === undefined) throw new Fallo(2, "Falta el verbo.", "Mira los verbos con «" + PROGRAMA + " --help».", false);
  if (nombre === "--help" || nombre === "-h") return ayuda();
  if (nombre === "--version") return { esquema: 1, nombre: DATOS.nombre, contrato: DATOS.contrato };
  const verbo = DATOS.verbos.find((v) => v.nombre === nombre);
  if (!verbo) {
    const vedada = DATOS.vedadas.find((v) => v.nombre === nombre);
    if (vedada) {
      throw new Fallo(5, "«" + nombre + "» no es un verbo: es una transición vedada al agente. " + vedada.que + " " + vedada.motivo, "No la reintentes: es de una persona; pídesela.", false);
    }
    throw uso("No hay ningún verbo «" + nombre + "». Los verbos son: " + DATOS.verbos.map((v) => v.nombre).join(", ") + ".");
  }
  return ejecutar(verbo, parsear(verbo, resto), resto);
}

function responder(codigo, cuerpo) {
  process.stdout.write(JSON.stringify(cuerpo) + "\n");
  process.exitCode = codigo;
}

try {
  responder(0, principal(process.argv.slice(2)));
} catch (e) {
  if (e instanceof Fallo) responder(e.codigo, { esquema: 1, error: e.message, salida: e.salida, reintentable: e.reintentable, ...e.datos });
  else {
    responder(3, {
      esquema: 1,
      error: "Falló inesperadamente: " + (e && e.message ? e.message : String(e)),
      salida: "Si se repite igual, avisa a una persona con este mensaje.",
      reintentable: false,
    });
  }
}
`;
