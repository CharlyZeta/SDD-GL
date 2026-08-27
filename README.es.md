# SDD-GL — Desarrollo Guiado por Especificaciones: Gate/Loop

![SDD-GL Portada](assets/sdd-gl-cover.png)

[![Version](https://img.shields.io/badge/version-0.3.0-blue)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![MCP Protocol](https://img.shields.io/badge/MCP-Protocol%20Ready-purple)](mcp/sdd-gl-mcp-spec.md)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-orange)](https://docs.claude.ai/code)
[![Stack](https://img.shields.io/badge/stack-agnostic-lightgrey)](#3-configuración-del-stack-recomendado)

> *La especificación no es documentación: es el contrato de completitud.*

SDD-GL es un framework multiplataforma y herramienta compatible con el estándar Model Context Protocol (MCP) que implementa un proceso de desarrollo guiado por especificaciones (Spec-Driven Development), diseñado específicamente para **un solo desarrollador**. Proporciona gobernanza selectiva en **Claude Code**, **Google Antigravity CLI & IDE**, **Cursor**, **Windsurf**, **VS Code** y **Zed**. Resuelve un problema fundamental: al trabajar en solitario con IA, no es práctico revisar cada microiteración, pero tampoco se puede ceder el control total en las decisiones de diseño.

La solución consiste en un flujo de trabajo adaptativo y estructurado que determina cuándo se requiere intervención humana (Gate) y cuándo la IA puede operar de manera autónoma con total auditabilidad (Glass Box Loop).

---

## ¿Por qué SDD-GL?

Las herramientas de SDD tradicionales (como AIUP, Kiro o BMad) están diseñadas para equipos con múltiples roles: revisores, interesados (stakeholders) y varios encargados de validar cada fase. Para un desarrollador independiente, este modelo genera una fricción innecesaria al exigir su presencia constante en decisiones menores que la IA podría resolver autónomamente.

El extremo opuesto es igualmente problemático: ceder el control por completo genera código que no ha sido contrastado con ninguna especificación, perdiendo toda trazabilidad cuando ocurre un error.

**SDD-GL resuelve esta tensión mediante una distinción clara:**

- **Gate**: Si la especificación tiene decisiones de diseño pendientes, el proceso se detiene y espera la intervención humana.
- **Loop**: Una vez que la especificación está cerrada y aprobada, el proceso se ejecuta de manera autónoma hasta su finalización.

No se trata de "revisar absolutamente todo" ni de "otorgar autonomía ilimitada a la IA". Es gobernanza selectiva: la intervención humana ocurre exactamente cuando su criterio técnico aporta valor.


---

## Conceptos clave

### Las tres capas

```mermaid
graph LR
    subgraph Intent ["1. Intent (Modo GATE)"]
        spec["Especificación abierta<br/>• doc.md<br/>• Lógica<br/>• Revisión"]
    end

    subgraph Contract ["2. Contract (Transición)"]
        gate["HO-Gate<br/>(Aprobación humana)"]
    end

    subgraph Resolution ["3. Resolution (Modo LOOP)"]
        loop_agents["Ejecución autónoma<br/>• coder-agent<br/>• tester-agent<br/>• reviewer-agent"]
    end

    spec -->|Envía a aprobación| gate
    gate -->|Aprobado: Status APPROVED / Mode LOOP| loop_agents
    loop_agents -->|Ambigüedad detectada| spec

    style Intent fill:#f5f7fa,stroke:#cbd5e1,stroke-width:1px
    style Contract fill:#eff6ff,stroke:#bfdbfe,stroke-width:1px
    style Resolution fill:#f0fdf4,stroke:#bbf7d0,stroke-width:1px
```

* **Intent (Intención)**: Fase donde se construye la especificación. El `requirements-agent` y el `reviewer-agent` refinan el contrato sección por sección. En esta etapa nunca se genera código de la aplicación. El desarrollador revisa y valida el diseño antes de avanzar.
* **Contract (HO-Gate - Transición)**: El acto formal de aprobación humana. No consiste en una casilla de verificación automática; es el instante en el que el desarrollador valida que la especificación está completa, es consistente y resulta ejecutable. Este gesto inicia la ejecución del bucle autónomo.
* **Resolution (Resolución)**: Fase en la que los agentes trabajan de manera autónoma. El Loop infiere los criterios de finalización a partir del contrato y no se detiene hasta cubrirlos por completo. Si detecta algún aspecto no definido en la especificación, no realiza suposiciones: regresa a la fase de Gate y solicita definición.

---

### Los dos modos

```mermaid
flowchart TD
    start([Inicio /sdd-feature o /sdd-fix]) --> draft[Creación de Contract en DRAFT]
    draft --> gate[Modo GATE]
    
    subgraph Modo_Gate [Fase GATE: Validación del Contrato]
        gate --> req[requirements-agent<br/>Completa sección]
        req --> rev[reviewer-agent<br/>Valida consistencia]
    end
    
    rev -->|Contradicción detectada| amb[Registra en Ambiguity Log]
    amb --> gate
    
    rev -->|Contract consistente| ho[HO-GATE: Aprobación Humana]
    
    ho -->|Rechaza o Modifica| gate
    ho -->|Status: APPROVED / Mode: LOOP| loop[Modo LOOP: Ejecución Autónoma]
    
    subgraph Modo_Loop [Fase LOOP: Desarrollo y Pruebas]
        loop --> iter[coder + tester + reviewer<br/>Iteran sobre el Completion Map]
    end
    
    iter -->|Ambigüedad encontrada| amb
    iter -->|Todos los criterios cubiertos| resolved[RESOLVED]
    
    resolved -->|Nueva especificación / Siguiente ciclo| gate

    %% Estilos
    style start fill:#e2e8f0,stroke:#64748b,stroke-width:1px
    style draft fill:#f1f5f9,stroke:#cbd5e1,stroke-width:1px
    style gate fill:#fef3c7,stroke:#f59e0b,stroke-width:2px
    style ho fill:#dbeafe,stroke:#2563eb,stroke-width:2px
    style loop fill:#dcfce7,stroke:#16a34a,stroke-width:2px
    style resolved fill:#ecfdf5,stroke:#059669,stroke-width:2px
```

> [!IMPORTANT]
> **Gobernanza Adaptativa en Gate (`EXPRESS` vs `STRICT`)**:
> Para eliminar la *fatiga de revisión de specs*, SDD-GL v0.3.0 soporta dos modos de gobernanza:
> - **⚡ `GATE-EXPRESS`**: Utilizado automáticamente para correcciones de bugs (`FIX-XXXX`) y features atómicas. Genera todas las secciones y validaciones de consistencia en **1 solo paso** para una aprobación humana inmediata.
> - **🛡️ `GATE-STRICT`**: Reservado para features de dominio complejo (`FEAT-XXXX`) con múltiples entidades. Guía al desarrollador sección por sección a través de puntos de control de diseño progresivos.

> [!NOTE]
> **Glass Box Loop (Telemetría y Auditoría Transparente)**:
> A diferencia de los agentes autónomos de tipo "caja negra", el Loop escribe un registro de auditoría de ejecución transparente para cada paso en `.sdd/runs/[ID]-[timestamp].md`. El desarrollador puede inspeccionar en tiempo real los archivos de contexto leídos, los diffs generados, las salidas del test runner, el conteo de reintentos y las justificaciones técnicas de cada decisión.

---

### El Completion Map (Mapa de Completitud)

Cuando el desarrollador aprueba el contrato, el Loop procesa la especificación e infiere los criterios de finalización de forma automática, sin requerir configuración manual por parte del usuario.

```markdown
COMPLETION MAP: FEAT-0001
# generado: 2026-08-03 10:30
# Flujo Principal | integration-test:FEAT-0001-main  | coder+tester | ❌
# AF-01           | unit-test:FEAT-0001-af01          | tester       | ❌
# AF-02           | unit-test:FEAT-0001-af02          | tester       | ❌
# BR-001          | unit-test:FEAT-0001-br001         | tester       | ❌
# BR-002          | unit-test:FEAT-0001-br002         | tester       | ❌
# AC-001          | assertion:FEAT-0001-ac001         | tester       | ❌
# AC-002          | assertion:FEAT-0001-ac002         | tester       | ❌
```

#### Tabla de Inferencia de Criterios

| Elemento en el Contract | Criterio inferido |
| :--- | :--- |
| Flujo Principal (N pasos) | Mínimo 1 prueba de integración |
| Flujo Alternativo (AF-XX) | 1 prueba unitaria por cada AF |
| Regla de Negocio (BR-XXX) | 1 prueba unitaria de validación por cada BR |
| Criterio de Aceptación (AC-XXX) | Mínimo 1 aserción verificable por cada AC |

> [!TIP]
> El Loop no finaliza su ejecución hasta que todos los elementos marcados en el Completion Map se resuelvan satisfactoriamente (`✅`). La cobertura de pruebas no está determinada por un porcentaje genérico, sino directamente por los requisitos especificados en el contrato.

---

## Inicio Rápido (Quickstart)

Sigue esta guía paso a paso para configurar y comenzar a utilizar SDD-GL en tu entorno local.

### 1. Requisitos Previos
- **Claude Code** (versión `>= 1.0.0`) o el CLI de **Antigravity**.
- Un proyecto de desarrollo controlado bajo un repositorio de **Git**.
- Configuración básica de testing en el proyecto (el bucle autónomo requiere ejecutar pruebas automatizadas).

### 2. Instalación de SDD-GL
Elige uno de los siguientes métodos para incorporar el plugin en tu proyecto:

#### Opción A: Clonación directa en el proyecto (Instalación limpia)
Ejecuta los siguientes comandos desde la raíz de tu proyecto para incorporar los archivos necesarios:
```bash
git clone https://github.com/CharlyZeta/sdd-gl .sdd-gl
cp .sdd-gl/CLAUDE.md .
cp -r .sdd-gl/protocol .
cp -r .sdd-gl/.claude .
mkdir -p contracts
rm -rf .sdd-gl
```

#### Opción B: Submódulo de Git (Recomendado para actualizaciones)
Si deseas vincular el repositorio para recibir actualizaciones fácilmente:
```bash
git submodule add https://github.com/CharlyZeta/sdd-gl .sdd-gl
cp .sdd-gl/CLAUDE.md .
cp -r .sdd-gl/protocol .
cp -r .sdd-gl/.claude .
mkdir -p contracts
```

### 3. Configuración del Stack (Recomendado)
Crea un archivo llamado `stack.md` en el directorio raíz para que los agentes comprendan tus tecnologías y sigan las pautas arquitectónicas del proyecto:
```markdown
# Stack de Desarrollo
- Lenguaje: Java 21
- Framework: Spring Boot 3.x
- Base de Datos: PostgreSQL
- Pruebas: JUnit 5 + Mockito
- Herramienta de Construcción: Maven
- Estilo Arquitectónico: Arquitectura Hexagonal + DDD
```
> [!NOTE]
> Sin `stack.md`, los agentes continuarán funcionando, pero generarán código y pruebas genéricas sin apegarse a las convenciones de tu proyecto.

---

## Guía de Uso

### Iniciar una nueva Funcionalidad (Feature)
Para iniciar el diseño e implementación de una nueva funcionalidad, ejecuta:
```bash
/sdd-feature "registrar un pago entre dos cuentas"
```
El proceso generará un contrato en borrador (`DRAFT`) e iniciará la fase **Gate**:
```
✅ Contract creado: contracts/FEAT-0001.md

📋 Revisá y completá antes de aprobar:
   - [ ] Business Rules (BR-XXX como invariante verificable)
   - [ ] Acceptance Criteria (AC-XXX en formato GIVEN/WHEN/THEN)
   - [ ] Alternative Flows si aplica

   ⏸️  Cuando estés listo: cambiá Status: APPROVED y Mode: LOOP
```
El agente `requirements-agent` te ayudará a estructurar las secciones necesarias, y el `reviewer-agent` comprobará la coherencia del diseño antes de dar paso a la aprobación.

### Iniciar una Corrección (Bugfix)
Para resolver un fallo en el sistema con un Gate simplificado que no requiere el modelado completo de casos de uso:
```bash
/sdd-fix "el saldo no se actualiza cuando el pago falla a mitad"
```
Solo necesitarás definir los siguientes datos básicos en la especificación del bugfix:
```markdown
## Pasos de Reproducción
1. Iniciar pago por 500 ARS.
2. Simular un fallo en el paso de acreditación.
3. Verificar el saldo de la cuenta origen.

## Comportamiento Actual
El saldo de origen se debita a pesar de que la transacción falló.

## Comportamiento Esperado
El saldo no debe verse alterado si el pago no se completa con éxito.

## Criterios de Aceptación
- AC-001: GIVEN pago iniciado WHEN falla la acreditación
          THEN el saldo origen no cambia y el pago queda en FAILED.
```

### Consultar el Estado del Proyecto
Para visualizar un resumen del estado de todas las especificaciones y el progreso del Loop, ejecuta:
```bash
/sdd-status
```
El sistema devolverá una vista detallada:
```
📊 SDD-GL Status

🔴 DRAFT (Gate — esperando revisión)
   └── FEAT-0003: Alta de usuario con verificación de email

🟡 APPROVED (Loop en progreso)
   └── FEAT-0002: Transferencia internacional [8/11 ✅]

🟢 RESOLVED
   └── FEAT-0001: Registrar pago entre cuentas [12/12 ✅]
   └── FIX-0001: Fix rollback de saldo en pago fallido [4/4 ✅]

Total: 4 contracts | 1 en Gate | 1 en Loop | 2 resueltos
```

---

## Ejemplo de Contrato Completo

A continuación se presenta una especificación real (`Contract`) tras superar la fase de validación de **Gate** y justo antes de pasar al **Loop** autónomo de desarrollo:

```markdown
# CONTRACT: Registrar un pago entre dos cuentas
# ID: FEAT-0001
# Status: APPROVED
# Mode: LOOP

## Intent
Permitir que un usuario registre un pago desde una cuenta origen
hacia una cuenta destino, debitando y acreditando los saldos correspondientes.

## Use Case
**Actor:** Usuario autenticado
**Goal:** Registrar un pago entre dos cuentas

### Main Flow
1. El usuario selecciona cuenta origen y cuenta destino
2. El usuario ingresa el monto del pago
3. El sistema registra el pago y actualiza los saldos

### Alternative Flows
- AF-01: Saldo insuficiente → error INSUFFICIENT_FUNDS sin modificar saldos
- AF-02: Cuenta origen = cuenta destino → error SAME_ACCOUNT_NOT_ALLOWED
- AF-03: Cuenta no pertenece al usuario → error ACCOUNT_NOT_FOUND

## Business Rules
- BR-001: El monto del pago debe ser mayor a cero
- BR-002: La cuenta origen debe tener saldo suficiente para cubrir el monto
- BR-003: La cuenta origen y destino no pueden ser la misma
- BR-004: La cuenta origen debe pertenecer al usuario autenticado
- BR-005: El estado inicial de todo pago registrado es PENDING

## Acceptance Criteria
- AC-001: GIVEN cuenta origen con saldo 1000 y cuenta destino distinta
          WHEN el usuario registra un pago de 200
          THEN saldo origen queda en 800, saldo destino suma 200,
               pago en estado COMPLETED
- AC-002: GIVEN cuenta origen con saldo 100
          WHEN el usuario intenta registrar un pago de 500
          THEN el sistema rechaza con INSUFFICIENT_FUNDS y ningún saldo cambia
- AC-003: GIVEN el usuario selecciona la misma cuenta como origen y destino
          WHEN intenta registrar el pago
          THEN el sistema rechaza con SAME_ACCOUNT_NOT_ALLOWED

## Entities Affected
- Payment: monto, cuentaOrigen, cuentaDestino, fecha, estado
- Account: saldo

## Ambiguity Log
- [x] BR-004: RESUELTO — cuenta destino puede pertenecer a cualquier usuario

## Completion Map
# generated: 2026-08-03 10:30
# Main Flow | integration-test:FEAT-0001-main  | coder+tester | ❌
# AF-01     | unit-test:FEAT-0001-af01          | tester       | ❌
# AF-02     | unit-test:FEAT-0001-af02          | tester       | ❌
# AF-03     | unit-test:FEAT-0001-af03          | tester       | ❌
# BR-001    | unit-test:FEAT-0001-br001         | tester       | ❌
# BR-002    | unit-test:FEAT-0001-br002         | tester       | ❌
# BR-003    | unit-test:FEAT-0001-br003         | tester       | ❌
# BR-004    | unit-test:FEAT-0001-br004         | tester       | ❌
# BR-005    | unit-test:FEAT-0001-br005         | tester       | ❌
# AC-001    | assertion:FEAT-0001-ac001         | tester       | ❌
# AC-002    | assertion:FEAT-0001-ac002         | tester       | ❌
# AC-003    | assertion:FEAT-0001-ac003         | tester       | ❌
```

---

## Caso de Estudio: Validación End-to-End del Framework

Para verificar la robustez y consistencia de la máquina de estados, los agentes y los bucles de reintentos de SDD-GL, validamos el ciclo de vida completo del framework utilizando un contrato complejo de **Cuenta de Fideicomiso (Escrow Agreement)** en un entorno de pruebas (validado bajo la ejecución de QA ID `62b817c9-f8bd-425d-af0a-84c642151b66`).

### Fases del Ciclo de Validación

#### 1. Modo Gate y Detección de Contradicciones
* **Configuración**: Creamos un contrato en borrador (`FEAT-9999.md` en `Status: DRAFT` / `Mode: GATE`).
* **Inyección de Conflicto**: Especificamos la regla `BR-001` (el monto del fideicomiso debe ser positivo) pero redactamos un criterio incompatible `AC-002` (la inicialización del fideicomiso tiene éxito con un monto de 0).
* **Validación**: El `reviewer-agent` ejecutó el análisis de consistencia, detectó y bloqueó la contradicción con éxito, y la registró en el log de ambigüedades:
  ```markdown
  - [ ] BR-001 vs AC-002: Escrow amount must be positive, but AC-002 specifies that amount 0 succeeds.
  ```
* **Resolución**: Corregimos `AC-002` para esperar un fallo de inicialización. Tras esto, la validación pasó con éxito y se generó el resumen pre-aprobado.

#### 2. Modo Loop y Reintento Guiado del Programador
* **Activación**: Cambiamos el contrato a `Status: APPROVED` y `Mode: LOOP`. El sistema autogeneró un Completion Map con 8 criterios de prueba.
* **Inyección de Defecto**: Introdujimos un error de programación en el cálculo de comisiones (comisión fija de `1.5` en lugar del `1.5%` del depósito).
* **Bucle TDD**: Ejecutar las pruebas falló en `AC-001`. Tras 3 intentos fallidos de implementación, el Loop invocó al `reviewer-agent`, el cual analizó el error y sugirió la fórmula correcta al programador:
  ```javascript
  this.feeCollected = 0.015 * this.deposited;
  this.releasedAmount = this.deposited - this.feeCollected;
  ```
* **Aplicación**: El `coder-agent` aplicó la sugerencia de corrección del revisor y las 8 pruebas pasaron exitosamente.

#### 3. Bloqueo en Loop y Escalado a Gate
* **Inyección de Ambigüedad**: Añadimos una regla de penalización por disputa (`BR-004`) sin definir el mecanismo de resolución de disputas ni quién pagaría dicha comisión.
* **Escalado**: El `tester-agent` marcó la regla como `NOT_WRITABLE` (no escribible) debido a la falta de especificación. El Loop detuvo la ejecución inmediatamente, registró el bloqueo en el `Ambiguity Log` y regresó el contrato a `DRAFT` / `GATE`:
  ```markdown
  - [ ] BR-004: The dispute penalty fee logic is ambiguous. The contract does not define how a dispute is resolved...
  ```
* **Resolución**: Completamos los detalles de resolución de disputas en el contrato, re-aprobamos a modo `LOOP`, el coder implementó el código correspondiente y se reanudó la ejecución.

#### 4. Final Estructurado de Pruebas
Las 9 pruebas (unitarias, de integración y aserciones) pasaron con éxito, transicionando el contrato a `Status: RESOLVED`:
```bash
✔ Main Flow: Escrow lifecycle integration (1.34ms)
✔ AF-01: Dispute period expires without action -> auto-release (0.19ms)
✔ AF-02: Refund requested before dispute period expires -> block (0.55ms)
✔ BR-001: Escrow amount must be positive (0.24ms)
✔ BR-002: System fee of 1.5% is deducted upon release (0.24ms)
✔ BR-003: Dispute period must be between 1 and 30 days (1.49ms)
✔ BR-004: Dispute penalty fee of 3% is deducted upon dispute resolution favoring Seller (0.33ms)
✔ AC-001: GIVEN dispute period 10 days WHEN release called THEN fee is 1.5% and remaining transferred (0.23ms)
✔ AC-002: GIVEN escrow with amount 0 WHEN initialized THEN it fails (0.27ms)
ℹ tests 9 | pass 9 | fail 0
```

---

## Los Cuatro Agentes

SDD-GL incluye cuatro agentes integrados. No requieren configuración manual; el orquestador se encarga de invocarlos con el contexto adecuado en cada etapa del ciclo.

### `requirements-agent`
Opera exclusivamente durante la fase de **Gate**. Completa las secciones del contrato **una por iteración** para garantizar que no se omitan detalles; nunca avanza más de una sección sin esperar una revisión y validación intermedia. Formatea las reglas de negocio como invariantes lógicas y estructura los criterios de aceptación bajo el estándar GIVEN/WHEN/THEN.
* **Propósito**: Asegurar un diseño progresivo y reflexivo en lugar de una generación apresurada. Permite corregir la dirección del diseño de forma temprana.

### `reviewer-agent`
Opera de manera transversal tanto en **Gate** como en **Loop**.
* En **Gate**, valida la consistencia lógica interna antes de la aprobación humana: detecta contradicciones entre reglas de negocio y criterios de aceptación, referencias a datos inexistentes y criterios no comprobables.
* En **Loop**, analiza los fallos tras tres intentos de compilación o testeo para discernir si se trata de un error de implementación (lo que provoca un reintento) o de una ambigüedad conceptual en el contrato (lo que detiene el flujo y escala a Gate).
* **Propósito**: Prevenir que especificaciones incompatibles o erróneas inicien la fase de codificación, ahorrando ciclos fallidos de desarrollo.

### `coder-agent`
Opera únicamente durante la fase de **Loop**. Es el encargado de escribir el código de la aplicación y de subsanar los fallos de implementación reportados por las pruebas. Analiza el archivo `stack.md` para respetar fielmente las tecnologías y convenciones del proyecto. Si requiere tomar una decisión de diseño que no esté documentada en el contrato, detiene el proceso y escala la decisión al desarrollador.

### `tester-agent`
Opera únicamente durante la fase de **Loop**. Diseña y ejecuta las pruebas necesarias para verificar cada regla de negocio (BR), flujo alternativo (AF) y criterio de aceptación (AC). C## Casos de Uso Críticos y Robustez

El protocolo de SDD-GL está optimizado para lidiar con escenarios complejos del día a día, minimizando la pérdida de tiempo y el retrabajo.

### 1. Detección de Contradicciones en la Fase Gate
Supongamos el siguiente conflicto lógico en la especificación:
```markdown
BR-001: El monto debe ser mayor a cero.
AC-002: GIVEN monto=0 WHEN transfiere THEN el sistema acepta la transacción.
```
* **Comportamiento**: El `reviewer-agent` identifica la inconsistencia de inmediato durante la fase de Gate. El sistema bloquea el cambio de estado a `APPROVED` y presenta al desarrollador las alternativas para corregirlo.
* **Importancia**: Evita la escritura de pruebas destinadas a fallar por incompatibilidad de requisitos, impidiendo que el Loop inicie con un diseño defectuoso.

### 2. Recuperación ante Fallos (Crash Recovery) sin Pérdida de Progreso
Si la ejecución se interrumpe durante la fase de Loop (por ejemplo, debido a fallos de red, límites de llamadas a la API o interrupción de la consola), el estado actual se conserva intacto en el disco mediante el Completion Map:
```markdown
# Main Flow | integration-test:FEAT-0001-main | coder+tester | ✅
# AF-01     | unit-test:FEAT-0001-af01         | tester       | ✅
# AF-02     | unit-test:FEAT-0001-af02         | tester       | ⏳  ← Interrumpido aquí
# BR-001    | unit-test:FEAT-0001-br001        | tester       | ❌
```
* **Comportamiento**: Al reanudar el comando, el Loop lee el archivo del mapa y retoma las tareas en el punto exacto donde se detuvo (`AF-02`). Las tareas completadas (`✅`) no se vuelven a ejecutar.
* **Importancia**: Garantiza la viabilidad del flujo autónomo en proyectos de gran envergadura o con extensas suites de pruebas.

### 3. Resolución Incremental de Ambigüedades
El Loop detiene su ejecución y escala al desarrollador al primer bloqueo irresoluble o falta de definición de diseño que encuentre, en lugar de acumular suposiciones. Cada interacción Gate/Loop mantiene la coherencia histórica del Completion Map:
```
Ciclo 1: Flujo Principal ✅, AFs ✅, BR-001..BR-002 ✅, BR-003 ❌ (Ambigüedad) → Escala a Gate
Ciclo 2: BR-003 ✅, BR-004 ✅, AC-001 ❌ (Ambigüedad) → Escala a Gate
Ciclo 3: AC-001 ✅, AC-002 ✅, AC-003 ✅ → Estado final: RESOLVED
```
* **Importancia**: Resolver las dudas de manera secuencial evita que el código se desvíe de los requisitos del negocio y previene refactorizaciones masivas al final del proceso.

---

## Comparativa con Otras Metodologías

| Criterio / Característica | SDD-GL | AIUP (Martinelli) | Kiro | BMad |
| :--- | :--- | :--- | :--- | :--- |
| **Diseñado para** | 1 Desarrollador (Solo) | Equipos | Equipos | Equipos |
| **Control Humano** | Selectivo (solo en especificación) | En cada fase del ciclo | En cada fase del ciclo | En cada fase del ciclo |
| **Criterios de Aceptación (Done)** | Inferidos automáticamente | Definidos manualmente | Definidos manualmente | Definidos manualmente |
| **Recuperación ante Caídas** | ✅ Sí (Persistencia por ítem) | ❌ No | ❌ No | ❌ No |
| **Contradicciones en Validación** | ✅ Detectada antes de aprobar | ❌ No | Parcial | ❌ No |
| **Múltiples Ambigüedades** | ✅ Ciclos independientes | ❌ No | ❌ No | ❌ No |
| **Compatibilidad Tecnológica** | ✅ Stack-agnostic | Parcial (plugins específicos) | ❌ No | ❌ No |
| **Proyectos Existentes (Brownfield)**| ✅ Soportado (vía `/sdd-fix`) | Limitado | ❌ No | ❌ No |

---

## Recomendaciones de Uso

### Cuándo utilizar `/sdd-feature`
- Desarrollo de nuevas funcionalidades con un dominio de datos no trivial (que involucren más de dos entidades).
- Modificaciones que impacten o redefinan las reglas de negocio preexistentes.
- Escenarios donde se requiera una trazabilidad rigurosa y documentada entre especificaciones y pruebas.

### Cuándo utilizar `/sdd-fix`
- Corrección de fallos (bugs) donde el comportamiento erróneo actual y el esperado estén plenamente identificados.
- Regresiones de software (funcionalidad que previamente operaba de manera correcta).
- Parches críticos o urgentes que se beneficien de un proceso Gate simplificado.

### Cuándo evitar el uso de SDD-GL
- Pruebas de concepto (spikes técnicos) o exploraciones libres de código sin criterios de aceptación iniciales.
- Tareas exclusivas de infraestructura, scripts de despliegue o cambios de configuración que no contengan lógica de negocio.
- Refactorizaciones puras que no alteren el comportamiento externo (puesto que no hay cambios en la especificación).
- Proyectos que no posean una base o suite de pruebas automatizadas (dado que el Loop requiere ejecutar tests para validar la completitud).

### Recomendaciones para Redactar Especificaciones de Calidad
* **Reglas de Negocio (Business Rules)**: Defínelas como invariantes lógicas verificables en lugar de descripciones de comportamiento.
  * ❌ `BR-001: El sistema debe validar el monto antes de procesar.`
  * ✅ `BR-001: El monto de la transacción debe ser mayor a cero.`
* **Criterios de Aceptación (Acceptance Criteria)**: Asegúrate de que las condiciones `GIVEN` reflejen estados reproducibles de datos y no descripciones genéricas.
  * ❌ `AC-001: GIVEN que el usuario tiene saldo suficiente WHEN realiza la transferencia THEN se procesa correctamente.`
  * ✅ `AC-001: GIVEN una cuenta origen con saldo 1000 WHEN transfiere 200 THEN el saldo final de la cuenta origen queda en 800.`
* **Flujos Alternativos (Alternative Flows)**: Especifica claramente el resultado final esperado o el código de error correspondiente, no solo la condición detonante.
  * ❌ `AF-01: Saldo insuficiente.`
  * ✅ `AF-01: Saldo insuficiente → retorna el error INSUFFICIENT_FUNDS sin modificar saldos.`

---

## Alcance y Limitaciones

### Lo que SDD-GL proporciona
- Un marco estructurado de trabajo y protocolo operativo (no incluye ni impone librerías en tu código).
- Orquestación automatizada de agentes para la redacción de especificaciones, desarrollo y generación de pruebas.
- Trazabilidad nativa entre las especificaciones del contrato y los casos de prueba generados.
- Validación temprana de inconsistencias conceptuales antes de la generación de código fuente.
- Persistencia de estados de ejecución para tolerar interrupciones del entorno.

### Lo que SDD-GL no cubre
- No determina ni restringe los lenguajes, frameworks o herramientas de pruebas de tu stack tecnológico.
- No gestiona ni crea recursos de infraestructura (como contenedores de Docker, flujos de CI/CD o migraciones de base de datos).
- No pretende reemplazar herramientas de gestión de proyectos o tableros de incidencias (como Jira, GitHub Issues o Linear).
- No garantiza la idoneidad ni calidad de las pruebas si el contrato de origen posee fallos lógicos o está mal redactado.
- Requiere de un runtime compatible (como Claude Code o Antigravity CLI) para ejecutar los flujos del agente.

### Limitaciones Conocidas (Versión 0.3.0)
* **Inmutabilidad del Mapa de Completitud**: El Completion Map se genera una única vez al transicionar al modo Loop. Si se realizan modificaciones al contrato con el Loop ya iniciado, el mapa no sincronizará dichos cambios de manera automática hasta el siguiente ciclo.
* **Ausencia de Árboles de Dependencias**: El soporte directo para modelar dependencias jerárquicas entre especificaciones (por ejemplo, definir que `FEAT-0002` requiere la previa implementación de `FEAT-0001`) está planificado para la versión 0.4.0.

---

## Estructura del Repositorio

```
sdd-gl/
├── README.md              ← Documentación principal en inglés.
├── README.es.md           ← Documentación completa en español.
├── CHANGELOG.md           ← Historial de cambios y versiones del proyecto.
├── plugin.json            ← Manifiesto multiplataforma del plugin.
├── CLAUDE.md              ← Orquestador para Claude Code.
├── AGENTS.md              ← Orquestador para Antigravity CLI e IDE.
├── LICENSE                ← Licencia del software (MIT).
├── protocol/
│   ├── contract.md        ← Estructura del contrato ejecutable y reglas de inferencia.
│   ├── gate.md            ← Protocolo de Gate Adaptativo (EXPRESS vs. STRICT).
│   └── loop.md            ← Protocolo de Glass Box Loop, límites de reintento y auditoría.
├── presets/               ← Presets oficiales de stacks sin configuración (Zero-Config).
│   ├── java-spring-boot.md ← Java 21+, Spring Boot 3.3+, JUnit 5, Hexagonal/DDD.
│   ├── python-fastapi.md   ← Python 3.12+, FastAPI, Pytest, Pydantic v2, Async.
│   └── typescript-node.md  ← TypeScript 5+, Node/Bun, Vitest/Jest, Zod, Prisma.
├── mcp/
│   └── sdd-gl-mcp-spec.md ← Especificación de herramientas y configuración del servidor MCP.
├── assets/
│   └── sdd-gl-cover.png   ← Portada gráfica y recursos de arquitectura.
├── test-sandbox/          ← Entorno de pruebas reales para validación end-to-end.
│   ├── escrow.js
│   └── escrow.test.js
├── .claude/               ← Wrappers de agentes y comandos para Claude Code.
│   ├── agents/
│   │   ├── requirements-agent.md
│   │   ├── reviewer-agent.md
│   │   ├── coder-agent.md
│   │   └── tester-agent.md
│   └── commands/
│       ├── sdd-feature.md
│       ├── sdd-fix.md
│       └── sdd-status.md
├── .agents/skills/        ← Habilidades nativas para Antigravity.
│   ├── sdd-gate/
│   ├── sdd-loop/
│   ├── sdd-feature/
│   ├── sdd-fix/
│   ├── sdd-status/
│   ├── sdd-requirements-agent/
│   ├── sdd-reviewer-agent/
│   ├── sdd-coder-agent/
│   └── sdd-tester-agent/
└── contracts/             ← Directorio de destino para las especificaciones del proyecto.
    └── .gitkeep
```

---

## Plan de Desarrollo (Roadmap)

### Versión 0.1.0 — Núcleo Inicial (Publicada)
- [x] Máquina de estados fundamental Gate/Loop y modelo de gobernanza selectiva.
- [x] Inferencia de criterios de completitud y escalado mediante Ambiguity Log.
- [x] Persistencia de estado ítem por ítem y recuperación ante interrupciones.
- [x] Cuatro agentes integrados y comandos base (`/sdd-feature`, `/sdd-fix`, `/sdd-status`).

### Versión 0.2.0 — Multiplataforma y Resiliencia Arquitectónica (Publicada)
- [x] Soporte nativo para Google Antigravity CLI e IDE (`AGENTS.md` + 9 habilidades especializadas).
- [x] Checklists diferenciados en Gate para Features (`FEAT`) vs. Bugfixes (`FIX`).
- [x] Límite de reintentos del revisor (máximo 1 ciclo guiado para eliminar bucles infinitos).
- [x] Manejo de escalado directo para estados `BLOCKED` (Coder) y `NOT_WRITABLE` (Tester).

### Versión 0.3.0 — Gobernanza Adaptativa, Glass Box y MCP (Versión Actual)
- [x] **Gobernanza Adaptativa en Gate**: Modo `GATE-EXPRESS` (aprobación en 1 solo paso para fixes y tareas atómicas, fatiga cero) junto a `GATE-STRICT` (revisión progresiva sección por sección para lógica compleja).
- [x] **Glass Box Loop**: Trazabilidad y auditoría de ejecución transparente en `.sdd/runs/[ID]-[timestamp].md` con archivos inspeccionados, diffs, salidas del runner y justificaciones técnicas.
- [x] **Presets Oficiales de Stacks**: Presets listos para producción para Java Spring Boot 3.x, Python FastAPI y TypeScript Node.js/Bun en `presets/`.
- [x] **Estándar Model Context Protocol (MCP)**: Especificación formal JSON-RPC en `mcp/sdd-gl-mcp-spec.md` para integración con Cursor, Windsurf, Claude Code/Desktop, Antigravity y Zed.
- [x] **Validación de QA End-to-End**: Suite completa de verificación y sandbox funcional (`test-sandbox/escrow.test.js`).

### Versión 0.4.0 (Próxima)
- [ ] Paquete independiente en NPM `@sdd-gl/mcp-server` para ejecución instantánea vía `npx`.
- [ ] Acción de CI/CD para GitHub Actions (`sdd-verify-action`) para validación de contratos en Pull Requests.
- [ ] Comando CLI `sdd-review` para generar reportes analíticos de cobertura entre contratos.
- [ ] Soporte para árboles de decisión y contratos dependientes (`depends_on: FEAT-XXXX`).

### Backlog de Ideas
- [ ] Integración nativa con sistemas de tickets e incidencias (GitHub Issues, Linear, Jira).
- [ ] Paralelización multiagente para agilizar el procesamiento en contratos con un alto volumen de criterios.
- [ ] Modo de simulación (`dry-run`) para previsualizar el comportamiento del Loop sin escribir código.

---

## Contribuir

SDD-GL se encuentra en una etapa de desarrollo activo y abierto a mejoras. Valoramos especialmente las contribuciones en las siguientes áreas:

1. **Reportes de Casos no Cubiertos**: Si identificas un escenario donde el protocolo de Gate/Loop falle o actúe de manera inconsistente, abre un *issue* describiendo detalladamente el contrato de origen, el comportamiento obtenido y el esperado.
2. **Presets de Stacks**: Diseños de agentes adaptados (`coder-agent.md` y `tester-agent.md`) optimizados para tecnologías concretas.
3. **Evolución del Formato del Contrato**: Propuestas de extensión de la tabla de inferencia para dar soporte a nuevos criterios lógicos en las especificaciones.

Para contribuir, realiza un fork del repositorio, crea una rama temática (feature branch) y envía un *Pull Request* con una descripción clara del caso que resuelve.

---

## Licencia

Este proyecto se distribuye bajo la [Licencia MIT](LICENSE). Consulta el archivo adjunto para más información.

Copyright © 2026 [Gerardo Maidana](https://github.com/CharlyZeta) ([LinkedIn](https://www.linkedin.com/in/gerardomaidana)).

---

*Nota: SDD-GL converge de manera independiente con patrones metodológicos que se están formalizando en el ecosistema de desarrollo moderno (como la iniciativa AIUP de Simon Martinelli). La diferencia fundamental radica en que SDD-GL está optimizado para el desarrollador en solitario, donde un esquema de gobernanza selectiva aporta mayor agilidad que un modelo de aprobación colegiado.*

---

## Integración con Antigravity CLI y Antigravity IDE

SDD-GL cuenta con soporte nativo para **Antigravity CLI** y **Antigravity IDE**, compartiendo exactamente el mismo núcleo metodológico y de protocolo. Únicamente varían las rutas de despliegue y las envolturas (wrappers) de comandos.

### Configuración en Antigravity CLI (`agy`)

#### Instalación Global (Disponible para cualquier proyecto)
Clona el repositorio en la carpeta de extensiones globales de Antigravity:
```bash
git clone https://github.com/CharlyZeta/sdd-gl ~/.gemini/antigravity-cli/plugins/sdd-gl
```
Verifica la correcta carga de comandos listando las habilidades instaladas:
```bash
agy /skills
# Deberías visualizar: sdd-gate, sdd-loop, sdd-feature, sdd-fix y sdd-status.
```

#### Instalación Local (Por proyecto)
Si prefieres integrarlo a nivel del espacio de trabajo:
```bash
mkdir -p .agents/skills
git clone https://github.com/CharlyZeta/sdd-gl /tmp/sdd-gl
cp -r /tmp/sdd-gl/.agents/skills/* .agents/skills/
cp -r /tmp/sdd-gl/protocol .
cp /tmp/sdd-gl/AGENTS.md .
mkdir -p contracts
```

### Integración con Antigravity IDE
Los componentes alojados en el directorio `.agents/skills/` son leídos e incorporados de manera automática por Antigravity IDE al indexar el proyecto. Utiliza la estructura indicada en la instalación local.

### Interacción y Ejecución en Antigravity
El flujo es idéntico a Claude Code. Puedes utilizar comandos explícitos:
```
/sdd-feature "Nueva funcionalidad de pagos"
/sdd-fix "El saldo no se actualiza cuando falla el pago"
/sdd-status
```
Adicionalmente, Antigravity soporta detección de intención mediante lenguaje natural, traduciendo tus peticiones a la habilidad correcta:
* *"Quiero iniciar una nueva funcionalidad para transferencias internacionales"* → Dispara `/sdd-feature`.
* *"El contrato FEAT-0002 ha sido aprobado, inicia la implementación"* → Dispara `/sdd-loop`.

### Equivalencias Técnicas del Entorno

| Aspecto | Claude Code | Entorno Antigravity |
| :--- | :--- | :--- |
| **Orquestador Principal** | `CLAUDE.md` | `AGENTS.md` |
| **Definición de Comandos** | `.claude/commands/*.md` | `.agents/skills/*/SKILL.md` |
| **Definición de Agentes** | `.claude/agents/*.md` | `.agents/skills/*/SKILL.md` |
| **Mapeo de Activación** | `/comando` explícito | Comandos explícitos o detección de lenguaje natural |
| **Modelo Recomendado** | Claude 3.5 Sonnet | Gemini 1.5 Pro / Flash |
| **Protocolo Operativo** | Carpeta `protocol/` (Idéntico) | Carpeta `protocol/` (Idéntico) |
| **Ubicación de Contratos**| Carpeta `contracts/` (Idéntico) | Carpeta `contracts/` (Idéntico) |

El protocolo (Gate/Loop/Contract) es 100% portable. Lo que cambia entre plataformas es solo la capa de integración con el agente, no la lógica del proceso.

