// El analizador contra repos de mentira (pruebas/repos/), nunca contra este repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analizar, lectorDeDisco, lectorEnMemoria } from "../../src/analizador/index.ts";
import type { Inventario, TipoDeSenal } from "../../src/modelo/index.ts";

const REPOS = join(import.meta.dirname, "..", "repos");
const nodeCli = analizar(lectorDeDisco(join(REPOS, "node-cli")));
const pythonCli = analizar(lectorDeDisco(join(REPOS, "python-cli")));

function senales(inv: Inventario, tipo: TipoDeSenal) {
  return inv.senales.filter((s) => s.tipo === tipo).map((s) => `${s.archivo}:${s.linea}`);
}

test("el Inventario declara esquema 1 y sobrevive a JSON sin perder nada", () => {
  assert.equal(nodeCli.esquema, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(nodeCli)), nodeCli);
});

test("analizar dos veces el mismo repo da lo mismo", () => {
  assert.deepEqual(analizar(lectorDeDisco(join(REPOS, "node-cli"))), nodeCli);
});

test("estructura: cuenta archivos, extensiones y lo que hay en la raíz", () => {
  const { estructura } = nodeCli;
  assert.equal(estructura.archivos, 15);
  assert.equal(estructura.por_extension["ts"], 6);
  assert.deepEqual(estructura.raiz.carpetas, ["data", "src", "test"]);
  assert.ok(estructura.raiz.archivos.includes("README.md"));
  assert.deepEqual(estructura.lenguajes, { typescript: 6 });
  assert.ok(estructura.carpetas_principales.some((c) => c.ruta === "src/modelo" && c.archivos === 1));
});

test("guías: README, AGENTS y CLAUDE, cuál se carga sola y qué importa cada una", () => {
  const porTipo = Object.fromEntries(nodeCli.guias.map((g) => [g.tipo, g]));
  assert.deepEqual(Object.keys(porTipo).sort(), ["agents", "claude", "readme"]);
  assert.equal(porTipo["agents"]!.se_carga_al_entrar, true);
  assert.equal(porTipo["claude"]!.se_carga_al_entrar, true);
  assert.equal(porTipo["readme"]!.se_carga_al_entrar, false);
  assert.deepEqual(porTipo["claude"]!.incluye, ["AGENTS.md"]);
  assert.deepEqual(porTipo["readme"]!.comandos.map((c) => c.texto), ["tareas estado", "tareas listar --estado pendiente"]);
  assert.deepEqual(porTipo["readme"]!.titulos.map((t) => [t.nivel, t.texto]), [[1, "Tareas"], [2, "Uso"]]);
  assert.match(porTipo["agents"]!.contenido, /Dueño/);
  assert.equal(porTipo["agents"]!.caracteres, porTipo["agents"]!.contenido.length);
});

// Hallazgo al auditar axd contra sí mismo: contaba
// pruebas/repos/node-cli/AGENTS.md —un repo de mentira para las pruebas del propio analizador—
// como si documentara a axd. Un AGENTS.md bajo pruebas/ (o tests/, spec/...) no es una guía de
// este repo; uno fuera de ahí sigue contando igual.
test("un AGENTS.md o CLAUDE.md bajo pruebas/ no es una guía de este repo; uno fuera de ahí sí", () => {
  const inv = analizar(
    lectorEnMemoria({
      "AGENTS.md": "# Guía real",
      "pruebas/repos/node-cli/AGENTS.md": "# Guía de un repo de mentira para las pruebas",
      "pruebas/repos/node-cli/CLAUDE.md": "# También de mentira",
      "tests/fixtures/otro/AGENTS.md": "# De mentira, con la otra carpeta de pruebas",
    }),
  );
  assert.deepEqual(inv.guias.map((g) => g.ruta), ["AGENTS.md"]);
});

test("manifiesto de Node: scripts con su línea, dependencias y el bin resuelto a su fuente .ts", () => {
  const [paquete] = nodeCli.manifiestos;
  assert.equal(paquete!.nombre, "@demo/tareas");
  assert.deepEqual(paquete!.scripts.map((s) => [s.nombre, s.linea]), [["build", 10], ["test", 11], ["check", 12]]);
  assert.deepEqual(paquete!.dependencias, ["@modelcontextprotocol/sdk", "express"]);
  assert.deepEqual(paquete!.dependencias_de_desarrollo, ["typescript"]);
  const bin = nodeCli.puntos_de_entrada.find((p) => p.tipo === "bin");
  assert.deepEqual(bin, { tipo: "bin", nombre: "tareas", ruta: "src/cli.ts", destino: "dist/cli.js", declarado_en: { archivo: "package.json", linea: 5 } });
  const main = nodeCli.puntos_de_entrada.find((p) => p.tipo === "main");
  assert.equal(main!.ruta, undefined, "dist/index.js no tiene fuente en el repo: no se inventa");
});

test("superficies de Node: verbos del switch del bin, rutas HTTP, tools de MCP y banderas", () => {
  const { superficies } = nodeCli;
  assert.deepEqual(superficies.cli.map((v) => [v.nombre, v.via, v.linea]), [["estado", "switch", 6], ["listar", "switch", 8], ["entregar", "switch", 10]]);
  assert.deepEqual(superficies.api.map((r) => `${r.metodo} ${r.ruta}`), ["get /estado", "post /tareas/:id/entregar"]);
  assert.deepEqual(superficies.mcp_tools.map((t) => t.nombre), ["estado", "entregar"]);
  assert.deepEqual(superficies.banderas, [{ archivo: "src/cli.ts", banderas: ["--dry-run", "--estado", "--evidencia"] }]);
});

test("MCP: servidores configurados y el SDK en las dependencias", () => {
  assert.deepEqual(nodeCli.mcp, { configurado: [{ archivo: ".mcp.json", servidores: ["tareas"] }], sdk: ["@modelcontextprotocol/sdk"] });
  assert.deepEqual(pythonCli.mcp, { configurado: [], sdk: ["fastmcp"] });
});

test("estado: el dominio separado de la interfaz, con formato y claves", () => {
  const porRuta = Object.fromEntries(nodeCli.estado.map((e) => [e.ruta, e]));
  assert.deepEqual(Object.keys(porRuta).sort(), ["data/bitacora.jsonl", "data/estado.json", "preferencias.json"]);
  assert.equal(porRuta["preferencias.json"]!.rol, "interfaz");
  assert.equal(porRuta["data/estado.json"]!.rol, "dominio");
  assert.deepEqual(porRuta["data/estado.json"]!.claves, ["esquema", "tareas"]);
  assert.equal(porRuta["data/bitacora.jsonl"]!.registros, 2);
  const python = Object.fromEntries(pythonCli.estado.map((e) => [e.ruta, e]));
  assert.deepEqual(python["estado.yaml"]!.claves, ["version", "tareas"]);
  assert.deepEqual([python["tareas.csv"]!.claves, python["tareas.csv"]!.registros], [["id", "titulo"], 2]);
  assert.ok(!nodeCli.estado.some((e) => e.ruta === "package.json" || e.ruta === ".mcp.json"), "la configuración no es estado");
});

test("contratos y módulos: el modelo, los imports y a qué archivo del repo apuntan", () => {
  assert.deepEqual(nodeCli.contratos, [{ ruta: "src/modelo/tipos.ts", tipo: "modelo", motivo: "bajo modelo/" }]);
  const almacen = nodeCli.modulos.find((m) => m.ruta === "src/almacen.ts")!;
  assert.deepEqual(almacen.imports, ["node:fs", "node:crypto", "./modelo/tipos.ts"]);
  assert.deepEqual(almacen.imports_locales, ["src/modelo/tipos.ts"]);
  const cli = pythonCli.modulos.find((m) => m.ruta === "herramienta/cli.py")!;
  assert.deepEqual(cli.imports, ["json", "os", "sys", "click", ".", ".almacen"]);
  assert.deepEqual(cli.imports_locales, ["herramienta/__init__.py", "herramienta/almacen.py"]);
});

test("pruebas: el comando documentado, los archivos y la configuración del corredor", () => {
  assert.deepEqual(nodeCli.pruebas.comandos.map((c) => c.nombre), ["test", "check"]);
  assert.deepEqual(nodeCli.pruebas.archivos, ["test/cli.spec.ts"]);
  assert.deepEqual(pythonCli.pruebas.comandos.map((c) => [c.manifiesto, c.nombre, c.comando]), [["Makefile", "test", "pytest -q"]]);
  assert.deepEqual(pythonCli.pruebas.archivos, ["tests/test_cli.py"]);
  assert.deepEqual(pythonCli.pruebas.configuracion, ["pyproject.toml"]);
});

test("tareas: cuántas, cuántas hechas y cuáles no tienen criterio de hecho", () => {
  assert.deepEqual(nodeCli.tareas, [{ ruta: "tareas.md", tareas: 3, hechas: 1, con_criterio: 2, sin_criterio: [{ archivo: "tareas.md", linea: 8 }] }]);
});

test("trazabilidad: la bitácora con sus claves; git solo si hay .git", () => {
  assert.deepEqual(nodeCli.trazabilidad, { git: false, bitacoras: [{ ruta: "data/bitacora.jsonl", registros: 2, claves: ["autor", "fecha", "evento", "id"] }] });
});

test("señales de Node: escritura con reemplazo y huella, JSON con esquema, errores con salida, fallos silenciosos", () => {
  assert.deepEqual(senales(nodeCli, "escribe-archivo"), ["src/almacen.ts:12"]);
  assert.deepEqual(senales(nodeCli, "reemplazo-atomico"), ["src/almacen.ts:13"]);
  assert.deepEqual(senales(nodeCli, "compara-huella"), ["src/almacen.ts:10"]);
  assert.deepEqual(senales(nodeCli, "clave-de-esquema"), ["src/cli.ts:7", "src/modelo/tipos.ts:2"]);
  assert.deepEqual(senales(nodeCli, "campo-de-salida"), ["src/cli.ts:12"]);
  assert.deepEqual(senales(nodeCli, "campo-reintentable"), ["src/cli.ts:12"]);
  assert.deepEqual(senales(nodeCli, "codigo-de-salida"), ["src/cli.ts:13"]);
  assert.deepEqual(senales(nodeCli, "bandera-de-ensayo"), ["src/cli.ts:16"]);
  assert.deepEqual(senales(nodeCli, "fallo-silencioso"), ["src/almacen.ts:20", "src/cli.ts:25"]);
  assert.deepEqual(senales(nodeCli, "importa-interfaz"), ["src/servidor.ts:1"]);
  const linea = nodeCli.senales.find((s) => s.tipo === "fallo-silencioso" && s.archivo === "src/cli.ts")!;
  assert.equal(linea.texto, "} catch {}");
});

test("Python: script de consola, verbos de click, rutas, tools, Makefile y señales; las pruebas no cuentan", () => {
  assert.deepEqual(pythonCli.puntos_de_entrada.map((p) => [p.tipo, p.nombre, p.ruta]), [["script-de-consola", "herramienta", "herramienta/cli.py"]]);
  assert.deepEqual(pythonCli.superficies.cli.map((v) => [v.nombre, v.via]), [["listar-tareas", "click"], ["entregar", "click"]]);
  assert.deepEqual(pythonCli.superficies.api.map((r) => `${r.metodo} ${r.ruta}`), ["get /tareas", "post /tareas/sync", "put /tareas/sync"]);
  assert.deepEqual(pythonCli.superficies.mcp_tools.map((t) => t.nombre), ["buscar", "leer-tarea"]);
  const make = pythonCli.manifiestos.find((m) => m.tipo === "makefile")!;
  assert.deepEqual(make.scripts.map((s) => [s.nombre, s.comando]), [["test", "pytest -q"], ["lint", "ruff check . && ruff format --check ."]]);
  const py = pythonCli.manifiestos.find((m) => m.tipo === "pyproject.toml")!;
  assert.deepEqual([py.nombre, py.version, py.dependencias, py.dependencias_de_desarrollo], ["herramienta", "0.4.0", ["click", "fastmcp", "fastapi"], ["pytest"]]);
  assert.deepEqual(senales(pythonCli, "fallo-silencioso"), ["herramienta/cli.py:26", "herramienta/cli.py:28"]);
  assert.deepEqual(senales(pythonCli, "reemplazo-atomico"), ["herramienta/almacen.py:16"]);
  assert.deepEqual(senales(pythonCli, "tabla-de-auditoria"), ["migraciones/001.sql:2"]);
  assert.deepEqual(senales(pythonCli, "clave-de-esquema"), ["herramienta/cli.py:18"]);
  assert.ok(!pythonCli.senales.some((s) => s.archivo.startsWith("tests/")), "el código de pruebas no da señales");
});

test("un repo vacío da un Inventario vacío pero completo, con lo que se buscó", () => {
  const vacio = analizar(lectorEnMemoria({}));
  assert.equal(vacio.estructura.archivos, 0);
  assert.deepEqual([vacio.guias, vacio.manifiestos, vacio.superficies.cli, vacio.senales], [[], [], [], []]);
  assert.ok(vacio.buscado.guias.length > 0 && vacio.buscado.estado.length > 0 && vacio.buscado.pruebas.length > 0);
});

test("ignora dependencias y compilados, detecta .git y no lee lo que pasa del tope", () => {
  const inv = analizar(
    lectorEnMemoria({
      ".git/HEAD": "ref: refs/heads/main",
      "node_modules/x/index.js": "process.exit(1)",
      "dist/cli.js": "process.exit(1)",
      "src/grande.ts": "x".repeat(200),
      "main.go": "package main",
      ".claude/CLAUDE.md": "# Guía",
      "package.json": "{ roto",
    }),
    { maxBytesPorArchivo: 100 },
  );
  assert.equal(inv.trazabilidad.git, true);
  assert.equal(inv.estructura.archivos, 4);
  assert.deepEqual(inv.limites.no_leidos, ["src/grande.ts"]);
  assert.deepEqual(inv.limites.lenguajes_sin_soporte, ["go"]);
  assert.deepEqual(inv.guias.map((g) => [g.ruta, g.se_carga_al_entrar]), [[".claude/CLAUDE.md", true]]);
  assert.match(inv.manifiestos[0]!.error!, /No es JSON válido/);
});

test("con más archivos que el tope, corta y lo dice", () => {
  const inv = analizar(lectorEnMemoria({ "a.md": "", "b.md": "", "c.md": "" }), { maxArchivos: 2 });
  assert.equal(inv.estructura.archivos, 2);
  assert.equal(inv.limites.truncado, true);
});

test("un script sin extensión con shebang de Python es código: sus verbos de argparse cuentan", () => {
  const inv = analizar(
    lectorEnMemoria({
      "bin/tareas": '#!/usr/bin/env python3\nimport argparse\np = argparse.ArgumentParser()\nsub = p.add_subparsers()\nsub.add_parser("estado")\nsub.add_parser("listar")\np.add_argument("--json")\n',
    }),
  );
  assert.deepEqual(inv.modulos.map((m) => [m.ruta, m.lenguaje]), [["bin/tareas", "python"]]);
  assert.deepEqual(inv.superficies.cli.map((v) => [v.nombre, v.via]), [["estado", "argparse"], ["listar", "argparse"]]);
  assert.deepEqual(inv.puntos_de_entrada.map((p) => [p.tipo, p.ruta]), [["shebang", "bin/tareas"]]);
  assert.deepEqual(inv.superficies.banderas, [{ archivo: "bin/tareas", banderas: ["--json"] }]);
});

test("cada verbo de CLI trae las banderas de su ventana, hasta el verbo siguiente", () => {
  assert.deepEqual(nodeCli.superficies.cli.map((v) => [v.nombre, v.banderas]), [["estado", []], ["listar", ["--estado"]], ["entregar", ["--dry-run", "--evidencia"]]]);
  assert.deepEqual(pythonCli.superficies.cli.map((v) => [v.nombre, v.banderas]), [["listar-tareas", []], ["entregar", ["--dry-run"]]]);
});
