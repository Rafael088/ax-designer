# AX Designer — para quien trabaje aquí

AX Designer es `axd`, un CLI que audita la Agent Experience de **otro** repositorio (el repo
objetivo), mide cuánto le cuesta a un agente enterarse de él y genera el código —un CLI de verbos
estrechos y un MCP server que lo envuelve— para que un agente lo opere con menos tokens, menos
rondas y menos errores. Esto es lo que conviene saber antes de tocar nada.

## Antes de empezar

```sh
git status --short              # si no está limpio, averigua por qué antes de seguir
git log --oneline | head -3
npm install
npm run check                   # tipos + pruebas; todo en verde antes y después de tu cambio
```

- La arquitectura y las decisiones del proyecto están en el historial de commits y en `docs/`.
- La guía de uso, con ejemplos reales de la salida: [`docs/uso.md`](docs/uso.md).

## Cómo está repartido

La tubería es `analizar → medir → evaluar → informe`, y desde el informe, `contrato → generar →
validar`. Cada paso es una función de lo que le da el anterior; los tipos de lo que pasa entre
ellos están en `src/modelo/`, que no hace E/S ni importa nada.

La E/S vive en tres sitios y en ninguno más:

- `src/analizador/lector` — el único que **lee** el repo objetivo.
- `src/generadores/escritor` — el único que **escribe** en el repo objetivo.
- `src/validador/motores/` — lo único que **lanza procesos** (agentes de verdad, que cuestan).

Si escribes `node:fs` o `node:child_process` fuera de esos tres, algo se salió de su sitio.
`src/cli/` traduce argv a llamadas y resultados a JSON; no tiene lógica de dominio y nada lo
importa. La dependencia va en un solo sentido: `cli → módulos → modelo`.

La rúbrica son 7 ejes, **un archivo por eje** en `src/rubrica/`, cada uno con su `evaluar()`:
lectura barata, contrato separado de la vista, verbos estrechos con transiciones con dueño,
escritura verificada e idempotente, contexto progresivo, errores que dicen qué hacer, y evidencia
y trazabilidad.

Los criterios de cada eje, sus pesos, umbrales, la escala y cómo se puntúa son **datos**, en
`src/rubrica/criterios.json` (explicado en `docs/rubrica.md`): cada `evaluar()` los lee de ahí y
no los repite. Un criterio cuya `fuente` es `corrida` sale `sin-evidencia` en `auditar`; no se
adivina. Los `id` de criterio no se renombran: los informes los citan.

## Lo que no se cambia sin decisión consciente

- **`axd` tiene que aprobar su propia rúbrica.** Salida JSON con `"esquema": 1`; las claves se
  agregan, nunca se renombran. Errores con `error`, `salida` (el siguiente paso) y
  `reintentable`. Códigos: `0` bien, `2` uso, `3` error, `4` el destino cambió (vuelve a
  ensayar), `5` hace falta una persona. `--formato md` es para personas y no es contrato.
- **Lo que escribe o gasta es un ensayo por defecto.** `generar` sin `--aplicar` y `validar` sin
  `--correr` no tocan nada ni gastan nada, y fallan donde fallaría lo de verdad. No añadas una
  bandera que se salte el ensayo ni un prompt interactivo: quien usa `axd` es un agente.
- **El escritor no pisa lo que no generó o lo que cambió desde que lo generó.** Sale con `5`.
- **Los dos generadores salen del mismo `Contrato`, y el MCP envuelve al CLI.** Un verbo que no
  está en el contrato no es una tool.
- **Cero dependencias de ejecución.** Añadir una es una decisión tomada y documentada, no un
  `npm install`. El SDK de MCP es dependencia del repo objetivo, no de este.
- **Los números se miden, no se estiman.** Un hallazgo de costo trae su medición. Los tokens
  salen del `Contador` de `src/medicion/` y nunca de una cuenta suelta en otro módulo.

## Convenciones

- Todo en español: identificadores, verbos de la CLI, mensajes, comentarios, commits y
  documentación. Los nombres del dominio son los de la tubería (`Inventario`, `Medicion`, `Eje`,
  `Hallazgo`, `Informe`, `Contrato`); no inventes sinónimos.
- TypeScript estricto y ESM. Node corre el `.ts` directo, así que solo sintaxis borrable: nada de
  `enum`, `namespace` ni parámetros de propiedad en constructores; uniones de literales en vez de
  `enum`. Los imports relativos llevan la extensión `.ts`.
- Pruebas con `node:test` y `node:assert/strict`, en `pruebas/` con el mismo árbol que `src/`
  (`pruebas/rubrica/lectura-barata.test.ts`). El analizador y la rúbrica se prueban contra repos
  de mentira en `pruebas/repos/`, nunca contra este repo ni contra uno de verdad. El validador se
  prueba con un motor de mentira: **una prueba nunca lanza un agente real**.
- Comentarios solo donde el porqué no se ve en el código. Funciones pequeñas que devuelven datos;
  la prosa para personas solo en `src/informe/`.
- La versión vive en un solo sitio (`package.json`) y `src/cli/main.ts` la repite sincronizada:
  `pruebas/cli.test.ts` falla si se separan. Al publicar, sube `package.json`, `VERSION` y
  etiquetado a la vez.

## Cómo se aporta

1. Abre un issue describiendo el problema o la idea antes de escribir código grande.
2. Rama desde `master`, commits pequeños, y `npm run check` en verde en cada uno.
3. Commits en español, en imperativo y diciendo qué cambia para quien usa `axd`
   («Medir el costo de leer el README»), no qué archivo tocaste.
4. Si tu cambio toca una de las invariantes de arriba, dilo en el PR y justifica por qué.

## Publicar

```sh
npm run check && npm run build
# package.json y VERSION en src/cli/main.ts a la nueva versión, mismo commit
git tag vX.Y.Z && npm publish
```

`npm publish` lleva `dist/` (tsc copia también los JSON de datos) y nada más: mira el contenido
con `npm pack --dry-run` antes de publicar.
