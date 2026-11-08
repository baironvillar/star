# Changelog

Los cambios que nota quien usa star en su app. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones
siguen [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado

- `star version`: muestra la versión de cada manifiesto y falla si alguno
  discrepa. Detecta solo el `package.json` raíz, los workspaces, y en una app de
  escritorio `tauri.conf.json`, `Cargo.toml` y `Cargo.lock`.
- `star version bump [patch|minor|major]`: sube la versión en todos los
  manifiestos, cambiando sólo el número. Antes revisa que coincidan, que la rama
  sea `release/<versión>`, que el tag esté libre (también en `origin`) y que
  `CHANGELOG.md` tenga las notas, y pregunta.
- `star version set <x.y.z>`: fija una versión, para reparar manifiestos que
  se desincronizaron.
- `star version tag <tag>`: falla si el tag no coincide con la versión. Es para
  la CI.
- `star notes [versión]`: imprime las notas de una versión desde
  `CHANGELOG.md`.
- `star release [patch|minor|major]`: prepara una versión desde `develop`.
  Revisa que todo esté en orden, corre la puerta (`vp check` y `vp test` por
  defecto, o lo que diga `"star": { "gate" }`), crea `release/<versión>`, sube
  la versión, commitea, empuja y abre el PR. Si las notas están en
  `## [Sin publicar]`, propone convertirlas en la sección de la versión.
- `star release finish`: cuando el CI del PR pasa, lo mergea con squash con la
  versión como asunto, actualiza `develop`, verifica lo que llegó y empuja el
  tag.
