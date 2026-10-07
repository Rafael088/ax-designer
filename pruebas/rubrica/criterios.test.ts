// Comprueba la forma de src/rubrica/criterios.json: es un contrato que leen los evaluar() de
// cada eje y `axd auditar`, así que se rompe en una prueba antes que en una auditoría.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raiz = new URL('../../', import.meta.url);
const rubrica = JSON.parse(readFileSync(new URL('src/rubrica/criterios.json', raiz), 'utf8'));
const documento = readFileSync(new URL('docs/rubrica.md', raiz), 'utf8');

// Los 7 ejes de la rúbrica, en su orden. Si cambian, cambian aquí a propósito.
const EJES: [string, string][] = [
  ['lectura-barata', 'Lectura barata'],
  ['contrato-separado-de-la-vista', 'Contrato separado de la vista'],
  ['verbos-estrechos', 'Verbos estrechos, y transiciones con dueño'],
  ['escritura-verificada', 'Escritura verificada e idempotente'],
  ['contexto-progresivo', 'Contexto progresivo'],
  ['errores-accionables', 'Errores que dicen qué hacer'],
  ['evidencia-y-trazabilidad', 'Evidencia y trazabilidad'],
];
const PREGUNTAS = new Set(['enterarse', 'actuar', 'demostrar']);
const IMPACTOS = new Set(['contexto', 'riesgo']);
const OPERADORES = new Set(['<=', '>=']);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const criterios: any[] = rubrica.ejes.flatMap((eje: any) => eje.criterios);

function textoNoVacio(valor: unknown): boolean {
  return typeof valor === 'string' && valor.trim().length > 0;
}

test('declara esquema y versión enteros', () => {
  assert.equal(rubrica.esquema, 1);
  assert.ok(Number.isInteger(rubrica.version) && rubrica.version >= 1);
});

test("tiene los 7 ejes de la rúbrica, numerados y en orden", () => {
  assert.deepEqual(
    rubrica.ejes.map((eje: any) => [eje.id, eje.nombre]),
    EJES,
  );
  rubrica.ejes.forEach((eje: any, i: number) => {
    assert.equal(eje.numero, i + 1, eje.id);
    assert.ok(PREGUNTAS.has(eje.pregunta), `${eje.id}: pregunta «${eje.pregunta}»`);
    assert.ok(typeof eje.peso === 'number' && eje.peso > 0, `${eje.id}: peso`);
    for (const campo of ['resumen', 'senal_de_problema', 'arreglo_tipico', 'referencia']) {
      assert.ok(textoNoVacio(eje[campo]), `${eje.id}: ${campo} vacío`);
    }
    assert.ok(eje.criterios.length >= 3, `${eje.id}: menos de 3 criterios`);
  });
});

test('las tres preguntas de la revisión tienen ejes', () => {
  assert.deepEqual(new Set(rubrica.ejes.map((eje: any) => eje.pregunta)), PREGUNTAS);
});

test('cada criterio tiene un id estable, único y colgado de su eje', () => {
  const vistos = new Set<string>();
  for (const eje of rubrica.ejes) {
    for (const criterio of eje.criterios) {
      const [prefijo, slug, ...resto] = String(criterio.id).split('/');
      assert.equal(prefijo, eje.id, criterio.id);
      assert.equal(resto.length, 0, criterio.id);
      assert.match(slug ?? '', SLUG, criterio.id);
      assert.ok(!vistos.has(criterio.id), `id repetido: ${criterio.id}`);
      vistos.add(criterio.id);
    }
  }
});

test('cada criterio se puede decidir: fuente, peso, textos de cada resultado y evidencia', () => {
  const fuentes = new Set(Object.keys(rubrica.fuentes));
  const evidencias = new Set(Object.keys(rubrica.evidencias));
  for (const c of criterios) {
    assert.ok(fuentes.has(c.fuente), `${c.id}: fuente «${c.fuente}»`);
    assert.ok([1, 2, 3].includes(c.peso), `${c.id}: peso ${c.peso}`);
    assert.equal(typeof c.critico, 'boolean', `${c.id}: critico`);
    assert.ok(IMPACTOS.has(c.impacto), `${c.id}: impacto «${c.impacto}»`);
    for (const campo of ['enunciado', 'como_se_mide', 'cumple', 'parcial', 'no_cumple']) {
      assert.ok(textoNoVacio(c[campo]), `${c.id}: ${campo} vacío`);
    }
    assert.ok(c.no_aplica_si === null || textoNoVacio(c.no_aplica_si), `${c.id}: no_aplica_si`);
    assert.ok(Array.isArray(c.evidencia) && c.evidencia.length > 0, `${c.id}: sin evidencia`);
    for (const tipo of c.evidencia) {
      assert.ok(evidencias.has(tipo), `${c.id}: evidencia «${tipo}»`);
    }
  }
});

test('la evidencia es coherente con la fuente', () => {
  for (const c of criterios) {
    if (c.fuente === 'corrida') {
      assert.deepEqual(c.evidencia, ['corrida'], `${c.id}: una corrida solo deja evidencia de corrida`);
    } else {
      assert.ok(!c.evidencia.includes('corrida'), `${c.id}: solo el validador produce corridas`);
    }
    if (c.fuente === 'medicion') {
      assert.ok(c.evidencia.includes('medicion'), `${c.id}: un criterio medido trae su medición`);
      assert.ok(c.metrica, `${c.id}: un criterio medido necesita métrica`);
    }
  }
});

test('las métricas tienen umbrales comparables y el de cumple es más exigente que el de parcial', () => {
  const nombres = new Set<string>();
  for (const c of criterios.filter((c) => c.metrica)) {
    const { nombre, unidad, cumple, parcial } = c.metrica;
    assert.match(nombre, /^[a-z0-9_]+$/, `${c.id}: nombre de métrica`);
    assert.ok(!nombres.has(nombre), `métrica repetida: ${nombre}`);
    nombres.add(nombre);
    assert.ok(textoNoVacio(unidad), `${c.id}: unidad`);
    for (const umbral of [cumple, parcial]) {
      assert.ok(OPERADORES.has(umbral.op), `${c.id}: operador «${umbral.op}»`);
      assert.equal(typeof umbral.valor, 'number', `${c.id}: valor`);
    }
    assert.equal(cumple.op, parcial.op, `${c.id}: cumple y parcial comparan distinto`);
    if (cumple.op === '<=') assert.ok(cumple.valor <= parcial.valor, `${c.id}: umbrales al revés`);
    else assert.ok(cumple.valor >= parcial.valor, `${c.id}: umbrales al revés`);
    if (unidad === 'proporcion') {
      assert.ok(cumple.valor <= 1 && parcial.valor >= 0, `${c.id}: proporción fuera de [0, 1]`);
    }
  }
});

test('la escala tiene los cinco resultados y niveles que cubren 0–100 sin huecos', () => {
  const { resultados, niveles, cobertura_minima } = rubrica.escala;
  assert.deepEqual(
    Object.fromEntries(Object.entries(resultados).map(([k, v]: [string, any]) => [k, [v.valor, v.cuenta]])),
    {
      cumple: [2, true],
      parcial: [1, true],
      'no-cumple': [0, true],
      'no-aplica': [null, false],
      'sin-evidencia': [null, false],
    },
  );
  assert.ok(cobertura_minima > 0 && cobertura_minima <= 1);
  assert.equal(niveles[0].desde, 0);
  niveles.forEach((tramo: any, i: number) => {
    assert.equal(tramo.nivel, i);
    assert.ok(tramo.desde < tramo.hasta, tramo.nombre);
    if (i > 0) assert.equal(tramo.desde, niveles[i - 1].hasta, `hueco antes de ${tramo.nombre}`);
  });
  assert.ok(niveles.at(-1).hasta > 100, 'el 100 tiene que caer en algún tramo');
});

test('docs/rubrica.md nombra cada eje y cada criterio, para que no se separen', () => {
  for (const [id, nombre] of EJES) {
    assert.ok(documento.includes(nombre), `falta el eje «${nombre}» en el documento`);
    assert.ok(documento.includes(`\`${id}\``), `falta el id «${id}» en el documento`);
  }
  for (const c of criterios) {
    assert.ok(documento.includes(`\`${c.id}\``), `falta «${c.id}» en docs/rubrica.md`);
  }
});
