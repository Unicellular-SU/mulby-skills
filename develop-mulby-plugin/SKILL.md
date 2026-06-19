---
name: develop-mulby-plugin
description: Create, convert, modify, validate, and package Mulby plugins with the Mulby CLI and bundled Mulby plugin references. Use when a task involves scaffolding a Mulby plugin, converting an existing React/Vue/Svelte/Vite/static frontend app into a Mulby plugin, porting uTools/zTools/Rubick-style plugins to Mulby APIs, choosing a React vs basic template, wiring `manifest.json` features to `src/main.ts` and UI or preload files, selecting Mulby host APIs, finalizing a themed plugin icon, or producing a `.inplugin` package.
---

# Develop Mulby Plugin

Use this skill for both new Mulby plugins and existing plugin fixes. The goal is to ship an attachable plugin, not just generate code fragments.

## Workflow

1. Start with recon.
   - Existing plugin: inspect `manifest.json`, `src/main.ts`, `src/ui/App.tsx` when UI exists, and `preload.cjs` when present.
   - Existing frontend app: inspect `package.json`, build config, frontend entry, router mode, output directory, and whether the app actually needs Mulby APIs.
   - uTools/zTools/Rubick-style plugin: inspect old `plugin.json`/manifest, preload, UI entry, lifecycle hooks, and all old host API calls.
   - New plugin: choose the correct template before creating files.
2. Pick the template deliberately.
   - If the user already has a working React, Vue, Svelte, or other frontend app, do not force it into the Mulby template. Read [references/existing-frontend-conversion.md](references/existing-frontend-conversion.md) and convert it in place.
   - If the source is a uTools/zTools/Rubick-style plugin, read [references/utools-ztools-migration.md](references/utools-ztools-migration.md) and migrate old host APIs to real Mulby APIs.
   - Use `react` for any visible UI, detached window, routed interface, or richer interactive flow.
   - Use `basic` for command-only, silent, or background-first plugins with no frontend.
3. Scaffold with the local CLI.
   - Read [references/cli-workflow.md](references/cli-workflow.md) for exact commands.
   - Prefer the bundled wrapper `scripts/invoke_mulby_cli.mjs`. It is cross-platform and can use a local install, a global `mulby`, or `npx mulby-cli`.
   - Treat Mulby CLI as template, build, and pack tooling only. Do not depend on or modify its AI generation flow for this skill.
   - Do not use `mulby create --ai` when you are already the AI agent doing the work.
4. Lock the plugin contract before major edits.
   - Define every `features[].code`.
   - Define each trigger in `cmds`.
   - Decide the mode for each feature: `ui`, `silent`, or `detached`.
   - Decide whether logic belongs in backend, UI, or `preload.cjs`.
   - Decide which Mulby APIs are needed.
   - Decide whether the plugin should expose tools for AI Agent (via `manifest.tools` and `context.api.tools`).
5. Build one minimum runnable path first.
   - Make `manifest.json` match real files.
   - Implement one happy path that can actually be triggered inside Mulby.
   - Add extra features only after the minimum path is attachable.
6. Finalize icon assets after the plugin direction is stable.
   - Do not finalize icon art while the plugin feature set or UI theme is still evolving.
   - After the plugin function and visual theme are settled, create an editable SVG source at `assets/icon.svg`.
   - The SVG must be specific to the plugin purpose, visual tone, and UI color palette. Do not ship a generic placeholder mark.
   - Run `scripts/finalize_plugin_icon.mjs` to render the SVG into the final 512x512 root `icon.png` before packaging.
7. Verify before handoff — test it yourself, do not just hand off a checklist.
   - Run `npm install` in the plugin directory when dependencies are missing.
   - Run build, and pack when the task calls for a deliverable package.
   - Run `mulby verify` yourself to load and smoke-test the plugin inside Mulby, then iterate (fix → rebuild → re-run) until the report is `ok`. Read [references/verify-plugin.md](references/verify-plugin.md).
   - Only if `mulby verify` cannot locate or launch Mulby, fall back to giving the user a short manual acceptance checklist — and say plainly that automated verification did not run and why.

## Mulby Rules

- Treat `manifest.json` as the plugin contract and source of truth.
- Keep `features` intentional. Do not leave template placeholders behind.
- Existing frontend apps can be valid Mulby plugins without using Mulby APIs. They still need `manifest.json`, a minimal backend `main`, a local `ui/index.html` build output, and an intentional trigger.
- For uTools/zTools/Rubick migrations, replace old host APIs with Mulby APIs. If Mulby does not support an old capability, mark it explicitly in code and README instead of silently dropping it.
- Do not edit `mulby-cli` AI prompts, sessions, or validation to solve plugin conversion tasks. The portable skill should guide any AI tool directly.
- Add `preload.cjs` only when Node.js or Electron bridging is required.
- When `preload.cjs` exists, keep it in CommonJS and wire `manifest.preload` to the real file.
- Keep editable icon source files as SVG during development; packaged plugins should normally end with a final root `icon.png`.
- Use this skill's own `scripts/finalize_plugin_icon.mjs` for plugin icon conversion. Do not depend on another skill for plugin icon finalization.
- Do not create preview-only HTML files such as `preview.html` or `demo.html`.
- Avoid watch mode or long-running dev commands unless the user explicitly asks for them.
- When the plugin backend imports npm packages that fail with esbuild bundling (native addons like `sharp`, packages using `createRequire` like `svgo`), externalize them individually with `--external:packagename`. Do not use `--packages=external` for plugins that will be packaged as `.inplugin` because `mulby pack` does not ship `node_modules`.
- If bundled references and the target environment diverge, trust the target environment's implementation and current type definitions.

## What To Read

- Read [references/cli-workflow.md](references/cli-workflow.md) when you need exact `create`, `build`, or `pack` behavior, or when you need to know what each template generates.
- Read [references/verify-plugin.md](references/verify-plugin.md) to test a finished plugin by driving Mulby with `mulby verify` (and the optional `mulby mcp` interactive loop), how to read the report and iterate, and when to fall back to a manual checklist.
- Read [references/plugin-development-guide.md](references/plugin-development-guide.md) when you need the full integration checklist, manifest rules, and preload constraints.
- Read [references/existing-frontend-conversion.md](references/existing-frontend-conversion.md) when converting an existing React, Vue, Svelte, Vite, or static frontend app into a Mulby plugin.
- Read [references/utools-ztools-migration.md](references/utools-ztools-migration.md) when porting uTools, zTools, Rubick-like, or other launcher-plugin ecosystems to Mulby.
- Read [references/icon-workflow.md](references/icon-workflow.md) when icon design, SVG source creation, or `icon.png` conversion is in scope.
- Read [references/api-map.md](references/api-map.md) when you need a bundled Mulby API navigator and module selection guide.
- Read [references/apis/README.md](references/apis/README.md) first when a task depends on specific Mulby APIs, then open the relevant `references/apis/*.md` files for exact module details.
- Read [references/apis/tools.md](references/apis/tools.md) when the plugin needs to expose tools for AI Agent integration.
- Read [references/drag-and-drop-sandbox-bypass-guide.md](references/drag-and-drop-sandbox-bypass-guide.md) when a plugin requires system drag-and-drop support or involves reading local file paths from drag events.

## Handoff Checklist

Before claiming completion, verify all of the following when applicable:

- `manifest.json` required fields are complete.
- Every `feature.code` maps to real handling logic.
- If `manifest.tools` is declared, every tool has a matching handler registered in `onLoad`.
- `main`, `ui`, and `preload` paths point to files that exist.
- For converted frontend apps, the build creates both `dist/main.js` and `ui/index.html`, and asset URLs work under `file://`.
- For old ecosystem migrations, all `utools`/`ztools`/`rubick` API calls are either replaced with documented Mulby APIs or listed as migration gaps.
- `preload.cjs` is only present when needed and stays CommonJS.
- If icon work is in scope, `assets/icon.svg` reflects the settled plugin function and UI theme, and the scaffold default `icon.png` has been replaced by the 512x512 output from `scripts/finalize_plugin_icon.mjs`.
- `npm run build` succeeds.
- `npm run pack` succeeds when a package is requested.
- `mulby verify` reports `ok` — load, trigger match, execution, and UI render all pass. Re-run after each fix until it passes.
- `README.md` has been updated to document the plugin's functionality, usage instructions, and any configuration options. Include at minimum: plugin description, supported features/commands, usage examples, and any prerequisites or dependencies.
- Only when `mulby verify` cannot run (Mulby not located/installed), the user receives a short manual acceptance checklist for testing inside Mulby, with a clear note that automated verification did not run.
