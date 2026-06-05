type LeadFormAutofillPayload = {
  requestId?: string;
  prospectId?: string;
  dealership?: string;
  targetUrl?: string;
  rootUrl?: string;
  message?: string;
  queuedAt?: number;
};

const AUTOFILL_KEY = 'brevmont_lead_form_autofill';
const STATUS_KEY = 'brevmont_lead_form_autofill_status';
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: false,
  runAt: 'document_idle',
  main() {
    void maybeFillLeadForm();
  },
});

async function maybeFillLeadForm() {
  const pending = await readPendingPayload();
  if (!pending || !pending.message || !pending.queuedAt) return;
  if (Date.now() - pending.queuedAt > TWO_HOURS_MS) return;
  if (!matchesPendingTarget(pending, window.location.href)) return;

  const result = fillVisibleForm(pending.message);
  if (result.filledCount === 0) return;

  await browser.storage.local.set({
    [STATUS_KEY]: {
      requestId: pending.requestId || '',
      prospectId: pending.prospectId || '',
      dealership: pending.dealership || '',
      url: window.location.href,
      filledCount: result.filledCount,
      fieldCount: result.fieldCount,
      filledAt: Date.now(),
    },
  });
  showFilledNotice(result.filledCount, pending.dealership || '');
}

async function readPendingPayload(): Promise<LeadFormAutofillPayload | null> {
  try {
    const stored = await browser.storage.local.get(AUTOFILL_KEY);
    const payload = stored[AUTOFILL_KEY] as LeadFormAutofillPayload | undefined;
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function matchesPendingTarget(payload: LeadFormAutofillPayload, currentHref: string) {
  const current = safeUrl(currentHref);
  if (!current || /(^|\.)brevmont\.com$/i.test(current.hostname)) return false;
  const targets = [payload.targetUrl, payload.rootUrl].map(safeUrl).filter(Boolean) as URL[];
  if (targets.length === 0) return false;
  return targets.some((target) => hostMatches(current.hostname, target.hostname));
}

function safeUrl(value?: string | null) {
  if (!value) return null;
  try {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(normalized);
  } catch {
    return null;
  }
}

function hostMatches(currentHost: string, targetHost: string) {
  const current = currentHost.replace(/^www\./i, '').toLowerCase();
  const target = targetHost.replace(/^www\./i, '').toLowerCase();
  return current === target || current.endsWith(`.${target}`) || target.endsWith(`.${current}`);
}

function fillVisibleForm(message: string) {
  const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')].filter(isVisibleField);
  let filledCount = 0;
  for (const field of fields) {
    const label = fieldLabel(field);
    const type = (field instanceof HTMLInputElement ? field.type : '').toLowerCase();
    if (type === 'hidden' || type === 'file' || type === 'submit' || type === 'button') continue;

    if (field instanceof HTMLInputElement && (type === 'checkbox' || type === 'radio')) {
      if (/agree|consent|contact|privacy|terms|email|phone|text/i.test(label)) {
        field.checked = true;
        dispatchFieldEvents(field);
        filledCount += 1;
      }
      continue;
    }

    const value = valueForField(field, label, message);
    if (!value) continue;
    setFieldValue(field, value);
    filledCount += 1;
  }
  return { fieldCount: fields.length, filledCount };
}

function isVisibleField(field: HTMLElement) {
  const style = window.getComputedStyle(field);
  const rect = field.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 2 && rect.height > 2 && !field.hasAttribute('disabled');
}

function fieldLabel(field: HTMLElement) {
  const id = field.getAttribute('id') || '';
  const explicitLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || '' : '';
  return [
    field.getAttribute('name'),
    id,
    field.getAttribute('placeholder'),
    field.getAttribute('aria-label'),
    field.getAttribute('title'),
    explicitLabel,
    field.closest('label')?.textContent,
    field.parentElement?.textContent,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function valueForField(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, label: string, message: string) {
  const type = field instanceof HTMLInputElement ? field.type.toLowerCase() : '';
  if (field instanceof HTMLTextAreaElement || /comment|message|question|note|details|additional|request/.test(label)) return message;
  if (/first/.test(label) && /name/.test(label)) return 'Yancy';
  if (/last/.test(label) && /name/.test(label)) return 'Garcia';
  if (/full.?name|your name|contact name|name/.test(label)) return 'Yancy Garcia';
  if (/email|e-mail/.test(label) || type === 'email') return 'founder@brevmont.com';
  if (/phone|mobile|cell|tel/.test(label) || type === 'tel') return '307-690-0291';
  if (/company|business|organization|dealership/.test(label)) return 'Brevmont Labs';
  if (field instanceof HTMLSelectElement && /contact/.test(label)) return selectOptionValue(field, /email/i);
  return '';
}

function selectOptionValue(field: HTMLSelectElement, pattern: RegExp) {
  const option = [...field.options].find((item) => pattern.test(item.textContent || '') || pattern.test(item.value || ''));
  return option?.value || '';
}

function setFieldValue(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  field.focus();
  field.value = value;
  dispatchFieldEvents(field);
}

function dispatchFieldEvents(field: HTMLElement) {
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function showFilledNotice(filledCount: number, dealership: string) {
  const existing = document.getElementById('brevmont-lead-form-autofill-notice');
  if (existing) existing.remove();
  const notice = document.createElement('div');
  notice.id = 'brevmont-lead-form-autofill-notice';
  notice.textContent = `Brevmont filled ${filledCount} fields${dealership ? ` for ${dealership}` : ''}. Review, handle CAPTCHA if present, then submit.`;
  Object.assign(notice.style, {
    position: 'fixed',
    zIndex: '2147483647',
    right: '18px',
    top: '18px',
    maxWidth: '360px',
    padding: '12px 14px',
    borderRadius: '10px',
    background: '#0b1613',
    color: '#ecfdf5',
    border: '1px solid rgba(167, 243, 208, 0.45)',
    boxShadow: '0 18px 48px rgba(0,0,0,0.32)',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: '13px',
    lineHeight: '1.4',
  });
  document.documentElement.appendChild(notice);
  window.setTimeout(() => notice.remove(), 9000);
}
