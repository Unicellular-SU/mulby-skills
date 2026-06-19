# CLI Workflow

Use this reference when you need exact Mulby plugin scaffolding, build, and packaging commands in a portable setup.

## Cross-Platform Wrapper

Prefer the bundled Node wrapper when this skill is installed as a standalone package:

```bash
node ./scripts/invoke_mulby_cli.mjs create my-plugin --template react
```

The wrapper is cross-platform and resolves the CLI in this order:

1. `MULBY_CLI_ENTRY` environment variable pointing to a CLI entry file
2. `MULBY_CLI_BIN` environment variable pointing to a `mulby` executable
3. a local `node_modules/.bin/mulby`
4. `mulby` on `PATH`
5. `npx --yes mulby-cli@latest`

Use environment overrides when you want a pinned CLI version or a repo-local CLI build.

Examples:

```bash
node ./scripts/invoke_mulby_cli.mjs build
node ./scripts/invoke_mulby_cli.mjs pack
```

If the CLI is already installed globally, the equivalent commands are:

```bash
mulby create my-plugin --template react
mulby build
mulby pack
```

Do not use `mulby create --ai` for this skill. The point of this skill is that the current agent already handles the implementation.

Treat Mulby CLI as a narrow utility:

- `create` scaffolds a basic or React template for new plugins.
- `build` bundles `src/main.ts` and may run a Vite UI build for template-style projects.
- `pack` creates the `.inplugin` archive.

Do not rely on or change Mulby CLI's AI generation flow when converting an existing project. The skill instructions are the source of truth for AI-assisted conversion.

## Template Selection

Do not scaffold over an existing working frontend app. For React, Vue, Svelte, Vite, or static apps that already exist, convert the project in place and read `references/existing-frontend-conversion.md`.

Choose `react` when the plugin needs:

- a visible UI
- a detached window
- richer user interactions
- routed frontend views

Choose `basic` when the plugin is:

- command-only
- silent
- background-first
- backend-only

## What `create` Generates

The common scaffold behavior is:

- `react` creates `manifest.json`, `package.json`, `tsconfig.json`, `vite.config.ts`, frontend files under `src/ui/`, backend entry `src/main.ts`, and `src/types/mulby.d.ts`.
- `basic` creates `manifest.json`, `package.json`, and `src/main.ts`.
- Both templates scaffold a default root `icon.png` that should be replaced before shipping a branded plugin.

Important defaults from the templates:

- `react` sets `manifest.ui` to `ui/index.html`.
- `react` package scripts include `build`, `build:backend`, `build:ui`, and `pack`.
- `basic` package scripts include `build`, `dev`, and `pack`.

## Build Behavior

The common build behavior is:

- `mulby build` requires `manifest.json`.
- Backend build bundles `src/main.ts` into `dist/main.js` with esbuild.
- UI build only runs when `manifest.ui` exists and `vite.config.ts` is present.
- Existing frontend projects may keep their own build command, but the final plugin build must create `dist/main.js` and `ui/index.html`.
- For Vite apps loaded by Mulby, use relative asset URLs (`base: './'`) and output the frontend bundle to the root `ui/` directory.

The generated plugin templates already wire `npm run build` to the expected build steps, so prefer `npm run build` inside the plugin project unless you specifically need to exercise the CLI command path.

## Pack Behavior

The common packaging behavior is:

- `mulby pack` requires `manifest.json`.
- `mulby pack` also requires `dist/main.js`, so build first.
- The archive always includes a packaged `manifest.json` whose `main` points to `main.js`.
- The archive always includes bundled backend output as `main.js`.
- It includes `ui/` when present.
- It includes `icon.png` and `README.md` when present.
- It includes `preload.cjs` when `manifest.preload` points to an existing file.
- When `preload` is present, production dependencies from `node_modules` are packed too.

The output filename is `<manifest.name>-<manifest.version>.inplugin`.

## Icon Finalization

- Do not finalize icon art while the plugin feature set or UI theme is still changing.
- Once the plugin direction is stable, create `assets/icon.svg` with artwork that matches the plugin purpose, tone, and palette.
- Run `scripts/finalize_plugin_icon.mjs` from this skill to convert the SVG into a 512x512 root `icon.png`.
- Replace the scaffold default root `icon.png` before `mulby pack`.
- Keep `manifest.icon` pointing to `icon.png` unless the project intentionally uses another supported icon form.

## Practical Loop

1. Scaffold with `create`.
2. Install dependencies in the plugin directory.
3. Edit `manifest.json` and the real entry files.
4. Run `npm run build`.
5. After the plugin behavior and UI theme are stable, create `assets/icon.svg` and run `scripts/finalize_plugin_icon.mjs` to replace the scaffold default `icon.png`.
6. Run `npm run pack` when a distributable package is needed.
7. Run `mulby verify` yourself to load and smoke-test the plugin inside Mulby (see `references/verify-plugin.md`); iterate until it reports `ok`. Only fall back to a manual user checklist if `mulby verify` cannot locate or launch Mulby.
