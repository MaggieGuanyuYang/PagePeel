(function () {
  if (window.__cleanliftReady) return;
  window.__cleanliftReady = true;

  const STRIP_TAGS = [
    'script', 'style', 'noscript', 'iframe',
    'nav', 'header', 'footer'
  ];

  const STRIP_ARIA_ROLES = ['navigation', 'banner', 'contentinfo'];

  const BOILERPLATE_PATTERNS = [
    'nav', 'navbar', 'navigation', 'menu', 'sidebar', 'breadcrumb', 'breadcrumbs',
    'footer', 'site-footer', 'page-footer', 'sitefooter',
    'header', 'site-header', 'page-header', 'topbar', 'top-bar',
    'cookie', 'cookies', 'consent', 'gdpr', 'privacy-banner', 'privacy-notice',
    'ad', 'ads', 'advert', 'adverts', 'advertisement', 'sponsor', 'sponsored', 'promo',
    'share', 'social', 'social-share', 'sharing', 'sharing-buttons', 'share-buttons',
    'comments', 'comment-section', 'disqus', 'commentlist',
    'related', 'recommended', 'also-bought', 'similar', 'you-may-like', 'youmaylike',
    'testimonial', 'testimonials', 'review-widget', 'trust-pilot', 'trustpilot', 'trust-badges',
    'newsletter', 'signup', 'subscribe', 'mailing-list', 'mailchimp',
    'modal', 'popup', 'overlay', 'dialog-backdrop', 'lightbox',
    'live-chat', 'chatbot', 'chat-widget', 'intercom-launcher', 'zopim', 'tawk',
    'skip-link', 'skip-to-content', 'skip-nav'
  ];

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
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const style = getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none') return true;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
    if (style.opacity === '0' && style.pointerEvents === 'none') return true;
    return false;
  }

  function buildBoilerplateSet(extra) {
    const all = BOILERPLATE_PATTERNS.concat(extra || []);
    return new Set(all.map(p => p.toLowerCase()));
  }

  function tokenize(s) {
    if (!s) return [];
    // Split camelCase: "siteFooter" → ["site", "Footer"], "URLBox" → ["URL", "Box"]
    const decamel = s
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    return decamel.split(/[\s_\-/]+/).map(t => t.toLowerCase()).filter(Boolean);
  }

  function elementMatchesBoilerplate(el, patternSet) {
    if (ALLOWLIST_TAGS.has(el.tagName)) return false;
    const tokens = [];
    if (el.id) tokens.push(...tokenize(el.id));
    if (el.className && typeof el.className === 'string') {
      el.className.split(/\s+/).forEach(c => tokens.push(...tokenize(c)));
    }
    const dc = el.getAttribute && el.getAttribute('data-component');
    if (dc) tokens.push(...tokenize(dc));
    for (const t of tokens) {
      if (patternSet.has(t)) return true;
    }
    return false;
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
    let changed = true;
    let passes = 0;
    while (changed && passes < 4) {
      changed = false;
      passes++;
      const candidates = clone.querySelectorAll('div, section, aside, span');
      for (const el of candidates) {
        if (isKept && isKept(el)) continue;
        if (el.children.length === 0 && !el.textContent.trim()) {
          el.remove();
          changed = true;
        }
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

    // Strip by tag
    STRIP_TAGS.forEach(tag => clone.querySelectorAll(tag).forEach(safeRemove));

    // Strip by ARIA role
    STRIP_ARIA_ROLES.forEach(role => clone.querySelectorAll('[role="' + role + '"]').forEach(safeRemove));

    // Strip by class/id pattern
    const customPatterns = (settings.customStripSelectors || '')
      .split(/[,\n]/).map(s => s.trim()).filter(s => s && !s.startsWith('.') && !s.startsWith('#') && !s.startsWith('['));
    const patternSet = buildBoilerplateSet(customPatterns);
    const candidates = Array.from(clone.querySelectorAll('div, section, aside, ul, ol, span, button, form, dialog'));
    for (const el of candidates) {
      if (elementMatchesBoilerplate(el, patternSet)) safeRemove(el);
    }

    // Strip by user CSS selectors (those that ARE valid CSS — start with . # [ or contain space/combinator)
    const customCssSelectors = (settings.customStripSelectors || '')
      .split(/[,\n]/).map(s => s.trim())
      .filter(s => s && (s.startsWith('.') || s.startsWith('#') || s.startsWith('[') || /[\s>+~]/.test(s)));
    if (customCssSelectors.length) {
      try {
        clone.querySelectorAll(customCssSelectors.join(',')).forEach(safeRemove);
      } catch (_e) { /* invalid selector */ }
    }

    // Resolve URLs
    resolveUrls(clone, document.baseURI);

    // Optional: strip images entirely
    if (!settings.includeImages) {
      clone.querySelectorAll('img, picture, figure').forEach(safeRemove);
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
      readyState: document.readyState
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
