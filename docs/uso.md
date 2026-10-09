# Guía de uso

`axd` se usa en dos pases: primero **mirar** (analizar, medir, auditar, contrato — nunca escriben
ni gastan), después **actuar** (generar, validar), donde todo lo que escribe o gasta es un *ensayo*
hasta que digas `--aplicar` o `--correr`. Toda la salida es JSON en stdout; en `auditar`,
`--formato md` la vuelve legible para una persona (y deja de ser contrato). Los códigos de
salida son:

| Código | Significado |
| --- | --- |
| `0` | Bien. |
| `2` | Uso incorrecto: falta un argumento, la ruta no existe, el JSON de tareas está mal. El `error` nombra la clave. |
| `3` | Error: algo que dependía del entorno falló (permisos, el motor no disponible). Trae `reintentable`. |
| `4` | El destino cambió desde el ensayo: vuelve a ensayar. No escribe nada en este caso. |
| `5` | Hace falta una persona: el contrato tiene verbos que axd no sabe implementar, o `ax/` tiene archivos que no generó axd. |

## 0. El resumen: `estado`

```sh
axd estado ./mi-repo      # < 1k tokens: puntuación por eje, críticos, lo generado en ax/, corridas y siguiente paso
```

Es el primer verbo para un agente que llega a un repo: solo lee, devuelve JSON con `"esquema": 1`
y en `salida` el siguiente paso concreto. El detalle está en `auditar`.

## 1. Entrarse del repo: `analizar` y `medir`

```sh
axd analizar ./mi-repo    # el Inventario: estructura, guías, manifiestos, estado, verbos encontrados
axd medir ./mi-repo       # el costo de descubrimiento, camino por camino
```

`medir` responde la pregunta central: *¿cuántos tokens le cuesta a un agente enterarse de este
repo por cada camino?* Salida (abreviada):

```json
{
  "caracteres_por_token": 4,
  "caminos": [
    { "id": "guia-de-entrada", "que": "CLAUDE.md / AGENTS.md", "tokens": 1800 },
    { "id": "resumen", "que": "la lectura barata del estado", "tokens": 220 },
    { "id": "leer-el-codigo", "que": "el camino caro: recorrer src/ hasta enterarse", "tokens": 41000 }
  ]
}
```

Si el repo no tiene un camino barato, eso **es** el hallazgo: el número grande se reporta igual,
con la razón (`sin camino barato: el agente entra leyendo el código`).

## 2. Diagnosticar: `auditar`

```sh
axd auditar ./mi-repo              # JSON: la puntuación, clave por clave
axd auditar ./mi-repo --formato md # el informe para leerlo una persona
```

Evalúa los [7 ejes de la rúbrica](rubrica.md) (lectura barata, contrato separado de la vista,
verbos estrechos, escritura verificada, contexto progresivo, errores accionables, evidencia y
trazabilidad). Cada criterio sale `cumple` / `parcial` / `no-cumple` / `no-aplica` /
`sin-evidencia`, **con su evidencia**: archivo y línea, o la medición con su camino. Un `no-cumple`
por falta de algo dice qué se buscó y dónde; nunca «no se encontró» a secas.

El informe ordena los hallazgos por lo que ahorran o el riesgo que quitan, no por lo fáciles que
son de arreglar. Ejemplos del repo de pruebas (`pruebas/repos/`): `muy-malo` sale 13/100 (ausente),
`python-cli` 40 (incipiente) y `node-cli` 77 (suficiente).

## 3. Decidir qué generar: `contrato`

```sh
axd contrato ./mi-repo
```

Propone el Contrato del repo: los verbos de solo lectura y de escritura que un agente debería
poder usar, cada uno con su entrada, su salida y **qué hace sobre el estado del dominio**, y las
transiciones vedadas (lo que un agente no puede hacer: aprobarse, marcar entregado sin evidencia).
El contrato lleva una `huella` (sha256 de su contenido): es lo que firman los generadores.

## 4. Generar el código: `generar cli` y `generar mcp`

```sh
axd generar cli ./mi-repo            # ensayo: qué archivos crearía y por qué
axd generar cli ./mi-repo --aplicar  # los escribe en ax/ del repo objetivo
axd generar mcp ./mi-repo --aplicar  # el MCP server (stdio) que envuelve al CLI
```

El ensayo lista cada archivo con su ruta, tamaño, sha256 y el `por_que`. Con `--aplicar`:

- `ax/contrato.json` — el contrato, versionado en el repo. Es la fuente de ambos generadores:
  un verbo que no está en el contrato no es una tool.
- `ax/cli.mjs` — Node puro, sin dependencias, JSON por defecto, errores con `salida` y
  `reintentable`, exit codes como los de arriba.
- `ax/mcp/` — servidor stdio del SDK de MCP con una tool por verbo del contrato. El SDK es
  dependencia del repo objetivo, nunca de axd.

Reglas de seguridad que conviene conocer:

- **No pisa lo que no generó axd.** Si en `ax/` hay un archivo ajeno, sale con `5` y dice cuál.
- **No pisa lo que cambió.** Guarda la `huella` del ensayo: `--aplicar` sin ella, o con el destino
  modificado, sale con `4` y hay que volver a ensayar. Así dos agentes que generen a la vez no se
  pisan.
- Los verbos que el contrato no dice cómo implementar se listan en el ensayo: axd escribe
  `ax/cli.md` documentando qué quedó sin hacer y por qué.

**Apps web sin CLI ni MCP.** Si el repo es una app web (rutas de Next.js en `app/**/route.ts` o
`pages/api/**`, Express, Flask o FastAPI), cada método de cada ruta se vuelve un verbo:
`listar-`/`leer-` para GET, `crear-` para POST, `actualizar-`/`reemplazar-` para PATCH/PUT y
`borrar-` para DELETE. Los segmentos `[id]` son argumentos, y el cuerpo de una escritura se saca
del esquema zod del manejador o, si no hay, del modelo de Prisma. El CLI generado llama a la app
por HTTP, así que la app tiene que estar levantada:

```sh
AX_BASE_URL=http://localhost:3000 node ax/cli.mjs leer-productos 7
AX_BASE_URL=http://localhost:3000 node ax/cli.mjs crear-orders --cuerpo='{"...": "..."}' --aplicar
```

Sin `AX_BASE_URL` usa el puerto por defecto del marco (Next 3000, FastAPI 8000, Flask 5000). El
tiempo de espera se cambia con `AX_HTTP_ESPERA_MS`. Si la app no responde, sale con `3` y
`reintentable: true`.

Después de generar, la guía del repo objetivo debe enlazar `ax/cli.md` (o añádelo tú): sin eso,
un agente nuevo no sabe que la herramienta existe.

## 5. Comprobarlo de verdad: `validar`

Generar no es demostrar. `validar` pone a un agente real a resolver las mismas tareas del repo
objetivo **sin** y **con** lo generado, en copias temporales, y compara.

```sh
axd validar ./mi-repo --tareas tareas.json               # el plan y el costo estimado; no copia, no gasta
axd validar ./mi-repo --tareas tareas.json --correr      # corre: GASTA dinero de API
```

El archivo de tareas (mira `pruebas/validador/node-cli.tareas.json` como ejemplo):

```json
{
  "esquema": 1,
  "modelo": "sonnet",
  "tareas": [
    {
      "id": "titulo-de-t-1",
      "enunciado": "¿Cuál es el título de la tarea t-1? Contesta solo con el título.",
      "terminado": { "tipo": "respuesta-contiene", "texto": "Medir" },
      "presupuesto": { "rondas": 10, "usd": 0.5, "segundos": 300 }
    },
    {
      "id": "entregar-t-1",
      "enunciado": "Registra la entrega de t-1 con la evidencia «npm test pasa».",
      "terminado": { "tipo": "comando", "argv": ["node", "-e", "..."] },
      "presupuesto": { "rondas": 15, "usd": 0.75, "segundos": 600 }
    }
  ]
}
```

`terminado` admite tres tipos: `comando` (argv, con `codigo` de salida esperado opcional),
`archivo-contiene` (`ruta` relativa al repo + `texto`: el archivo dice lo que se pidió) y
`respuesta-contiene` (`texto`: la respuesta del agente lo contiene). El presupuesto es un tope, no una
meta: una corrida que lo pasa se corta y cuenta como fallo de la variante, no de la tarea.

Sin `--correr`, `validar` devuelve el plan (cada tarea × {sin, con} × repeticiones, alternando el
orden de las variantes para que el orden no favorezca a ninguna) y su costo estimado con la tabla
de precios de `src/validador/precios.json` —usa siempre tu propia tabla con `--precios precios.json`
para estimar con lo que pagas de verdad.

Con `--correr` (motor `claude`, necesita `claude` en el PATH):

```sh
axd validar ./mi-repo --tareas tareas.json --correr --repeticiones 3 --precios precios.json
```

Deja todo en `.ax-corridas/` del repo objetivo: transcripciones, usage de tokens y rondas por
corrida, y la comparación final —medianas por variante, dejando fuera los fallos del motor— en
rondas, tokens, costo y si la tarea terminó. `--motor mentira` ejercita el flujo completo sin
gastar un centavo (útil en CI y para entender la salida). Más detalle en [validador.md](validador.md).

## 6. El bucle completo, de principio a fin

```sh
axd auditar ./mi-repo --formato md            # 1. ¿qué le cuesta entrar a un agente?
axd contrato ./mi-repo                         # 2. ¿qué verbos debería tener?
axd generar cli ./mi-repo                      # 3. ensayo: ¿qué crearía?
axd generar cli ./mi-repo --aplicar            # 4. crearlo
axd generar mcp ./mi-repo --aplicar            # 5. el MCP que lo envuelve
axd auditar ./mi-repo --formato md             # 6. re-auditar: el número debe subir
axd validar ./mi-repo --tareas tareas.json --correr  # 7. y demostrarlo con un agente real
```
