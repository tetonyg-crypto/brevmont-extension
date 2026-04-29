/**
 * Tool: SupportModal.tsx
 * Purpose: In-popup support ticket composer. Two steps — compose then review.
 *          Auto-attaches breadcrumbs, screenshot, extension version, current
 *          tab URL. Solves the "send me a screenshot" support friction
 *          (Lab Note 2026-04-29).
 * Last Updated: 2026-04-29
 *
 * STEP FLOW:
 *   compose: textarea + optional subject. "Continue" → screenshot capture
 *            kicked off in background.
 *   review:  thumbnail + breadcrumb count + "Send" → posts to
 *            /v1/support/tickets, shows "We have it." on success.
 *
 * BRAND DISCIPLINE:
 *   - Inter, no emoji, no em-dashes
 *   - Bone background, Charcoal text, Deep Teal CTA
 *   - Periods, commas. No exclamation points except "thanks."
 *
 * GRACEFUL DEGRADATION:
 *   - Screenshot failure does NOT block submit
 *   - Network failure shows retry, doesn't lose typed body
 *   - 401 surfaces "your session expired" copy
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { addBreadcrumb, clearBreadcrumbs, getBreadcrumbs, type Breadcrumb } from '../../lib/breadcrumbs';
import { redactObject, redactText } from '../../lib/redact';
import { captureScreenshot } from '../../lib/screenshot';

const PROXY_URL = 'https://oper8er-proxy-production.up.railway.app';

interface SupportModalProps {
  onClose: () => void;
  repAuthToken: string;
}

type Step = 'compose' | 'review' | 'sending' | 'sent' | 'error';

function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } | null {
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1];
  const bin = atob(m[2]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return { blob: new Blob([arr], { type: mime }), mime };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

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
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [screenshotBytes, setScreenshotBytes] = useState(0);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Capture screenshot + breadcrumb snapshot when transitioning compose → review.
  useEffect(() => {
    if (step !== 'review') return;
    let cancelled = false;
    (async () => {
      const [shot, crumbs] = await Promise.all([
        captureScreenshot(),
        getBreadcrumbs(),
      ]);
      if (cancelled) return;
      setScreenshotDataUrl(shot.dataUrl);
      setScreenshotBytes(shot.byteLength);
      setScreenshotError(shot.errorReason);
      setBreadcrumbs(crumbs);
      addBreadcrumb({
        category: 'state',
        message: 'support_modal_review',
        data: { has_screenshot: Boolean(shot.dataUrl) },
      }).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [step]);

  const currentUrl = useMemo(() => {
    // Best-effort: query the active tab from the popup. This is async but we
    // can run it once and stash. A failure just means current_url is empty.
    return '';
  }, []);

  // Validate + advance.
  function continueToReview() {
    const trimmed = body.trim();
    if (trimmed.length < 10) {
      setBodyError('A bit more context helps us help you faster. Aim for at least 10 characters.');
      bodyRef.current?.focus();
      return;
    }
    if (trimmed.length > 5000) {
      setBodyError('That is too long. Trim to 5000 characters or fewer.');
      return;
    }
    setBodyError(null);
    setStep('review');
  }

  async function submit() {
    setStep('sending');
    setSubmitError(null);

    // Redact client-side defense-in-depth.
    const redactedBody = redactText(body.trim());
    const redactedBreadcrumbs = redactObject(breadcrumbs);

    // Pull active tab URL right before submit.
    let url = '';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      url = tab?.url ? redactText(tab.url, ['ssn', 'phone', 'credit_card']) : '';
    } catch (_) { /* noop */ }

    const manifest = chrome.runtime.getManifest();
    const payload: Record<string, unknown> = {
      subject: subject.trim() || undefined,
      body: redactedBody,
      current_url: url,
      extension_version: manifest.version || '',
      user_agent: navigator.userAgent,
      breadcrumbs: redactedBreadcrumbs,
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
      if (resp.status === 401) {
        setSubmitError('Your session expired. Reload the popup and try again.');
        setStep('error');
        return;
      }
      if (resp.status === 429) {
        setSubmitError('That was a lot of tickets at once. Wait a moment and try again.');
        setStep('error');
        return;
      }
      if (!resp.ok) {
        setSubmitError(`Send failed (${resp.status}). Try again or text the founder.`);
        setStep('error');
        return;
      }
      const json = (await resp.json()) as { ticket_id?: string };
      setTicketId(json.ticket_id || null);
      setStep('sent');
      // Clear breadcrumbs so the next ticket starts clean.
      clearBreadcrumbs().catch(() => {});
    } catch (e: any) {
      setSubmitError('Network error. Try again or text the founder.');
      setStep('error');
    }
  }

  if (step === 'sent') {
    return (
      <div style={{ padding: 24, fontFamily: FONT, color: PALETTE.charcoal, background: PALETTE.bone, minHeight: 320 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>We have it.</h2>
        <p style={{ fontSize: 14, color: PALETTE.textBody, lineHeight: 1.5, marginTop: 12 }}>
          Yancy reads every one of these. We will reach out within a few hours.
        </p>
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
          Close
        </button>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div style={{ padding: 24, fontFamily: FONT, color: PALETTE.charcoal, background: PALETTE.bone, minHeight: 320 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>That did not go through.</h2>
        <p style={{ fontSize: 14, color: PALETTE.textBody, lineHeight: 1.5, marginTop: 12 }}>{submitError}</p>
        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          <button
            onClick={() => setStep('review')}
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
            Try again
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
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step === 'review' || step === 'sending') {
    return (
      <div style={{ padding: 24, fontFamily: FONT, color: PALETTE.charcoal, background: PALETTE.bone, minHeight: 320 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>One more look before we send.</h2>
        <p style={{ fontSize: 13, color: PALETTE.textMuted, lineHeight: 1.5, marginTop: 8 }}>
          We auto-attached your screen, your last few clicks, and your version info. Nothing else leaves your browser.
        </p>

        <div style={{ marginTop: 16, padding: 12, background: '#fff', border: `1px solid ${PALETTE.border}`, borderRadius: 6 }}>
          {subject ? (
            <div style={{ fontSize: 13, fontWeight: 600, color: PALETTE.charcoal, marginBottom: 8 }}>{subject}</div>
          ) : null}
          <div style={{ fontSize: 13, color: PALETTE.textBody, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>{body}</div>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: PALETTE.textMuted, lineHeight: 1.6 }}>
          <div>Screenshot: {screenshotDataUrl ? `attached (${formatBytes(screenshotBytes)})` : 'not attached'}{screenshotError ? ` (${screenshotError})` : ''}</div>
          <div>Breadcrumbs: {breadcrumbs.length} recent events</div>
          <div>Version: {chrome.runtime.getManifest().version}</div>
        </div>

        {screenshotDataUrl ? (
          <div style={{ marginTop: 12 }}>
            <img
              src={screenshotDataUrl}
              alt="Screenshot preview"
              style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 6, border: `1px solid ${PALETTE.border}` }}
            />
          </div>
        ) : null}

        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          <button
            onClick={submit}
            disabled={step === 'sending'}
            style={{
              background: PALETTE.deepTeal,
              color: PALETTE.bone,
              border: 'none',
              padding: '10px 20px',
              borderRadius: 6,
              fontFamily: FONT,
              fontWeight: 600,
              cursor: step === 'sending' ? 'wait' : 'pointer',
              opacity: step === 'sending' ? 0.7 : 1,
            }}
          >
            {step === 'sending' ? 'Sending...' : 'Send'}
          </button>
          <button
            onClick={() => setStep('compose')}
            disabled={step === 'sending'}
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
            Back
          </button>
        </div>
      </div>
    );
  }

  // Compose step
  return (
    <div style={{ padding: 24, fontFamily: FONT, color: PALETTE.charcoal, background: PALETTE.bone, minHeight: 320 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>How can we help?</h2>
      <p style={{ fontSize: 13, color: PALETTE.textMuted, lineHeight: 1.5, marginTop: 8 }}>
        Quick note on what is happening. We will see your screen and your recent activity automatically. A human reads every one.
      </p>

      <input
        type="text"
        placeholder="One-line summary (optional)"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={200}
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
        placeholder="What were you trying to do, and what happened instead?"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          if (bodyError) setBodyError(null);
        }}
        maxLength={5000}
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
          minHeight: 100,
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        {bodyError ? (
          <span style={{ fontSize: 11, color: '#DC2626' }}>{bodyError}</span>
        ) : (
          <span />
        )}
        <span style={{ fontSize: 11, color: PALETTE.textMuted }}>{body.length}/5000</span>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
        <button
          onClick={continueToReview}
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
          Continue
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
          Cancel
        </button>
      </div>
    </div>
  );
}
