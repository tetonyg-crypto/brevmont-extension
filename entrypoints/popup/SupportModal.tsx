/**
 * Tool: SupportModal.tsx
 * Purpose: In-popup support ticket composer. Single compose screen — screenshot,
 *          breadcrumbs, version, and current URL are gathered silently in
 *          the background when the user clicks Send.
 * Last Updated: 2026-04-29
 *
 * COPY:
 *   All user-facing strings come from `lib/copy.ts` (`support` section),
 *   sourced from Atlas-Approved Copy V1 (§1). Do not hard-code copy here.
 *
 * STEP FLOW:
 *   compose: textarea + optional subject. Send → button shows "Sending"
 *            while we capture screenshot/breadcrumbs and POST.
 *   sent:    button shows "Message received"; full success copy renders.
 *   error:   submit failure (network/server) shows the V1 error message.
 *            Screenshot-only failure surfaces a separate notice but the
 *            ticket itself is still considered sent.
 *
 * BRAND DISCIPLINE:
 *   - Inter, no emoji, no em-dashes
 *   - Bone background, Charcoal text, Deep Teal CTA
 *   - Periods, commas. No exclamation points.
 *
 * GRACEFUL DEGRADATION:
 *   - Screenshot capture failure does NOT block submit (V1 §1.4 spec).
 *   - Network failure preserves the typed body and lets the rep retry.
 *   - 401 surfaces a session-expired hint (this isn't in V1 because it's
 *     a degenerate state that shouldn't reach a real customer; copy is
 *     internal-direct, not customer-facing voice).
 */

import { useRef, useState } from 'react';
import { addBreadcrumb, clearBreadcrumbs, getBreadcrumbs } from '../../lib/breadcrumbs';
import { redactObject, redactText } from '../../lib/redact';
import { captureScreenshot } from '../../lib/screenshot';
import { copy } from '../../lib/copy';

const PROXY_URL = 'https://oper8er-proxy-production.up.railway.app';

interface SupportModalProps {
  onClose: () => void;
  repAuthToken: string;
}

type Step = 'compose' | 'sending' | 'sent' | 'error';

const PALETTE = {
  bone: '#F8F6F1',
  charcoal: '#0F1419',
  deepTeal: '#0D6E6E',
  border: '#E5E7EB',
  textBody: '#1F2937',
  textMuted: '#6B7280',
};

const FONT = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export default function SupportModal({ onClose, repAuthToken }: SupportModalProps) {
  const [step, setStep] = useState<Step>('compose');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [screenshotMissing, setScreenshotMissing] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  async function send() {
    const trimmed = body.trim();
    if (trimmed.length < 10) {
      setBodyError('A bit more detail helps. Please describe what is happening.');
      bodyRef.current?.focus();
      return;
    }
    if (trimmed.length > 5000) {
      setBodyError('Please keep this under 5000 characters.');
      return;
    }
    setBodyError(null);

    setStep('sending');
    setSubmitError(null);
    setScreenshotMissing(false);

    // Gather context in parallel. Screenshot may fail; that does not block.
    const [shot, crumbs] = await Promise.all([captureScreenshot(), getBreadcrumbs()]);
    const screenshotDataUrl = shot.dataUrl;
    const screenshotFailed = !screenshotDataUrl;

    addBreadcrumb({
      category: 'state',
      message: 'support_modal_send',
      data: { has_screenshot: !screenshotFailed },
    }).catch(() => {});

    // Pull active tab URL right before submit. Failure → empty string.
    let url = '';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      url = tab?.url ? redactText(tab.url, ['ssn', 'phone', 'credit_card']) : '';
    } catch (_) {
      /* noop */
    }

    const manifest = chrome.runtime.getManifest();
    const payload: Record<string, unknown> = {
      subject: subject.trim() || undefined,
      body: redactText(trimmed),
      current_url: url,
      extension_version: manifest.version || '',
      user_agent: navigator.userAgent,
      breadcrumbs: redactObject(crumbs),
      screenshot_data_url: screenshotDataUrl || undefined,
    };

    try {
      const resp = await fetch(`${PROXY_URL}/v1/support/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${repAuthToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        // 401, 429, 5xx all collapse into the V1 error string. The rep is
        // told what to do next; we don't expose the status code in voice.
        setSubmitError(copy.support.errorSubmit);
        setStep('error');
        return;
      }
      // Success. The ticket landed even if the screenshot didn't.
      setScreenshotMissing(screenshotFailed);
      setStep('sent');
      clearBreadcrumbs().catch(() => {});
    } catch (_) {
      setSubmitError(copy.support.errorSubmit);
      setStep('error');
    }
  }

  if (step === 'sent') {
    return (
      <div
        style={{
          padding: 24,
          fontFamily: FONT,
          color: PALETTE.charcoal,
          background: PALETTE.bone,
          minHeight: 320,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{copy.support.sendSent}</h2>
        <p
          style={{
            fontSize: 14,
            color: PALETTE.textBody,
            lineHeight: 1.55,
            marginTop: 16,
          }}
        >
          {copy.support.successFull}
        </p>
        {screenshotMissing ? (
          <p
            style={{
              fontSize: 12,
              color: PALETTE.textMuted,
              lineHeight: 1.55,
              marginTop: 12,
            }}
          >
            {copy.support.errorScreenshot}
          </p>
        ) : null}
        <button
          onClick={onClose}
          style={{
            marginTop: 20,
            background: PALETTE.deepTeal,
            color: PALETTE.bone,
            border: 'none',
            padding: '10px 20px',
            borderRadius: 6,
            fontFamily: FONT,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {copy.generic.close}
        </button>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div
        style={{
          padding: 24,
          fontFamily: FONT,
          color: PALETTE.charcoal,
          background: PALETTE.bone,
          minHeight: 320,
        }}
      >
        <p
          style={{
            fontSize: 14,
            color: PALETTE.textBody,
            lineHeight: 1.55,
            margin: 0,
          }}
        >
          {submitError || copy.support.errorSubmit}
        </p>
        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          <button
            onClick={() => setStep('compose')}
            style={{
              background: PALETTE.deepTeal,
              color: PALETTE.bone,
              border: 'none',
              padding: '10px 20px',
              borderRadius: 6,
              fontFamily: FONT,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {copy.generic.retry}
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              color: PALETTE.charcoal,
              border: `1px solid ${PALETTE.border}`,
              padding: '10px 20px',
              borderRadius: 6,
              fontFamily: FONT,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {copy.generic.close}
          </button>
        </div>
      </div>
    );
  }

  // Compose (also rendered while sending; only the button label flips).
  const sending = step === 'sending';
  return (
    <div
      style={{
        padding: 24,
        fontFamily: FONT,
        color: PALETTE.charcoal,
        background: PALETTE.bone,
        minHeight: 320,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{copy.support.headline}</h2>
      <p style={{ fontSize: 13, color: PALETTE.textMuted, lineHeight: 1.55, marginTop: 8 }}>
        {copy.support.subhead}
      </p>

      <input
        type="text"
        placeholder={copy.support.subjectPlaceholder}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={200}
        disabled={sending}
        style={{
          width: '100%',
          marginTop: 16,
          padding: '8px 10px',
          fontSize: 13,
          fontFamily: FONT,
          background: '#fff',
          color: PALETTE.charcoal,
          border: `1px solid ${PALETTE.border}`,
          borderRadius: 6,
          boxSizing: 'border-box',
        }}
      />

      <textarea
        ref={bodyRef}
        placeholder={copy.support.bodyPlaceholder}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          if (bodyError) setBodyError(null);
        }}
        maxLength={5000}
        disabled={sending}
        style={{
          width: '100%',
          marginTop: 8,
          padding: '8px 10px',
          fontSize: 13,
          fontFamily: FONT,
          background: '#fff',
          color: PALETTE.charcoal,
          border: bodyError ? '1px solid #DC2626' : `1px solid ${PALETTE.border}`,
          borderRadius: 6,
          minHeight: 120,
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
        }}
      >
        {bodyError ? <span style={{ fontSize: 11, color: '#DC2626' }}>{bodyError}</span> : <span />}
        <span style={{ fontSize: 11, color: PALETTE.textMuted }}>{body.length}/5000</span>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
        <button
          onClick={send}
          disabled={sending}
          style={{
            background: PALETTE.deepTeal,
            color: PALETTE.bone,
            border: 'none',
            padding: '10px 20px',
            borderRadius: 6,
            fontFamily: FONT,
            fontWeight: 600,
            cursor: sending ? 'wait' : 'pointer',
            opacity: sending ? 0.7 : 1,
          }}
        >
          {sending ? copy.support.sendSending : copy.support.sendIdle}
        </button>
        <button
          onClick={onClose}
          disabled={sending}
          style={{
            background: 'transparent',
            color: PALETTE.charcoal,
            border: `1px solid ${PALETTE.border}`,
            padding: '10px 20px',
            borderRadius: 6,
            fontFamily: FONT,
            fontWeight: 600,
            cursor: sending ? 'wait' : 'pointer',
            opacity: sending ? 0.7 : 1,
          }}
        >
          {copy.generic.close}
        </button>
      </div>
    </div>
  );
}
