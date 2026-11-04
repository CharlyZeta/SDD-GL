# DEPLOY — Publicar una versión

Checklist para llevar `sdd-gl` del repo a npm sin sorpresas. Todo lo de acá se
probó en la publicación de la 0.6.0, incluidos los errores que aparecieron.

---

## Antes de empezar

```powershell
cd E:\Propios\SDD-GL\sdd-gl-repo
git status --porcelain        # tiene que estar vacío
git pull                      # o al menos estar al día con origin/main
npm whoami                    # tiene que devolver tu usuario (charlyzeta)
```

Si `npm whoami` falla con **E401**, el token de `~/.npmrc` está vencido o mal
pegado. No sigas: `npm login` y volvé a probar.

---

## 1. Subir la versión

```powershell
node scripts/release.js 0.6.2
```

Ese script actualiza de una sola vez:

- `package.json`, `mcp/package.json`, `plugin.json` y `package-lock.json`
- el badge de versión en `README.md` y `README.es.md`
- regenera `.sdd/dashboard.html` y `docs/index.html` (el layout muestra la versión)

## 2. Escribir el changelog

Agregá la entrada **arriba de todo** en `CHANGELOG.md` (el archivo va de la más
nueva a la más vieja):

```markdown
## [0.6.2] — 2026-11-05

### Changed — <título corto>

- <qué cambió y por qué>
```

## 3. Verificar

```powershell
npm test                      # suite completa (~90 s)
node scripts/release.js --check   # manifiestos, badges y CHANGELOG en línea
npm pack --dry-run            # lista exacta de lo que se publica
```

`--check` falla si alguna de las cuatro versiones quedó desincronizada. Es el
error más fácil de cometer y el más difícil de ver: la página de npm mostraría
un badge mentiroso.

Del `npm pack --dry-run` revisá dos cosas: que estén `mcp/`, `bin/`, `protocol/`,
`presets/` y que **no** aparezcan `contracts/`, `.sdd/` ni `test-sandbox/`.

## 4. Commit y push

```powershell
git add -A
git commit -m "chore(release): 0.6.2"
git push origin main
```

Esperá el CI en verde antes de publicar:

```
https://github.com/CharlyZeta/SDD-GL/actions
```

## 5. Publicar

```powershell
npm publish
```

`prepublishOnly` corre la suite y `release.js --check`. Si algo falla, no publica.
npm va a pedir el **código de 6 dígitos** (2FA) o va a abrir el navegador.

## 6. Verificar la publicación

```powershell
npm view sdd-gl version           # la versión nueva
npm view sdd-gl dist.tags --json  # latest debe apuntar a la nueva
npm i -g sdd-gl
sdd --help
```

**Cuidado con la propagación.** El registro tarda uno o dos minutos en servir la
versión nueva en todos los nodos. En la 0.6.0 pasó esto:

```
npm view sdd-gl version  →  0.0.0-stage   (placeholder, caché vieja)
# ~2 minutos después
npm view sdd-gl version  →  0.6.0         ✓
```

Si `npm i -g` instala la versión anterior, no es un bug del paquete: esperá y
repetí. Para forzar la consulta sin caché:

```powershell
npm view sdd-gl version --registry=https://registry.npmjs.org/
```

## 7. Tareas posteriores (opcionales)

```powershell
# Marcar una versión vieja como obsoleta
npm deprecate sdd-gl@0.6.1 "usar >= 0.6.2"
```

Si la versión anterior tenía un bug crítico, conviene además un `npm dist-tag`
apuntando `latest` a la última buena:

```powershell
npm dist-tag add sdd-gl@0.6.2 latest
```

---

## Errores conocidos

| Síntoma | Causa | Solución |
|---|---|---|
| `E401` en `npm whoami` | token vencido, revocado o truncado al pegar | `npm config delete //registry.npmjs.org/:_authToken` y `npm login` |
| `E403 ... Two-factor authentication required` | token granular sin "Bypass 2FA" | `npm publish --otp=123456`, o recrear el token con Bypass 2FA |
| `E404` en el `PUT` al publicar | es un 401 disfrazado: la autenticación falló | verificar `npm whoami` antes de publicar |
| `E404` en `npm i -g sdd-gl` | el paquete no existe todavía (nunca se publicó) | correr `npm publish` primero |
| `npm warn ... bin[sdd] script name was invalid and removed` | npm normaliza el prefijo `./` del `bin` | cosmético; el tarball conserva los bins (verificado) |
| `latest` apunta a una versión vieja | propagación del registro | esperar 1–2 min y repetir |
| `npm deprecate` pide OTP | toda escritura en el registro requiere 2FA | usar `--otp` o el flujo del navegador |

---

## Qué no se puede deshacer

- **El nombre del paquete queda tomado** desde la primera publicación. Elegirlo
  mal obliga a publicar otro nombre y deprecar el anterior.
- **Una versión publicada no se borra** después de 72 h. Si sale con un bug: se
  publica un patch y, si es grave, `npm deprecate`.
- **Un nombre no se puede mover de scope**: `sdd-gl` y `@algo/sdd-gl` son
  paquetes distintos.

Por eso el orden es siempre: `release.js` → changelog → tests → CI verde →
`npm publish` → verificar.

---

## Referencia rápida

```powershell
node scripts/release.js --check     # ¿está todo en línea?
node scripts/release.js 0.6.2       # subir versión + regenerar dashboards
npm test                            # suite completa
npm pack --dry-run                  # qué se va a publicar
npm publish                         # subir al registro
npm view sdd-gl version             # verificar
```
