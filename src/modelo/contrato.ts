// El Contrato: el diseño AX del repo objetivo y el único insumo de los dos generadores.
// Dice qué se lee barato (y cuánto cuesta), qué verbos estrechos hay —con sus entradas, su salida
// y sus errores—, qué transiciones no puede hacer el agente y cómo se invoca el CLI que los
// expone. El generador de CLI lo implementa; el de MCP lo envuelve, una tool por verbo.
//
// Es datos planos y serializables: `axd contrato` lo imprime tal cual y los generadores lo copian
// a `ax/contrato.json` del repo objetivo. Las claves se agregan, nunca se renombran.

import type { FormatoDeDatos, Lenguaje, Ruta, Ubicacion } from "./inventario.ts";

export type Contrato = {
  esquema: 1;
  /** Ruta del repo tal como se pidió. No entra en la huella: el mismo repo da el mismo contrato. */
  raiz: string;
  /** sha256 del contrato en JSON canónico, sin `raiz` ni `huella`. Va en la cabecera de lo generado. */
  huella: string;
  proyecto: { nombre: string; lenguaje: Lenguaje | null };
  /** Cómo se invoca el CLI que implementa los verbos: lo crea `axd generar cli` y lo llama el MCP. */
  cli: InvocacionDelCli;
  lecturas: Lectura[];
  /** El estado del dominio sobre el que trabajan los verbos y cómo se calcula su huella. */
  dominio: DominioDelContrato;
  verbos: VerboDelContrato[];
  /** Lo que el agente no hace nunca: no es verbo del CLI ni tool del MCP. */
  vedadas: TransicionVedada[];
  /** Los códigos de salida del CLI generado; los mismos de axd. */
  codigos: Record<CodigoDelCli, string>;
  /** Los hallazgos del Informe que este contrato atiende, y cómo. */
  atiende: Atencion[];
  /** Lo que se aproximó con heurísticas y conviene que una persona revise. */
  notas: string[];
};

export type CodigoDelCli = "0" | "2" | "3" | "4" | "5";

export type InvocacionDelCli = {
  /** Hoy siempre el CLI que genera axd; el MCP envuelve a ese, nunca reimplementa los verbos. */
  origen: "generado";
  generador: "axd generar cli";
  lenguaje: "javascript" | "python";
  /** El archivo que crea `axd generar cli`, relativo a la raíz. */
  ruta: Ruta;
  /** argv[0] y el prefijo fijo: la llamada a un verbo es `programa ...argumentos verbo ...entradas`. */
  programa: string;
  argumentos: string[];
  /** Se corre con la raíz del repo objetivo como carpeta de trabajo. */
  cwd: "raiz";
  /** JSON por stdout con `esquema`, también en los errores (`error`, `salida`, `reintentable`). */
  salida: "json";
  /** Las banderas comunes de los verbos de escritura. */
  banderas: { aplicar: "--aplicar"; huella: "--huella" };
  /** Cómo se pasan las entradas, para quien traduce argumentos a argv (el MCP). */
  convencion: string;
};

export type TipoDeEntrada = "texto" | "entero" | "booleano" | "lista";

export type EntradaDelVerbo = {
  /** Nombre de la entrada en snake_case: la propiedad del esquema de la tool. */
  nombre: string;
  tipo: TipoDeEntrada;
  requerida: boolean;
  descripcion: string;
  /** Posicional (va después del verbo, en el orden de `posicion`) o bandera (`--algo valor`). */
  como: "posicional" | "bandera";
  posicion?: number;
  bandera?: string;
};

export type ErrorDelVerbo = {
  codigo: 2 | 3 | 4 | 5;
  cuando: string;
  /** El siguiente paso que trae el error, para que el agente no tenga que preguntar. */
  salida: string;
  reintentable: boolean;
};

export type VerboDelContrato = {
  /** En kebab-case: el subcomando del CLI y el nombre de la tool del MCP. */
  nombre: string;
  tipo: "lectura" | "escritura";
  descripcion: string;
  /** Lo que va entre el prefijo del CLI y las entradas: hoy, `[nombre]`. */
  argv: string[];
  entradas: EntradaDelVerbo[];
  salida: { descripcion: string; claves: string[] };
  errores: ErrorDelVerbo[];
  /** Escritura: sin `--aplicar` es un ensayo que no toca nada. Lectura: false. */
  ensayo_por_defecto: boolean;
  /** Lo que el verbo exige como prueba (`evidencia`) y lo que devuelve para demostrar lo hecho. */
  evidencia: { exige: string[]; devuelve: string[] };
  /** Existente: ya está en el repo (CLI, MCP o API). Propuesto: lo añade el contrato. */
  origen: "existente" | "propuesto";
  motivo: string;
  visto_en: (Ubicacion & { via: "cli" | "mcp" | "api" })[];
  /** Qué hace de verdad el CLI generado con el estado del dominio; `sin-implementar` si el contrato no lo sabe. */
  implementacion: Implementacion;
};

export type FuenteDelDominio = {
  ruta: Ruta;
  formato: FormatoDeDatos;
  /** Un JSONL de solo anexar (bitácora, eventos): donde las escrituras dejan su registro. */
  bitacora: boolean;
};

export type DominioDelContrato = {
  /** Los archivos de estado del dominio, en orden de ruta: los que leen las lecturas y cubre la huella. */
  fuentes: FuenteDelDominio[];
  /** Cómo se calcula la huella que devuelven las lecturas y comparan las escrituras con `--huella`. */
  huella: string;
};

/**
 * Lo que hace el verbo en el CLI generado, sin adivinar: una operación genérica sobre las fuentes
 * del dominio. Si el contrato no tiene con qué implementarlo, `sin-implementar` dice qué falta y
 * el CLI sale con 5 y esa `salida`, nunca con un stub que finge que funcionó.
 */
export type Implementacion =
  /** Resume cada fuente (claves, colecciones y cuántos registros, últimos de la bitácora) dentro del presupuesto. */
  | { tipo: "resumen" }
  /** Los registros de `coleccion`, filtrados por igualdad en el campo de cada entrada de `filtros`. */
  | { tipo: "listar"; coleccion: Ruta; filtros: string[] }
  /** El registro de `coleccion` cuyo `campo` es igual a la entrada `entrada`. */
  | { tipo: "leer"; coleccion: Ruta; entrada: string; campo: string }
  /** Los registros de `coleccion` que contienen el texto de la entrada `entrada`. */
  | { tipo: "buscar"; coleccion: Ruta; entrada: string }
  /**
   * Anexa a la bitácora `destino` un registro con `evento`, las entradas de `campos` y la fecha.
   * Con `existe`, antes comprueba que hay un registro en `coleccion` con `campo` igual a la entrada.
   */
  | { tipo: "anexar"; destino: Ruta; evento: string; campos: string[]; existe?: { entrada: string; coleccion: Ruta; campo: string } }
  | { tipo: "sin-implementar"; falta: string; salida: string };

export type Lectura = {
  /** El verbo de lectura que la sirve. */
  verbo: string;
  descripcion: string;
  /** Los archivos de estado del dominio que el agente se ahorra leer. */
  fuente: Ruta[];
  /** Lo que se espera que cueste su salida: el umbral de cumple de la rúbrica para esa lectura. */
  presupuesto_tokens: number;
  /** Lo que cuesta hoy enterarse leyendo `fuente` entera, con el Contador. Null si no hay fuente. */
  tokens_camino_caro: number | null;
};

export type TransicionVedada = {
  nombre: string;
  que: string;
  dueno: "persona";
  motivo: string;
  evidencia: Ubicacion[];
};

export type Atencion = { criterio: string; resultado: "parcial" | "no-cumple"; como: string };
