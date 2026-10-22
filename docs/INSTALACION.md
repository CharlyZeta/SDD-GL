# Guía de Instalación SDD-GL

## Método remoto (recomendado)

Desde cualquier cliente MCP compatible (Claude Code, Cursor, Windsurf, OpenCode):

```bash
# Instala el servidor MCP remoto vía npx
npx -y github:CharlyZeta/SDD-GL

# Verificar la instalación
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ./mcp/server.js
```

Salida esperada: `result.tools` contiene **8 herramientas**:

```
sdd_create_contract    sdd_validate_gate    sdd_step_loop    sdd_log_ambiguity
sdd_get_status         sdd_get_metrics      sdd_audit_traceability   sdd_generate_dashboard
```

### Claude Code

```bash
# Remoto (sin clonar)
claude mcp add sdd-gl -- npx -y github:CharlyZeta/SDD-GL

# Local (desde la raíz del proyecto SDD-GL)
claude mcp add sdd-gl -- node ./mcp/server.js
```

### Gemini CLI

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

### OpenCode

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

---

## Método local (entorno de desarrollo)

Clona el repositorio y usa el binario Node.js directamente.

```bash
# Clonar el repositorio
git clone https://github.com/CharlyZeta/SDD-GL.git

# Entrar al directorio
cd sdd-gl-repo

# Usar el servidor local
node ./mcp/server.js
```

### Configurar MCP en Claude Code (local)

```bash
claude mcp add sdd-gl -- node ./mcp/server.js
```

### Configurar MCP en Gemini CLI (local)

```json
// ~/.gemini/settings.json
{
  "mcpServers": {
    "sdd-gl": {
      "command": "node",
      "args": ["./mcp/server.js"]
    }
  }
}
```

### Configurar MCP en OpenCode (local)

```json
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "sdd-gl": {
      "type": "local",
      "command": ["node", "./mcp/server.js"],
      "enabled": true
    }
  }
}
```

---

## Generar el Dashboard Visual Living

Después de tener el servidor funcionando (contratos creados, métricas agregadas), generá tu dashboard **local**:

```bash
node mcp/dashboard-gen.js      # equivale a: npm run dashboard
```

**Salida:** `.sdd/dashboard.html` (privado, fuera de `docs/`). El generador lee:

- `contracts/` — todos los archivos `.md` con especificación
- `.sdd/metrics.json` — telemetría de calidad (opcional)
- `.sdd/usage.json` — uso local del MCP (opcional)
- `.sdd/runs/` — logs de auditoría de Loop completados

Ese HTML lleva los datos embebidos y no hace llamadas de red para obtenerlos, así que podés publicarlo donde quieras como **tu propia** métrica de uso. No hay agregación global.

### Dashboard público (solo showcase)

Si querés regenerar la página publicada del repositorio (GitHub Pages), usá el modo showcase, que **solo** lee `examples/contracts/` y nunca el estado privado:

```bash
npm run dashboard:public       # equivale a: node mcp/dashboard-gen.js --public
```

**Salida:** `docs/index.html`. No lee `contracts/`, `.sdd/metrics.json` ni `.sdd/usage.json`; las secciones de calidad y uso se muestran como "sin datos".

### Requisitos previos

- **Node.js ≥ 18** (para el servidor MCP y el generador)
- **Conexión a internet** (solo para el dashboard, que carga Tailwind, Chart.js y Lucide por CDN)
- **Entorno estándar:** Linux / macOS / Windows (PowerShell / CMD)

---

## Método como paquete npm instalado

```bash
# Instalar como dependencia
npm install @sdd-gl/mcp-server

# Luego referenciar en la configuración del cliente

# Claude Code (local):
claude mcp add sdd-gl -- $(npm bin)/sdd-gl-mcp

# O usar npx:
claude mcp add sdd-gl -- npx -y @sdd-gl/mcp-server

# Gemini CLI
{
  "mcpServers": {
    "sdd-gl": {
      "command": "npx",
      "args": ["-y", "@sdd-gl/mcp-server"]
    }
  }
}
```

El paquete expone los mismos 8 tools del servidor MCP. La única diferencia es la ruta al binario
dependiendo del cliente y el PATH configurado.