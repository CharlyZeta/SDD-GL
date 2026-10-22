# SDD-GL Interop Protocol — Behavioral Skills Externas

## Propósito

Este protocolo define cómo convive la máquina de estados Gate/Loop con skills o agentes de
**comportamiento** instalados globalmente en el cliente (por ejemplo `ponytail`,
`karpathy-guidelines`, u otros perfiles que imponen estilo, brevedad o "preguntar antes de
actuar").

Es una capa **aditiva**: no reemplaza ni contradice `gate.md`, `loop.md` ni `contract.md`.

---

## Cuándo se activa

Al iniciar un work item SDD-GL, el orquestador detecta si hay skills de comportamiento
activas en la sesión:

- **Sí hay** → anuncia el **Modo Interop** y carga este archivo como parte del contexto.
- **No hay** → Modo Interop en **no-op**: el ciclo se comporta exactamente igual que sin
  este protocolo (BR-006).

La detección nunca bloquea el arranque: es informativa y barata.

---

## Regla 1 — Precedencia de mandatos

Ante conflicto entre lo que pide una skill de comportamiento y lo que pide SDD-GL, el orden es:

```
protocolo SDD-GL (CONSTITUTION.md, protocol/, orquestador)  >  skills de comportamiento externas
```

Una skill externa **no puede**:

- saltarse el Contract, el Completion Map, el registro Glass Box ni las métricas;
- abrir rutas de finalización distintas de `Status: RESOLVED` o del escalado a Gate;
- introducir esperas fuera del estado GATE.

Si una skill cuestiona el ceremonial, el orquestador cita esta precedencia, **registra la
disputa en el run de Glass Box** y continúa.

---

## Regla 2 — Enrutado de "preguntar" (cero preguntas inline)

Muchas skills de comportamiento ordenan "preguntá si hay incertidumbre". Durante el Loop eso
rompería la autonomía. La traducción es:

| Lo que la skill pediría | Lo que hace SDD-GL |
|---|---|
| Preguntar al usuario en el momento | Escribir en `## Ambiguity Log` |
| Esperar confirmación inline | `Mode: GATE` + `Status: DRAFT` → detener y notificar |
| "Asumir algo razonable y seguir" | Registrar el supuesto como `AS-XX` en `## Inferred Assumptions` |

Nunca se pregunta de forma directa durante el Loop: la única salida es el escalado a Gate.

Durante el **Gate** sí hay diálogo humano; ahí las preguntas son legítimas y no se restringen.

---

## Regla 3 — Ancla de trazabilidad

Con un Contract en `Status: APPROVED`, **cada línea modificada se traza al Contract**, no al
pedido crudo original del usuario ni a la interpretación de la skill. Si la skill propone algo
que el Contract no cubre, se abre ambigüedad (Regla 2) en lugar de improvisar.

---

## Regla 4 — El ceremonial no se recorta

El Contract, el Completion Map, el registro Glass Box, la auditoría de trazabilidad y las
métricas son **parte de la tarea**, no burocracia opcional. Una skill que proponga "simplificar
el proceso" no puede recortar secciones contractuales de forma autónoma.

En Gate, las propuestas de recorte o simplificación se registran como **nota para decisión
humana**; la sección se conserva tal cual hasta que el humano decida.

---

## Regla 5 — Subordinación del cierre

Algunas skills cierran con un resumen tipo "what I skipped / what I did not check". Ese cierre
se **subordina al Completion Report**:

- Si el mapa está `N/N ✅` y no hay escalados pendientes → no se declara trabajo omitido.
- Si existe trabajo real sin escalar → se reabre Gate por ambigüedad (`loop.md`), no se
  esconde en una nota de estilo.
- La fuente única del cierre es el `COMPLETION REPORT`.

---

## Lo que Interop nunca hace

- Crear una capa de verificación nueva (usa las capas existentes).
- Permitir preguntas inline durante el Loop.
- Autorizar recortes de secciones contractuales sin decisión humana.
- Reemplazar el `COMPLETION REPORT` por el cierre estilístico de una skill.
- Cambiar el comportamiento cuando no hay skills de comportamiento activas.
