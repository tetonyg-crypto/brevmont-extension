/**
 * VinSolutions DOM Discovery Script
 *
 * PURPOSE: Find the exact selectors for the CRM note/activity input field
 * so Brevmont can inject text directly instead of requiring copy-paste.
 *
 * HOW TO USE:
 * 1. Open VinSolutions in Chrome
 * 2. Navigate to a customer record (Customer Dashboard page)
 * 3. Click "Note" or open the activity/notes area (wherever you normally type CRM notes)
 * 4. Open Chrome DevTools (F12) → Console tab
 * 5. Paste this ENTIRE script into the console and press Enter
 * 6. Copy the FULL output and send it back
 *
 * The script scans ALL frames (including iframes) for writable fields.
 */

(function() {
  const results = {
    timestamp: new Date().toISOString(),
    pageUrl: window.location.href,
    frames: []
  };

  function scanFrame(doc, frameLabel) {
    const frameData = {
      label: frameLabel,
      url: doc.location?.href || 'unknown',
      textareas: [],
      contentEditables: [],
      inputs: [],
      iframes: [],
      noteRelatedElements: [],
      buttons: []
    };

    // 1. Find all textareas
    doc.querySelectorAll('textarea').forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      frameData.textareas.push({
        index: i,
        id: el.id || null,
        name: el.name || null,
        className: el.className || null,
        placeholder: el.placeholder || null,
        rows: el.rows,
        cols: el.cols,
        visible: rect.width > 0 && rect.height > 0,
        dimensions: `${rect.width}x${rect.height}`,
        parentId: el.parentElement?.id || null,
        parentClass: el.parentElement?.className?.slice(0, 100) || null,
        nearbyText: getNearbyText(el),
        selector: getUniqueSelector(el),
        readonly: el.readOnly,
        disabled: el.disabled,
        value: el.value?.slice(0, 50) || ''
      });
    });

    // 2. Find all contenteditable elements
    doc.querySelectorAll('[contenteditable="true"], [contenteditable=""]').forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      frameData.contentEditables.push({
        index: i,
        tag: el.tagName,
        id: el.id || null,
        className: el.className?.slice(0, 100) || null,
        visible: rect.width > 0 && rect.height > 0,
        dimensions: `${rect.width}x${rect.height}`,
        parentId: el.parentElement?.id || null,
        parentClass: el.parentElement?.className?.slice(0, 100) || null,
        nearbyText: getNearbyText(el),
        selector: getUniqueSelector(el),
        innerHTML: el.innerHTML?.slice(0, 100) || ''
      });
    });

    // 3. Find text inputs that might be note fields
    doc.querySelectorAll('input[type="text"], input:not([type])').forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 100) return; // Skip tiny inputs
      frameData.inputs.push({
        index: i,
        id: el.id || null,
        name: el.name || null,
        className: el.className?.slice(0, 100) || null,
        placeholder: el.placeholder || null,
        type: el.type,
        visible: rect.width > 0 && rect.height > 0,
        dimensions: `${rect.width}x${rect.height}`,
        nearbyText: getNearbyText(el),
        selector: getUniqueSelector(el)
      });
    });

    // 4. Find elements with note/activity-related text
    const noteKeywords = /note|activity|log|comment|remark|description|summary|detail/i;
    doc.querySelectorAll('label, legend, h1, h2, h3, h4, h5, h6, span, div, a, button, tab, [role="tab"]').forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length < 80 && noteKeywords.test(text)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          frameData.noteRelatedElements.push({
            tag: el.tagName,
            text: text.slice(0, 60),
            id: el.id || null,
            className: el.className?.slice(0, 80) || null,
            role: el.getAttribute('role') || null,
            href: el.href || null,
            selector: getUniqueSelector(el),
            dimensions: `${rect.width}x${rect.height}`
          });
        }
      }
    });

    // 5. Find buttons that might submit notes
    doc.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"], [onclick]').forEach(el => {
      const text = (el.textContent || el.value || '').trim();
      if (text && text.length < 40 && /save|submit|add|post|log|create|done|ok|send/i.test(text)) {
        frameData.buttons.push({
          tag: el.tagName,
          text: text.slice(0, 40),
          id: el.id || null,
          className: el.className?.slice(0, 80) || null,
          type: el.type || null,
          selector: getUniqueSelector(el)
        });
      }
    });

    // 6. Find iframes (for recursion report)
    doc.querySelectorAll('iframe').forEach((el, i) => {
      frameData.iframes.push({
        index: i,
        id: el.id || null,
        name: el.name || null,
        src: el.src?.slice(0, 150) || null,
        className: el.className?.slice(0, 80) || null,
        dimensions: `${el.width}x${el.height}`
      });
    });

    results.frames.push(frameData);

    // Recurse into same-origin iframes
    doc.querySelectorAll('iframe').forEach((iframe, i) => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          scanFrame(iframeDoc, `${frameLabel} > iframe[${i}]${iframe.id ? '#' + iframe.id : ''}${iframe.name ? '[name=' + iframe.name + ']' : ''}`);
        }
      } catch (e) {
        // Cross-origin iframe — can't access
        results.frames.push({
          label: `${frameLabel} > iframe[${i}] (CROSS-ORIGIN)`,
          url: iframe.src || 'unknown',
          error: 'Cannot access cross-origin iframe'
        });
      }
    });
  }

  function getNearbyText(el) {
    // Get text from parent and siblings to identify context
    const parent = el.parentElement;
    if (!parent) return '';
    const siblings = Array.from(parent.children);
    const texts = [];

    // Previous sibling text
    const prev = el.previousElementSibling;
    if (prev) texts.push('PREV: ' + (prev.textContent || '').trim().slice(0, 60));

    // Parent's direct text
    const parentText = Array.from(parent.childNodes)
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim())
      .filter(Boolean)
      .join(' ');
    if (parentText) texts.push('PARENT_TEXT: ' + parentText.slice(0, 60));

    // Labels pointing to this element
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) texts.push('LABEL: ' + label.textContent.trim().slice(0, 60));
    }

    // Closest heading
    let node = el;
    for (let i = 0; i < 5; i++) {
      node = node.parentElement;
      if (!node) break;
      const heading = node.querySelector('h1, h2, h3, h4, h5, h6, legend, .header, .title');
      if (heading) {
        texts.push('HEADING: ' + heading.textContent.trim().slice(0, 60));
        break;
      }
    }

    return texts.join(' | ');
  }

  function getUniqueSelector(el) {
    if (el.id) return '#' + el.id;

    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = '#' + current.id;
        path.unshift(selector);
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (classes) selector += '.' + classes;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(' > ');
  }

  // Start scan
  console.log('%c[Brevmont DOM Discovery] Scanning all frames...', 'color: #2563eb; font-weight: bold; font-size: 14px;');
  scanFrame(document, 'TOP');

  // Output
  const output = JSON.stringify(results, null, 2);
  console.log('%c[Brevmont DOM Discovery] COMPLETE — Copy everything below this line:', 'color: #16a34a; font-weight: bold; font-size: 14px;');
  console.log('=== OPER8ER_DOM_DISCOVERY_START ===');
  console.log(output);
  console.log('=== OPER8ER_DOM_DISCOVERY_END ===');

  // Also copy to clipboard if possible
  try {
    navigator.clipboard.writeText(output).then(() => {
      console.log('%c[Brevmont] Results copied to clipboard!', 'color: #16a34a; font-weight: bold;');
    }).catch(() => {
      console.log('%c[Brevmont] Could not auto-copy. Please select the JSON above and copy manually.', 'color: #f59e0b;');
    });
  } catch(e) {
    console.log('%c[Brevmont] Please select the JSON above and copy manually.', 'color: #f59e0b;');
  }

  // Quick summary
  let totalTextareas = 0, totalCE = 0, totalNoteElements = 0, totalButtons = 0;
  results.frames.forEach(f => {
    totalTextareas += (f.textareas || []).length;
    totalCE += (f.contentEditables || []).length;
    totalNoteElements += (f.noteRelatedElements || []).length;
    totalButtons += (f.buttons || []).length;
  });

  console.log('%c[Brevmont] SUMMARY:', 'color: #2563eb; font-weight: bold;');
  console.log(`  Frames scanned: ${results.frames.length}`);
  console.log(`  Textareas found: ${totalTextareas}`);
  console.log(`  ContentEditable elements: ${totalCE}`);
  console.log(`  Note-related elements: ${totalNoteElements}`);
  console.log(`  Submit-like buttons: ${totalButtons}`);

  if (totalTextareas === 0 && totalCE === 0) {
    console.log('%c  ⚠ No writable fields found! Make sure the Note/Activity form is OPEN before running this script.', 'color: #ef4444; font-weight: bold;');
  }
})();
