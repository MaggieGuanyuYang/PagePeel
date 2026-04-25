# Third-Party Components

PagePeel vendors a single third-party JavaScript dependency. No npm install
or build step is involved at packaging time; the file ships as-is in the
extension bundle.

## turndown

- **Path:** `libs/turndown.js`
- **Upstream:** https://github.com/mixmark-io/turndown
- **License:** MIT
- **Likely version:** 7.x (signature matches the `TurndownService` IIFE,
  `RootNode` helper, and `x-turndown` wrapper introduced in 7.0.0;
  pre-7.0.0 used a different pattern). The exact tagged release was not
  recorded at vendor time — confirm before any upgrade.
- **SHA-256 of vendored file (after Wave 6 banner added):** computed at
  build time; recompute via
  `shasum -a 256 pagepeel/libs/turndown.js`
  and update this line if the file changes.

### Why vendored

The extension is a Manifest V3 build with no bundler. Vendoring a single
file keeps the install footprint minimal and avoids a build pipeline for
a research tool that the maintainer wants to keep audit-friendly.

### When upgrading turndown

1. Pull the desired tagged release from upstream.
2. Replace `libs/turndown.js` with the new file.
3. Restore the banner block at the top of the file (the upstream release
   does not include PagePeel-specific provenance text).
4. Recompute SHA-256 and update this file.
5. Smoke-test extraction on at least one page from each PRD provider
   category (university, professional body, commercial, NHS,
   specialist, online platform).

### Other "dependencies" (none)

No other third-party JS, CSS, fonts, or assets are bundled. The icon
generator at `icons/_gen.py` uses only Python standard library
(`math`, `struct`, `zlib`, `pathlib`).
