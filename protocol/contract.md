# SDD-GL Contract Format

Un Contract es la spec ejecutable de un work item.
Legible para el humano en modo Gate, parseable por el Loop para inferir criterios de completitud.

---

## Formato de archivo

```
# CONTRACT: [nombre del work item]
# ID: [FEAT|FIX]-XXXX
# Status: DRAFT | APPROVED | RESOLVED
# Mode: GATE | LOOP
# Gate-Mode: EXPRESS | STRICT

## Intent
<!-- Qué problema resuelve. Una o dos oraciones. -->
<!-- El Loop no lee esta sección para inferir criterios. -->

## User Story
- Como: [quién]
- Quiero: [un solo objetivo]
- Para: [beneficio esperado]

## Use Case
**Actor:**
**Goal:**

### Main Flow
1.
2.
3.

### Alternative Flows
- AF-01: [condición] → [resultado]

## Business Rules
- BR-001: [invariante verificable]

## Acceptance Criteria
- AC-001: GIVEN [contexto] WHEN [acción] THEN [resultado esperado]

## Entities Affected
- [Entidad]: [atributos relevantes o invariantes]

## Inferred Assumptions

Sección opcional y no-normativa (no genera Completion Map).
Formato de cada supuesto inferido por el requirements-agent:
```
- [ ] AS-[NN]: [decisión asumida] → [impacto si es falso]
```
Estados posibles:
- `- [ ]` — abierto (bloquea aprobación, BR-003)
- `- [x] CONFIRMED` — confirmado por humano en HO-GATE
- `- [x] REFUTED — [resolución]` — refutado; secciones dependientes regeneradas (AF-01)
Si no hay inferencias relevantes: `- [x] Ninguno`

---

## Ambiguity Log
- [ ]

## Completion Map
# generated: [timestamp]
# [nombre]|[test-id]|[agente]|[status]
```

---

## Atomicidad del contrato

Un contrato es **una historia, un objetivo, un entregable**.

| Regla | Código de Gate |
|---|---|
| Debe existir `## User Story` con `Como / Quiero / Para` | `STORY_MISSING` |
| El `Quiero` declara un solo objetivo (dos infinitivos unidos por conector → dos objetivos) | `STORY_MULTI_GOAL` |
| Presupuesto: ≤7 BR, ≤8 AC, ≤5 AF, ≤9 pasos | `BUDGET_EXCEEDED` |

Los chequeos de atomicidad aplican **solo a contratos en `DRAFT`**: un contrato ya aprobado o
resuelto no se invalida retroactivamente.

### Waivers

Una excepción se registra en el Ambiguity Log con motivo no vacío; sin motivo, el waiver no vale:

```
- [x] STORY-OK: [por qué este contrato no lleva historia]
- [x] BUDGET-OK: [por qué excede el presupuesto]
```

La historia **no genera ítems** en el Completion Map: el mapa se infiere de Main Flow, AF, BR y AC.

---

## Tabla de inferencia de criterios y capas

### Inferencia por tipo de criterio:
| Elemento en la spec        | Criterio inferido                         | Capa principal |
|----------------------------|-------------------------------------------|----------------|
| Main Flow con N pasos      | 1 integration test mínimo                 | functional     |
| Alternative Flow AF-XX     | 1 unit test por cada AF-XX                | functional     |
| Business Rule BR-XXX       | 1 unit test de validación por cada BR-XXX | functional     |
| Acceptance Criteria AC-XXX | 1 assertion verificable por cada AC-XXX   | functional     |

### Capas de verificación estándar:
| Capa (`[layer]`) | Propósito                                               | Agente encargado |
|------------------|---------------------------------------------------------|------------------|
| `functional`     | Pruebas unitarias, de integración y aserciones          | tester           |
| `static`         | Tipado estricto, análisis estático y linting            | verifier         |
| `security`       | Escaneo de vulnerabilidades y prevención de fugas       | verifier         |
| `arch`           | Respeto a límites de arquitectura y CONSTITUTION.md     | verifier         |

---

## Formato del Completion Map

Cada línea del mapa sigue el formato tabular plano:
```
# [item-id]|[layer]|[test-id]|[agente]|[status]
```

Donde status es uno de:
- `❌` — pendiente
- `⏳` — en ejecución (si aparece al arrancar = proceso interrumpido, reanudar desde ahí)
- `✅` — completado

El Loop escribe el status en disco **antes** y **después** de ejecutar cada ítem.
Si al arrancar hay ítems `⏳`, el proceso fue interrumpido: reanudar desde el primero `⏳`.

---

## Regla del HO-Gate

El humano es el único que puede cambiar:
- `Status: DRAFT → APPROVED`
- `Mode: GATE → LOOP`

El proceso no modifica estos campos solo.
La combinación `Status: APPROVED + Mode: LOOP` es el único trigger del Loop.
