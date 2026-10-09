// El Inventario: lo que el analizador ve en el repo objetivo, sin juzgarlo. Lo leen la medición
// y los evaluar() de la rúbrica; por eso todo lo que puede ser evidencia trae archivo y línea, y
// todo lo que se buscó y no estaba deja dicho dónde se buscó (`buscado`).
//
// Es datos planos y serializables: `axd analizar` lo imprime tal cual. Las claves se agregan,
// nunca se renombran.

/** Rutas siempre relativas a la raíz del repo objetivo, con `/`. */
export type Ruta = string;

/** Un sitio exacto del repo: lo que la rúbrica cita como evidencia de tipo `archivo`. */
export type Ubicacion = { archivo: Ruta; linea: number };

export type Inventario = {
  esquema: 1;
  /** Ruta del repo tal como se pidió analizar. */
  raiz: string;
  estructura: Estructura;
  guias: Guia[];
  manifiestos: Manifiesto[];
  puntos_de_entrada: PuntoDeEntrada[];
  superficies: Superficies;
  mcp: Mcp;
  estado: ArchivoDeEstado[];
  contratos: ArchivoDeContrato[];
  modulos: Modulo[];
  pruebas: Pruebas;
  tareas: ArchivoDeTareas[];
  trazabilidad: Trazabilidad;
  senales: Senal[];
  /** Qué se buscó y dónde, para que un no-cumple por ausencia sea repetible. */
  buscado: Buscado;
  limites: Limites;
};

export type Estructura = {
  archivos: number;
  carpetas: number;
  bytes: number;
  /** Extensión (sin punto, o «(sin extensión)») → cuántos archivos. */
  por_extension: Record<string, number>;
  /** Lo que hay en la raíz: lo primero que ve un agente al entrar. */
  raiz: { archivos: Ruta[]; carpetas: Ruta[] };
  /** Carpetas de hasta dos niveles con cuántos archivos tienen debajo. */
  carpetas_principales: { ruta: Ruta; archivos: number }[];
  /** Lenguajes de los archivos de código vistos, por número de archivos. */
  lenguajes: Record<string, number>;
};

export type TipoDeGuia = "readme" | "agents" | "claude" | "llms" | "otra-guia-de-agente";

export type Guia = {
  tipo: TipoDeGuia;
  ruta: Ruta;
  bytes: number;
  caracteres: number;
  lineas: number;
  /** Si es la que un agente carga sola al entrar en la raíz (AGENTS.md, CLAUDE.md). */
  se_carga_al_entrar: boolean;
  titulos: { nivel: number; texto: string; linea: number }[];
  /** Archivos que la guía importa (`@AGENTS.md` de CLAUDE.md), resueltos desde la raíz. */
  incluye: Ruta[];
  /** Bloques de código de comandos de la guía (```sh), línea a línea. */
  comandos: { texto: string; linea: number }[];
  /** El texto, para que la rúbrica busque en él. Cortado en `limites.max_bytes_contenido`. */
  contenido: string;
  truncado: boolean;
};

export type TipoDeManifiesto = "package.json" | "pyproject.toml" | "makefile" | "justfile" | "cargo.toml" | "go.mod" | "deno.json";

export type Manifiesto = {
  tipo: TipoDeManifiesto;
  ruta: Ruta;
  nombre?: string;
  version?: string;
  scripts: Script[];
  /** Nombres de dependencias de ejecución y de desarrollo, sin versiones. */
  dependencias: string[];
  dependencias_de_desarrollo: string[];
  /** Si no se pudo leer (JSON roto…): el manifiesto existe pero no se sabe qué declara. */
  error?: string;
};

export type Script = { nombre: string; comando: string; linea: number };

export type TipoDePuntoDeEntrada = "bin" | "main" | "exports" | "script-de-consola" | "modulo-principal" | "shebang";

export type PuntoDeEntrada = {
  tipo: TipoDePuntoDeEntrada;
  /** Nombre del programa cuando lo declara el manifiesto (`bin`, `[project.scripts]`). */
  nombre?: string;
  /** Archivo al que apunta, si se pudo resolver dentro del repo. */
  ruta?: Ruta;
  /** Lo que dice el manifiesto (`pkg.mod:main`, `./dist/cli.js`). */
  destino: string;
  declarado_en: Ubicacion;
};

export type ViaDeVerbo = "argparse" | "click" | "typer" | "commander" | "yargs" | "switch";

export type VerboCli = Ubicacion & {
  nombre: string;
  via: ViaDeVerbo;
  /** Banderas largas que aparecen entre la línea del verbo y la del siguiente (o 20 líneas):
   *  una ventana, no un parser; el contrato las toma como entradas propuestas del verbo. */
  banderas: string[];
  /** De `banderas`, las que el parser exige (`required=True` de argparse/click, `required: true`,
   *  `.requiredOption(` de commander): sin ellas el verbo se niega aunque su código no construya
   *  ningún error. Solo si hay alguna. */
  banderas_requeridas?: string[];
  /** La función a la que despacha el verbo, de su línea de inicio a la de su fin: la que llama el
   *  `case` de un switch, la de `set_defaults(funcion=…)` de argparse, la que decora click/typer, o
   *  la que llama el `if` que compara con el nombre del verbo. La rúbrica mira ahí (y en `llama`),
   *  no 20 líneas tras la declaración. Sin `manejador`, no se supo seguir el despacho. */
  manejador?: Manejador;
};

export type Manejador = {
  linea: number;
  hasta: number;
  /** Solo si la función vive en otro módulo del repo, importado por el archivo del verbo
   *  (`return estado.main()` con `from . import estado`). Sin él, es el archivo del verbo. */
  archivo?: Ruta;
  /** Las funciones del mismo módulo que el manejador a las que este llama, hasta dos saltos y
   *  ocho funciones (`main` → `calcular` → `resumir`): el trabajo a menudo está ahí. */
  llama?: { linea: number; hasta: number }[];
};

export type MetodoHttp = "get" | "post" | "put" | "patch" | "delete" | "all";

/**
 * Una ruta HTTP. `ruta` va en estilo Express: `:id` para un segmento dinámico, `:slug*` para el
 * resto de la ruta (`[...slug]` de Next) y `:slug*?` si ese resto es opcional (`[[...slug]]`).
 */
export type RutaApi = Ubicacion & {
  metodo: MetodoHttp;
  ruta: string;
  /** De dónde sale la ruta cuando no se declara llamando a un router: en Next, el archivo es la ruta. */
  marco?: "next-app-router" | "next-pages-router";
  /** Parámetros de consulta que lee el manejador (`searchParams.get("q")`, `req.query.q`). Solo si hay alguno. */
  consulta?: string[];
  /** El cuerpo JSON que valida el manejador, sacado del esquema zod que usa. Solo si se vio uno. */
  cuerpo?: CuerpoInferido;
  /**
   * Lo que se vio de cada parámetro de `consulta` (en el mismo orden): cómo lo convierte el
   * manejador, su valor por defecto, sus topes y con qué valores lo compara. Solo si hay consulta.
   */
  consulta_detalle?: ParametroDeConsulta[];
  /** Lo que devuelve el manejador cuando sale bien, sacado de su `return`. Solo si se vio. */
  respuesta?: RespuestaInferida;
  /** El comentario de documentación (JSDoc) justo encima del manejador, sin los delimitadores. */
  doc?: string;
};

/** Lo que se vio de un parámetro de consulta en el código del manejador. Lo que no se vio, falta. */
export type ParametroDeConsulta = {
  nombre: string;
  /** La línea donde se lee. */
  linea: number;
  /** Cómo lo convierte el manejador: `Number()` es número, `parseInt()` o zod `.int()` entero. */
  tipo?: TipoDeCampo;
  /** El valor que toma si no viene (`|| 30`, `?? "todas"`, `.default(30)`, `{ dias = 30 }`). */
  por_defecto?: string | number | boolean;
  /** Topes: `Math.max(…, 1)` es el mínimo y `Math.min(…, 200)` el máximo; en zod, `.min()` y `.max()`. */
  minimo?: number;
  maximo?: number;
  /** Los valores literales con los que lo compara (`estado === "pagada"`) o los de su `z.enum([…])`. */
  valores?: string[];
  /** Solo si el esquema zod que lo valida lo exige (sin `.optional()` ni `.default()`). */
  requerido?: boolean;
  /** La variable local que lo guarda (`const limite = …`): sirve para seguirlo en la respuesta. */
  variable?: string;
  /** Si la variable entra en el `where` de una consulta de Prisma: filtra lo que se devuelve. */
  filtra?: boolean;
};

/**
 * Un periodo de fechas que se vio en el código, en días respecto del inicio de hoy: `desde` es el
 * primer día (0 hoy, -6 hace seis días) y `hasta` el día en que acaba, sin incluirlo (1 es hasta el
 * final de hoy; null, hasta ahora). Con `parametro`, son los últimos «parametro» días.
 */
export type PeriodoInferido = { desde: number; hasta: number | null; parametro?: string; expresion: string };

/** Una consulta de Prisma de la que sale (parte de) la respuesta. */
export type ConsultaPrisma = {
  /** El delegado tal como se escribe (`venta`, `facturaProveedor`): el modelo, en minúscula inicial. */
  modelo: string;
  operacion: string;
  /** `orderBy`, como `campo asc|desc`. */
  orden?: string[];
  /** `take`: un número o el nombre del parámetro de consulta que lo fija. */
  tope?: number | string;
  /** Las relaciones de `include`. */
  incluye?: string[];
  /** `by` de un groupBy. */
  agrupa?: string[];
};

/** Una clave de la respuesta y lo que se pudo seguir de su valor. */
export type ClaveDeRespuesta = {
  nombre: string;
  /** Si su valor es un objeto literal, sus claves. */
  claves?: ClaveDeRespuesta[];
  periodo?: PeriodoInferido;
  consulta?: ConsultaPrisma;
};

/** Lo que devuelve el manejador al salir bien: un objeto con claves, o lo que da una consulta de Prisma. */
export type RespuestaInferida = {
  linea: number;
  /** objeto: un literal con `claves`. lista/registro: lo que devuelve `consulta`. desconocida: no se pudo seguir. */
  forma: "objeto" | "lista" | "registro" | "desconocida";
  claves?: ClaveDeRespuesta[];
  consulta?: ConsultaPrisma;
  periodo?: PeriodoInferido;
  /** Claves que el manejador añade a cada elemento de la lista (`.map((f) => ({ ...f, vencida }))`). */
  anade?: string[];
  /** El código HTTP con que responde, si se ve (`ok(venta, 201)`). */
  estado?: number;
};

export type TipoDeCampo = "texto" | "numero" | "entero" | "booleano" | "fecha" | "lista" | "objeto" | "otro";

export type CampoDelCuerpo = {
  nombre: string;
  tipo: TipoDeCampo;
  requerido: boolean;
  /** `.default(x)` de zod o `@default(x)` de Prisma. Solo si se vio. */
  por_defecto?: string | number | boolean;
  /** `.min()`/`.max()` de zod: el valor en números, el largo en textos, los elementos en listas. */
  minimo?: number;
  maximo?: number;
  /** Los valores de un `z.enum([…])` literal. */
  valores?: string[];
  /** El nombre de la lista de valores cuando el enum no es literal (`z.enum(METODOS_PAGO)`). */
  valores_de?: string;
};

/** Lo que se pudo inferir del cuerpo JSON de una petición, y de dónde. */
export type CuerpoInferido = {
  origen: "zod" | "prisma";
  /** El esquema zod (`esquemaOrden`) o el modelo de Prisma (`Producto`). */
  nombre: string;
  desde: Ubicacion;
  campos: CampoDelCuerpo[];
};

export type ToolMcp = Ubicacion & { nombre: string };

export type Superficies = {
  /** Subcomandos de CLI encontrados en el código. */
  cli: VerboCli[];
  /** Rutas HTTP declaradas en el código. */
  api: RutaApi[];
  /** Tools de MCP registradas en el código del repo. */
  mcp_tools: ToolMcp[];
  /** Banderas largas (`--algo`) que aparecen en el código de las CLIs, por archivo. */
  banderas: { archivo: Ruta; banderas: string[] }[];
};

export type Mcp = {
  /** Servidores MCP configurados para quien trabaja en el repo (`.mcp.json` y parecidos). */
  configurado: { archivo: Ruta; servidores: string[] }[];
  /** Dependencias que traen un SDK de MCP. */
  sdk: string[];
};

export type FormatoDeDatos = "json" | "jsonl" | "yaml" | "toml" | "csv" | "markdown" | "sqlite" | "prisma" | "otro";

/** Dominio: el estado del negocio. Interfaz: preferencias y estado de pantalla. */
export type RolDeEstado = "dominio" | "interfaz" | "desconocido";

export type ArchivoDeEstado = {
  ruta: Ruta;
  formato: FormatoDeDatos;
  rol: RolDeEstado;
  bytes: number;
  caracteres: number;
  /** Por qué se tomó por archivo de estado (nombre, carpeta). */
  motivo: string;
  /** Claves de primer nivel (JSON/YAML/TOML) o del primer registro (JSONL), o del frontmatter (md).
   *  En Markdown, además, «id» si al menos la mitad de los ítems de lista del cuerpo llevan un id
   *  de bloque de Obsidian (`- [ ] tarea ^abc-123`): la entidad es la línea y su id va en ella. */
  claves?: string[];
  /** Registros, para JSONL y CSV. */
  registros?: number;
  /** Los modelos de un esquema de Prisma: el estado vive en la base de datos, esto es su forma. */
  modelos?: ModeloDeDatos[];
};

export type ModeloDeDatos = {
  nombre: string;
  linea: number;
  /** La tabla de `@@map("…")`, si la renombra. */
  tabla?: string;
  campos: CampoDelModelo[];
};

export type CampoDelModelo = {
  nombre: string;
  /** El tipo tal cual (`String`, `Int`, `Categoria`), sin `?` ni `[]`. */
  tipo: string;
  lista: boolean;
  opcional: boolean;
  /** Lo genera la base o Prisma: `@id @default(…)`, `@default(…)`, `@updatedAt`. */
  por_defecto: boolean;
  id: boolean;
  /** El tipo es otro modelo: una relación, no una columna. */
  relacion: boolean;
  /** El tipo es un `enum` del esquema: en JSON va como texto. */
  enumerado: boolean;
  linea: number;
};

export type ArchivoDeContrato = {
  ruta: Ruta;
  tipo: "json-schema" | "tipos" | "modelo" | "openapi" | "documento";
  motivo: string;
};

export type Lenguaje = "typescript" | "javascript" | "python" | "shell" | "go" | "rust" | "ruby" | "otro";

export type Modulo = {
  ruta: Ruta;
  lenguaje: Lenguaje;
  lineas: number;
  caracteres: number;
  /** Lo que importa, tal cual se escribe (`./lector.ts`, `node:fs`, `gi.repository`). */
  imports: string[];
  /** Imports relativos resueltos a archivos del repo. */
  imports_locales: Ruta[];
  es_prueba: boolean;
};

export type Pruebas = {
  archivos: Ruta[];
  /** Scripts de manifiesto que corren pruebas o chequeos (test, check, pytest…). */
  comandos: (Script & { manifiesto: Ruta })[];
  /** Configuración de corredores encontrada (pytest.ini, vitest.config.ts…). */
  configuracion: Ruta[];
};

export type ArchivoDeTareas = {
  ruta: Ruta;
  /** Ítems de lista con casilla (`- [ ]`, `- [x]`). */
  tareas: number;
  hechas: number;
  /** Las que tienen criterio de hecho: «hecho cuando», aceptación, o una sublista de casillas. */
  con_criterio: number;
  sin_criterio: Ubicacion[];
};

export type Trazabilidad = {
  git: boolean;
  /** Archivos de solo anexar que parecen bitácora (jsonl de eventos, auditoría), o una carpeta
   *  de un Markdown por día (`bitacora/AAAA-MM-DD.md`), que cuenta como una sola: entonces `ruta`
   *  es el día más reciente, `claves` las del frontmatter y `archivos` cuántos días hay. */
  bitacoras: { ruta: Ruta; registros: number; claves: string[]; archivos?: number }[];
};

export type TipoDeSenal =
  | "serializa-json"
  | "clave-de-esquema"
  | "importa-interfaz"
  | "escribe-archivo"
  | "reemplazo-atomico"
  | "transaccion"
  | "compara-huella"
  | "bandera-de-ensayo"
  | "construye-error"
  | "campo-de-salida"
  | "campo-reintentable"
  | "codigo-de-salida"
  | "manejador-de-errores"
  | "fallo-silencioso"
  | "tabla-de-auditoria";

/** Una línea de código que coincide con un patrón que la rúbrica sabe leer. Describe, no puntúa. */
export type Senal = Ubicacion & { tipo: TipoDeSenal; texto: string };

export type Buscado = {
  guias: string[];
  manifiestos: string[];
  mcp: string[];
  estado: string[];
  tareas: string[];
  pruebas: string[];
};

export type Limites = {
  max_archivos: number;
  max_bytes_por_archivo: number;
  max_bytes_contenido: number;
  /** Carpetas que no se recorren nunca (dependencias, compilados, control de versiones). */
  carpetas_ignoradas: string[];
  /** Si se cortó el recorrido por `max_archivos`: lo que falta no se vio. */
  truncado: boolean;
  /** Archivos de código que no se leyeron por pasar de `max_bytes_por_archivo`. */
  no_leidos: Ruta[];
  /** Lenguajes vistos para los que no se extraen imports ni superficies. */
  lenguajes_sin_soporte: Lenguaje[];
};
