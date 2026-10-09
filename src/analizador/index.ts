// analizar: ruta → Inventario. Describe el repo objetivo sin juzgarlo; puntuar es de la rúbrica.
import type { Inventario, Lenguaje, PuntoDeEntrada, Ruta, Senal } from "../modelo/index.ts";
import { esPrueba, leerCodigo, manejadorEnOtroModulo, type DespachoPendiente } from "./codigo.ts";
import {
  ESTADO_BUSCADO, MCP_BUSCADO, TAREAS_BUSCADAS, clasificarContrato, clasificarEstado, esArchivoDeTareas, esBitacora,
  anotarBitacora, esConfiguracionMcp, esSdkMcp, leerEstado, leerTareas, servidoresMcp,
} from "./datos.ts";
import { GUIAS_BUSCADAS, leerGuia, tipoDeGuia } from "./guias.ts";
import { LENGUAJES_CON_SOPORTE, lenguajeDe } from "./lenguajes.ts";
import type { Lector } from "./lector.ts";
import { esEsquemaPrisma, modelosPrisma } from "./prisma.ts";
import { MANIFIESTOS_BUSCADOS, leerManifiesto, tipoDeManifiesto } from "./manifiestos.ts";
import { CARPETAS_IGNORADAS, estructuraDe, recorrer, type ArchivoVisto } from "./recorrido.ts";

export { leerArbol, leerEntrada, lectorDeDisco, lectorEnMemoria, lectorSinOcultos, type ArchivoDelArbol, type Lector } from "./lector.ts";

export type OpcionesDeAnalisis = {
  maxArchivos?: number;
  maxBytesPorArchivo?: number;
  maxBytesContenido?: number;
};

export const LIMITES_POR_DEFECTO = { maxArchivos: 5000, maxBytesPorArchivo: 256 * 1024, maxBytesContenido: 64 * 1024 } as const;

const PRUEBAS_BUSCADAS = [
  "scripts test, check, verify, ci, pytest o que llamen a node --test, jest, vitest, mocha, pytest, go test, cargo test",
  "*.test.*, *.spec.*, test_*.py, *_test.py y código bajo tests/, test/, pruebas/, __tests__/, spec/",
  "pytest.ini, tox.ini, conftest.py, vitest.config.*, jest.config.*, .mocharc.*, playwright.config.*, [tool.pytest] en pyproject.toml",
];
const SCRIPT_DE_PRUEBAS = /^(test|tests|check|verify|ci|pytest|spec)([:_-]|$)/;
const CORREDOR_DE_PRUEBAS = /node\s+--test|\b(jest|vitest|mocha|ava|tap|pytest|unittest|playwright\s+test|go\s+test|cargo\s+test|deno\s+test|bun\s+test)\b/;
const CONFIG_DE_PRUEBAS = /^(pytest\.ini|tox\.ini|conftest\.py|(vitest|jest|playwright)\.config\.[cm]?[jt]s|\.mocharc(\.\w+)?)$/;
const SHEBANG = /^#!.*\b(node|deno|bun|python[\d.]*)\b/;
const TABLA_DE_AUDITORIA = /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?["`]?\w*(audit|log|bitacora|historial|eventos?|events?|history)\w*/i;

export function analizar(lector: Lector, opciones: OpcionesDeAnalisis = {}): Inventario {
  const maxArchivos = opciones.maxArchivos ?? LIMITES_POR_DEFECTO.maxArchivos;
  const maxBytes = opciones.maxBytesPorArchivo ?? LIMITES_POR_DEFECTO.maxBytesPorArchivo;
  const maxContenido = opciones.maxBytesContenido ?? LIMITES_POR_DEFECTO.maxBytesContenido;

  const recorrido = recorrer(lector, maxArchivos);
  const existentes = new Set<Ruta>(recorrido.archivos.map((a) => a.ruta));
  const noLeidos = new Set<Ruta>();
  const leer = (archivo: ArchivoVisto): string | undefined => {
    if (archivo.bytes > maxBytes) {
      noLeidos.add(archivo.ruta);
      return undefined;
    }
    return lector.leer(archivo.ruta);
  };

  const inventario: Inventario = {
    esquema: 1,
    raiz: lector.raiz,
    estructura: estructuraDe(recorrido),
    guias: [],
    manifiestos: [],
    puntos_de_entrada: [],
    superficies: { cli: [], api: [], mcp_tools: [], banderas: [] },
    mcp: { configurado: [], sdk: [] },
    estado: [],
    contratos: [],
    modulos: [],
    pruebas: { archivos: [], comandos: [], configuracion: [] },
    tareas: [],
    trazabilidad: { git: recorrido.git, bitacoras: [] },
    senales: [],
    buscado: {
      guias: GUIAS_BUSCADAS,
      manifiestos: MANIFIESTOS_BUSCADOS,
      mcp: MCP_BUSCADO,
      estado: ESTADO_BUSCADO,
      tareas: TAREAS_BUSCADAS,
      pruebas: PRUEBAS_BUSCADAS,
    },
    limites: {
      max_archivos: maxArchivos,
      max_bytes_por_archivo: maxBytes,
      max_bytes_contenido: maxContenido,
      carpetas_ignoradas: [...CARPETAS_IGNORADAS],
      truncado: recorrido.truncado,
      no_leidos: [],
      lenguajes_sin_soporte: [],
    },
  };

  // Primero guías y manifiestos: los manifiestos dicen qué archivos son puntos de entrada.
  for (const archivo of recorrido.archivos) {
    // Un AGENTS.md o CLAUDE.md bajo pruebas/ (o tests/, __tests__/, spec/...) es de un repo de
    // mentira para las pruebas del propio analizador, no una guía de este repo: sin la
    // exclusión, auditar axd contra sí mismo contaba pruebas/repos/node-cli/AGENTS.md como si
    // documentara a axd (hallazgo sobre verbos-estrechos/transiciones-con-dueno).
    if (tipoDeGuia(archivo) && !esPrueba(archivo.ruta)) {
      inventario.guias.push(leerGuia(archivo, lector.leer(archivo.ruta), existentes, maxContenido));
    }
    if (!tipoDeManifiesto(archivo.nombre)) continue;
    const texto = leer(archivo);
    if (texto === undefined) continue;
    const { manifiesto, puntos } = leerManifiesto(archivo, texto, existentes);
    inventario.manifiestos.push(manifiesto);
    inventario.puntos_de_entrada.push(...puntos);
    for (const s of manifiesto.scripts) {
      if (SCRIPT_DE_PRUEBAS.test(s.nombre) || CORREDOR_DE_PRUEBAS.test(s.comando)) {
        inventario.pruebas.comandos.push({ ...s, manifiesto: manifiesto.ruta });
      }
    }
    if (archivo.nombre === "pyproject.toml" && /^\[tool\.pytest/m.test(texto)) inventario.pruebas.configuracion.push(archivo.ruta);
  }
  const dependencias = inventario.manifiestos.flatMap((m) => [...m.dependencias, ...m.dependencias_de_desarrollo]);
  inventario.mcp.sdk = [...new Set(dependencias.filter(esSdkMcp))];

  const entradas = new Set(inventario.puntos_de_entrada.flatMap((p) => p.ruta ?? []));
  const despachos: DespachoPendiente[] = [];
  const sinSoporte = new Set<Lenguaje>();
  for (const archivo of recorrido.archivos) {
    const lenguaje = lenguajeDe(archivo) ?? lenguajeDeScriptSinExtension(archivo, lector, maxBytes);
    if (lenguaje === undefined) continue;
    if (!LENGUAJES_CON_SOPORTE.has(lenguaje)) {
      sinSoporte.add(lenguaje);
      continue;
    }
    const texto = leer(archivo);
    if (texto === undefined) continue;
    const leido = leerCodigo(archivo.ruta, lenguaje, texto, existentes, entradas.has(archivo.ruta));
    inventario.modulos.push(leido.modulo);
    if (leido.modulo.es_prueba) inventario.pruebas.archivos.push(archivo.ruta);
    inventario.superficies.cli.push(...leido.verbos);
    inventario.superficies.api.push(...leido.api);
    inventario.superficies.mcp_tools.push(...leido.tools);
    if (leido.banderas.length > 0) inventario.superficies.banderas.push({ archivo: archivo.ruta, banderas: leido.banderas });
    inventario.senales.push(...leido.senales);
    despachos.push(...leido.despachos);
    if (leido.principal && !leido.modulo.es_prueba && !entradas.has(archivo.ruta)) {
      const punto: PuntoDeEntrada = {
        tipo: leido.principal.tipo,
        ruta: archivo.ruta,
        destino: archivo.ruta,
        declarado_en: { archivo: archivo.ruta, linea: leido.principal.linea },
      };
      inventario.puntos_de_entrada.push(punto);
    }
  }
  inventario.limites.lenguajes_sin_soporte = [...sinSoporte].sort();
  // Segundo paso: los verbos que despachan a una función de otro módulo del repo. Solo se sigue
  // a un módulo que ya se leyó como código (no a uno que pasó del tope de bytes).
  for (const { verbo, archivo, funcion } of despachos) {
    const modulo = inventario.modulos.find((m) => m.ruta === archivo);
    if (modulo === undefined) continue;
    const manejador = manejadorEnOtroModulo(archivo, modulo.lenguaje, lector.leer(archivo), funcion);
    if (manejador !== undefined) verbo.manejador = manejador;
  }

  for (const archivo of recorrido.archivos) {
    const prueba = esPrueba(archivo.ruta);
    if (archivo.extension === "sql" && !prueba) {
      const texto = leer(archivo);
      if (texto !== undefined) inventario.senales.push(...tablasDeAuditoria(archivo.ruta, texto));
    }
    const clase = prueba ? undefined : clasificarEstado(archivo);
    if (clase) inventario.estado.push(leerEstado(archivo, clase, clase.formato === "sqlite" ? undefined : leer(archivo)));
    if (!prueba && esEsquemaPrisma(archivo.ruta)) {
      const texto = leer(archivo);
      const modelos = texto === undefined ? [] : modelosPrisma(texto);
      if (modelos.length > 0) {
        inventario.estado.push({
          ruta: archivo.ruta,
          formato: "prisma",
          rol: "dominio",
          bytes: archivo.bytes,
          caracteres: texto!.length,
          motivo: "esquema de Prisma: los modelos del dominio (los datos viven en la base)",
          claves: modelos.map((m) => m.nombre),
          modelos,
        });
      }
    }
    const contrato = clasificarContrato(archivo, prueba);
    if (contrato) inventario.contratos.push(contrato);
    if (!prueba && esArchivoDeTareas(archivo)) {
      const texto = leer(archivo);
      if (texto !== undefined) inventario.tareas.push(leerTareas(archivo.ruta, texto));
    }
    if (!prueba && esBitacora(archivo)) {
      const texto = leer(archivo);
      if (texto !== undefined) anotarBitacora(inventario.trazabilidad.bitacoras, archivo, texto);
    }
    if (esConfiguracionMcp(archivo.ruta)) {
      const texto = leer(archivo);
      const servidores = texto === undefined ? undefined : servidoresMcp(texto);
      if (servidores !== undefined) inventario.mcp.configurado.push({ archivo: archivo.ruta, servidores });
    }
    if (CONFIG_DE_PRUEBAS.test(archivo.nombre)) inventario.pruebas.configuracion.push(archivo.ruta);
  }
  inventario.limites.no_leidos = [...noLeidos];
  return inventario;
}

/** Scripts sin extensión en la raíz, bin/ o scripts/ que se declaran node o python por su shebang. */
function lenguajeDeScriptSinExtension(archivo: ArchivoVisto, lector: Lector, maxBytes: number): Lenguaje | undefined {
  if (archivo.extension !== "" || archivo.bytes > maxBytes || archivo.bytes === 0) return undefined;
  if (!/^((bin|scripts)\/)?[^/]+$/.test(archivo.ruta)) return undefined;
  const m = SHEBANG.exec(lector.leer(archivo.ruta).split("\n", 1)[0] ?? "");
  if (!m) return undefined;
  return m[1]!.startsWith("python") ? "python" : "javascript";
}

function tablasDeAuditoria(ruta: Ruta, texto: string): Senal[] {
  return texto.split("\n").flatMap((linea, i): Senal[] =>
    TABLA_DE_AUDITORIA.test(linea) ? [{ tipo: "tabla-de-auditoria", archivo: ruta, linea: i + 1, texto: linea.trim().slice(0, 160) }] : [],
  );
}
