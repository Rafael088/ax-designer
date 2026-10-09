# El validador: `axd validar`

Corre las mismas tareas con un agente de verdad dos veces —**sin** lo que generó axd y **con** lo
generado (el CLI, el MCP o los dos, según `--con`)— y compara rondas, tokens, costo y si terminó.

```sh
axd validar [repo] --tareas <archivo> [--correr] [--motor claude|mentira] [--con cli|mcp|ambos] [--repeticiones N] [--precios <archivo>]
```

- Sin `--correr` es un **ensayo**: devuelve el plan de corridas y su costo estimado. No copia, no
  escribe y no gasta, y falla donde fallaría la corrida (motor que no está: 3; un archivo de `ax/`
  que no generó axd: 5).
- Con `--correr` y el motor `claude` **gasta dinero**: lanza `claude -p --output-format stream-json
  --verbose` una vez por corrida. El resultado queda en `.ax-corridas/<fecha>-<contrato>.json` del
  repo objetivo, y la transcripción de cada corrida —lo que hizo el agente paso a paso, tal cual lo
  imprimió claude— en `.ax-corridas/<fecha>-<contrato>/<tarea>-<variante>-<repeticion>.jsonl`; cada
  resultado dice la suya en `transcripcion`. También se guarda la de una corrida en la que falló el
  motor, si alcanzó a imprimir algo. El uso, el costo y la respuesta salen del evento `result`.
- `--con` elige qué lleva la copia «con»:
  - `ambos` (por defecto): el CLI y el MCP generados, y una línea al final de la guía que el agente
    del motor carga solo (`CLAUDE.md` para claude; se crea si no existe) que apunta a `ax/cli.md`.
  - `cli`: solo el CLI generado y esa línea. Sin MCP no hay `npm install`, ni `--mcp-config`, ni
    tools diferidas que cargar con ToolSearch: mide si el CLI basta.
  - `mcp`: el CLI y el MCP, sin la línea (como antes de `--con`).
- `--motor mentira` no lanza ningún agente: devuelve la estimación como si fuera el resultado.
  Sirve para probar la tubería.

## El archivo de tareas

JSON. Ejemplo para `pruebas/repos/node-cli`: `pruebas/validador/node-cli.tareas.json`.

```json
{
  "esquema": 1,
  "modelo": "sonnet",
  "repeticiones": 1,
  "tareas": [
    {
      "id": "titulo-de-t-1",
      "enunciado": "¿Cuál es el título de la tarea t-1? Contesta solo con el título.",
      "terminado": { "tipo": "respuesta-contiene", "texto": "Medir" },
      "presupuesto": { "rondas": 10, "usd": 0.5, "segundos": 300 }
    }
  ]
}
```

| Clave | Qué es | Si falta |
| --- | --- | --- |
| `esquema` | Siempre `1` | Error 2 |
| `modelo` | El alias o id que se pasa a `claude --model`; el precio se busca por él | `sonnet` |
| `repeticiones` | Corridas por tarea y variante, de 1 a 10 (`--repeticiones` lo cambia) | `1` |
| `tareas[].id` | Minúsculas, números y guiones; único | Error 2 |
| `tareas[].enunciado` | Lo que se le pide al agente, igual en las dos variantes | Error 2 |
| `tareas[].terminado` | Cómo se sabe, **sin agente**, que la tarea quedó hecha (abajo) | Error 2 |
| `tareas[].presupuesto` | `rondas` (`--max-turns`), `usd` (`--max-budget-usd`) y `segundos` por corrida | 20, 1, 600 |

Los criterios de `terminado`, comprobados sobre la copia en la que trabajó el agente:

- `{ "tipo": "comando", "argv": ["npm", "test"], "codigo": 0 }`: el comando, sin shell, en la raíz
  de la copia, sale con `codigo` (0 si se omite).
- `{ "tipo": "archivo-contiene", "ruta": "data/bitacora.jsonl", "texto": "..." }`.
- `{ "tipo": "respuesta-contiene", "texto": "..." }`: la respuesta final del agente, para tareas de
  solo lectura.

## Cómo corre

1. Copia el repo al temporal del sistema dos veces, sin `.git`, `node_modules`, `.ax-corridas` ni lo
   que ya hubiera generado axd. En «con» aplica `generar cli` con el escritor y, según `--con`,
   `generar mcp` con `npm install` en `ax/mcp` (el SDK del MCP) y la línea en la guía. El repo
   original no se toca.
2. Cada corrida trabaja en una copia nueva de su plantilla. Las variantes se alternan dentro de
   cada repetición.
3. El motor `claude` corre con `--strict-mcp-config` en las dos variantes (no entran los MCP de
   quien lo lanza ni el `.mcp.json` del repo), `--permission-mode acceptEdits` y las mismas
   herramientas propias (`Read, Grep, Glob, Edit, Write, Bash`); el «con» con MCP suma el MCP
   generado por `--mcp-config` y sus tools (`mcp__<proyecto>`). `Bash` está permitido: el agente puede correr
   comandos con los permisos de quien lanza `axd`, aunque trabaje en una copia.
4. Tras cada corrida se comprueba `terminado`. Se compara por tarea con medianas: primero manda la
   tasa de terminado; con la misma, gastar menos tokens y rondas. Si ninguna variante terminó es
   empate. Las corridas en las que falló el motor no cuentan; sin ninguna válida de un lado,
   `sin-datos`.

## La estimación

Los tokens de lo que el agente leería salen del Contador (caracteres / 4) sobre la medición
(«sin»: la guía de entrada y el estado del dominio) y el contrato («con»: la guía y su línea, las
definiciones de las tools si lleva MCP —o `ax/cli.md` una vez si es solo el CLI— y el presupuesto
de la lectura barata). Lo que no se mide sin un agente —lo que manda
en cada ronda antes de la tarea y lo que escribe— son **supuestos** declarados en
`src/validador/precios.json`, junto con los precios por millón de tokens, su fuente y si se
verificaron. La fórmula va en cada plan (`estimacion.formula`). Es un orden de magnitud; el tope de
gasto real es `usd_tope`, la suma de los presupuestos, que se le pasa al motor como límite.

`--precios <archivo>` reemplaza la tabla con una del mismo formato.
