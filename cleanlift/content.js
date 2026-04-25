(function () {
  if (window.__cleanliftReady) return;
  window.__cleanliftReady = true;

  const STRIP_TAGS_ALWAYS = ['script', 'style', 'noscript', 'iframe'];
  // header/footer/nav are stripped only outside <article>/<main>: HTML5 allows
  // <header>/<footer> inside sectioning content as section headers, where they
  // hold real body content (module titles, etc.) rather than page chrome.
  const STRIP_TAGS_OUTSIDE_CONTENT = ['nav', 'header', 'footer'];

  const STRIP_ARIA_ROLES = ['navigation', 'banner', 'contentinfo'];

  // Distinctive whole-token signatures (matched against full class names like
  // "site-footer", "trust-badges"). A single hit is enough to strip the element.
  const STRONG_PATTERNS = new Set([
    'navbar', 'sidebar', 'breadcrumb', 'breadcrumbs',
    'site-footer', 'page-footer', 'sitefooter',
    'site-header', 'page-header', 'topbar', 'top-bar', 'top-nav',
    'cookie-banner', 'cookie-notice', 'cookie-consent', 'consent-banner',
    'gdpr', 'privacy-banner', 'privacy-notice',
    'advert', 'adverts', 'advertisement', 'advertising',
    'social-share', 'sharing-buttons', 'share-buttons', 'social-icons',
    'comment-section', 'disqus', 'commentlist',
    'related-posts', 'related-articles', 'related-courses', 'related-content',
    'recommended-posts', 'also-bought', 'also-like', 'you-may-like', 'youmaylike',
    'testimonial', 'testimonials', 'review-widget', 'trust-pilot', 'trustpilot', 'trust-badges',
    'newsletter', 'newsletter-signup', 'mailing-list', 'mailchimp',
    'dialog-backdrop', 'lightbox',
    'live-chat', 'chatbot', 'chat-widget', 'intercom-launcher', 'zopim', 'tawk',
    'skip-link', 'skip-to-content', 'skip-nav'
  ]);

  // Ambiguous token fragments. Outside of <article>/<main>, a single match
  // strips. Inside content regions, require ≥2 matches OR a STRONG hit so that
  // a Bootstrap "card-header" or LearnDash "course-promo" doesn't lose content.
  const WEAK_TOKENS = new Set([
    'nav', 'navigation', 'menu',
    'header', 'footer',
    'cookie', 'cookies', 'consent',
    'ad', 'ads', 'sponsor', 'sponsored', 'promo',
    'share', 'social', 'sharing',
    'comments',
    'related', 'recommended', 'similar',
    'signup', 'subscribe',
    'modal', 'popup', 'overlay'
  ]);

  const ALLOWLIST_TAGS = new Set(['MAIN', 'ARTICLE', 'SECTION', 'BODY', 'HTML']);

  function isAccordionLike(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.tagName === 'DETAILS' || el.tagName === 'SUMMARY') return true;
    if (el.getAttribute('aria-expanded') === 'false') return true;
    const cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
    if (/(^|[\s_-])(accordion|collapse|expandable|expander|tab-pane|tabpanel)([\s_-]|$)/.test(cls)) return true;
    const role = el.getAttribute('role');
    if (role === 'tabpanel') return true;
    return false;
  }

  function isVisuallyHidden(el) {
    const style = getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none') return true;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
    if (style.opacity === '0' && style.pointerEvents === 'none') return true;
    // aria-hidden=true: only treat as hidden when the element has no visible
    // text. Sighted users still see aria-hidden text (it's only invisible to
    // assistive tech), so dropping it can lose icon-prefixed labels.
    if (el.getAttribute('aria-hidden') === 'true') {
      const text = (el.textContent || '').trim();
      if (!text) return true;
    }
    return false;
  }

  function buildBoilerplatePatterns(extra) {
    const strong = new Set(STRONG_PATTERNS);
    const weak = new Set(WEAK_TOKENS);
    if (extra && extra.length) {
      for (const raw of extra) {
        const lc = String(raw).toLowerCase().trim();
        if (!lc) continue;
        // Custom patterns are treated as strong by default — the user opted
        // into them per-site, so we trust their precision.
        strong.add(lc);
      }
    }
    return { strong, weak };
  }

  function tokenize(s) {
    if (!s) return [];
    const decamel = s
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    return decamel.split(/[\s_\-/]+/).map(t => t.toLowerCase()).filter(Boolean);
  }

  function elementMatchesBoilerplate(el, patterns) {
    if (ALLOWLIST_TAGS.has(el.tagName)) return false;

    const wholeTokens = [];
    const splitTokens = [];

    const addSource = (raw) => {
      if (!raw) return;
      const lc = String(raw).toLowerCase();
      if (lc) wholeTokens.push(lc);
      String(raw).split(/\s+/).forEach(c => {
        const cl = c.toLowerCase();
        if (cl) wholeTokens.push(cl);
        splitTokens.push(...tokenize(c));
      });
    };

    if (el.id) addSource(el.id);
    if (el.className && typeof el.className === 'string') addSource(el.className);
    const dc = el.getAttribute && el.getAttribute('data-component');
    if (dc) addSource(dc);

    let strongHit = false;
    for (const t of wholeTokens) {
      if (patterns.strong.has(t)) { strongHit = true; break; }
    }
    if (strongHit) return true;

    let weakCount = 0;
    for (const t of splitTokens) {
      if (patterns.weak.has(t)) weakCount++;
    }
    if (!weakCount) return false;

    const insideContent = el.closest && el.closest('article, main');
    return insideContent ? weakCount >= 2 : weakCount >= 1;
  }

  function promoteHeadingLikeElements(clone) {
    // Promote elements that are visually/semantically headings but use a
    // <div>/<span> tag. Conservative: only promote on explicit signals —
    // aria role="heading", or class tokens like "heading-large", "section-title"
    // — never on font-size heuristics, which would create false positives.
    const HEADING_CLASS_RE = /(?:^|[\s_-])(heading|headline|section-title|page-title|course-title|module-title|widget-title|entry-title|block-title)(?:[\s_-]|$)/i;

    const candidates = clone.querySelectorAll(
      '[role="heading"], div, span, p, header'
    );
    for (const el of candidates) {
      if (/^H[1-6]$/.test(el.tagName)) continue;
      // Skip elements containing block-level children — they aren't leaf headings.
      if (el.querySelector('h1,h2,h3,h4,h5,h6,p,ul,ol,table,blockquote,article,section,div')) continue;

      let level = 0;
      const role = el.getAttribute && el.getAttribute('role');
      if (role === 'heading') {
        const aria = parseInt(el.getAttribute('aria-level') || '', 10);
        if (aria >= 1 && aria <= 6) level = aria;
        else level = 3;
      } else {
        const cls = (el.className && typeof el.className === 'string') ? el.className : '';
        if (HEADING_CLASS_RE.test(cls)) {
          // Try to infer level from class: h1/h2/.../h6 fragment, or "large"/"xl"/"section".
          const m = cls.match(/(?:^|[\s_-])h([1-6])(?:[\s_-]|$)/i);
          if (m) level = parseInt(m[1], 10);
          else if (/section-title|page-title|course-title/i.test(cls)) level = 2;
          else if (/module-title|widget-title|entry-title|block-title/i.test(cls)) level = 3;
          else if (/large|xl|hero/i.test(cls)) level = 2;
          else level = 3;
        }
      }
      if (!level) continue;

      const text = (el.textContent || '').trim();
      if (!text || text.length > 200) continue;

      const newH = clone.ownerDocument.createElement('h' + level);
      newH.textContent = text;
      el.replaceWith(newH);
    }
  }

  function buildKeepSet(root, selector) {
    const set = new Set();
    if (!selector || !selector.trim()) return set;
    try {
      const matches = root.querySelectorAll(selector);
      for (const m of matches) {
        set.add(m);
        m.querySelectorAll('*').forEach(d => set.add(d));
      }
    } catch (_e) {
      // invalid selector — silently ignore
    }
    return set;
  }

  function buildCloneMaps(live, clone) {
    const cloneToLive = new Map();
    const liveToClone = new Map();
    const stack = [[live, clone]];
    while (stack.length) {
      const [l, c] = stack.pop();
      cloneToLive.set(c, l);
      liveToClone.set(l, c);
      const lc = l.children;
      const cc = c.children;
      const n = Math.min(lc.length, cc.length);
      for (let i = 0; i < n; i++) {
        stack.push([lc[i], cc[i]]);
      }
    }
    return { cloneToLive, liveToClone };
  }

  function gatherHiddenLiveElements(root) {
    const hidden = [];
    const stack = [{ el: root, depth: 0 }];
    while (stack.length) {
      const { el, depth } = stack.pop();
      const children = el.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childDepth = depth + (isAccordionLike(child) ? 1 : 0);
        if (childDepth === 0 && isVisuallyHidden(child)) {
          hidden.push(child);
        } else {
          stack.push({ el: child, depth: childDepth });
        }
      }
    }
    return hidden;
  }

  function resolveUrls(clone, baseURI) {
    const fix = (el, attr) => {
      const raw = el.getAttribute(attr);
      if (!raw) return;
      try {
        const abs = new URL(raw, baseURI).href;
        el.setAttribute(attr, abs);
      } catch (_e) {
        // leave as-is on failure
      }
    };
    clone.querySelectorAll('a[href]').forEach(a => fix(a, 'href'));
    clone.querySelectorAll('img[src]').forEach(img => fix(img, 'src'));
    clone.querySelectorAll('img[srcset]').forEach(img => img.removeAttribute('srcset'));
  }

  function dropEmptyContainers(clone, isKept) {
    // Bottom-up post-order traversal: children are evaluated before parents,
    // so deeply-nested wrapper chains (Webflow/Squarespace) collapse in one
    // pass without the previous 4-pass cap leaving residue.
    const stack = [clone];
    const ordered = [];
    while (stack.length) {
      const el = stack.pop();
      ordered.push(el);
      for (let i = 0; i < el.children.length; i++) stack.push(el.children[i]);
    }
    for (let i = ordered.length - 1; i >= 0; i--) {
      const el = ordered[i];
      if (el === clone) continue;
      if (!el.parentNode) continue;
      const tag = el.tagName;
      if (tag !== 'DIV' && tag !== 'SECTION' && tag !== 'ASIDE' && tag !== 'SPAN') continue;
      if (isKept && isKept(el)) continue;
      if (el.children.length === 0 && !el.textContent.trim()) {
        el.parentNode.removeChild(el);
      }
    }
  }

  function buildTurndown() {
    if (typeof TurndownService === 'undefined') {
      throw new Error('TurndownService not loaded');
    }
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
      hr: '---'
    });

    td.keep(['kbd', 'sub', 'sup']);
    td.remove(['style', 'script', 'noscript']);

    td.addRule('summaryHeading', {
      filter: 'summary',
      replacement: function (content) {
        const text = (content || '').trim();
        if (!text) return '';
        return '\n\n#### ' + text + '\n\n';
      }
    });

    td.addRule('detailsBlock', {
      filter: 'details',
      replacement: function (content) {
        return '\n\n' + content.trim() + '\n\n';
      }
    });

    td.addRule('definitionTerm', {
      filter: 'dt',
      replacement: function (content) {
        return '\n\n**' + content.trim() + '**\n';
      }
    });

    td.addRule('definitionDescription', {
      filter: 'dd',
      replacement: function (content) {
        return ': ' + content.trim() + '\n';
      }
    });

    td.addRule('table', {
      filter: 'table',
      replacement: function (_content, node) {
        return '\n\n' + tableToMarkdown(node) + '\n\n';
      }
    });

    td.addRule('fencedCodeBlock', {
      filter: function (node) {
        return node.nodeName === 'PRE' &&
          node.firstElementChild &&
          node.firstElementChild.nodeName === 'CODE';
      },
      replacement: function (_content, node) {
        const codeEl = node.firstElementChild;
        const cls = (codeEl.getAttribute('class') || '') + ' ' +
                    (node.getAttribute('class') || '');
        const m = cls.match(/(?:^|\s)(?:language|lang|highlight-source)-([\w+-]+)/);
        const lang = m ? m[1] : '';
        const code = codeEl.textContent.replace(/\n+$/, '');
        return '\n\n```' + lang + '\n' + code + '\n```\n\n';
      }
    });

    return td;
  }

  function inlineText(node) {
    if (!node) return '';
    let s = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        s += child.nodeValue;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        s += inlineText(child);
      }
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  function escapePipe(s) {
    return s.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';
    const grid = rows.map(tr =>
      Array.from(tr.children)
        .filter(c => c.tagName === 'TD' || c.tagName === 'TH')
        .map(c => ({ text: escapePipe(inlineText(c)), header: c.tagName === 'TH' }))
    ).filter(r => r.length);
    if (!grid.length) return '';

    const colCount = Math.max(...grid.map(r => r.length));
    grid.forEach(r => { while (r.length < colCount) r.push({ text: '', header: false }); });

    let headerRow;
    let bodyRows;
    if (grid[0].some(c => c.header)) {
      headerRow = grid[0];
      bodyRows = grid.slice(1);
    } else {
      headerRow = Array(colCount).fill(0).map((_, i) => ({ text: 'Column ' + (i + 1), header: true }));
      bodyRows = grid;
    }

    const lines = [];
    lines.push('| ' + headerRow.map(c => c.text || ' ').join(' | ') + ' |');
    lines.push('| ' + headerRow.map(() => '---').join(' | ') + ' |');
    for (const row of bodyRows) {
      lines.push('| ' + row.map(c => c.text || ' ').join(' | ') + ' |');
    }
    return lines.join('\n');
  }

  function buildJsonStructure(root) {
    const out = [];
    const BLOCK_LEAVES = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'PRE', 'HR', 'IMG', 'DL']);
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS', 'AUDIO', 'VIDEO', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'FORM', 'LABEL']);

    const inlineFlush = (parts) => {
      const text = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (text) out.push({ type: 'paragraph', text });
    };

    function emitInlineLink(a) {
      const text = inlineText(a);
      const href = a.getAttribute('href');
      return text ? '[' + text + '](' + (href || '') + ')' : '';
    }

    function collectInline(el) {
      let s = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          s += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (SKIP_TAGS.has(child.tagName)) continue;
          if (child.tagName === 'A') {
            s += ' ' + emitInlineLink(child) + ' ';
          } else if (child.tagName === 'STRONG' || child.tagName === 'B') {
            s += ' **' + inlineText(child) + '** ';
          } else if (child.tagName === 'EM' || child.tagName === 'I') {
            s += ' *' + inlineText(child) + '* ';
          } else if (child.tagName === 'CODE') {
            s += ' `' + inlineText(child) + '` ';
          } else if (child.tagName === 'BR') {
            s += '\n';
          } else {
            s += ' ' + collectInline(child) + ' ';
          }
        }
      }
      return s.replace(/\s+/g, ' ').trim();
    }

    function listToEntry(list) {
      const ordered = list.tagName === 'OL';
      const items = [];
      for (const li of list.children) {
        if (li.tagName !== 'LI') continue;
        const nestedLists = Array.from(li.children).filter(c => c.tagName === 'UL' || c.tagName === 'OL');
        const nestedClone = nestedLists.length
          ? nestedLists.map(nl => ({
              type: 'list',
              ordered: nl.tagName === 'OL',
              items: listToEntry(nl).items
            }))
          : [];
        const liClone = li.cloneNode(true);
        Array.from(liClone.children).forEach(c => {
          if (c.tagName === 'UL' || c.tagName === 'OL') c.remove();
        });
        const text = collectInline(liClone);
        if (text || nestedClone.length) {
          items.push(nestedClone.length ? { text, children: nestedClone } : text);
        }
      }
      return { type: 'list', ordered, items };
    }

    function tableEntry(table) {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (!rows.length) return null;
      const grid = rows.map(tr =>
        Array.from(tr.children)
          .filter(c => c.tagName === 'TD' || c.tagName === 'TH')
          .map(c => ({ text: inlineText(c), header: c.tagName === 'TH' }))
      ).filter(r => r.length);
      if (!grid.length) return null;
      const colCount = Math.max(...grid.map(r => r.length));
      grid.forEach(r => { while (r.length < colCount) r.push({ text: '', header: false }); });
      let headers, body;
      if (grid[0].some(c => c.header)) {
        headers = grid[0].map(c => c.text);
        body = grid.slice(1).map(r => r.map(c => c.text));
      } else {
        headers = Array(colCount).fill('').map((_, i) => 'Column ' + (i + 1));
        body = grid.map(r => r.map(c => c.text));
      }
      return { type: 'table', headers, rows: body };
    }

    function dlEntry(dl) {
      const items = [];
      let term = null;
      for (const child of dl.children) {
        if (child.tagName === 'DT') {
          if (term) items.push(term);
          term = { term: inlineText(child), descriptions: [] };
        } else if (child.tagName === 'DD' && term) {
          term.descriptions.push(inlineText(child));
        }
      }
      if (term) items.push(term);
      return { type: 'definitions', items };
    }

    function visit(node) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.nodeValue.replace(/\s+/g, ' ').trim();
        if (t) out.push({ type: 'paragraph', text: t });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (SKIP_TAGS.has(tag)) return;

      if (/^H[1-6]$/.test(tag)) {
        const text = inlineText(node);
        if (text) out.push({ type: 'heading', level: parseInt(tag[1], 10), text });
        return;
      }
      if (tag === 'P') {
        const text = collectInline(node);
        if (text) out.push({ type: 'paragraph', text });
        return;
      }
      if (tag === 'UL' || tag === 'OL') {
        const entry = listToEntry(node);
        if (entry.items.length) out.push(entry);
        return;
      }
      if (tag === 'TABLE') {
        const entry = tableEntry(node);
        if (entry) out.push(entry);
        return;
      }
      if (tag === 'BLOCKQUOTE') {
        const text = inlineText(node);
        if (text) out.push({ type: 'quote', text });
        return;
      }
      if (tag === 'PRE') {
        const text = node.textContent.replace(/^\n+|\n+$/g, '');
        if (text) out.push({ type: 'code', text });
        return;
      }
      if (tag === 'HR') {
        out.push({ type: 'divider' });
        return;
      }
      if (tag === 'IMG') {
        const alt = node.getAttribute('alt') || '';
        const src = node.getAttribute('src') || '';
        if (alt || src) out.push({ type: 'image', alt, src });
        return;
      }
      if (tag === 'DL') {
        out.push(dlEntry(node));
        return;
      }
      if (tag === 'DETAILS') {
        const summary = node.querySelector(':scope > summary');
        if (summary) {
          const text = inlineText(summary);
          if (text) out.push({ type: 'heading', level: 4, text });
        }
        for (const child of node.children) {
          if (child.tagName !== 'SUMMARY') visit(child);
        }
        return;
      }
      if (tag === 'A' && Array.from(node.children).every(c => !BLOCK_LEAVES.has(c.tagName) && c.tagName !== 'DIV')) {
        const text = inlineText(node);
        const href = node.getAttribute('href') || '';
        if (text) {
          out.push({ type: 'paragraph', text: '[' + text + '](' + href + ')' });
        }
        return;
      }
      if (tag === 'BR') return;

      // Container: recurse children
      for (const child of node.childNodes) visit(child);
    }

    for (const child of root.childNodes) visit(child);
    return out;
  }

  function safeTitle(s) {
    let out = (s || 'page')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '-');
    try {
      out = out.replace(/[^\p{L}\p{N}._-]/gu, '-');
    } catch (_e) {
      out = out.replace(/[^A-Za-z0-9._-]/g, '-');
    }
    return out
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80) || 'page';
  }

  function applyFilenameTemplate(template, ctx) {
    return template.replace(/\{(\w+)\}/g, function (_m, key) {
      return ctx[key] != null ? String(ctx[key]) : '';
    });
  }

  function makeFilename(template, ext, ctx) {
    let name = applyFilenameTemplate(template || '{title}_{domain}_{date}', {
      title: safeTitle(ctx.title),
      domain: safeTitle(ctx.domain),
      date: ctx.date,
      timestamp: ctx.timestamp.replace(/[:]/g, '-')
    });
    name = name.replace(/[\\/:*?"<>|]/g, '-').replace(/-{2,}/g, '-').slice(0, 180);
    if (!name) name = 'cleanlift-' + ctx.date;
    return name + '.' + ext;
  }

  function buildFrontmatter(meta) {
    const lines = [
      '---',
      'url: ' + meta.url,
      'domain: ' + meta.domain,
      'title: ' + JSON.stringify(meta.title),
      'extracted: ' + meta.timestamp,
      'word_count: ' + meta.wordCount,
      '---',
      ''
    ];
    return lines.join('\n');
  }

  function tokenEstimate(charCount) {
    return Math.max(0, Math.round(charCount / 4));
  }

  function formatTokenBadge(tokens) {
    if (tokens >= 100000) return Math.round(tokens / 1000) + 'k';
    if (tokens >= 1000) return (tokens / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(tokens);
  }

  function checkLazyAccordions(root) {
    const triggers = root.querySelectorAll('[aria-expanded="false"], details:not([open])');
    return triggers.length > 8;
  }

  function extract(settings) {
    settings = Object.assign({
      outputFormat: 'markdown',
      includeFrontmatter: true,
      includeLinks: true,
      includeImages: true,
      customStripSelectors: '',
      customKeepSelectors: '',
      filenameTemplate: '{title}_{domain}_{date}'
    }, settings || {});

    const liveBody = document.body;
    if (!liveBody) {
      return { error: 'No document body available.' };
    }

    const ct = (document.contentType || '').toLowerCase();
    if (ct && !ct.includes('html') && !ct.includes('xml') && !ct.includes('text/plain')) {
      return { error: 'CleanLift only extracts HTML pages. This tab reports content-type: ' + document.contentType + '.' };
    }

    // Compute hidden + keep info from live DOM (read-only — no mutation).
    const hiddenLive = new Set(gatherHiddenLiveElements(liveBody));
    const keepLive = buildKeepSet(liveBody, settings.customKeepSelectors);

    const clone = liveBody.cloneNode(true);
    const { cloneToLive, liveToClone } = buildCloneMaps(liveBody, clone);

    function isKept(el) {
      let cur = el;
      while (cur && cur.nodeType === Node.ELEMENT_NODE) {
        const live = cloneToLive.get(cur);
        if (live && keepLive.has(live)) return true;
        cur = cur.parentNode;
      }
      return false;
    }

    function safeRemove(el) {
      if (!el || !el.parentNode) return;
      if (isKept(el)) return;
      el.parentNode.removeChild(el);
    }

    // Strip hidden elements
    for (const liveEl of hiddenLive) {
      const cloneEl = liveToClone.get(liveEl);
      if (cloneEl) safeRemove(cloneEl);
    }

    // Strip unconditional tags (script/style/noscript/iframe).
    STRIP_TAGS_ALWAYS.forEach(tag => clone.querySelectorAll(tag).forEach(safeRemove));

    // Strip header/footer/nav only when outside <article>/<main>. HTML5 allows
    // these tags inside sectioning content as section headers, where they
    // carry real body content (e.g. WordPress block themes' .entry-header).
    STRIP_TAGS_OUTSIDE_CONTENT.forEach(tag => {
      clone.querySelectorAll(tag).forEach(el => {
        if (!el.closest('article, main')) safeRemove(el);
      });
    });

    // Strip by ARIA role
    STRIP_ARIA_ROLES.forEach(role => clone.querySelectorAll('[role="' + role + '"]').forEach(safeRemove));

    // Strip by class/id pattern
    const customPatterns = (settings.customStripSelectors || '')
      .split(/[,\n]/).map(s => s.trim()).filter(s => s && !s.startsWith('.') && !s.startsWith('#') && !s.startsWith('['));
    const patterns = buildBoilerplatePatterns(customPatterns);
    const candidates = Array.from(clone.querySelectorAll('div, section, aside, ul, ol, span, button, form, dialog'));
    for (const el of candidates) {
      if (elementMatchesBoilerplate(el, patterns)) safeRemove(el);
    }

    // Strip by user CSS selectors. Each selector runs in its own try/catch so
    // a single invalid entry doesn't silently drop the user's whole config.
    const customCssSelectors = (settings.customStripSelectors || '')
      .split(/[,\n]/).map(s => s.trim())
      .filter(s => s && (s.startsWith('.') || s.startsWith('#') || s.startsWith('[') || /[\s>+~]/.test(s)));
    const invalidSelectors = [];
    for (const sel of customCssSelectors) {
      try {
        clone.querySelectorAll(sel).forEach(safeRemove);
      } catch (_e) {
        invalidSelectors.push(sel);
      }
    }

    // Resolve URLs (with protocol allowlist; see resolveUrls).
    resolveUrls(clone, document.baseURI);

    // Optional: strip images. Preserve <figcaption> text — it's body content
    // even when the image itself is dropped.
    if (!settings.includeImages) {
      clone.querySelectorAll('figure').forEach(fig => {
        if (isKept(fig)) return;
        const cap = fig.querySelector('figcaption');
        if (cap && cap.textContent.trim()) {
          const p = document.createElement('p');
          p.textContent = cap.textContent.trim();
          fig.replaceWith(p);
        } else {
          safeRemove(fig);
        }
      });
      clone.querySelectorAll('img, picture').forEach(safeRemove);
    }

    // Optional: replace links with text
    if (!settings.includeLinks) {
      clone.querySelectorAll('a[href]').forEach(a => {
        const text = a.textContent;
        const span = document.createElement('span');
        span.textContent = text;
        a.replaceWith(span);
      });
    }

    // Promote visually-styled heading divs/spans before block emission so
    // both Markdown (Turndown) and JSON paths see them as real headings.
    promoteHeadingLikeElements(clone);

    // Drop empties left over
    dropEmptyContainers(clone, isKept);

    // Build outputs
    const td = buildTurndown();
    let markdown = '';
    try {
      markdown = td.turndown(clone);
    } catch (e) {
      markdown = '> Error converting to markdown: ' + (e && e.message ? e.message : String(e));
    }
    markdown = markdown.replace(/\n{3,}/g, '\n\n').trim() + '\n';

    const json = buildJsonStructure(clone);

    const wordCount = markdown.split(/\s+/).filter(Boolean).length;
    const charCount = markdown.length;
    const tokens = tokenEstimate(charCount);

    let domain = '';
    try { domain = new URL(location.href).hostname.replace(/^www\./, ''); } catch (_e) {}

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const timestamp = now.toISOString();

    const warnings = [];
    if (invalidSelectors.length) {
      warnings.push({
        kind: 'invalid-selector',
        message: 'Custom strip selector ignored (invalid CSS): ' + invalidSelectors.join(', ')
      });
    }

    const meta = {
      url: location.href,
      domain,
      title: document.title || '',
      timestamp,
      date,
      wordCount,
      charCount,
      tokens,
      tokenBadge: formatTokenBadge(tokens),
      lazyAccordionsSuspected: checkLazyAccordions(document.body),
      readyState: document.readyState,
      warnings
    };

    let markdownOut = markdown;
    if (settings.includeFrontmatter) {
      markdownOut = buildFrontmatter(meta) + '\n' + markdown;
    }

    const jsonOut = settings.includeFrontmatter
      ? {
          url: meta.url,
          domain: meta.domain,
          title: meta.title,
          extracted: meta.timestamp,
          word_count: meta.wordCount,
          content: json
        }
      : { content: json };

    const filenameMd = makeFilename(settings.filenameTemplate, 'md', meta);
    const filenameJson = makeFilename(settings.filenameTemplate, 'json', meta);

    return {
      markdown: markdownOut,
      json: JSON.stringify(jsonOut, null, 2),
      meta,
      filenameMd,
      filenameJson
    };
  }

  window.cleanlift = { extract };
})();
