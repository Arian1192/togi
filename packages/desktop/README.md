# @togi/desktop

App de escritorio de togi (ADR-010): Tauri 2 en Rust, y Vite con React en el webview.

## Arrancarla

```sh
pnpm --filter @togi/desktop app
```

Compila la interfaz (`vite build`) y arranca la app con `cargo run --features tauri/custom-protocol`.
Necesita un daemon en marcha (`togi daemon start`): la ventana muestra su estado y su versión
(`v0.2.5 (aae6fce)` si está instalado, `dev` si corre desde el repo).

**No uses `cargo run` a secas.** Sin la opción `tauri/custom-protocol` Tauri no empaqueta la
interfaz y la ventana falla con `asset not found: index.html`. El script `app` ya la lleva.

## Comprobaciones

- `cargo test --locked` en `src-tauri/` necesita que exista `dist/`: antes, `pnpm --filter @togi/desktop build`.
- Los tests de Node (`pnpm test`) vigilan la CSP, las capacidades y que el frontend no toque el token.
- El token no sale del lado Rust: lo comprueba `src-tauri/tests/token-boundary.rs`.
