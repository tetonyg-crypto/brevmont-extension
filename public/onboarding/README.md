# Install-screen screenshots — founder hand-off

The first-run install screen (`entrypoints/install-screen/`) shows three
platform-specific screenshots that walk the rep through pinning the Brevmont
extension in their Chrome toolbar. Until these PNGs ship, the install screen
gracefully falls back to text-only step descriptions.

## Files needed (drop here, exact filenames)

| File         | Platform | What to capture                                                         |
| ------------ | -------- | ----------------------------------------------------------------------- |
| `mac-1.png`  | macOS    | Chrome toolbar with the puzzle-piece (Extensions) icon highlighted      |
| `mac-2.png`  | macOS    | Extensions menu open with Brevmont visible + the pin icon highlighted   |
| `mac-3.png`  | macOS    | Chrome toolbar with the Brevmont icon now pinned                        |
| `win-1.png`  | Windows  | Chrome toolbar with the puzzle-piece (Extensions) icon highlighted      |
| `win-2.png`  | Windows  | Extensions menu open with Brevmont visible + the pin icon highlighted   |
| `win-3.png`  | Windows  | Chrome toolbar with the Brevmont icon now pinned                        |

## Capture spec

- Crop tightly to the toolbar area (~600x150 visual rect, then center on
  whatever is highlighted).
- Annotate the target with a soft red rounded rectangle (lighter weight than
  Apple's accessibility highlight — think 1.5px stroke, 8px radius, opacity
  0.85). No arrows, no callouts, no SaaS-y zoom-bubbles.
- Light theme Chrome only. Dark theme captures introduce contrast variance
  the on-page styling can't compensate for.
- Anonymise the screenshot — clear cookies for any logged-in services in the
  capture browser profile, hide bookmarks bar.

## Compression budget

- PNG-8 (256 colours) is fine for these UI shots; PNG-24 is overkill.
- Run each through TinyPNG or `pngquant` after capture.
- Target combined size for all 6 files: under 200KB.

## After dropping files

The WXT build (`npm run build`) auto-includes anything in `public/` in the
extension bundle. No code changes needed once the PNGs land — `main.ts`
already references the relative paths.

## Test

After build + reload the extension at chrome://extensions, the install
screen should fire automatically on a fresh profile (Chrome doesn't show
install screens on update). Force the trigger by uninstalling and
re-loading the unpacked extension. The install-screen tab should open with
the three platform-specific screenshots visible.
