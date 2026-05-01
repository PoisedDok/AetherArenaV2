use serde_json::{json, Value};

use crate::dispatch::CdpContext;

pub async fn handle(
    method: &str,
    _params: &Value,
    ctx: &mut CdpContext,
    session_id: &Option<String>,
) -> Result<Value, String> {
    match method {
        // ── LP.getMarkdown ────────────────────────────────────────────────────
        // Converts the visible DOM to Markdown.  Falls back through two levels
        // when the DOM body is empty (e.g. CSR React / Next.js App Router pages
        // where the reconciler hasn't committed yet):
        //   Level A: toMd() — semantic HTML → clean markdown
        //   Level B: getInnerText() walker — any visible text in the DOM
        //   Level C: SPA state stores — window.__next_f (RSC), __NEXT_DATA__,
        //            Redux, etc. → extracts readable strings from JSON payloads
        "getMarkdown" => {
            let page = ctx.get_session_page_mut(session_id).ok_or("No page")?;
            let code = r#"
(function() {
    // ── A: semantic HTML → markdown ───────────────────────────────────────────
    function toMd(el, depth) {
        if (!el) return '';
        if (el.nodeType === 3) return el.textContent || '';
        if (el.nodeType !== 1) return '';
        var tag = (el.tagName || '').toLowerCase();
        var children = '';
        var cn = el.childNodes || [];
        for (var i = 0; i < cn.length; i++) children += toMd(cn[i], depth);
        children = children.replace(/\n{3,}/g, '\n\n');
        switch(tag) {
            case 'h1': return '\n# ' + children.trim() + '\n\n';
            case 'h2': return '\n## ' + children.trim() + '\n\n';
            case 'h3': return '\n### ' + children.trim() + '\n\n';
            case 'h4': return '\n#### ' + children.trim() + '\n\n';
            case 'h5': return '\n##### ' + children.trim() + '\n\n';
            case 'h6': return '\n###### ' + children.trim() + '\n\n';
            case 'p': return '\n' + children.trim() + '\n\n';
            case 'br': return '\n';
            case 'hr': return '\n---\n\n';
            case 'strong': case 'b': return '**' + children + '**';
            case 'em': case 'i': return '*' + children + '*';
            case 'code': return '`' + children + '`';
            case 'pre': return '\n```\n' + children + '\n```\n\n';
            case 'blockquote': return '\n> ' + children.trim().replace(/\n/g, '\n> ') + '\n\n';
            case 'a':
                var href = el.getAttribute('href') || '';
                if (href && children.trim()) return '[' + children.trim() + '](' + href + ')';
                return children;
            case 'img':
                var src = el.getAttribute('src') || '';
                var alt = el.getAttribute('alt') || '';
                return '![' + alt + '](' + src + ')';
            case 'ul': case 'ol':
                return '\n' + children + '\n';
            case 'li':
                var parent = el.parentNode;
                var isOrdered = parent && parent.tagName && parent.tagName.toLowerCase() === 'ol';
                var bullet = isOrdered ? '1. ' : '- ';
                return bullet + children.trim() + '\n';
            case 'table': return '\n' + children + '\n';
            case 'thead': case 'tbody': case 'tfoot': return children;
            case 'tr':
                var cells = [];
                var tds = el.childNodes || [];
                for (var j = 0; j < tds.length; j++) {
                    if (tds[j].nodeType === 1) cells.push(toMd(tds[j], depth).trim());
                }
                return '| ' + cells.join(' | ') + ' |\n';
            case 'th': case 'td': return children;
            case 'script': case 'style': case 'noscript': case 'link': case 'meta': return '';
            case 'div': case 'section': case 'article': case 'main': case 'aside': case 'nav': case 'header': case 'footer':
                return '\n' + children;
            case 'span': return children;
            default: return children;
        }
    }

    var body = document.body || document.documentElement;
    var md = toMd(body, 0);
    md = md.replace(/\n{3,}/g, '\n\n').trim();

    // ── B: visible-text walker ────────────────────────────────────────────────
    // Fires when Level A returns too little (< 50 chars) but visible DOM text
    // nodes exist — handles cases where React committed but used non-semantic tags.
    if (md.length < 50) {
        var SKIP = {SCRIPT:1,STYLE:1,NOSCRIPT:1,META:1,LINK:1};
        var texts = [];
        function walkText(node) {
            if (!node) return;
            if (node.nodeType === 3) {
                var t = (node.textContent || '').trim();
                if (t.length > 2) texts.push(t);
                return;
            }
            if (node.nodeType === 1 && SKIP[node.tagName]) return;
            var kids = node.childNodes || [];
            for (var i = 0; i < kids.length; i++) walkText(kids[i]);
        }
        walkText(document.body || document.documentElement);
        var walked = texts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        // Only use if it adds meaningful new content (not just script noise)
        if (walked.length > md.length + 20) md = walked;
    }

    // ── C: SPA state fallback ─────────────────────────────────────────────────
    // When the DOM is truly empty (CSR SPA where React hasn't rendered yet),
    // extract readable strings from well-known JavaScript state stores.
    // Security: we only extract *string values* that look like human-readable
    // sentences (contain spaces, no JS syntax chars) — never arbitrary eval.
    if (md.length < 50) {
        var spa = [];

        // Next.js Pages Router
        if (window.__NEXT_DATA__) {
            try {
                function pickStrings(obj, depth) {
                    if (depth > 6 || !obj) return;
                    if (typeof obj === 'string' && obj.length > 25 && /\s/.test(obj) && !/[{}<>]/.test(obj))
                        spa.push(obj);
                    else if (Array.isArray(obj))
                        for (var i = 0; i < obj.length; i++) pickStrings(obj[i], depth+1);
                    else if (typeof obj === 'object')
                        Object.keys(obj).forEach(function(k){ pickStrings(obj[k], depth+1); });
                }
                pickStrings(window.__NEXT_DATA__.props, 0);
            } catch(e) {}
        }

        // Next.js App Router — RSC flight data
        if (window.__next_f) {
            try {
                window.__next_f.forEach(function(item) {
                    if (!Array.isArray(item) || typeof item[1] !== 'string') return;
                    // Each item[1] is a chunk of RSC protocol text containing JSON
                    // blobs. Parse JSON-like objects embedded in it.
                    var matches = item[1].match(/"description":"([^"]{25,})"/g);
                    if (matches) matches.forEach(function(m) {
                        var v = m.replace(/^"description":"/, '').replace(/"$/, '');
                        if (/\s/.test(v)) spa.push(v);
                    });
                    // Also extract plain sentence-like strings (30+ chars, no JS syntax)
                    var plain = item[1].match(/"([A-Z][^"\\]{29,}[.!?]?)"/g);
                    if (plain) plain.forEach(function(m) {
                        var v = m.slice(1, -1);
                        if (/\s/.test(v) && !/[\{\}\[\]\\=><]/.test(v)) spa.push(v);
                    });
                });
            } catch(e) {}
        }

        // Deduplicate and join
        var seen = {};
        var deduped = spa.filter(function(s) {
            if (seen[s]) return false;
            seen[s] = true;
            return true;
        });
        if (deduped.length > 0) md = deduped.join('\n\n');
    }

    // Page title as fallback header
    if (md.length < 10 && document.title) {
        md = '# ' + document.title;
    }

    return md.replace(/\n{3,}/g, '\n\n').trim();
})()
"#;
            let result = page.evaluate(code);
            let markdown = result.as_str().unwrap_or("").to_string();
            Ok(json!({ "markdown": markdown }))
        }

        // ── LP.getInnerText ───────────────────────────────────────────────────
        // Returns all visible text from the page, properly filtered.
        // Unlike browser innerText (which in QuickJS may include script content),
        // this walks the DOM tree and only collects text from non-script elements.
        // Useful when LP.getMarkdown returns empty but some DOM text nodes exist.
        "getInnerText" => {
            let page = ctx.get_session_page_mut(session_id).ok_or("No page")?;
            let code = r#"
(function() {
    var SKIP = {SCRIPT:1,STYLE:1,NOSCRIPT:1,META:1,LINK:1,HEAD:1};
    var texts = [];
    function walk(node) {
        if (!node) return;
        if (node.nodeType === 3) {
            var t = (node.textContent || '').trim();
            if (t.length > 1) texts.push(t);
            return;
        }
        if (node.nodeType === 1 && SKIP[node.tagName]) return;
        var kids = node.childNodes || [];
        for (var i = 0; i < kids.length; i++) walk(kids[i]);
    }
    walk(document.body || document.documentElement);
    return texts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
})()
"#;
            let result = page.evaluate(code);
            let text = result.as_str().unwrap_or("").to_string();
            Ok(json!({ "text": text }))
        }

        _ => Err(format!("Unknown LP method: {}", method)),
    }
}
