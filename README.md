# AX Designer

Los agentes gastan demasiados tokens y rondas enterándose de un repositorio antes de poder
tocarlo. AX Designer es a la Agent Experience lo que el diseño de UX es a las personas: audita un
repo, mide cuánto le cuesta a un agente enterarse de él y **genera el código** —un CLI de verbos
estrechos y un MCP server que lo envuelve— para que un agente lo opere con menos tokens, menos
rondas y menos errores. Después lo comprueba poniendo a un agente de verdad a resolver las mismas
tareas con y sin lo generado.

```sh
npm install -g ax-designer    # o: npm install github:Rafael088/ax-designer
axd auditar ./mi-repo --formato md
```

Requiere Node ≥ 22.18. Todo devuelve JSON (`--formato md` para leerlo una persona), y **nada
escribe ni gasta sin `--aplicar` o `--correr`**: lo que escribe o gastaría se ensaya primero.

## Qué hace

| Verbo | Para qué |
| --- | --- |
| `axd estado <repo>` | El resumen barato (< 1k tokens, JSON con esquema): puntuación por eje, críticos pendientes, si lo generado en `ax/` está al día con el contrato, las corridas guardadas y el siguiente paso. No escribe ni gasta. |
| `axd analizar <repo>` | El Inventario en JSON: qué hay, qué se lee al entrar, dónde está el estado. No escribe ni gasta. |
| `axd medir <repo>` | El costo de descubrimiento, camino por camino: cuántos tokens cuesta enterarse por cada vía. |
| `axd auditar <repo>` | El informe por los 7 ejes de la rúbrica AX, con puntuación, nivel y hallazgos ordenados por lo que ahorran. |
| `axd contrato <repo>` | El contrato propuesto: los verbos de solo lectura y de escritura que un agente debería poder usar, y las transiciones vedadas. |
| `axd generar <cli\|mcp> <repo>` | Sin `--aplicar`, el ensayo: qué archivos crearía y por qué. Con `--aplicar`, los escribe en `ax/` del repo objetivo. |
| `axd validar <repo> --tareas <archivo>` | Sin `--correr`, el plan de corridas (cada tarea, sin y con lo generado) y su costo estimado. Con `--correr` las ejecuta con un agente real y compara rondas, tokens y costo. |

```sh
axd estado ../mi-repo                        # cómo está, en poco, y qué toca después
axd auditar ../mi-repo --formato md          # qué le cuesta a un agente enterarse
axd generar cli ../mi-repo                   # ensayo: qué crearía y por qué
axd generar cli ../mi-repo --aplicar         # ax/contrato.json + ax/cli.mjs
axd generar mcp ../mi-repo --aplicar         # ax/mcp/: el MCP server que envuelve al CLI
axd validar ../mi-repo --tareas tareas.json  # plan y costo estimado (no gasta)
axd validar ../mi-repo --tareas tareas.json --correr   # corre agentes de verdad: GASTA
```

## Por qué confiar en el número

- La rúbrica son [7 ejes con criterios medibles](docs/rubrica.md): cada decisión de `axd auditar`
  trae su evidencia (archivo y línea, o la medición con su camino), y lo que no se puede medir
  sale `sin-evidencia` y baja la cobertura — nunca se adivina.
- Los tokens salen de un solo Contador (caracteres / 4) en toda la herramienta.
- `axd validar --correr` no compara impressiones: pone a un agente real a resolver las mismas
  tareas en copias del repo, con y sin lo generado, y mide la diferencia
  ([docs/validador.md](docs/validador.md)).

## Guías

- **[Guía de uso](docs/uso.md)** — el flujo completo `analizar → auditar → contrato → generar →
  validar`, los códigos de salida y el modo ensayo.
- **[La rúbrica AX](docs/rubrica.md)** — los 7 ejes, cómo se decide cada criterio y cómo se puntúa.
- **[El validador](docs/validador.md)** — las corridas con agentes reales y su costo.
- **[AGENTS.md](AGENTS.md)** — para quien trabaje el código (persona o agente).

## Desarrollo

```sh
npm install
npm run check          # tipos + pruebas
npm run axd -- --help  # el CLI desde el código, sin compilar
```

## Licencia

MIT — ver [LICENSE](LICENSE).
