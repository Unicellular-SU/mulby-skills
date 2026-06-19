# Verify Plugin

Use this reference to actually **test a finished plugin by driving Mulby itself**, instead of only handing the
user a manual checklist. Self-verification is the default; the manual checklist is the fallback.

## Self-test first

After build (and pack when requested), verify the plugin through Mulby's verification mode. Prefer the wrapper:

```bash
node ./scripts/invoke_mulby_cli.mjs verify .              # verify the current plugin dir
node ./scripts/invoke_mulby_cli.mjs verify ./my-plugin --json
```

Globally installed equivalent:

```bash
mulby verify .
mulby verify ./my-plugin --json
mulby verify ./my-plugin --strict      # also fail on warnings
```

`mulby verify`:

- locates the Mulby executable (`--app-path`, env `MULBY_APP_PATH`, `mulby config set appPath <exe>`, or the
  default install location);
- launches Mulby in an **isolated** verification mode (its own temp userData — no effect on the user's real
  Mulby or data);
- runs a smoke test of the plugin: `manifest` + entry, plugin `load`, `onLoad` lifecycle, per-feature trigger
  match, feature execution (silent/background), and UI render (for UI features);
- prints a structured report and exits `0` (pass) / `1` (fail).

## Read the report

Use `--json` to parse it. Key fields:

- `ok` / `verdict` — overall pass/fail.
- `checks[]` — each `{ id, title, status: pass | fail | warn | skip, detail }`. Common ids: `manifest`, `load`,
  `onload`, `trigger:<feature>`, `run:<feature>`, `render:<feature>`.
- `features[]` — per feature: `triggerMatched`, `run`, and `uiRender`.
- `logs[]` — host / UI console output captured during the run. Look here for the cause of an `onload` / `run`
  / `render` failure.

## Fix loop

Iterate until `ok` is true:

1. Any `fail` → fix, rebuild (`npm run build`), re-run. Read `logs` for the underlying error.
2. `trigger:<feature>` fail → the `manifest.json` `features[].cmds` keyword/regex is misconfigured (e.g. `regex`
   uses `value` instead of `match`).
3. `onload` / `run` fail → a backend error in `src/main.ts` → `dist/main.js`; the message is in `detail` / `logs`.
4. `render:<feature>` fail → the UI failed to mount, crashed, or logged console errors; check `logs` and
   `features[].uiRender`.

Always rebuild before re-running so `dist/main.js` and `ui/` are current.

## Interactive MCP loop (optional)

For richer back-and-forth — search, run, render, screenshot, query DOM — start the verification MCP server and
connect an MCP client (Claude Code / Cursor, or a test client):

```bash
node ./scripts/invoke_mulby_cli.mjs mcp     # prints the HTTP URL + AI-IDE config; Ctrl+C to stop
```

Tools: `load_plugin`, `list_features`, `search`, `run`, `render_ui`, `screenshot`, `query_dom`, `get_logs`.

## When automated verification cannot run

If `mulby verify` cannot locate or launch Mulby (Mulby not installed, no `appPath` configured, headless CI
without the app), do **not** silently skip testing. Instead:

1. State clearly that automated verification could not run, and why.
2. Hand the user a short manual acceptance checklist for testing inside Mulby: which keyword(s)/trigger to type,
   which feature to invoke, and the expected result for each declared feature.
