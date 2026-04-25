(function () {
  if (window.__pagepeelReady) return;
  window.__pagepeelReady = true;

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

  // Returns null when the element is visible to a sighted user, or a reason
  // string when it should be stripped. Reason codes feed into stripped.hiddenByReason
  // so the popup disclosure can show *why* something was removed.
  //
  // Conservative defaults: we DON'T pass contentVisibilityAuto (a render
  // optimization, not a hide) or checkOpacity (catches mid-animation
  // elements) to checkVisibility — both produce false positives that drop
  // user-visible content. We accept some hidden-chrome leakage in exchange.
  function visibilityState(el) {
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkVisibilityCSS: true })) return 'css-hidden';
    } else {
      const style = getComputedStyle(el);
      if (style) {
        if (style.display === 'none') return 'display-none';
        if (style.visibility === 'hidden' || style.visibility === 'collapse') return 'visibility-hidden';
      }
    }
    // aria-hidden=true: only treat as hidden when the element has no visible
    // text. Sighted users still see aria-hidden text (it's only invisible to
    // assistive tech), so dropping it can lose icon-prefixed labels.
    if (el.getAttribute('aria-hidden') === 'true') {
      const text = (el.textContent || '').trim();
      if (!text) return 'aria-hidden';
    }
    return null;
  }

  function isVisuallyHidden(el) {
    return visibilityState(el) !== null;
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

  // Inline same-origin iframe bodies into the clone before stripping <iframe>.
  // PRD calls out fee tables in iframes on some Russell-Group university
  // pages; without this, the user-visible content is silently dropped.
  // Cross-origin frames throw on contentDocument access — caught and skipped.
  function inlineSameOriginIframes(clone, liveBody, liveToClone) {
    const counts = { inlined: 0, blocked: 0 };
    const iframes = liveBody.querySelectorAll('iframe');
    for (const liveIf of iframes) {
      let body = null;
      try {
        body = liveIf.contentDocument && liveIf.contentDocument.body;
      } catch (_e) {
        counts.blocked++;
        continue;
      }
      if (!body) {
        counts.blocked++;
        continue;
      }
      const cloneIf = liveToClone.get(liveIf);
      if (!cloneIf || !cloneIf.parentNode) continue;
      // Setting innerHTML on a detached element doesn't execute scripts,
      // and the strip pipeline removes <script> right after.
      const wrapper = clone.ownerDocument.createElement('div');
      wrapper.setAttribute('data-pagepeel-iframe', liveIf.src || '');
      wrapper.innerHTML = body.innerHTML;
      cloneIf.replaceWith(wrapper);
      counts.inlined++;
    }
    return counts;
  }

  // Inline open shadow roots so content rendered via shadow DOM (Webflow
  // components, custom elements, some commercial training templates)
  // survives extraction. Closed shadow roots are unreachable; we count
  // them so the user can see whether content might be missing.
  function inlineOpenShadowRoots(clone, liveBody, liveToClone) {
    const counts = { open: 0, closed: 0 };
    const stack = [liveBody];
    while (stack.length) {
      const el = stack.pop();
      if (el.shadowRoot) {
        counts.open++;
        const cloneEl = liveToClone.get(el);
        if (cloneEl) {
          const wrapper = clone.ownerDocument.createElement('div');
          wrapper.setAttribute('data-pagepeel-shadow', el.tagName.toLowerCase());
          wrapper.innerHTML = el.shadowRoot.innerHTML;
          cloneEl.appendChild(wrapper);
        }
        // Recurse into shadowRoot children (rare but real: nested shadow DOM)
        for (const child of el.shadowRoot.children) stack.push(child);
      }
      for (const child of el.children) stack.push(child);
    }
    return counts;
  }

  function gatherHiddenLiveElements(root) {
    const hidden = []; // [{el, reason}]
    const stack = [{ el: root, depth: 0 }];
    while (stack.length) {
      const { el, depth } = stack.pop();
      const children = el.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childDepth = depth + (isAccordionLike(child) ? 1 : 0);
        let reason = null;
        if (childDepth === 0) reason = visibilityState(child);
        if (reason) {
          hidden.push({ el: child, reason });
        } else {
          stack.push({ el: child, depth: childDepth });
        }
      }
    }
    return hidden;
  }

  // Allowed protocols for <a href>. javascript:/vbscript:/file:/chrome-*: are
  // dropped because the .md output is consumed by LLM pipelines and humans
  // pasting into renderers — both can re-expose javascript: URLs as XSS.
  const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'ftp:']);
  // <img src> is more restrictive: data: and blob: can carry script payloads
  // (SVG-with-script in particular). Allow only http(s).
  const SAFE_IMG_PROTOCOLS = new Set(['http:', 'https:']);

  function resolveUrls(clone, baseURI) {
    const fixLink = (el, attr, allowed) => {
      const raw = el.getAttribute(attr);
      if (!raw) return;
      let parsed;
      try {
        parsed = new URL(raw, baseURI);
      } catch (_e) {
        el.removeAttribute(attr);
        return;
      }
      if (!allowed.has(parsed.protocol)) {
        el.removeAttribute(attr);
        return;
      }
      el.setAttribute(attr, parsed.href);
    };
    clone.querySelectorAll('a[href]').forEach(a => fixLink(a, 'href', SAFE_LINK_PROTOCOLS));
    clone.querySelectorAll('img[src]').forEach(img => fixLink(img, 'src', SAFE_IMG_PROTOCOLS));
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

  function rowAllBold(tr) {
    const cells = Array.from(tr.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH');
    if (!cells.length) return false;
    return cells.every(c => {
      if (c.tagName === 'TH') return true;
      const onlyBold = c.querySelector('strong, b');
      const text = (c.textContent || '').trim();
      return !!onlyBold && (onlyBold.textContent || '').trim() === text;
    });
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
    } else if (rows[0] && rowAllBold(rows[0])) {
      // First row is visually-bold-only — promote to header (common pattern
      // in commercial training-page fee tables that omit <th>).
      headerRow = grid[0];
      bodyRows = grid.slice(1);
    } else {
      // No reliable header signal. Emit a header-less markdown table
      // (empty header cells) rather than fake "Column 1, Column 2" labels
      // that hijack downstream LLM field detection.
      headerRow = Array(colCount).fill(0).map(() => ({ text: '', header: true }));
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
      // Preserve newlines from <br> while collapsing horizontal whitespace.
      // Multi-line fee blocks (`<p>UK: £12,500<br>EU: £18,000</p>`) keep their
      // structure in JSON output instead of merging into one space-joined run.
      return s
        .replace(/[ \t\f\v ]+/g, ' ')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function isInlineOnlyContainer(el) {
      const INLINE_OK = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'CODE', 'KBD',
        'SUB', 'SUP', 'SMALL', 'MARK', 'TIME', 'ABBR', 'CITE', 'Q', 'U', 'S',
        'BR', 'SPAN', 'BDI', 'BDO', 'WBR']);
      for (const child of el.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && !INLINE_OK.has(child.tagName)) {
          return false;
        }
      }
      return true;
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
      } else if (rows[0] && rowAllBold(rows[0])) {
        headers = grid[0].map(c => c.text);
        body = grid.slice(1).map(r => r.map(c => c.text));
      } else {
        // No reliable header signal. JSON consumers should treat headers=null
        // as "use row position", not as fake column labels.
        headers = null;
        body = grid.map(r => r.map(c => c.text));
      }
      return { type: 'table', headers, rows: body };
    }

    function dlEntry(dl) {
      // Walk DT/DD in document order. Squarespace/Webflow templates wrap each
      // pair in a single styling <div>, so we accept dt/dd nested up to one
      // wrapper deep. Orphan DDs (before the first DT, or with no DT at all)
      // are emitted under a synthetic empty term so content survives.
      const items = [];
      let term = null;
      const all = Array.from(dl.querySelectorAll('dt, dd')).filter(el => {
        let p = el.parentElement;
        while (p) {
          if (p === dl) return true;
          if (p.tagName === 'DL') return false;
          p = p.parentElement;
        }
        return false;
      });
      for (const el of all) {
        if (el.tagName === 'DT') {
          if (term) items.push(term);
          term = { term: inlineText(el), descriptions: [] };
        } else {
          if (!term) term = { term: '', descriptions: [] };
          term.descriptions.push(inlineText(el));
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
        // Iterate childNodes (not children) so text nodes directly inside
        // <details>...</details> are preserved alongside element children.
        for (const child of node.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'SUMMARY') continue;
          visit(child);
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

      // Inline-only container (DIV/SPAN/etc. with no block descendants):
      // emit a single paragraph instead of fragmenting into N entries. This
      // restores parity with Turndown's markdown output.
      if (isInlineOnlyContainer(node)) {
        const text = collectInline(node);
        if (text) out.push({ type: 'paragraph', text });
        return;
      }

      // Mixed-content container: recurse children
      for (const child of node.childNodes) visit(child);
    }

    for (const child of root.childNodes) visit(child);
    return out;
  }

  // Windows refuses to open files whose stem matches a reserved device name,
  // and bidi/zero-width characters can spoof filenames in shells. Both must
  // be stripped before the page-controlled title becomes part of a filename.
  const WIN_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  // Bidi overrides (U+202A–U+202E), isolates (U+2066–U+2069), zero-width
  // (U+200B–U+200F), BOM (U+FEFF).
  const SPOOFY_CHARS_RE = /[‪-‮⁦-⁩​-‏﻿]/g;

  function safeTitle(s) {
    let out = (s || 'page')
      .replace(SPOOFY_CHARS_RE, '')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '-');
    try {
      out = out.replace(/[^\p{L}\p{N}._-]/gu, '-');
    } catch (_e) {
      out = out.replace(/[^A-Za-z0-9._-]/g, '-');
    }
    out = out
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80) || 'page';
    if (WIN_RESERVED_RE.test(out)) out = '_' + out;
    return out;
  }

  function applyFilenameTemplate(template, ctx) {
    return template.replace(/\{(\w+)\}/g, function (_m, key) {
      return ctx[key] != null ? String(ctx[key]) : '';
    });
  }

  // Stable, fast hash of a URL — a 6-char djb2 in base36. Used to disambiguate
  // filenames so two pages whose sanitized titles collide (or two re-runs of
  // the same URL on the same date) don't silently overwrite via uniquify.
  function hashUrl(url) {
    let h = 5381;
    const s = String(url || '');
    for (let i = 0; i < s.length; i++) {
      h = (((h << 5) + h) | 0) ^ s.charCodeAt(i);
    }
    return Math.abs(h).toString(36).padStart(6, '0').slice(0, 6);
  }

  function makeFilename(template, ext, ctx) {
    const tpl = template || '{title}_{domain}_{date}_{hash}';
    let name = applyFilenameTemplate(tpl, {
      title: safeTitle(ctx.title),
      domain: safeTitle(ctx.domain),
      date: ctx.date,
      timestamp: ctx.timestamp.replace(/[:]/g, '-'),
      hash: ctx.hash
    });
    // If the user's stored template predates the {hash}/{timestamp} variables,
    // append the hash so different URLs never collide on the filename layer.
    if (!/\{hash\}|\{timestamp\}/.test(tpl) && ctx.hash) {
      name += '_' + ctx.hash;
    }
    name = name.replace(/[\\/:*?"<>|]/g, '-').replace(/-{2,}/g, '-').slice(0, 180);
    if (!name) name = 'cleanlift-' + ctx.date + '-' + (ctx.hash || '');
    return name + '.' + ext;
  }

  // YAML single-quoted scalar: doubles internal apostrophes and strips control
  // characters that would otherwise produce multi-line scalars or invalid YAML.
  // Safer than JSON.stringify for downstream readers that aren't strict YAML
  // (Stage-2 scripts that just split on first ':').
  function yamlSingleQuote(s) {
    const safe = String(s == null ? '' : s)
      .replace(/[ -]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return "'" + safe.replace(/'/g, "''") + "'";
  }

  function buildFrontmatter(meta) {
    const lines = [
      '---',
      'url: ' + yamlSingleQuote(meta.url),
      'domain: ' + yamlSingleQuote(meta.domain),
      'title: ' + yamlSingleQuote(meta.title),
      'extracted: ' + yamlSingleQuote(meta.timestamp),
      'word_count: ' + meta.wordCount,
      '---',
      ''
    ];
    return lines.join('\n');
  }

  // Token estimate uses words × 1.3 for plain prose (closer to BPE behaviour
  // than chars/4) plus a small overhead for markdown syntax (link parens,
  // table pipes, code fences). Still rough — accurate enough for badge/UI.
  function tokenEstimate(markdown, wordCount) {
    if (!markdown) return 0;
    const baseTokens = Math.round(wordCount * 1.3);
    // Count syntax overhead: links [text](url), table pipes, fence ticks.
    const linkSyntax = (markdown.match(/\]\(/g) || []).length * 2;
    const tableMarkers = (markdown.match(/\|/g) || []).length;
    const codeFences = (markdown.match(/```/g) || []).length * 2;
    return Math.max(0, baseTokens + linkSyntax + tableMarkers + codeFences);
  }

  function formatTokenBadge(tokens) {
    if (tokens >= 100000) return Math.round(tokens / 1000) + 'k';
    if (tokens >= 1000) return (tokens / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(tokens);
  }

  function countLazyAccordions(root) {
    return root.querySelectorAll('[aria-expanded="false"], details:not([open])').length;
  }

  // Parse per-domain rules of the form
  //   durham.ac.uk: .intl-entry-requirements, .related-courses
  //   ucl.ac.uk: .promo, #event-banner
  // Lines without a colon are ignored. Returns Map<hostname, "selector,selector">.
  function parsePerDomainRules(text) {
    const out = new Map();
    if (!text) return out;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const host = line.slice(0, idx).trim().toLowerCase();
      const sels = line.slice(idx + 1).trim();
      if (host && sels) out.set(host, sels);
    }
    return out;
  }

  function extract(settings) {
    // In-tab mutex: when popup and shortcut both fire concurrently they used
    // to produce two extractions racing into the downloads layer, where
    // 'uniquify' silently turned the second into name(1) — masquerading as
    // two pages from one. The lock makes the second caller fail-fast.
    if (window.__pagepeelBusy) {
      return { error: 'PagePeel is already extracting this tab. Wait for the current run to finish, then re-trigger.' };
    }
    window.__pagepeelBusy = true;

    try {
      return extractInner(settings);
    } finally {
      window.__pagepeelBusy = false;
    }
  }

  function extractInner(settings) {
    settings = Object.assign({
      outputFormat: 'markdown',
      includeFrontmatter: true,
      includeLinks: true,
      includeImages: true,
      customStripSelectors: '',
      customKeepSelectors: '',
      perDomainRules: '',
      filenameTemplate: '{title}_{domain}_{date}_{hash}'
    }, settings || {});

    const liveBody = document.body;
    if (!liveBody) {
      return { error: 'No document body available.' };
    }

    const ct = (document.contentType || '').toLowerCase();
    if (ct && !ct.includes('html') && !ct.includes('xml') && !ct.includes('text/plain')) {
      return { error: 'PagePeel only extracts HTML pages. This tab reports content-type: ' + document.contentType + '.' };
    }

    // Per-domain rules: lines of "hostname: selector1, selector2". The matching
    // rules for the current hostname are appended to customStripSelectors so
    // a researcher tuning Durham doesn't have to re-edit selectors when
    // moving to UCL.
    const perDomain = parsePerDomainRules(settings.perDomainRules || '');
    const currentHost = (location.hostname || '').toLowerCase();
    const domainStrip = [];
    for (const [host, sels] of perDomain) {
      if (currentHost === host || currentHost.endsWith('.' + host)) {
        domainStrip.push(sels);
      }
    }
    if (domainStrip.length) {
      settings = Object.assign({}, settings, {
        customStripSelectors: [settings.customStripSelectors, ...domainStrip]
          .filter(Boolean).join(', ')
      });
    }

    // Compute hidden + keep info from live DOM (read-only — no mutation).
    const hiddenLiveEntries = gatherHiddenLiveElements(liveBody);
    const hiddenLive = new Set(hiddenLiveEntries.map(h => h.el));
    const hiddenReasonByLive = new Map(hiddenLiveEntries.map(h => [h.el, h.reason]));
    const keepLive = buildKeepSet(liveBody, settings.customKeepSelectors);

    const clone = liveBody.cloneNode(true);
    const { cloneToLive, liveToClone } = buildCloneMaps(liveBody, clone);

    // Inline same-origin iframe bodies and open shadow-root content into the
    // clone before stripping. This recovers content that the user can see
    // (fee-table iframes on university pages, Webflow shadow-DOM components)
    // but that cloneNode would otherwise skip.
    const iframeCounts = inlineSameOriginIframes(clone, liveBody, liveToClone);
    const shadowCounts = inlineOpenShadowRoots(clone, liveBody, liveToClone);

    function isKept(el) {
      let cur = el;
      while (cur && cur.nodeType === Node.ELEMENT_NODE) {
        const live = cloneToLive.get(cur);
        if (live && keepLive.has(live)) return true;
        cur = cur.parentNode;
      }
      return false;
    }

    // Tracks counts of stripped elements per category, surfaced via
    // meta.stripped so the researcher can audit what disappeared without
    // diffing markdown output by eye. hiddenByReason breaks out display:none
    // vs visibility:hidden vs aria-hidden so a surprising 300+ count can be
    // diagnosed without re-instrumenting the extension.
    const stripped = {
      hidden: 0,
      hiddenByReason: {},
      tagsAlways: 0,
      tagsOutsideContent: 0,
      ariaRoles: 0,
      patternMatched: 0,
      customSelectors: 0,
      figures: 0
    };

    function safeRemove(el, bucket) {
      if (!el || !el.parentNode) return false;
      if (isKept(el)) return false;
      el.parentNode.removeChild(el);
      if (bucket && stripped[bucket] != null) stripped[bucket]++;
      return true;
    }

    // Strip hidden elements, recording per-reason counts.
    for (const liveEl of hiddenLive) {
      const cloneEl = liveToClone.get(liveEl);
      if (!cloneEl) continue;
      if (safeRemove(cloneEl, 'hidden')) {
        const reason = hiddenReasonByLive.get(liveEl) || 'unknown';
        stripped.hiddenByReason[reason] = (stripped.hiddenByReason[reason] || 0) + 1;
      }
    }

    // Strip unconditional tags (script/style/noscript/iframe).
    STRIP_TAGS_ALWAYS.forEach(tag => clone.querySelectorAll(tag).forEach(el => safeRemove(el, 'tagsAlways')));

    // Strip header/footer/nav only when outside <article>/<main>. HTML5 allows
    // these tags inside sectioning content as section headers, where they
    // carry real body content (e.g. WordPress block themes' .entry-header).
    STRIP_TAGS_OUTSIDE_CONTENT.forEach(tag => {
      clone.querySelectorAll(tag).forEach(el => {
        if (!el.closest('article, main')) safeRemove(el, 'tagsOutsideContent');
      });
    });

    // Strip by ARIA role
    STRIP_ARIA_ROLES.forEach(role => clone.querySelectorAll('[role="' + role + '"]').forEach(el => safeRemove(el, 'ariaRoles')));

    // Strip by class/id pattern
    const customPatterns = (settings.customStripSelectors || '')
      .split(/[,\n]/).map(s => s.trim()).filter(s => s && !s.startsWith('.') && !s.startsWith('#') && !s.startsWith('['));
    const patterns = buildBoilerplatePatterns(customPatterns);
    const candidates = Array.from(clone.querySelectorAll('div, section, aside, ul, ol, span, button, form, dialog'));
    for (const el of candidates) {
      if (elementMatchesBoilerplate(el, patterns)) safeRemove(el, 'patternMatched');
    }

    // Strip by user CSS selectors. Each selector runs in its own try/catch so
    // a single invalid entry doesn't silently drop the user's whole config.
    const customCssSelectors = (settings.customStripSelectors || '')
      .split(/[,\n]/).map(s => s.trim())
      .filter(s => s && (s.startsWith('.') || s.startsWith('#') || s.startsWith('[') || /[\s>+~]/.test(s)));
    const invalidSelectors = [];
    for (const sel of customCssSelectors) {
      try {
        clone.querySelectorAll(sel).forEach(el => safeRemove(el, 'customSelectors'));
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
          stripped.figures++;
        } else {
          safeRemove(fig, 'figures');
        }
      });
      clone.querySelectorAll('img, picture').forEach(el => safeRemove(el, 'figures'));
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

    // Build outputs. Markdown failure is reported via meta.markdownError
    // and the markdown payload is left null so the popup/SW can refuse the
    // download — previously a Turndown crash produced a "valid-looking"
    // .md whose body was just the error message.
    const td = buildTurndown();
    let markdown = null;
    let markdownError = null;
    try {
      const raw = td.turndown(clone);
      markdown = raw.replace(/\n{3,}/g, '\n\n').trim() + '\n';
    } catch (e) {
      markdownError = e && e.message ? e.message : String(e);
    }

    let json = null;
    let jsonError = null;
    try {
      json = buildJsonStructure(clone);
    } catch (e) {
      jsonError = e && e.message ? e.message : String(e);
    }

    const wordCount = markdown ? markdown.split(/\s+/).filter(Boolean).length : 0;
    const charCount = markdown ? markdown.length : 0;
    const tokens = tokenEstimate(markdown || '', wordCount);

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
    if (markdownError) {
      warnings.push({ kind: 'markdown-error', message: 'Could not produce a Markdown file from this page: ' + markdownError });
    }
    if (jsonError) {
      warnings.push({ kind: 'json-error', message: 'Could not produce a JSON file from this page: ' + jsonError });
    }
    if (iframeCounts.blocked) {
      warnings.push({
        kind: 'iframe-blocked',
        message: 'This page embeds content from another website (' + iframeCounts.blocked + ' embed' + (iframeCounts.blocked > 1 ? 's' : '') + '). Browsers block extensions from reading those, so any text inside may be missing.'
      });
    }
    if (iframeCounts.inlined) {
      warnings.push({
        kind: 'iframe-inlined',
        message: 'Captured content from ' + iframeCounts.inlined + ' embedded panel' + (iframeCounts.inlined > 1 ? 's' : '') + ' on this page.'
      });
    }
    if (shadowCounts.open) {
      warnings.push({
        kind: 'shadow-open',
        message: 'Captured ' + shadowCounts.open + ' specially-rendered section' + (shadowCounts.open > 1 ? 's' : '') + ' (used by some custom components).'
      });
    }

    const collapsedCount = countLazyAccordions(document.body);
    const urlHash = hashUrl(location.href);

    const meta = {
      url: location.href,
      domain,
      title: document.title || '',
      timestamp,
      date,
      hash: urlHash,
      wordCount,
      charCount,
      tokens,
      tokenBadge: formatTokenBadge(tokens),
      collapsedCount,
      lazyAccordionsSuspected: collapsedCount >= 1,
      readyState: document.readyState,
      stripped,
      warnings,
      markdownError,
      jsonError
    };

    // Fail-closed: if BOTH outputs failed, return as a hard error so the
    // shortcut path doesn't silently write garbage to disk.
    if (markdownError && jsonError) {
      return { error: 'Extraction produced no usable output. ' + markdownError, meta };
    }

    let markdownOut = null;
    if (markdown !== null) {
      markdownOut = settings.includeFrontmatter
        ? buildFrontmatter(meta) + '\n' + markdown
        : markdown;
    }

    let jsonOut = null;
    if (json !== null) {
      jsonOut = settings.includeFrontmatter
        ? {
            url: meta.url,
            domain: meta.domain,
            title: meta.title,
            extracted: meta.timestamp,
            word_count: meta.wordCount,
            content: json
          }
        : { content: json };
    }

    const filenameMd = makeFilename(settings.filenameTemplate, 'md', meta);
    const filenameJson = makeFilename(settings.filenameTemplate, 'json', meta);

    return {
      markdown: markdownOut,
      json: jsonOut !== null ? JSON.stringify(jsonOut, null, 2) : null,
      meta,
      filenameMd,
      filenameJson
    };
  }

  window.pagepeel = { extract };
})();
