/**
 * Brevmont panel height diagnostic — paste into VinSolutions DevTools console.
 *
 * What this tells us:
 *   1. Which Brevmont version is actually loaded in Chrome.
 *   2. Exact bounding rect of the shadow host (`#brevmont-host`) — top,
 *      bottom, height. This is the element whose `height` was changed in
 *      1.9.9 to content-driven.
 *   3. Parent chain from host up to <html>, so we can rule out a VinSolutions
 *      wrapper pinning it tall.
 *   4. Inside the shadow root: `#o8` (inner panel) + each direct child
 *      (`.header`, `#o8-quick`, `#o8-outputs`, any `.tools-panel`) with
 *      their own rects — so we can see whether a HIDDEN panel is
 *      contributing height, or whether `.outputs` is eating space despite
 *      being :empty.
 *   5. Highlights each element with a colored outline for 10 seconds so
 *      you can visually confirm which one is creating the white strip.
 *
 * Usage:
 *   Open VinSolutions. Open the Brevmont panel. Right-click > Inspect >
 *   Console. Paste this whole file, press Enter. Read the printed table.
 *   Screenshot the console output + the outlined page.
 *
 * If `#brevmont-host.height` is large (e.g. 758 or matches the CRM panel),
 * the old 1.9.6/1.9.7 bundle is loaded — reload in chrome://extensions.
 *
 * If `#brevmont-host.height` is small (300-400px-ish) but the white strip
 * is still visible below it, the space is NOT Brevmont — it's VinSolutions'
 * own empty column area. In that case Brevmont has no legitimate element
 * to fix; it's a CRM layout reality.
 */
(function brevmontDebugPanelHeight() {
  const COLORS = ['#FF006E', '#3A86FF', '#FFBE0B', '#8338EC', '#06FFA5', '#FB5607'];
  const out = [];
  const host = document.getElementById('brevmont-host')
            || document.querySelector('[id*="brevmont"]');

  if (!host) {
    console.warn('[brevmont-debug] no #brevmont-host found on this page. Is the panel open?');
    return;
  }

  // Version lookup via manifest (works in extension context only; on the
  // host page we can't read manifest, but the content-script guard file
  // usually bakes in a hint somewhere).
  try {
    const v = (chrome && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest()) || null;
    if (v) console.log('[brevmont-debug] manifest version:', v.version, v.version_name);
  } catch { /* expected on page context */ }

  function describe(el, label) {
    if (!el) return { label, absent: true };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      label,
      tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: Math.round(r.height),
      width: Math.round(r.width),
      styleHeight: cs.height,
      styleMaxHeight: cs.maxHeight,
      styleMinHeight: cs.minHeight,
      styleDisplay: cs.display,
      styleOverflow: cs.overflow,
    };
  }

  out.push(describe(host, '#brevmont-host (shadow host)'));

  // Parent chain up to <html>
  let p = host.parentElement;
  let depth = 1;
  while (p && depth < 6) {
    out.push(describe(p, `parent[${depth}]`));
    p = p.parentElement;
    depth++;
  }

  // Inside the shadow root — this is the inner panel and its flex children.
  const sh = host.shadowRoot;
  if (sh) {
    const inner = sh.getElementById('o8');
    out.push(describe(inner, '#o8 (inner panel)'));
    if (inner) {
      Array.from(inner.children).forEach((c, i) => {
        out.push(describe(c, `  #o8 > child[${i}]`));
      });
      const outputs = sh.getElementById('o8-outputs');
      if (outputs) out.push(describe(outputs, '#o8-outputs'));
      // First visible tool panel, if any toggled
      const tools = sh.querySelectorAll('.tools-panel');
      tools.forEach((tp, i) => {
        const d = describe(tp, `.tools-panel[${i}] (${tp.id})`);
        if (getComputedStyle(tp).display !== 'none') out.push(d);
      });
    }
  } else {
    out.push({ note: 'shadow root not accessible (closed mode?). Host geometry alone is authoritative.' });
  }

  console.table(out);

  // Visual overlay — paint colored outlines for 10 seconds.
  const targets = [host];
  if (sh) {
    const inner = sh.getElementById('o8');
    if (inner) {
      targets.push(inner);
      Array.from(inner.children).forEach((c) => targets.push(c));
    }
  }
  targets.forEach((el, i) => {
    const c = COLORS[i % COLORS.length];
    const prev = el.style.outline;
    el.style.outline = `3px solid ${c}`;
    setTimeout(() => { el.style.outline = prev; }, 10000);
  });

  // Short summary
  const hostH = Math.round(host.getBoundingClientRect().height);
  console.log(
    `[brevmont-debug] host height = ${hostH}px. ` +
    `If this is >600 on an idle panel with no outputs, the 1.9.9 fix is NOT loaded — ` +
    `reload extension in chrome://extensions + Ctrl+Shift+R the page.`
  );
})();
