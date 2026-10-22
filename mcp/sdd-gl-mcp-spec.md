# SDD-GL Model Context Protocol (MCP) Server Specification

Esta especificación formal define el **Servidor MCP de SDD-GL (`sdd-gl-mcp`)**, permitiendo que cualquier cliente compatible con el estándar MCP (Claude Code, Gemini/Antigravity, OpenCode, Cursor, Windsurf, VS Code Copilot, Zed) ejecute la metodología Spec-Driven Development de forma 100% agnóstica.

> **Agnosticismo de plataforma.** El protocolo Gate/Loop, el formato de contratos y el Completion
> Map son idénticos en todas las plataformas. Lo único que cambia es la **capa de integración**:
> dónde se instalan los skills (`~/.claude/` vs `~/.agents/`) y cómo se declara el servidor MCP en
> la configuración del cliente. Ningún tool depende de un IDE concreto.

---

## 1. Arquitectura del Servidor MCP

El servidor expone herramientas (`tools`) que operan directamente sobre el sistema de archivos del proyecto local (`contracts/`, `.sdd/runs/`, `.sdd/metrics.json`).

```
┌─────────────────────────────────────────────────────────────┐
│                 Cualquier Cliente MCP                       │
│  (Claude Code / Gemini / OpenCode / Cursor / Windsurf)      │
└──────────────────────────────┬──────────────────────────────┘
                               │ JSON-RPC 2.0 (stdio)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   SDD-GL MCP Server                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Tools (8):                                            │  │
│  │ • sdd_create_contract    • sdd_get_status             │  │
│  │ • sdd_validate_gate      • sdd_get_metrics            │  │
│  │ • sdd_step_loop          • sdd_audit_traceability     │  │
│  │ • sdd_log_ambiguity      • sdd_generate_dashboard     │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────┘
                               │ I/O Local
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  Proyecto: contracts/ | .sdd/runs/ | .sdd/metrics.json      │
└─────────────────────────────────────────────────────────────┘
```

- **Transporte:** JSON-RPC 2.0 sobre `stdio` (lectura línea a línea con `readline`).
- **Versión de protocolo MCP:** `2024-11-05`.
- **Raíz del proyecto:** variable de entorno `SDD_PROJECT_ROOT`, o el directorio de trabajo actual.
- **Servidor:** sin dependencias externas; sólo Node.js built-ins (`fs`, `path`, `readline`).

---

## 2. Definición de Herramientas (Tools Schema)

### `sdd_create_contract`
Crea un nuevo archivo de contrato en `contracts/` con el ID correlativo siguiente y modo Gate inicial. Nunca sobrescribe un contrato existente.
- **Parameters**:
  - `title` (string, required): Título o descripción corta del work item.
  - `type` (string, enum: `["FEAT", "FIX"]`, required): Tipo de contrato.
  - `gate_mode` (string, enum: `["EXPRESS", "STRICT"]`, optional): Nivel de gobernanza (por defecto `EXPRESS` para FIX y `STRICT` para FEAT).
  - `intent` (string, optional): Descripción del problema y objetivo.
- **Returns**: `success`, `contract_id`, `path`, `gate_mode`.

### `sdd_validate_gate`
Valida la completitud estructural y consistencia lógica interna de un contrato en modo DRAFT.
- **Parameters**:
  - `contract_id` (string, required): Identificador del contrato (ej. `FEAT-0001` o `FIX-0001`).
- **Returns**:
  - `status`: `"READY_FOR_APPROVAL"` | `"INCOMPLETE"` | `"CONTRADICTION_DETECTED"`
  - `inferred_criteria_count`: Número total de tests que inferirá el Loop.
  - `blocking_issues`: Lista de problemas o contradicciones detectadas.

### `sdd_step_loop`
Ejecuta de forma determinista un paso del Completion Map en modo Loop, emitiendo el log de auditoría (Glass Box).
- **Parameters**:
  - `contract_id` (string, required): Contrato en estado `APPROVED` y modo `LOOP`.
  - `item_id` (string, optional): ID del criterio específico a ejecutar (o `auto` para el siguiente pendiente).
- **Returns**:
  - `item_status`: `"PASS"` | `"FAIL"` | `"BLOCKED"` | `"NOT_WRITABLE"`
  - `attempt_number`: Número de intento (1..3).
  - `audit_log_path`: Ruta del log de auditoría en `.sdd/runs/`.

### `sdd_log_ambiguity`
Registra un bloqueo formal en el `Ambiguity Log` y transiciona el contrato de regreso a `Status: DRAFT` / `Mode: GATE`.
- **Parameters**:
  - `contract_id` (string, required): ID del contrato.
  - `item_id` (string, required): Criterio que disparó el bloqueo.
  - `reason` (string, required): Motivo preciso de la ambigüedad o falta de diseño en la spec.

### `sdd_get_status`
Genera el tablero de estado consolidado de todos los contratos del repositorio.
- **Parameters**: Ninguno.
- **Returns**:
  - Resumen agrupado por `DRAFT (Gate)`, `APPROVED (Loop)` y `RESOLVED`.

### `sdd_get_metrics`
Devuelve las First-Pass Quality Rates (FPQR), el promedio de reintentos y las tasas de éxito por capa.
- **Parameters**: Ninguno.
- **Returns**: métricas agregadas desde `.sdd/metrics.json` (con fallback a valores por defecto).

### `sdd_audit_traceability`
Audita la trazabilidad entre contratos y código base activo (specs huérfanas vs código sin trackear).
- **Parameters**: Ninguno.
- **Returns**: mapa de trazabilidad por contrato.

### `sdd_generate_dashboard`
Compila la telemetría del proyecto y genera el Living Visual Dashboard en `docs/index.html`.
- **Parameters**: Ninguno.
- **Returns**: `success`, `path`, `total_contracts`, `resolved_count`, `last_updated`.

---

## 3. Configuración en Clientes MCP

El bloque JSON es **idéntico** para todos los clientes MCP que usen transporte `stdio` (la mayoría).
Lo que cambia es la ruta del archivo de configuración y, en algunos casos, si el cliente acepta
un comando remoto (`npx`) o exige un binario local.

### 3.1 Método remoto (recomendado) — común a todos los clientes

```json
{
  "mcpServers": {
    "sdd-gl": {
      "command": "npx",
      "args": ["-y", "github:CharlyZeta/SDD-GL"]
    }
  }
}
```

### 3.2 Método local (entorno de desarrollo) — común a todos los clientes

```json
{
  "mcpServers": {
    "sdd-gl": {
      "command": "node",
      "args": ["./mcp/server.js"]
    }
  }
}
```

### 3.3 Ubicación del archivo de configuración por cliente

| Cliente | Archivo de configuración | Notas |
|---|---|---|
| **Claude Code** | `claude mcp add` (CLI) o `~/.claude.json` | Ver comando abajo. |
| **Gemini CLI** | `~/.gemini/settings.json` | Bloque `mcpServers` en la raíz. |
| **Antigravity IDE** | `~/.agents/skills/` (skills) | Skills de SDD-GL allí. |
| **OpenCode** | `~/.config/opencode/opencode.json` | Bloque `mcp` con clave `type: "local"`. |
| **Cursor** | `~/.cursor/mcp.json` | Formato `mcpServers` estándar. |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` | Formato `mcpServers` estándar. |
| **VS Code (Copilot)** | `.vscode/mcp.json` (workspace) | Formato `servers` con `type: "stdio"`. |
| **Zed** | `~/.config/zed/settings.json` | Bloque `context_servers`. |

### 3.4 Claude Code — comando directo

```bash
# Remoto (sin clonar el repo)
claude mcp add sdd-gl -- npx -y github:CharlyZeta/SDD-GL

# Local (desde la raíz de un clon de SDD-GL)
claude mcp add sdd-gl -- node ./mcp/server.js
```

Verificar con `claude mcp list`. El comando `npx` debe resolverse en el `PATH` del proceso que
lanza Claude Code; si usás Windows y `npx` no está en `PATH`, usá el método local con la ruta
absoluta a `node`.

### 3.5 Gemini CLI

```json
// ~/.gemini/settings.json
{
  "mcpServers": {
    "sdd-gl": {
      "command": "npx",
      "args": ["-y", "github:CharlyZeta/SDD-GL"]
    }
  }
}
```

### 3.6 OpenCode

```json
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "sdd-gl": {
      "type": "local",
      "command": ["npx", "-y", "github:CharlyZeta/SDD-GL"],
      "enabled": true
    }
  }
}
```

OpenCode usa el bloque `mcp` (no `mcpServers`) y un array para `command`.

### 3.7 Verificación de la conexión

Todos los clientes exponen una forma de listar los servidores MCP conectados. El criterio de
éxito es ver el servidor `sdd-gl` con sus **8 tools** disponibles:

```
sdd_create_contract    sdd_validate_gate    sdd_step_loop    sdd_log_ambiguity
sdd_get_status         sdd_get_metrics      sdd_audit_traceability   sdd_generate_dashboard
```

Verificación directa por JSON-RPC (sin cliente), desde la raíz del proyecto:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ./mcp/server.js
```

---

## 4. Dependencias

### 4.1 Servidor MCP (`mcp/server.js`)

**Ninguna.** Sólo Node.js built-ins. Requiere **Node.js ≥ 18**.

### 4.2 Dashboard (`mcp/dashboard-gen.js`)

**Ninguna dependencia npm.** El HTML generado carga sus librerías por CDN en tiempo de ejecución:

| Librería | Origen | Uso |
|---|---|---|
| Tailwind CSS | `https://cdn.tailwindcss.com` | Estilos y layout |
| Chart.js | `https://cdn.jsdelivr.net/npm/chart.js` | Gráficos |
| Lucide | `https://unpkg.com/lucide@latest` | Iconos SVG |

> El dashboard requiere **conexión a internet** para renderizar los gráficos. El resto del
> framework (protocolo, contratos, MCP server) funciona **offline**.

Generación del dashboard:

```bash
# Desde la raíz del proyecto (usa SDD_PROJECT_ROOT o el cwd)
node mcp/dashboard-gen.js
```

Salida: `docs/index.html`. El generador lee `contracts/`, `.sdd/metrics.json` y `.sdd/runs/`,
y no sobrescribe nada fuera de `docs/index.html`.

### 4.3 Skill de instalación (`npm install`)

```bash
npm install @sdd-gl/mcp-server
```

Después, el binario queda disponible como `sdd-gl-mcp` (o `sdd-gl`) en `node_modules/.bin/`.
Referenciá el ejecutable con ruta absoluta en la config del cliente si el `PATH` no lo expone.

---

## 5. Verificación de estado del servidor

```bash
# Listar herramientas
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ./mcp/server.js

# Estado de contratos
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sdd_get_status","arguments":{}}}' \
  | node ./mcp/server.js
```

Salida esperada: `result.tools` con **8 entradas**.
