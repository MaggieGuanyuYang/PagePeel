# CLAUDE.md — PagePeel agent rules

Instructions for future Claude Code sessions in this repo. Not an end-user
doc (see `README.md`) and not a product brief (see `PRD-PagePeel.md`).

## Project shape

- Chrome MV3 extension. Vanilla JS. **No build step, no npm, no bundler.**
- Minimum Chrome 114 (`pagepeel/manifest.json`).
- Single vendored dep: `pagepeel/libs/turndown.js` (MIT, ~7.x). Provenance
  in `pagepeel/THIRD_PARTY.md` — keep in sync if the file changes.
- Service worker: `pagepeel/background.js`. Content script (loaded on
  demand via `chrome.scripting.executeScript`): `pagepeel/content.js`
  (~1240 lines, holds the strip + extract pipeline).
- Layout (don't reorganise):
  `pagepeel/{manifest.json, content.js, background.js, libs/, icons/, popup/, options/, THIRD_PARTY.md}`.

## Audience (load-bearing)

The user is a **social/behavioural scientist** running a 200-page scoping
review. Not a developer. Not a power user.

- **No CS jargon in user-facing strings.** No "selectors", "patterns",
  "regex", "CSS classes", "DOM", "boilerplate filtering". Wave 10 stripped
  this out — don't reintroduce it.
- The "Boilerplate filtering" power-user controls (custom strip/keep
  selectors, per-domain rules) were **deliberately removed from the UI**.
  The underlying code still accepts those settings if hand-edited into
  storage, but no UI surfaces them. Don't re-add UI without an ask.

## Brand palette (load-bearing — defined in `pagepeel/popup/popup.css:1-44`)

| Token         | Hex       | Role                                                         |
| ------------- | --------- | ------------------------------------------------------------ |
| `--brand-teal`  | `#76c8c2` | Accent edge (left stripes), focus rings, success / "ok" tone |
| `--brand-deep`  | `#27153e` | Light-mode **TEXT only**. Never a background fill.           |
| `--brand-pink`  | `#eb548e` | Primary action — CTA, badge, hover                           |
| `--brand-cream` | `#fefbff` | Light-mode background                                        |

Hard rules:

- **No orange anywhere.** Wave 15 deleted it. Warn states are pink-wine
  (`#a8245e` / `#7a1c4a`, see `--warn-fg` in popup.css). If a future pass
  is tempted to use amber for warn — reject.
- **Brand-deep purple is not a dark-mode surface fill.** Wave 16 removed
  it. Dark mode uses neutral warm-dark (`#1a1a1d` / `#232327`); purple is
  accent-only.
- Theme is user-selectable Auto / Light / Dark (Wave 17). Resolved via
  `matchMedia`, stamped on `<html>` as `data-theme`.

## Strip-layer mental model (CRITICAL — `pagepeel/content.js:1-200`)

The most-tuned part of this codebase. Every rule below has a real failure
case behind it. **Don't relax these without a reproducer.**

- **`STRONG_ROOTS`** (`content.js:23-63`) + **`tokenMatchesStrong()`**
  (`:81-92`) does exact-match OR prefix-with-`-`/`_`-separator;
  underscores normalised to hyphens. Prefix-only on purpose: chrome
  compounds lead with the chrome word (`cookie-banner`, `site-footer`).
  **Suffix matches like Bootstrap `card-header` MUST survive** — killing
  them broke the MRS event-page sidebar.
- **Weak rule requires `weakCount >= 2` universally** (`:194-198`). No
  `<main>`/`<article>` asymmetry. The old "1 hit outside landmarks" rule
  was deleted in Wave 13 — landmark-less pages (MRS, Drupal/T4 university
  templates) silently lost real content.
- **Accordion / tab-pane awareness** (`:96-105`): `tab-pane`, `accordion`,
  `collapse`, `expandable`, `tabpanel`, `<details>`, and
  `aria-expanded="false"` all count. The depth counter at `:344` keeps
  content that's only hidden because it sits inside a collapsed accordion.
- **`visibilityState()`** (`:115-133`) does NOT pass `contentVisibilityAuto`
  or `checkOpacity` to `Element.checkVisibility`. Wave 9 removed those —
  they over-stripped real content as "hidden". Hidden-chrome leakage is
  the accepted trade-off.
- If asked to "strip more aggressively": say no unless the user provides a
  real page where content survives that shouldn't.

## Validated templates — don't break these

Wave 14 verified the strip pipeline against real pages: MRS, Durham (12.7k
words), Oxford Conted, CIPR ASPX, Government Campus GOV.UK, bi.team
Webflow, LSE summer school, WBS, UCL Short Courses, SRA. All extracted
full course-detail content. **These are the regression set.** Test harness:
`/tmp/pp-test/run.js` (jsdom-based, ad-hoc; not in the repo). Use it to
validate any strip-layer change before claiming it's safe.

## API and naming

- **In-tab API:** `window.pagepeel.extract(settings)` — defined at
  `content.js:921`, exposed at `:1242`. Only entry point.
- **Storage namespace:** `pagepeel:*` keys in `chrome.storage.{local,sync}`
  (`background.js:15`, `:268-286`).
- **Filename default:** `{title}_{domain}_{date}_{hash}` (`background.js:10`).
  The `_{hash}` suffix is **load-bearing** for batch-extraction dedup.
- **CSS class prefix `cl-*`** is internal, inherited from the pre-rebrand
  name. Wave 12 (CleanLift→PagePeel) left it alone deliberately —
  renaming churns the diff for no user benefit. Don't rename without ask.

## Anti-patterns (specific to this repo)

- No test framework / npm scripts. Personal research tool; ad-hoc jsdom
  checks under `/tmp/` are the current bar.
- No npm runtime dependencies. Vanilla JS, vendored third-party only.
- No orange / amber palette tokens. No purple dark-mode surface fill.
- No power-user UI controls (selector inputs, regex fields, pattern
  editors) without explicit ask — Wave 10 stripped these.
- No renaming `cl-*` CSS prefix without ask.
- **No network calls outside the user's machine.** PRD forbids it;
  `manifest.json` has no `host_permissions` and no remote fetches.
- No CS jargon in popup/options copy.

## Workflow

- Waves are committed independently; commit messages document rationale.
  The git log is the audit trail. Follow the same cadence: one logical
  surface per commit, `Wave N/M: <surface>` for multi-wave sequences,
  short imperative for one-offs. Don't squash — per-wave history is the
  documentation.
- Verification: load unpacked in Chrome, run on the validated template
  set. There is no CI.

## When in doubt

1. Check `PRD-PagePeel.md` for product intent (audience, scope, formats,
   prohibited behaviours like network calls).
2. Check this file for codebase conventions and palette / strip rules.
3. Check the git log for the wave-by-wave rationale (`git log --oneline`).
4. If the change touches the strip layer, run it against the Wave 14
   regression set before declaring it safe.
