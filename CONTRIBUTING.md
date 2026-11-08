# Cómo contribuir

Mientras el proyecto está en diseño, lo que más sirve es discutir el alcance.

## Proponer un cambio de alcance

1. Abre un issue o un pull request que edite
   [`docs/alcance.md`](docs/alcance.md).
2. Si cierra una de las preguntas abiertas, la decisión pasa a
   [`docs/decisiones.md`](docs/decisiones.md) con su porqué.
3. Si cambia el orden del trabajo, se actualiza [`ROADMAP.md`](ROADMAP.md).

## Ramas

- `main`: la línea publicada. Sólo recibe `develop`.
- `develop`: integración. Todo llega acá por pull request.
- Todo lo demás: `tipo/descripcion-corta`, en inglés, minúscula y kebab-case,
  cortado desde `develop`. Por ejemplo `docs/scope-updater-backup` o
  `feat/version-adapters`.

Nunca se commitea ni se empuja directo a `develop` ni a `main`.

## Commits

```
tipo(scope): asunto en inglés, minúscula, sin punto, hasta 72 caracteres
```

Tipos: `feat fix refactor perf docs test build ci chore style revert`. El
commit que sube una versión se llama como la versión sola (`0.2.0`).

## Idiomas

Código, commits, ramas y pull requests en inglés. Documentación, comentarios y
todo texto que ve una persona, en español de Chile.
