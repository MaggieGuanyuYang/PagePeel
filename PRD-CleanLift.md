# PRD: CleanLift — Faithful Webpage Text Extractor for LLM Pipelines

## Problem

Researchers and developers need to extract text from webpages to feed into LLMs (e.g. via Claude Code), but existing tools fall into two extremes:

- **Readability-based extractors** (MarkDownload, LLMFeeder) aggressively filter content, dropping sidebars, callout boxes, and non-"article" text. They guess what's important and often guess wrong.
- **Raw dumpers** (innerText-based tools) capture everything but flatten all structure, producing an unreadable wall of text with no indication of what was a heading, a table cell, or a paragraph.

Neither approach serves users who need **faithful, structured extraction** — all meaningful content preserved, obvious boilerplate removed, output ready for LLM consumption.

Additionally, automated scraping tools (Jina Reader, Firecrawl) fetch pages server-side, so they get blocked by cookie walls, CAPTCHAs, and bot detection. Users need to browse manually, verify each page, then extract — a **human-in-the-loop** workflow.

## Solution

A Chrome extension that:

1. Runs on the **already-rendered page** in the user's browser (no server-side fetching)
2. Strips only obvious structural boilerplate (nav, footer, cookie banners)
3. Preserves **all remaining visible text** with semantic structure (headings, paragraphs, lists, tables, links)
4. Outputs as **structured markdown or JSON**, optimised for LLM ingestion
5. Downloads the file with **one click or keyboard shortcut**

### Where This Fits in the Overall Pipeline

```
STAGE 1: Content capture (THIS EXTENSION)
  User visits each webpage → eyeballs it → clicks extension → .md/.json saved locally
  Repeat ~200 times
       │
       ▼
STAGE 2: AI-assisted data charting (Claude Code)
  Claude Code reads the .md/.json files → pre-extracts 14 standardised fields
  per training provision into the Excel data-extraction template
       │
       ▼
STAGE 3: Human verification (GY and NH)
  Reviewers independently verify AI-extracted entries against the .md/.json source files
  First 20% calibrated together; remainder split between reviewers
  Disagreements resolved through discussion; NC consulted if needed
       │
       ▼
STAGE 4: Evidence synthesis
  Descriptive numerical analysis + qualitative content analysis
```

The extension's job is Stage 1 only. Its output quality directly determines how accurately Stage 2 can run — if the extension loses content or flattens structure, Claude Code will either miss fields or hallucinate them, creating more verification burden in Stage 3.

## Target User

Researchers, academics, and developers who need to extract content from 50–500+ webpages for analysis via LLMs. They browse pages manually (to handle auth, cookies, verification) and need a reliable "capture" button.

## Primary Use Case: Behavioural Science Training Scoping Review

The immediate use case is extracting structured information from ~200 UK/European course and training programme webpages for a scoping review of behavioural research training provision. The provider list spans ~80+ organisations. Understanding the diversity of page architectures shapes several design decisions.

### Provider Categories & Expected Page Architectures

**Category 1: Russell Group / research-intensive universities (~25 providers)**
Durham, UCL, LSE, King's College London, Warwick, Edinburgh, Glasgow, Exeter, Nottingham, Leeds, Southampton, Bath, Surrey, Essex, UEA, Newcastle, Reading (Henley), St Andrews, Queen Mary, Heriot-Watt, Brunel, Bangor, Aberystwyth, Northumbria, Bournemouth, Stirling, City St George's, St Mary's, Open University, UCD, Nottingham Trent, Belfast Met.

- **CMS platforms:** Mostly bespoke university CMS or T4/Terminalfour, Drupal, WordPress
- **Page structure:** Very long single-page layouts. Course overview, modules (often in tabs or accordions), entry requirements (expandable per-country), fees (domestic/international tabs), how to apply, student life/testimonials, related courses
- **Key noise:** Country-by-country entry requirements (can be 80%+ of page length), generic "why choose us" marketing, prospectus download CTAs, open day banners, student testimonial carousels, "virtual tour" embeds, live chat widgets
- **Key content risk:** Module details often hidden inside accordion/tab components; fee tables may be in iframes or dynamically loaded
- **Subvariant — university summer schools / exec ed:** LSE Summer School, LSE Executive Education, Warwick Business School, Durham Business School, Oxford Lifelong Learning, Aalto, Erasmus Rotterdam, Crawford School (ANU), Transilyana Executive Education. These sit on the university domain but use a different template — more commercial, landing-page style, with pricing and booking CTAs

**Category 2: Professional/industry bodies (~10 providers)**
CIM, MRS, CIPR, APG, Data & Marketing Association (DMA), Social Research Association (SRA), Alliance of Independent Agencies, Road Safety GB Academy, UK Coaching, BDA.

- **CMS platforms:** WordPress, Craft CMS, custom builds
- **Page structure:** Event/training listing pages. Course title, dates, price, CPD points, delivery format, brief syllabus, booking button
- **Key noise:** Member login prompts, "become a member" CTAs, event calendar widgets, sponsor logos
- **Key content risk:** Some may list multiple courses on one page (index pages) — the extension extracts whatever is on the current page, so the user needs to navigate to individual course pages first

**Category 3: Commercial training providers (~15 providers)**
Oxford Management Centre, Oxford Training Centre, Oxford Executive Institute, GLOMACS, The Knowledge Academy, Lead Academy, Centre of Excellence, Lancashire Training, EML Learning, SMG Learning, Keystar Training, IntroTeach, The Teachers Training, MacSkills, Future Fit Training, Fitness Education Online, UK Public College, LSFL, LSIB, LSBR.

- **CMS platforms:** WordPress (often with WooCommerce or LearnDash), Shopify, custom
- **Page structure:** Product-page style. Course title, price, "add to cart", syllabus accordion, duration, certification, reviews
- **Key noise:** Heavy marketing copy, trust badges, countdown timers, upsell sections ("students also bought"), review widgets (Trustpilot/Google), pop-up discount offers
- **Key content risk:** Syllabus details may be behind "read more" truncation or accordion. Price may be dynamically rendered

**Category 4: NHS / government / public sector (~8 providers)**
e-LfH / Health Education England, YOURhealth NHS, Whittington Health NHS Trust, NHS Education for Scotland (NES), Norfolk County Council, Government Campus, Civil Service College, PACE.

- **CMS platforms:** GOV.UK-adjacent design systems, NHS digital templates, WordPress
- **Page structure:** Clean, accessible, structured content. Heading hierarchy tends to be well-formed. May use GOV.UK accordion pattern or NHS component library
- **Key noise:** Breadcrumbs, "Is this page useful?" feedback widgets, related links sidebars, accessibility statements
- **Key content risk:** Content may be spread across multiple pages (e.g. separate pages for "overview", "what you'll learn", "how to access") — the extension only captures the current page

**Category 5: Specialist behavioural science organisations (~5 providers)**
Behavioural Insights Team (BIT), UCL Centre for Behaviour Change, Social Change UK, Behaviour Change Training, Applied Behavioural Science Academy (Affective Advisory / Behamics / ETH), Behavioural Safety Mentors, ribot.

- **CMS platforms:** Squarespace, WordPress, Webflow, custom
- **Page structure:** Varies widely — from polished Squarespace landing pages to basic WordPress. Usually shorter and more focused than university pages
- **Key noise:** Newsletter signup, blog teasers, case study carousels
- **Key content risk:** Some may be single-page sites with all content on one scroll — extraction should work well here

**Category 6: Online learning platforms (~3 providers)**
FutureLearn (hosting LSE courses), MyNutriWeb, Buttercups Training, HFE, HealthCareCourses.

- **CMS platforms:** Custom learning platforms, Moodle-adjacent
- **Page structure:** Course catalogue style — overview, syllabus, reviews, "enrol now", accreditation logos
- **Key noise:** Platform-wide navigation, "trending courses", learner count badges, review aggregation
- **Key content risk:** Some content may require login to view full syllabus; the user handles this by being logged in when they extract

### Common Noise Patterns Across All Categories

These are patterns the strip layer should catch beyond the generic boilerplate list:

- Country-by-country entry requirement expansions (university pages)
- "How to apply" step-by-step generic instructions
- Student/learner testimonial carousels and review widgets
- "Related courses" / "You might also like" / "Students also bought" sections
- Promotional banners (open days, prospectus downloads, early-bird discounts)
- Scholarship/funding generic paragraphs
- Live chat widgets, chatbot overlays, pop-up offers
- Trust badges, accreditation logo grids
- Social proof counters ("5,000 students enrolled")
- Cookie consent banners and GDPR overlays

**Note:** These domain-specific patterns should NOT be hardcoded into V1. Instead, the **custom boilerplate selectors** feature (in Settings) lets the user add per-domain rules. For example, on Durham pages: `.intl-entry-requirements`, `.related-courses`. The default strip layer stays generic; domain tuning happens via user config. However, documenting these patterns here gives Claude Code useful context when building the strip layer's class/id matching patterns.

### Downstream Usage: Data Extraction for Scoping Review

**Critical design principle: The extension captures ALL visible body content faithfully. It is a general-purpose extractor, not a field-specific scraper.** The only content removed is obvious structural boilerplate (nav, header, footer, cookie banners, etc. as defined in the Strip Layer). Everything else stays — even content that may seem irrelevant to the 14 extraction fields below. The human researcher browsing the page may notice information that doesn't fit neatly into the predefined fields, and that context should be preserved in the output.

The 14-field table below is provided purely as **background context** — it explains why we're building this tool and what the captured content will eventually be used for. It should NOT influence what the extension extracts or filters. The extension's job is to faithfully capture the webpage; Claude Code's job (in the next stage) is to find the relevant fields within that capture.

The data-extraction template (from the study protocol, informed by Forsetlund et al., 2009) captures these 14 standardised fields per training provision:

| # | Field | Description |
|---|-------|-------------|
| 1 | Course title | Full official name of the training provision |
| 2 | Provider name | Organisation delivering the training |
| 3 | Provider type | Academic / commercial / public-sector |
| 4 | Content | Topics, competencies, knowledge and skills covered |
| 5 | Delivery format | In-person / online / hybrid |
| 6 | Duration | Length of the programme |
| 7 | Frequency | How often the training runs |
| 8 | Target audience | Who the training is designed for |
| 9 | Accreditation | Professional body recognition, CPD points, academic credits |
| 10 | Prerequisites | Required qualifications or experience |
| 11 | Cost | Fees, pricing tiers |
| 12 | Location | Where the training is delivered |
| 13 | Evaluation metrics | How learning is assessed |
| 14 | URL | Access URL (captured automatically in metadata) |

After the extension captures content, Claude Code will pre-extract these fields into a standardised Excel template. All AI-extracted entries will then be independently verified by human reviewers (GY and NH), with particular attention to interpretive fields such as content classification and skill level assessment. The first 20% of sources are calibrated together; the remainder split between reviewers. Disagreements are resolved through discussion, with NC consulted if needed.

**Why this context matters for the extension builder:** Understanding these fields helps explain why preserving heading hierarchy is important (Claude Code needs to distinguish a "Modules" section from an "Assessment" section), and why the extension should err on the side of capturing too much rather than too little. If Claude Code receives a faithful, well-structured capture of the entire page, it can find what it needs. If the extension over-filters, the lost content may be unrecoverable without revisiting the page.

## Core Requirements

### 1. Boilerplate Removal (Strip Layer)

Remove the following elements before extraction:

- `<nav>`, `<header>`, `<footer>` elements
- Elements with ARIA roles: `navigation`, `banner`, `contentinfo`
- Elements with common boilerplate class/id patterns:
  - Navigation: `nav`, `navbar`, `menu`, `sidebar`, `breadcrumb`
  - Footer: `footer`, `site-footer`, `page-footer`
  - Cookie/consent: `cookie`, `consent`, `gdpr`, `privacy-banner`
  - Ads: `ad`, `ads`, `advert`, `advertisement`, `sponsor`
  - Social: `share`, `social`, `sharing-buttons`
  - Comments sections: `comments`, `comment-section`, `disqus`
  - Related/recommended: `related`, `recommended`, `also-bought`, `similar`, `you-may-like`
  - Testimonials/reviews: `testimonial`, `review`, `trust-pilot`, `trustpilot`
  - Newsletter/signup: `newsletter`, `signup`, `subscribe`, `mailing-list`
- `<script>`, `<style>`, `<noscript>`, `<iframe>` elements
- Hidden elements (`display: none`, `visibility: hidden`, `aria-hidden="true"`) — **EXCEPT** content inside `<details>` elements (even if collapsed) and elements with common accordion patterns (e.g. `aria-expanded="false"` panels). These contain real content that happens to be collapsed; extract them and preserve the summary/trigger text as a heading.

**Important:** This is the ONLY filtering. Everything else that remains must be extracted faithfully. Do not use Readability.js or any "main content detection" algorithm.

### 2. Faithful Text Extraction (Extract Layer)

Walk the cleaned DOM tree and extract all visible text, preserving:

- **Headings** (`h1`–`h6`) → markdown headings (`#`–`######`)
- **Paragraphs** (`p`, `div` with text) → separated by blank lines
- **Lists** (`ul`, `ol`, `li`) → markdown list syntax
- **Tables** (`table`, `tr`, `td`, `th`) → markdown table syntax
- **Links** (`a`) → `[text](href)` with resolved absolute URLs
- **Emphasis** (`strong`, `b`, `em`, `i`) → `**bold**`, `*italic*`
- **Code** (`code`, `pre`) → backticks or fenced code blocks
- **Blockquotes** (`blockquote`) → `>` prefix
- **Images** → `![alt text](src)` (alt text only, no base64 embedding)
- **Definition lists**, `<details>`, `<summary>` → appropriate markdown equivalents
- **Line breaks** (`br`) → newlines
- **Semantic sections** (`article`, `section`, `aside`, `main`) → preserve as structural dividers with a comment or horizontal rule if helpful

Text nodes must be extracted in **DOM order** (which corresponds to visual reading order for well-structured pages).

### 3. Output Format

**Primary: Markdown (.md)**

```
---
url: https://www.durham.ac.uk/study/courses/behavioural-science-c8k409/
domain: durham.ac.uk
title: Behavioural Science C8K409 - Durham University
extracted: 2026-04-25T14:30:00Z
word_count: 2340
---

# Behavioural Science C8K409

Content here in faithful markdown...
```

**Secondary: JSON (.json)** (togglable in settings)

```json
{
  "url": "https://www.durham.ac.uk/study/courses/behavioural-science-c8k409/",
  "domain": "durham.ac.uk",
  "title": "Behavioural Science C8K409 - Durham University",
  "extracted": "2026-04-25T14:30:00Z",
  "word_count": 2340,
  "content": [
    { "type": "heading", "level": 1, "text": "Behavioural Science C8K409" },
    { "type": "paragraph", "text": "This MSc course is aimed at..." },
    { "type": "heading", "level": 2, "text": "Modules" },
    { "type": "list", "ordered": false, "items": ["Advanced Topics in Behavioural Science (30 credits)", "Dissertation (60 credits)"] },
    { "type": "heading", "level": 2, "text": "Fees" },
    { "type": "table", "headers": ["Status", "Fee"], "rows": [["Home", "£12,500"], ["International", "£28,500"]] }
  ]
}
```

The JSON format preserves element types explicitly, which gives Claude Code more structured data to work with. Users should be able to choose their preferred format in the extension settings.

### 4. File Naming & Download

- Default filename: `{sanitised-page-title}_{domain}_{YYYY-MM-DD}.md` (or `.json`)
- Example: `research-findings_nature-com_2026-04-25.md`
- Files download to the browser's default download folder
- No save dialog by default (configurable)

### 5. User Interface

**Popup (click extension icon):**

- Preview of extracted text (first ~500 chars) so the user can sanity-check before downloading
- "Download as MD" button (primary)
- "Download as JSON" button (secondary)
- "Copy to clipboard" button
- Character count and estimated token count (rough: chars ÷ 4)
- Status indicator: ✓ extracted / ⚠ page still loading

**Keyboard shortcut:**

- `Alt+Shift+E` → extract + download as markdown (no popup, instant)
- Configurable via `chrome://extensions/shortcuts`

**Badge:**

- Show estimated token count on the extension icon badge after extraction (e.g. "3.2k")

### 6. Settings Page

Accessible via right-click → Options:

- **Output format:** Markdown (default) / JSON / Both
- **Include metadata frontmatter:** Yes (default) / No
- **Include links:** Yes (default) / No (reduces token count)
- **Include images as alt text:** Yes (default) / No
- **Custom boilerplate selectors to strip:** Text field where users can add additional CSS selectors to remove (e.g. `.promo-banner`, `#newsletter-signup`)
- **Custom selectors to keep:** Override for elements that might be caught by boilerplate removal (e.g. if a site uses `nav` for actual content navigation)
- **Filename template:** Customisable pattern with variables `{title}`, `{domain}`, `{date}`, `{timestamp}`

## Architecture

### Manifest V3

```
manifest.json
├── permissions: activeTab, clipboardWrite, storage, downloads
├── content_scripts: content.js (injected on demand via scripting API)
├── background.js (service worker)
├── popup.html / popup.js
├── options.html / options.js
└── libs/
    └── turndown.js (HTML-to-markdown conversion)
```

### Processing Pipeline

```
User clicks extension
       │
       ▼
content.js injected into active tab
       │
       ▼
Clone document.body (work on clone, not live DOM)
       │
       ▼
STRIP LAYER: Remove boilerplate elements from clone
       │
       ▼
STRIP LAYER: Remove hidden elements (check computed styles)
       │
       ▼
EXTRACT LAYER (Markdown path): Run Turndown on cleaned HTML
       │
       ▼
EXTRACT LAYER (JSON path): Walk DOM tree, build structured array
       │
       ▼
Add metadata frontmatter (url, title, date)
       │
       ▼
Send result to popup for preview / trigger download
```

### Key Technical Notes

- **Clone the DOM** before modifying — never alter the live page
- **Check `getComputedStyle()`** for hidden elements, not just inline styles — elements can be hidden via external CSS
- **Resolve relative URLs** to absolute before extraction
- **Handle shadow DOM** if possible (some modern sites use it for content)
- **Use Turndown.js** for HTML→markdown — it's the same library used by MarkDownload and LLMFeeder, well-tested, handles tables and code blocks
- **No external network calls** — everything runs locally in the browser. No analytics, no telemetry
- **Throttle computed style checks** — calling `getComputedStyle()` on every element can be slow on large pages; batch or limit depth
- **Handle accordion/expandable sections carefully** — many university and NHS pages use `<details>/<summary>` or JS-driven accordions. Content inside collapsed accordions is usually still in the DOM (just hidden via CSS). The extension should extract this content but mark it clearly (e.g. with the `<summary>` text as a heading). If content is truly not in the DOM until clicked (lazy-loaded), flag this to the user in the preview: "⚠ This page may contain expandable sections that weren't loaded. Click to expand them before re-extracting."

## Non-Requirements (Out of Scope for V1)

- No batch/automation (user manually visits each page)
- No server-side processing
- No AI-powered content detection or classification
- No data charting — the extension captures raw webpage content; the downstream extraction of the 14 protocol fields (course title, provider type, content, fees, etc.) into the Excel template is handled separately by Claude Code and human reviewers
- No PDF output
- No screenshot capture
- No browser history tracking
- No multi-page session aggregation (can add in v2)
- No Obsidian/Notion-specific formatting (can add in v2)

## Success Criteria

1. On a typical content-rich webpage, extracted text contains **100% of visible body content** minus nav/footer/cookie boilerplate
2. Output is **valid markdown** that renders correctly when previewed
3. JSON output preserves **element types** (heading, paragraph, list, table) accurately
4. Extraction completes in **under 2 seconds** on a typical page
5. Extension passes **Chrome Web Store review** (Manifest V3 compliant, minimal permissions)
6. **Completeness check (downstream validation):** As a practical test of whether the capture is faithful enough, Claude Code should be able to find all 14 protocol fields (or confirm "not stated") from the extension's output alone, without revisiting the original webpage. This is a validation of completeness, not a specification — the extension captures everything, and the 14 fields just happen to be what we need from it.
7. **Heading hierarchy preserved:** Section headings from the original page (e.g. "Modules", "Entry Requirements", "Assessment", "Fees") are rendered as markdown headings, not flattened into body text.

## Test Pages

Validate extraction quality against at least one page from each provider category:

**Category 1 — University course pages:**
1. `https://www.durham.ac.uk/study/courses/behavioural-science-c8k409/` — long page, expandable entry requirements, module accordions
2. `https://www.ucl.ac.uk/brain-sciences/pals/research/experimental-psychology/workshops/introduction-behavioural-science` — UCL department page

**Category 1 variant — University exec ed / summer school:**
3. An LSE Executive Education or Oxford Lifelong Learning course page (URL TBD from corpus) — more commercial template on university domain

**Category 2 — Professional body:**
4. `https://www.mrs.org.uk/event/training-courses/the-science-of-behaviour-change` — event listing with dates, pricing, CPD
5. `https://www.cim.co.uk/learn-develop/training-development/training-courses/behavioural-economics/` — professional institute training

**Category 3 — Commercial training provider:**
6. `https://oxford-management.com/course/behavioural-economics` — commercial landing page
7. `https://abc-trainingservices.co.uk/product/behavioural-science/` — likely WooCommerce product page
8. `https://schoolofux.com/products/behavioural-ux-psychology-workshop-remote` — Shopify-style product page

**Category 4 — NHS / government:**
9. `https://behaviourchange.hee.nhs.uk/toolkits/individual/learning-behaviour-change/behaviour-change-literacy-elearning` — NHS/HEE structured page
10. `https://www.nhs-health-trainers.co.uk/for-professionals/training-courses/` — NHS service training listing

**Category 5 — Specialist behavioural science org:**
11. A BIT or Social Change UK training page (URL TBD from corpus)

**Category 6 — Online learning platform:**
12. An LSE-via-FutureLearn course page (URL TBD from corpus)

**Edge case — Foundation degree at partner college:**
13. `https://www.gre.ac.uk/foundation-degrees/engsci/applied-behavioural-science-and-welfare-foundation-degree-hadlow-college` — university subsite for partner delivery

### Validation Criteria (apply to all test pages)

- All course content (title, modules, outcomes, fees, duration) is captured
- Navigation, cookie banners, and site-wide headers/footers are stripped
- Country-by-country entry requirement blocks (if present) are captured but clearly delimited so downstream processing can skip them if needed
- Accordion/expandable content that is in the DOM at extraction time is included, even if visually collapsed
- "Related courses" / "you might also like" sections are stripped by default boilerplate rules
- Trust badges, testimonial carousels, and "enrol now" CTAs are stripped
- Output is clean enough that Claude Code can reliably identify the downstream structured fields
- Token count is reasonable: a typical course page should extract to 500–3,000 tokens, not 10,000+ (which would signal noise leaking through)

## Future Considerations (V2+)

- **Session mode (high priority for scoping review workflow):** Aggregate extractions from multiple pages into one file or a structured JSONL (one JSON object per page, one per line). This would let the user extract 200 pages into a single file that Claude Code can iterate through. Could also append to an existing file rather than creating a new download each time.
- **Batch URL list:** Paste a list of URLs, extension opens each tab, waits for user confirmation, then extracts
- **Custom extraction profiles:** Save per-domain strip/keep rules (e.g. "on nature.com, also strip `.c-article-references`")
- **Export to folder:** Let users pick a dedicated output folder
- **Token count by model:** Show estimated tokens for Claude, GPT-4, etc.
- **Diff view:** Show what was stripped vs what was kept, so users can verify the boilerplate removal didn't catch real content
