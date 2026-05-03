# Plugin Icon Workflow

Use this reference when icon work is in scope for a Mulby plugin.

## Timing

Finalize the icon only after the plugin function and UI theme are stable.

Do not design the final SVG while these are still changing:

- the plugin's primary job
- feature names and triggers
- UI layout direction
- color palette and visual tone

During early development, keep the scaffold default `icon.png` or a temporary draft. The final icon should be created near the packaging phase.

## Design Requirements

Create an editable SVG source at:

```text
assets/icon.svg
```

The SVG should be:

- specific to the plugin's real function
- visually consistent with the finished UI theme
- simple enough to remain recognizable at small sizes
- centered in a square canvas
- free of tiny text or fragile details
- not a generic placeholder, app logo, or unrelated decorative mark

Choose colors from the plugin UI when possible. If the UI uses a restrained palette, the icon should also be restrained; if the UI is playful or visual, the icon can be more expressive.

## Conversion

Use this skill's bundled script to convert the SVG into the packaged plugin icon:

```bash
node /path/to/develop-mulby-plugin/scripts/finalize_plugin_icon.mjs \
  --project-root /path/to/plugin \
  --svg assets/icon.svg \
  --out icon.png
```

Defaults:

- input: `assets/icon.svg`
- output: `icon.png`
- size: `512x512`
- padding: `0.08`
- `manifest.icon` is updated to the output path unless `--no-update-manifest` is passed

If `sharp` cannot be resolved, install it in the plugin project or pass:

```bash
--sharp-root /path/to/project-with-sharp
```

## Final Checks

Before packaging:

1. Confirm `assets/icon.svg` is the editable source.
2. Confirm root `icon.png` is the generated 512x512 PNG, not the scaffold default.
3. Confirm `manifest.icon` points to `icon.png`, unless the plugin intentionally uses another supported icon path.
4. Visually inspect the icon next to the plugin UI.
5. Check that the icon still reads clearly when previewed small.
