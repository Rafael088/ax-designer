# La rúbrica AX

Los 7 ejes de la Revisión AX —la metodología de Agent Experience que `axd` aplica—, vueltos criterios
que se pueden decidir mirando el repo objetivo, con una escala y un cálculo fijos. La metodología dice
**qué** mirar; esto dice **cuándo se cumple** y **cómo se mide**, para que dos auditorías del mismo
repo den lo mismo.

Los datos viven en [`src/rubrica/criterios.json`](../src/rubrica/criterios.json) y son el contrato:
cada `evaluar()` de `src/rubrica/<eje>.ts` lee de ahí sus criterios, sus pesos y sus umbrales, y no
los repite en el código. Este documento los explica para personas. `pruebas/rubrica/criterios.test.ts`
comprueba la forma del JSON y que aquí se nombre cada criterio, así que si añades uno, añádelo en
los dos sitios.

El JSON lleva `"esquema": 1` (su forma) y `"version"` (su contenido). Cambiar un umbral, un peso o
un criterio sube `version`; renombrar o quitar un `id` no se hace: los informes guardados los citan.

## Cómo se decide un criterio

Cada criterio es un enunciado observable («existe un camino de solo lectura que devuelve el estado
resumido») con su forma de medirlo y lo que significa cada resultado.

| Resultado | Valor | Cuándo |
| --- | --- | --- |
| `cumple` | 2 | Se ve en el repo, con evidencia |
| `parcial` | 1 | Se ve a medias: no en todos los casos, o existe y no se descubre |
| `no-cumple` | 0 | No se ve, o se ve lo contrario |
| `no-aplica` | — | Se da su condición `no_aplica_si`; sale del cálculo, con el motivo |
| `sin-evidencia` | — | Aplica pero no se puede decidir con lo disponible; sale del cálculo y baja la cobertura |

**De dónde sale cada decisión** (`fuente`):

- `inventario` — del `Inventario` del analizador: archivos, manifiestos, guías, código leído sin
  ejecutar.
- `medicion` — de un número del `Contador` de `src/medicion/` (tokens = caracteres / 4, el mismo
  factor en toda la herramienta). Lleva `metrica` con umbrales: `cumple` y `parcial` comparan con el mismo
  operador y el de `cumple` es más exigente.
- `corrida` — solo ejecutando algo del repo objetivo, que es del validador (`axd validar --correr`).
  `axd auditar` no lanza procesos, así que esos criterios le salen `sin-evidencia`. **No se
  adivinan**: un número que no se midió no entra en la puntuación.

**Toda decisión lleva evidencia**, de uno de los tipos que admite el criterio: `archivo` (ruta y
línea), `medicion` (camino y tokens), `ausencia` (qué se buscó y dónde, para que otro repita la
búsqueda) o `corrida` (comando, código y salida). Un `no-cumple` por falta de algo trae su
`ausencia`; nunca sale «no se encontró» sin decir dónde se buscó.

## Cómo se puntúa un eje

```
puntuación = round(100 × Σ(peso × valor) / Σ(peso × 2))     sobre los que cuentan
cobertura  = Σ peso de los que cuentan / Σ peso de los que aplican
```

| Nivel | Nombre | Puntuación |
| --- | --- | --- |
| 0 | ausente | 0–24 |
| 1 | incipiente | 25–49 |
| 2 | suficiente | 50–79 |
| 3 | ejemplar | 80–100 |

Tres reglas encima del número:

1. **Un crítico en `no-cumple` deja el eje en 1 como mucho.** Hay criterios sin los que el eje no
   significa nada (no hay resumen; el agente se aprueba solo; se pisa en silencio): ningún otro
   acierto los compensa.
2. **Con cobertura por debajo de 0,5 el eje no tiene nivel** («sin evaluar»): se informa la
   puntuación, pero con menos de la mitad del peso decidido no representa al eje.
3. **Si todo el eje es `no-aplica`, el eje es `no-aplica`**, con el porqué, y no cuenta como 0.

La puntuación global es la media simple de los ejes con nivel. El informe enseña siempre los 7.

**Ejemplo** — Eje 1 de un repo con un `--estado` que devuelve JSON resumido: resumen (peso 3) cumple,
formato (2) cumple, esquema (2) no-cumple, costo del resumen (2) cumple, ahorro (3) cumple,
sin cargar la app (2) cumple. Σ(peso × valor) = 6 + 4 + 0 + 4 + 6 + 4 = 24 sobre 28 → **86, ejemplar**. El esquema sigue
siendo un hallazgo (brecha 2 × 2 = 4): el nivel resume el eje, los hallazgos dicen qué falta.

## Cómo se ordenan los hallazgos

Cada criterio en `parcial` o `no-cumple` es un `Hallazgo`. Se ordenan por lo que ahorran o el
riesgo que quitan, no por lo fácil que es arreglarlos:

1. Los críticos en `no-cumple`.
2. Por brecha = peso × (2 − valor), de mayor a menor.
3. A igual brecha, los de `impacto: contexto` con medición, por los tokens que ahorraría el cambio.
4. A igualdad, por número de eje y orden del criterio en el JSON, para que el orden sea estable.

## Los criterios, eje por eje

Columnas: **F** fuente (inv · med · corr), **P** peso, **★** crítico. El texto completo de cada
resultado y cómo se mide está en el JSON.

### 1. Lectura barata · `lectura-barata` · enterarse

¿Puede el agente conocer el estado en una llamada, en formato de máquina y en milisegundos?

| Criterio | F | P | Cumple si |
| --- | --- | --- | --- |
| `lectura-barata/resumen-existe` ★ | inv | 3 | Hay un camino de solo lectura al estado resumido y la guía o el README lo nombran |
| `lectura-barata/formato-de-maquina` | inv | 2 | Sale en JSON por defecto |
| `lectura-barata/esquema-versionado` | inv | 2 | Declara su versión de esquema y la regla «se agregan claves, no se renombran» |
| `lectura-barata/costo-del-resumen` | med | 2 | ≤ 500 tokens (parcial ≤ 2.000) |
| `lectura-barata/ahorro-frente-al-camino-caro` | med | 3 | El caro cuesta ≥ 10 veces más (parcial ≥ 3); sin barato, el costo del caro es el hallazgo |
| `lectura-barata/sin-cargar-la-app` | inv | 2 | El resumen no importa la interfaz ni arranca la app |

### 2. Contrato separado de la vista · `contrato-separado-de-la-vista` · enterarse

¿El estado del dominio vive en un formato que el agente lee directo, y el de interfaz aparte?

| Criterio | F | P | Cumple si |
| --- | --- | --- | --- |
| `contrato-separado-de-la-vista/dominio-legible` | inv | 3 | El dominio persiste en un formato abierto que se lee sin la app |
| `contrato-separado-de-la-vista/interfaz-aparte` | inv | 2 | El estado de pantalla tiene su propio archivo, tabla o carpeta |
| `contrato-separado-de-la-vista/lectura-sin-la-vista` | inv | 2 | El agente lee datos, nunca HTML, TUI ni texto formateado |
| `contrato-separado-de-la-vista/contrato-documentado` | inv | 2 | El formato está escrito (tipos, schema, docs) y coincide con lo que se escribe |
| `contrato-separado-de-la-vista/modelo-sobre-el-almacenamiento` | inv | 1 | Una capa de modelo sin E/S separa lo que ve el agente del formato de disco |

### 3. Verbos estrechos, y transiciones con dueño · `verbos-estrechos` · actuar

¿Hay operaciones con nombre en vez de «escribe el archivo», y qué no puede hacer el agente?

| Criterio | F | P | Cumple si |
| --- | --- | --- | --- |
| `verbos-estrechos/operaciones-con-nombre` | inv | 3 | Hay verbos de escritura y la guía los da como la única vía |
| `verbos-estrechos/superficie-estrecha` | inv | 1 | ≤ 15 verbos expuestos (parcial ≤ 30) |
| `verbos-estrechos/transiciones-con-dueno` | inv | 2 | Hay un mapa de quién hace cada transición y el código lo hace cumplir |
| `verbos-estrechos/sin-autoaprobacion` ★ | inv | 3 | Ningún verbo del agente aprueba ni cierra su trabajo, y la guía lo dice |
| `verbos-estrechos/devuelve-estado-nuevo` | inv | 2 | ≥ 80 % de los verbos de escritura devuelven el estado resultante (parcial ≥ 40 %) |

### 4. Escritura verificada e idempotente · `escritura-verificada` · demostrar

¿Comprueba que lo leído sigue igual antes de escribir, escribe atómico y reintentar es seguro?

| Criterio | F | P | Cumple si |
| --- | --- | --- | --- |
| `escritura-verificada/huella-de-lectura` ★ | inv | 3 | Toda escritura compara una huella de lo leído y falla con error propio si cambió |
| `escritura-verificada/escritura-atomica` | inv | 2 | Temporal + reemplazo, o transacción, en todas las escrituras |
| `escritura-verificada/reintento-seguro` | corr | 2 | Correr dos veces cada verbo deja el mismo estado (parcial: la mitad) |
| `escritura-verificada/ensayo-antes-de-escribir` | inv | 1 | Lo grande o irreversible es ensayo por defecto y se pide `--aplicar` |

### 5. Contexto progresivo · `contexto-progresivo` · enterarse

¿Se puede pedir poco y luego más: índice barato, detalle bajo demanda y filtros?

| Criterio | F | P | Cumple si |
| --- | --- | --- | --- |
| `contexto-progresivo/tres-tamanos` | inv | 3 | Hay resumen, lista y detalle (parcial: dos de los tres) |
| `contexto-progresivo/filtros` | inv | 2 | La lista acepta ≥ 2 filtros (parcial: 1) |
| `contexto-progresivo/identificadores-estables` | inv | 3 | Cada entidad guarda un id estable que los verbos aceptan |
| `contexto-progresivo/guia-de-entrada-acotada` | med | 2 | Hay guía para agentes y cuesta ≤ 2.500 tokens (parcial ≤ 6.000) |
| `contexto-progresivo/lectura-acotada` | inv | 1 | La lectura más amplia tiene tope por defecto |

### 6. Errores que dicen qué hacer · `errores-accionables` · actuar

¿El error nombra la causa y la salida, y distingue lo reintentable?

| Criterio | F | P | Cumple si |
| --- | --- | --- | --- |
| `errores-accionables/errores-estructurados` | inv | 2 | Un manejador central serializa todos los errores |
| `errores-accionables/nombran-la-salida` | inv | 3 | ≥ 80 % de los errores dicen el siguiente paso (parcial ≥ 40 %) |
| `errores-accionables/reintentable-distinguido` | inv | 2 | Campo de reintento o códigos de salida distintos, documentados |
| `errores-accionables/fallos-visibles` | inv | 2 | Ningún `catch` vacío ni valor por defecto que esconda un fallo (parcial ≤ 2) |

### 7. Evidencia y trazabilidad · `evidencia-y-trazabilidad` · demostrar

¿Cómo demuestra el agente lo que hizo, y dónde queda quién hizo qué?

| Criterio | F | P | Cumple si |
| --- | --- | --- | --- |
| `evidencia-y-trazabilidad/entrega-con-evidencia` | inv | 3 | El verbo de entrega se niega sin evidencia |
| `evidencia-y-trazabilidad/registro-de-quien-hizo-que` | inv | 2 | Bitácora del dominio con autor y fecha (parcial: solo git) |
| `evidencia-y-trazabilidad/pruebas-repetibles` | inv | 2 | Un comando de pruebas documentado, con pruebas detrás |
| `evidencia-y-trazabilidad/criterio-de-hecho` | inv | 1 | ≥ 80 % de las tareas del repo tienen criterio de hecho (parcial ≥ 40 %) |

## Dónde se comprueba

La rúbrica se calibró contra auditorías AX hechas a mano sobre repos reales: cada fila de hallazgos
de esas revisiones tiene que salir como `parcial` o `no-cumple` en su criterio, y lo que la
revisión daba por bueno tiene que salir `cumple`. Ese paso a paso se prueba con las tres pruebas
de `pruebas/rubrica/` (la forma del JSON, el cálculo del eje y la evaluación criterio a criterio),
y `axd auditar` sobre los repos de mentira de `pruebas/repos/` enseña la escala en sus tres
niveles: `muy-malo` sale 13 (ausente), `node-cli` 77 (suficiente) y `python-cli` 40 (incipiente).

Si la rúbrica da otra cosa en algún caso conocido, el fallo es de la rúbrica o del analizador:
se corrige aquí y en el JSON, se sube `version` y se anota por qué.
