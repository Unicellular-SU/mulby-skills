# uTools / zTools Plugin Migration

Use this reference when converting an existing uTools, zTools, Rubick-like, or launcher-plugin project into a Mulby plugin.

The goal is not to preserve the old host API names. The goal is to produce a real Mulby plugin with equivalent behavior where Mulby supports it, and an explicit gap list where Mulby does not.

## Migration Workflow

1. Inspect the old plugin contract.
   - Read `plugin.json`, `manifest.json`, `package.json`, and entry HTML/JS files.
   - Identify the UI entry, preload entry, lifecycle hooks, trigger commands, permissions, assets, and build output.
   - Detect multi-window file layouts such as `region/index.html`, `effect/index.html`, `recorder/index.html`, `countdown.html`, and per-window preload files.
   - Identify native/runtime resources loaded by path, such as `addon-*.node`, `.exe` helpers, `aperture`, ffmpeg binaries, language files, or model/data folders.
   - Detect the old host globals: `window.utools`, `utools`, `window.ztools`, `ztools`, `rubick`, or custom wrappers.
2. Convert the package shape.
   - Use `references/existing-frontend-conversion.md` for build output rules.
   - Create Mulby `manifest.json`.
   - Add a minimal `src/main.ts` or migrate old backend logic into `src/main.ts`.
   - Build the primary frontend output to root `ui/index.html`.
   - Preserve extra HTML/preload/native resources only when they are still needed, and list them in `manifest.assets`.
3. Replace old host APIs with Mulby APIs.
   - Search first; do not rewrite blindly.
   - Open `references/api-map.md` and then the exact `references/apis/*.md` files for each capability.
   - Prefer direct Mulby APIs over compatibility shims.
   - Replace only with APIs documented in this skill or confirmed in the target Mulby codebase.
4. Mark unsupported behavior explicitly.
   - If no Mulby API exists, do not pretend it works.
   - Leave a concise TODO or fallback message in the relevant code path.
   - Add a README section named `Migration Notes` or `Known Mulby Gaps`.
5. Validate the migrated behavior inside Mulby.

## API Replacement Rules

Renderer-side calls usually become `window.mulby.<module>.<method>()`.

Backend-side calls usually become `context.api.<module>.<method>()` or the injected backend `mulby.<module>.<method>()` when the target project already follows the Mulby backend style.

Do not keep old globals unless you deliberately add a small compatibility wrapper. A wrapper is acceptable only when it maps to real Mulby APIs and has a small, documented surface.

## Common API Mapping

| uTools / zTools Pattern | Mulby Replacement | Status |
| --- | --- | --- |
| `utools.onPluginEnter(callback)` | `window.mulby.onPluginInit(callback)` in renderer, or `run(context)` in backend | Supported with different event shape |
| `utools.onPluginOut(callback)` | `onUnload()` for backend lifecycle, or plugin/window close handling where available | Partial; no direct renderer `onPluginOut` equivalent in current docs |
| `utools.hideMainWindow()` | `window.mulby.window.hide()` | Supported in renderer |
| `utools.showMainWindow()` | `window.mulby.window.show()` | Supported |
| `utools.outPlugin()` | `window.mulby.plugin.outPlugin()` | Supported |
| `utools.redirect(label, payload)` | `window.mulby.plugin.redirect(label, payload)` | Supported |
| `utools.setFeature(feature)` | backend `context.api.features.setFeature(feature)` | Supported, backend API |
| `utools.removeFeature(code)` | backend `context.api.features.removeFeature(code)` | Supported, backend API |
| `utools.getFeatures()` | backend `context.api.features.getFeatures()` | Supported, backend API |
| `utools.copyText(text)` or clipboard write | `window.mulby.clipboard.writeText(text)` / `context.api.clipboard.writeText(text)` | Supported |
| `utools.readCurrentFolderPath()` | Use filesystem/dialog/window context only if available | Gap unless matching Mulby API exists |
| `utools.showNotification(...)` | `window.mulby.notification.show(...)` / `context.api.notification.show(...)` | Supported |
| `utools.showOpenDialog(...)` | `window.mulby.dialog.showOpenDialog(...)` / `context.api.dialog.showOpenDialog(...)` | Supported |
| `utools.showSaveDialog(...)` | `window.mulby.dialog.showSaveDialog(...)` / `context.api.dialog.showSaveDialog(...)` | Supported |
| `utools.shellOpenPath(path)` | `window.mulby.shell.openPath(path)` / `context.api.shell.openPath(path)` | Supported if shell API exposes the method |
| `utools.shellOpenExternal(url)` | `window.mulby.shell.openExternal(url)` / `context.api.shell.openExternal(url)` | Supported if shell API exposes the method |
| `utools.dbStorage.*` | `window.mulby.storage.*` / `context.api.storage.*` | Partial; KV storage exists, method names and sync/async behavior differ |
| `utools.db.*` document DB | `storage` APIs if simple KV/list data is enough | Partial; revision/document DB semantics are a gap |
| `utools.dbCryptoStorage.*` | Combine `security.encryptString/decryptString` with `storage` only when string encryption is enough | Partial; old encrypted storage object semantics are a gap |
| `utools.screenCapture()` | `window.mulby.screen.screenCapture()` | Supported in renderer; backend has `capture`/`captureRegion`, not interactive region capture |
| `utools.hideMainWindowPasteText(text)` | `window.mulby.input.hideMainWindowPasteText(text)` / backend input API | Supported |
| `utools.hideMainWindowPasteImage(image)` | `window.mulby.input.hideMainWindowPasteImage(image)` / backend input API | Supported |
| `utools.hideMainWindowPasteFile(path)` | `window.mulby.input.hideMainWindowPasteFile(path)` / backend input API | Supported |
| `utools.hideMainWindowTypeString(text)` | `window.mulby.input.hideMainWindowTypeString(text)` / backend input API | Supported |
| `utools.ubrowser...` | `window.mulby.inbrowser...` | Partial; renderer-side only in current docs, compare chain methods |
| `utools.ai(...)` | `window.mulby.ai...` / `context.api.ai...` if current docs support the needed call | Partial; verify against `apis/ai.md` |
| `utools.registerTool(...)` | Declare `manifest.tools`, then register with `context.api.tools` in backend `onLoad()` | Supported with Mulby contract |
| ZTools/uTools 原生鼠标/键盘 hook | `window.mulby.inputMonitor` / `context.api.inputMonitor` | Supported; 需声明 `permissions.inputMonitor`，macOS 需辅助功能权限 |
| `ztools.createBrowserWindow(route, opts)` single-entry route window | `window.mulby.window.create(route, opts)` | Supported; default `loadMode: 'route'` loads `manifest.ui` and maps route/query into hash/search |
| `ztools.createBrowserWindow('region/index.html', opts)` file-backed child window | `window.mulby.window.create('region/index.html', { loadMode: 'file', preload: opts.webPreferences?.preload, ... })` | Supported for legacy migration; HTML/preload must stay inside plugin directory |
| `opts.webPreferences.preload` for a child page | `window.mulby.window.create(path, { loadMode: 'file', preload: 'child/preload.cjs' })` | Supported only in file mode; falls back to `manifest.preload` when omitted |
| `win.setIgnoreMouseEvents(true)` | 创建时 `ignoreMouseEvents: true, forwardMouseEvents: true`，或运行时 `child.setIgnoreMouseEvents(true, { forward: true })` | Supported; CSS `pointer-events: none` 不能替代 |
| `win.setAlwaysOnTop(true, 'screen-saver')` | 创建时 `alwaysOnTop: true, alwaysOnTopLevel: 'screen-saver'`，或运行时 `child.setAlwaysOnTop(true, 'screen-saver')` | Supported |
| `win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` | 创建时 `visibleOnAllWorkspaces: true, visibleOnFullScreen: true`，或运行时 `child.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` | Supported |
| `win.showInactive()` | 创建时 `focusable: false` 自动使用 `showInactive()`，或运行时 `child.showInactive()` | Supported |
| `display.bounds` 多屏/缩放坐标 | `window.mulby.screen.getAllDisplays()` / `getPrimaryDisplay()` / `getDisplayNearestPoint()` | Supported; 详见 `apis/screen.md` |
| user payment/subscription APIs | No general Mulby equivalent in this skill docs | Gap; mark explicitly |
| account/cloud sync APIs | No general Mulby equivalent in this skill docs | Gap; mark explicitly |

Always verify method names in `references/apis/*.md`; this table is only a migration navigator.

For any method not in this table, do not infer a Mulby API from the old name. Search the API docs first. If no exact or safe semantic match exists, leave a migration gap.

## Manifest Conversion

Typical uTools-style contracts use `plugin.json` and feature entries. Convert them into Mulby `manifest.json`:

- Plugin identity -> `id`, `name`, `displayName`, `version`, `description`, `author`, `homepage`
- Primary entry HTML -> `ui`
- Preload file -> `preload` only if still needed; keep it CommonJS `.cjs`
- Extra HTML files, per-window preload files, native modules, and external binaries -> `assets`
- Commands/features -> `features[]`
- Keyword trigger -> `cmds: [{ "type": "keyword", "value": "..." }]`
- Regex trigger -> `cmds: [{ "type": "regex", "match": "..." }]`
- File/image triggers -> `files` or `img`
- Selection triggers -> `over`
- Window-context triggers -> `window` when equivalent data exists
- Background behavior -> `pluginSetting.background`, `persistent`, `idleTimeoutMs`
- Independent app windows -> `mode: "detached"` plus `window`

If old feature routing depends on a single entry URL, map each feature to `route` and use hash routing in the UI. If the old plugin genuinely depends on separate HTML documents with separate preload scripts, use the explicit file-window compatibility mode described below instead of forcing everything through hash routing.

Example for a migrated screen recorder style plugin:

```json
{
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "preload": "preload.cjs",
  "assets": [
    "region",
    "effect",
    "recorder",
    "countdown.html",
    "region/preload.cjs",
    "effect/preload.cjs",
    "addon-darwin-arm64.node",
    "bin/aperture"
  ],
  "features": [
    {
      "code": "main",
      "explain": "Open recorder",
      "cmds": [{ "type": "keyword", "value": "recorder" }],
      "mode": "detached"
    }
  ]
}
```

## Multi-HTML and Per-Window Preload Migration

Prefer modern Mulby structure for new plugins: one `manifest.ui` entry, frontend routing, and one optional `manifest.preload`. Use `loadMode: 'file'` only when preserving legacy behavior is materially simpler or required, such as old zTools/uTools plugins where region selection, overlay effects, recorder controls, and countdown pages are separate HTML files.

Route mode remains the default:

```ts
await window.mulby.window.create('overlay?source=main');
```

This loads `manifest.ui`, maps `overlay` to `location.hash`, and keeps `?source=main` in `location.search`.

File mode is explicit:

```ts
await window.mulby.window.create('region/index.html?key=abc#select', {
  loadMode: 'file',
  preload: 'region/preload.cjs',
  width: 640,
  height: 480,
  title: 'Select Region'
});
```

File mode constraints:

- `url` is a plugin-local HTML path, optionally followed by query/hash.
- HTML entries must be relative paths inside the plugin directory and must end in `.html` or `.htm`.
- Absolute paths, `../` traversal, NUL characters, missing files, and non-HTML entries are rejected by the host.
- `options.preload` is honored only in file mode. It must be a plugin-local `.js` or `.cjs` file.
- Mulby loads the core preload first, so `window.mulby` is still available, then loads the specified plugin preload.
- If `options.preload` is omitted, Mulby falls back to `manifest.preload`. If neither exists, only the Mulby core preload is loaded.
- File child windows still belong to the creating `pluginId`; parent/child controls and messaging remain scoped to that plugin.

Always package file-window resources explicitly. `mulby pack` cannot infer files opened by runtime string paths:

```json
{
  "assets": [
    "region",
    "effect",
    "countdown.html",
    "region/preload.cjs",
    "effect/preload.cjs",
    "addon-darwin-arm64.node",
    "bin/aperture"
  ]
}
```

Example zTools child-window shim:

```ts
type LegacyWindowOptions = {
  width?: number
  height?: number
  x?: number
  y?: number
  title?: string
  transparent?: boolean
  alwaysOnTop?: boolean
  skipTaskbar?: boolean
  focusable?: boolean
  frame?: boolean
  webPreferences?: {
    preload?: string
  }
}

export function createZtoolsWindowCompat(mulby: typeof window.mulby) {
  return async function createBrowserWindow(path: string, options: LegacyWindowOptions = {}) {
    return mulby.window.create(path, {
      loadMode: 'file',
      preload: options.webPreferences?.preload,
      width: options.width,
      height: options.height,
      x: options.x,
      y: options.y,
      title: options.title,
      transparent: options.transparent,
      alwaysOnTop: options.alwaysOnTop,
      skipTaskbar: options.skipTaskbar,
      focusable: options.focusable,
      titleBar: options.frame === false ? false : undefined
    });
  };
}
```

For overlay windows, pass Mulby-specific behavior explicitly:

```ts
await window.mulby.window.create('effect/index.html#overlay', {
  loadMode: 'file',
  preload: 'effect/preload.cjs',
  transparent: true,
  type: 'borderless',
  alwaysOnTop: true,
  alwaysOnTopLevel: 'screen-saver',
  skipTaskbar: true,
  focusable: false,
  ignoreMouseEvents: true,
  forwardMouseEvents: true,
  visibleOnAllWorkspaces: true,
  visibleOnFullScreen: true,
  backgroundThrottling: false
});
```

## Code Migration Checklist

Search for old host usage:

```bash
rg -n "utools|ztools|rubick|window\\.utools|window\\.ztools|dbStorage|ubrowser|onPluginEnter|onPluginOut" .
```

For each match:

1. Classify capability: window, input, clipboard, storage, shell, filesystem, notification, dynamic feature, AI, browser automation, payment, account, or other.
2. Open `references/api-map.md`.
3. Open the matching `references/apis/*.md`.
4. Replace with Mulby API only when the target method exists.
5. If the Mulby API has different sync/async behavior, update all callers accordingly.
6. If not supported, add an explicit migration note.

Example unsupported marker:

```ts
throw new Error('Mulby migration gap: uTools dbCryptoStorage has no direct Mulby equivalent yet.');
```

For optional behavior, prefer graceful degradation:

```ts
console.warn('[Migration] Skipped cloud sync: Mulby has no equivalent account sync API yet.');
```

## Compatibility Wrapper Rules

A wrapper can reduce churn in large ports, but keep it honest:

- Name it clearly, such as `src/migration/utools-compat.ts`.
- Implement only methods that map to real Mulby APIs.
- Throw or warn for unsupported methods.
- Do not create a fake `window.utools` or `window.ztools` that silently drops behavior.
- For old `createBrowserWindow` wrappers, use `loadMode: 'file'` only for plugin-local HTML files. Keep route windows in default route mode.
- Remove the wrapper once direct Mulby calls are practical.

Example:

```ts
export function createUtoolsCompat(mulby: typeof window.mulby) {
  return {
    hideMainWindow: () => mulby.window.hide(),
    showMainWindow: () => mulby.window.show(),
    outPlugin: (isKill?: boolean) => mulby.plugin.outPlugin(isKill),
    copyText: (text: string) => mulby.clipboard.writeText(text),
    showNotification: (body: string) => mulby.notification.show(body),
    dbCryptoStorage: unsupported('dbCryptoStorage')
  };
}

function unsupported(name: string) {
  return new Proxy({}, {
    get() {
      throw new Error(`Mulby migration gap: ${name} is not supported by the current Mulby APIs.`);
    }
  });
}
```

## Required Migration Notes

When porting from uTools/zTools, update `README.md` with:

- Original plugin source/ecosystem if known.
- Which old host APIs were replaced by Mulby APIs.
- Which behaviors are unsupported or degraded.
- Manual test checklist inside Mulby.

Do not claim full compatibility unless every old host API call has been replaced or intentionally removed.
