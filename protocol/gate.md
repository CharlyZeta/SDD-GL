# SDD-GL Gate Protocol

## Propósito

El modo Gate opera cuando el Contract está en `Status: DRAFT`.
El proceso no genera código en este modo.
El único output válido es un Contract más completo o un Contract listo para aprobar.

---

## Cuándo se activa

- Al arrancar cualquier work item nuevo (FEAT o FIX)
- Cuando el Loop detecta una ambigüedad y escribe en Ambiguity Log
- Cuando el humano rechaza un Contract y lo vuelve a DRAFT

---

## Comportamiento en modo Gate

### Paso 1 — Si no existe Contract
Generar Contract en DRAFT con Intent y Use Case básico inferido de la descripción.
Detenerse. Esperar revisión humana antes de continuar.

### Paso 2 — Si existe Contract en DRAFT: checklist estructural

Verificar cada sección:

| Sección             | Condición mínima                                          |
|---------------------|-----------------------------------------------------------|
| Main Flow           | Al menos 3 pasos numerados                                |
| Alternative Flows   | Al menos 1 AF-XX (o explícitamente "ninguno")             |
| Business Rules      | Al menos 1 BR-XXX expresado como invariante verificable   |
| Acceptance Criteria | Al menos 1 AC-XXX en formato GIVEN/WHEN/THEN              |
| Ambiguity Log       | Sin ítems `- [ ]` sin resolver                            |

Si alguna condición falla → completar **una sola sección** y detenerse.
No avanzar más de una sección por iteración.

### Paso 3 — Análisis de consistencia interna

Antes de presentar el Contract como aprobable, verificar:

- ¿Algún AC-XXX contradice algún BR-XXX?
  Ejemplo: BR dice "monto > 0" pero AC dice "monto=0 es aceptado".
- ¿Algún AC-XXX referencia datos o fuentes no definidas en el Contract?
- ¿Dos BR-XXX se contradicen entre sí?

Si se detecta contradicción → escribir en Ambiguity Log con formato:
```
- [ ] [ID-A] vs [ID-B]: [descripción de la contradicción y opciones de resolución]
```
Detenerse. No presentar como aprobable hasta que el humano resuelva.

### Paso 4 — Presentar resumen pre-aprobación

Cuando el Contract pasa el checklist y la consistencia:

```
✅ Contract completo y consistente: contracts/[ID].md

Resumen:
  - N pasos en Main Flow
  - N Alternative Flows (AF-01..AF-N)
  - N Business Rules (BR-001..BR-N)
  - N Acceptance Criteria (AC-001..AC-N)

Criterios que inferirá el Loop:
  - 1 integration test (Main Flow)
  - N unit tests (AF-XX)
  - N unit tests (BR-XXX)
  - N assertions (AC-XXX)
  Total: N criterios de completitud

⏸️  HO-GATE: cambiá Status: APPROVED y Mode: LOOP para iniciar el Loop.
```

---

## Lo que Gate nunca hace

- Generar código de implementación
- Generar tests
- Resolver contradicciones por cuenta propia
- Avanzar más de una sección por iteración
- Cambiar `Status` o `Mode` sin intervención humana
