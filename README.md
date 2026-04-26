# PagePeel

A Chrome extension that captures any webpage as clean Markdown or JSON,
optimised for feeding into LLM pipelines. Built for researchers running
human-in-the-loop scoping reviews — the user browses each page normally
(handling auth, cookies, and verification), then clicks once to save a
faithful, structured copy of the visible content.

PagePeel is **faithful** rather than aggressive: it removes obvious page
chrome (nav, footer, cookie banners, ads, related-content sidebars) but
preserves everything else — headings, paragraphs, lists, tables, links,
fee schedules, learning outcomes — so the downstream LLM has full
context to extract structured fields from.

## Why it exists

Existing tools fall into two extremes:

- **Readability-style extractors** (MarkDownload, LLMFeeder) over-filter:
  they guess what's "main content" and drop sidebars, callouts, and any
  text outside a single article body. On a university course page they
  routinely lose fee tables and entry requirements.
- **Raw `innerText` dumpers** capture everything but flatten structure
  into a wall of text — no headings, no list semantics, no tables.

PagePeel sits in the middle: strip-then-preserve. The output is suitable
both for LLM ingestion (markdown headings, structured JSON) and for human
verification (the captured `.md` reads cleanly).

## Install (unpacked)

1. Clone this repo.
2. In Chrome (or any Chromium-based browser): visit
   `chrome://extensions/`, enable **Developer mode**, click
   **Load unpacked**, and pick the `pagepeel/` directory.
3. The PagePeel icon appears in the toolbar. Pin it.

Manifest V3, minimum Chrome 114, no build step required.

## Use

**Popup:** click the PagePeel icon → preview appears with one big
**Save as Markdown** button (plus secondary *Save as JSON* and *Copy to
clipboard*). The popup also shows a *What was removed* breakdown so you
can verify nothing important was stripped.

**Shortcut:** `Alt+Shift+E` (configurable at
`chrome://extensions/shortcuts`) — saves directly to your Downloads
folder without opening the popup. Useful when batching through many
URLs.

**Filename pattern:** the default is
`{title}_{domain}_{date}_{hash}.md` — the 6-character hash is a
short URL fingerprint that prevents two pages with similar titles from
overwriting each other. Configurable in Settings.

**Extraction history:** every save (popup or shortcut) is logged to
`chrome.storage.local`. Open Settings → *View extraction history* to
audit a batch run, or *Export as file* to download the log as JSONL
for downstream pipeline use.

## Settings

Right-click the toolbar icon → **Options**, or click the gear icon in
the popup. Available controls:

- **Output format** — Markdown only, JSON only, or both.
- **Appearance** — Match my system, Always light, Always dark.
- **Include page details at the top** — toggles YAML-style frontmatter
  (URL, title, date, word count) at the top of the markdown file.
- **Preserve hyperlinks** — turn off to reduce token count when the
  surrounding text is sufficient.
- **Include images as alt text** — when off, images are dropped but
  any `<figcaption>` text is preserved.
- **Filename pattern** — placeholders: `{title}` `{domain}` `{date}`
  `{timestamp}` `{hash}`.

## Privacy

PagePeel **does not make any external network calls**. Extraction runs
entirely in your browser. Settings sync to your Google account via
`chrome.storage.sync` (Chrome's standard sync mechanism, not anything
PagePeel-specific). Extraction history is stored locally only
(`chrome.storage.local`) and never leaves your device.

Permissions requested: `activeTab` (read the current page when you
click), `scripting` (inject the extraction code into that tab),
`storage` (save your settings + history), `downloads` (save the
generated file). No `tabs`, no `host_permissions`, no `cookies`, no
`webRequest`.

## Workflow it was built for

The original use case is a UK / European behavioural-science training
scoping review: ~200 course pages × ~14 standardised data fields per
course, extracted by a downstream LLM, then verified by human
reviewers. PagePeel is **stage 1** — capture. The LLM extraction and
human verification are downstream stages outside the extension.

The extraction-history log doubles as a session manifest: at the end
of a 200-page batch you can export the log as JSONL and feed it to
the LLM stage to know exactly which files exist and which extractions
had warnings worth re-checking.

See `PRD-PagePeel.md` for the full product brief, including the
provider-category breakdown, content-loss risks per CMS template, and
validation criteria.

## Architecture (one paragraph)

`pagepeel/manifest.json` declares an MV3 service worker
(`pagepeel/background.js`), a popup (`pagepeel/popup/`), an options
page (`pagepeel/options/`), and a content script (`pagepeel/content.js`)
that's injected on demand into the active tab. The content script
clones `document.body`, strips boilerplate via a token-prefix matcher
plus an accordion-aware hidden-element pass, inlines same-origin
iframes and open shadow roots, then runs Turndown for Markdown and a
custom DOM walker for structured JSON. Turndown is vendored at
`pagepeel/libs/turndown.js`; see `pagepeel/THIRD_PARTY.md` for
provenance.

## Status

Early-stage research tool. The strip pipeline has been empirically
validated against representative pages from each PRD provider category
(Russell Group university, exec ed, professional body, NHS / GOV.UK,
specialist behavioural-science org, online platform). If a page loses
content, the *What was removed* disclosure in the popup will usually
make the cause obvious; please open an issue with the URL.

## License

[MIT](LICENSE). Copyright © 2026 Maggie Guanyu Yang.

Bundles [turndown](https://github.com/mixmark-io/turndown) (MIT) at
`pagepeel/libs/turndown.js`.
