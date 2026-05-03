# Existing Frontend Conversion

Use this reference when the user already has a React, Vue, Svelte, or other frontend app and wants to turn it into a Mulby plugin.

Do not force the project into the Mulby React template. Keep the existing app structure when it is already working, and add only the Mulby contract needed to load, trigger, build, and package it.

If the source project is already a uTools, zTools, Rubick-like, or other launcher plugin, also read `references/utools-ztools-migration.md` before rewriting APIs.

## Runtime Facts

- Mulby requires `manifest.json`.
- Non-system plugins require `manifest.main`, and the referenced backend file must exist.
- UI plugins set `manifest.ui` to a local HTML file, usually `ui/index.html`.
- Mulby loads plugin UI with Electron `loadFile()`, not an HTTP dev server.
- Feature `route` is passed as the window hash.
- The renderer always receives Mulby's core preload, so `window.mulby` is available when the app wants it.
- If the app does not need Mulby APIs, it can ignore `window.mulby` completely.
- `mulby pack` requires `dist/main.js`, rewrites packaged `manifest.main` to `main.js`, and includes the root `ui/` directory when present.
- `mulby pack` includes root `icon.png`, `README.md`, `preload.cjs` when declared, and extra paths listed in `manifest.assets`.

## Recommended Conversion

Use in-place conversion for existing Vite/React/Vue apps:

1. Inspect the current app.
   - Identify the framework and build tool.
   - Find the current HTML entry, build command, output directory, router mode, and asset paths.
   - Check whether it depends on backend APIs, remote URLs, browser-only APIs, service workers, or absolute public paths.
2. Add the Mulby plugin contract at the project root.
   - `manifest.json`
   - `src/main.ts` as a minimal backend entry
   - `icon.png` and preferably `assets/icon.svg`
   - `README.md`
3. Configure the frontend build to output a local UI bundle.
   - Output directory should be root `ui/`.
   - Built entry should be `ui/index.html`.
   - Asset URLs must be relative; for Vite set `base: './'`.
4. Configure scripts so one build produces both required outputs.
   - backend: `dist/main.js`
   - frontend: `ui/index.html`
   - It is acceptable to use the project's existing build command instead of `mulby build` as long as these outputs exist before `mulby pack`.
5. Add or update `manifest.features`.
   - Use `mode: "detached"` for full apps, dashboards, editors, games, and multi-page tools.
   - Use `mode: "ui"` only for compact panel-style tools.
   - Use `route` when a feature should open a specific hash route.
6. Build and package.

## CLI Role

Use Mulby CLI only for template creation, build, and packaging. For existing apps, the app's own framework build is allowed and often preferable. The conversion is valid as long as the final project contains the Mulby contract and produces the required packaged outputs.

## Minimal Files

`manifest.json` for a UI-only converted app:

```json
{
  "id": "my-existing-app",
  "name": "my-existing-app",
  "version": "1.0.0",
  "displayName": "My Existing App",
  "description": "Existing frontend app packaged as a Mulby plugin.",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "icon": "icon.png",
  "features": [
    {
      "code": "open",
      "explain": "Open app",
      "mode": "detached",
      "cmds": [{ "type": "keyword", "value": "my-app" }]
    }
  ],
  "window": {
    "width": 1000,
    "height": 720,
    "minWidth": 720,
    "minHeight": 480
  }
}
```

Minimal `src/main.ts` when the app does not need backend logic:

```ts
export function onLoad() {}
export function onUnload() {}
export function onEnable() {}
export function onDisable() {}

export async function run() {}

export default { onLoad, onUnload, onEnable, onDisable, run };
```

Minimal build scripts:

```json
{
  "scripts": {
    "build": "pnpm run build:backend && pnpm run build:ui",
    "build:backend": "esbuild src/main.ts --bundle --platform=node --outfile=dist/main.js",
    "build:ui": "vite build",
    "pack": "pnpm run build && mulby pack"
  }
}
```

`mulby build` only auto-runs the UI build when it finds `vite.config.ts`. Existing projects may use `vite.config.js`, framework CLIs, or custom build scripts. In those cases, keep the project's native build command and make `package.json` scripts produce the required `dist/main.js` and `ui/index.html` before running `mulby pack`.

## Vite Apps

For Vite-based React, Vue, Svelte, Solid, or vanilla apps, keep the existing plugin config and set only the Mulby-relevant build options:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'ui',
    emptyOutDir: true
  }
});
```

If the app uses `root`, make `outDir` point back to the plugin root:

```ts
export default defineConfig({
  root: 'src/ui',
  base: './',
  build: {
    outDir: '../../ui',
    emptyOutDir: true
  }
});
```

Keep framework plugins such as `@vitejs/plugin-react` or `@vitejs/plugin-vue`. Do not replace Vue with React just because Mulby's default template uses React.

## Non-Vite Or Static Apps

For Create React App, Next static export, Vue CLI, Astro static output, or hand-written static apps, keep the native build and copy the final static output into root `ui/`.

Examples:

- CRA: build to `build/`, then copy `build/*` to `ui/`.
- Next static export: export static files, then copy the export directory to `ui/`.
- Static HTML: place `index.html` and assets directly under `ui/`.

The final packaged shape still needs `ui/index.html`. Do not point `manifest.ui` at a dev server URL.

## Routing

Mulby passes feature routes as URL hashes. Prefer hash routing for converted frontend apps:

- React Router: use `HashRouter`.
- Vue Router: use `createWebHashHistory()`.
- Other routers: use hash mode when available.

Avoid browser history routing unless the app is specifically adapted to `file://` loads and refresh behavior.

Feature example:

```json
{
  "code": "settings",
  "explain": "Open settings",
  "mode": "detached",
  "route": "settings",
  "cmds": [{ "type": "keyword", "value": "my-app settings" }]
}
```

The UI will load as `ui/index.html#settings`.

## When To Use Mulby APIs

No Mulby API is required for a pure frontend app.

Only integrate `window.mulby` when the app needs host capabilities such as:

- clipboard
- notifications
- local storage scoped to the plugin
- filesystem or shell APIs
- opening additional plugin windows
- backend RPC through `window.mulby.host`
- receiving launch input via `window.mulby.onPluginInit`

If no host capability is needed, avoid adding Mulby-specific code to the existing UI.

## Preload

Do not add `preload.cjs` for ordinary frontend apps.

Use `preload.cjs` only when the UI needs a narrow Node.js or Electron bridge that `window.mulby` does not already provide. It must be CommonJS and must be declared in `manifest.preload`.

## Assets And Network

Converted apps are loaded from `file://`, so check these risks:

- Absolute asset paths such as `/assets/app.js` will break. Use relative paths.
- Service workers and PWA assumptions usually do not apply.
- Backend HTTP calls must point to real reachable services.
- Static files outside the built `ui/` directory are not packaged unless copied into `ui/` or listed in `manifest.assets`.
- Dynamic imports must resolve from the local built bundle.

## Validation Checklist

Before handoff:

1. `manifest.json` exists and declares `main`, `ui`, `features`, and `icon`.
2. `dist/main.js` exists after build.
3. `ui/index.html` exists after build.
4. Built `ui/index.html` uses relative asset URLs.
5. The app opens from `file://` without relying on the dev server.
6. Feature `mode` matches the UI shape (`detached` for full apps, `ui` for compact panels).
7. Routes use hash mode when routes are needed.
8. `mulby pack` succeeds and includes `ui/`.
9. Manual test inside Mulby opens the converted UI from the configured trigger.
