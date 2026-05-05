import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

type GenMode = 'all' | 'text' | 'email' | 'crm';

interface CustomerCtx {
  name?: string;
  vehicle?: string;
  url?: string;
  platform?: string;
  email?: string;
}

interface GenSection {
  text: string;
  email: string;
  crm: string;
  raw: string;
}

const PALETTE = {
  bone: '#F8F6F1',
  charcoal: '#0F1419',
  deepTeal: '#0D6E6E',
  border: '#E5E2DC',
  muted: '#6B7280',
};

function BrevmontSidePanel() {
  const [repName, setRepName] = useState('');
  const [dealershipName, setDealershipName] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [customerContext, setCustomerContext] = useState<CustomerCtx>({});
  const [platformHint, setPlatformHint] = useState('chrome_extension');
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [sections, setSections] = useState<GenSection | null>(null);
  const [rawOutput, setRawOutput] = useState('');
  const [genMode, setGenMode] = useState<GenMode>('all');
  const [history, setHistory] = useState<Array<{ id: string; summary: string; at: number }>>([]);
  const [error, setError] = useState('');
  const [copyFlash, setCopyFlash] = useState('');
  const recognitionRef = useRef<any>(null);

  const repInput = transcript.trim() || manualInput.trim();

  const loadIdentity = useCallback(async () => {
    const local = await browser.storage.local.get([
      'rep_name',
      'dealership',
      'dealer_token',
      'license_revoked',
    ]);
    const sync = await browser.storage.sync.get(['rep_name', 'dealership', 'dealer_token']);
    const token = (local.dealer_token as string) || (sync.dealer_token as string) || '';
    setHasToken(!!token && !local.license_revoked);
    setRepName((local.rep_name as string) || (sync.rep_name as string) || '');
    setDealershipName((local.dealership as string) || (sync.dealership as string) || '');
  }, []);

  useEffect(() => {
    void loadIdentity();
    const onStorage = () => void loadIdentity();
    browser.storage.onChanged.addListener(onStorage);

    const onMsg = (msg: any) => {
      if (msg?.type === 'CUSTOMER_CONTEXT' && msg.payload) {
        const p = msg.payload;
        setCustomerContext({
          name: p.name,
          vehicle: p.vehicle,
          url: p.url,
          platform: p.platform,
          email: p.email,
        });
        if (typeof p.platform === 'string') setPlatformHint(p.platform);
      }
    };
    browser.runtime.onMessage.addListener(onMsg);

    void browser.storage.session.get(['brevmont_customer_context']).then((s) => {
      const c = s.brevmont_customer_context as Record<string, unknown> | undefined;
      if (c && typeof c === 'object') {
        setCustomerContext({
          name: c.name as string | undefined,
          vehicle: c.vehicle as string | undefined,
          url: c.url as string | undefined,
          platform: c.platform as string | undefined,
        });
        if (typeof c.platform === 'string') setPlatformHint(c.platform);
      }
    });

    const poll = window.setInterval(() => {
      void browser.storage.session.get(['brevmont_customer_context']).then((s) => {
        const c = s.brevmont_customer_context as Record<string, unknown> | undefined;
        if (c?.platform) setPlatformHint(String(c.platform));
      });
    }, 2000);

    return () => {
      browser.storage.onChanged.removeListener(onStorage);
      browser.runtime.onMessage.removeListener(onMsg);
      window.clearInterval(poll);
    };
  }, [loadIdentity]);

  const startListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError('Voice input is not supported in this browser.');
      return;
    }
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = (e: any) => {
      setIsListening(false);
      setError(`Voice: ${e.error || 'error'}`);
    };
    recognition.onresult = (e: any) => {
      const t = Array.from(e.results as any[])
        .map((r: any) => r[0].transcript)
        .join('');
      setTranscript(t);
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopListening = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
    setIsListening(false);
  };

  const parseSections = (text: string) => {
    const textMatch = text.match(/(?:^|\n)TEXT(?:\s*MESSAGE)?\s*\n([\s\S]*?)(?=\n(?:EMAIL|CRM)|$)/i);
    const emailMatch = text.match(/(?:^|\n)EMAIL(?:\s*REPLY)?\s*\n([\s\S]*?)(?=\n(?:TEXT|CRM)|$)/i);
    const crmMatch = text.match(/(?:^|\n)CRM(?: NOTE)?\s*\n([\s\S]*)$/i);
    return {
      text: textMatch?.[1]?.trim() || '',
      email: emailMatch?.[1]?.trim() || '',
      crm: crmMatch?.[1]?.trim() || '',
      raw: text,
    };
  };

  const handleGenerate = async () => {
    if (!repInput) {
      setError('Add voice or text first.');
      return;
    }
    setIsGenerating(true);
    setError('');
    setSections(null);
    setRawOutput('');

    try {
      const localLead = await browser.storage.local.get(['brevmont_lead']);
      const lead = (localLead.brevmont_lead as Record<string, unknown>) || {};
      const customerName =
        (customerContext.name as string) ||
        (lead.customerName as string) ||
        '';
      const vehicle =
        (customerContext.vehicle as string) ||
        (lead.vehicle as string) ||
        null;

      const leadContext = {
        customerName: customerName || undefined,
        customerEmail: customerContext.email || (lead.email as string) || undefined,
        vehicle,
        phone: (lead.phone as string) || undefined,
        email: (lead.email as string) || undefined,
        source: (lead.source as string) || undefined,
        status: (lead.status as string) || undefined,
        lastContact: (lead.lastContact as string) || undefined,
      };

      const type: GenMode = genMode;
      const payload = {
        type,
        leadContext,
        repInput:
          repInput +
          (vehicle ? '' : '\n[SYSTEM: No vehicle of interest detected. Do not invent a vehicle.]'),
        repName: '',
        dealership: '',
        platform: platformHint || 'chrome_extension',
        metadata: {
          workflow_type: type === 'all' ? 'all' : type,
          customer_name: customerName || null,
          vehicle,
          email: leadContext.customerEmail || null,
        },
      };

      const response: any = await browser.runtime.sendMessage({
        type: 'GENERATE_OUTPUT',
        payload,
      });

      if (response?.queued) {
        setRawOutput(response.message || 'Queued for sync.');
        setSections(parseSections(response.message || ''));
      } else if (response?.error) {
        throw new Error(response.error);
      } else {
        const text = response?.text || '';
        const sec = response?.sections || parseSections(text);
        setSections(sec);
        setRawOutput(text);
        try {
          await browser.runtime.sendMessage({
            type: 'LOG_ACTION',
            payload: {
              action_type: 'GENERATE',
              platform: platformHint,
              customer: customerName || null,
              vehicle,
            },
          });
        } catch {
          /* noop */
        }
        setHistory((h) =>
          [
            {
              id: crypto.randomUUID(),
              summary: (sec.text || sec.email || sec.crm || text).slice(0, 120),
              at: Date.now(),
            },
            ...h,
          ].slice(0, 5)
        );
      }
    } catch (e: any) {
      setError(e?.message || 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async (label: string, t: string) => {
    if (!t) return;
    await navigator.clipboard.writeText(t);
    setCopyFlash(label);
    window.setTimeout(() => setCopyFlash(''), 1500);
    try {
      await browser.runtime.sendMessage({
        type: 'LOG_COPY',
        payload: { label: 'COPY', platform: platformHint, customer: customerContext.name },
      });
    } catch {
      /* noop */
    }
  };

  const handleInject = async (t: string) => {
    if (!t) return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await browser.tabs.sendMessage(tab.id, { type: 'BREVMONT_INJECT_TEXT', payload: t });
    try {
      await browser.runtime.sendMessage({
        type: 'LOG_ACTION',
        payload: {
          action_type: 'PASTE',
          platform: platformHint,
          customer: customerContext.name,
        },
      });
    } catch {
      /* noop */
    }
  };

  if (!hasToken) {
    return (
      <div style={{ ...base, padding: 24, textAlign: 'center', color: PALETTE.muted }}>
        <div style={{ fontWeight: 700, color: PALETTE.charcoal, marginBottom: 8 }}>Brevmont</div>
        <p style={{ fontSize: 13 }}>Complete extension setup to generate follow-ups.</p>
      </div>
    );
  }

  return (
    <div style={base}>
      <header
        style={{
          background: PALETTE.charcoal,
          color: PALETTE.bone,
          padding: '12px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 800, letterSpacing: '0.12em', fontSize: 11, color: PALETTE.deepTeal }}>
          BREVMONT
        </span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{repName || 'Rep'}</div>
          <div style={{ fontSize: 10, opacity: 0.75 }}>{dealershipName || 'Dealership'}</div>
        </div>
      </header>

      {(customerContext.name || customerContext.vehicle) && (
        <div
          style={{
            background: PALETTE.deepTeal,
            color: PALETTE.bone,
            padding: '8px 14px',
            fontSize: 12,
          }}
        >
          {customerContext.name && <span>{customerContext.name}</span>}
          {customerContext.vehicle && <span> · {customerContext.vehicle}</span>}
        </div>
      )}

      <div style={{ padding: '12px 14px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: `1px solid ${PALETTE.border}` }}>
        {(
          [
            ['all', 'All'],
            ['text', 'Text'],
            ['email', 'Email'],
            ['crm', 'CRM note'],
          ] as const
        ).map(([k, lab]) => (
          <button
            key={k}
            type="button"
            onClick={() => setGenMode(k)}
            style={{
              flex: 1,
              minWidth: 56,
              padding: '6px 4px',
              fontSize: 11,
              borderRadius: 6,
              border: `1px solid ${genMode === k ? PALETTE.deepTeal : PALETTE.border}`,
              background: genMode === k ? PALETTE.deepTeal : '#fff',
              color: genMode === k ? '#fff' : PALETTE.charcoal,
              cursor: 'pointer',
            }}
          >
            {lab}
          </button>
        ))}
      </div>

      <section style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          type="button"
          onClick={isListening ? stopListening : startListening}
          style={{
            padding: 12,
            borderRadius: 10,
            border: 'none',
            background: isListening ? '#b91c1c' : PALETTE.deepTeal,
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {isListening ? 'Stop mic' : 'Speak'}
        </button>
        {transcript ? (
          <div style={{ fontSize: 12, background: '#fff', border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 10, color: PALETTE.muted, textTransform: 'uppercase' }}>Transcript</div>
            <div>{transcript}</div>
          </div>
        ) : null}
        <textarea
          placeholder="Or describe the situation…"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          rows={3}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: 10,
            borderRadius: 8,
            border: `1px solid ${PALETTE.border}`,
            fontSize: 13,
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          disabled={isGenerating || !repInput}
          onClick={() => void handleGenerate()}
          style={{
            padding: 12,
            borderRadius: 10,
            border: 'none',
            background: PALETTE.charcoal,
            color: PALETTE.bone,
            fontWeight: 700,
            cursor: isGenerating ? 'wait' : 'pointer',
            opacity: !repInput ? 0.5 : 1,
          }}
        >
          {isGenerating ? 'Generating…' : 'Generate'}
        </button>
      </section>

      {error ? (
        <div style={{ margin: '0 14px', padding: 10, background: '#fee2e2', borderRadius: 8, fontSize: 12, color: '#991b1b' }}>
          {error}
        </div>
      ) : null}

      {(sections || rawOutput) && (
        <div
          style={{
            margin: '12px 14px',
            padding: 12,
            background: '#fff',
            borderRadius: 10,
            border: `1px solid ${PALETTE.deepTeal}`,
            fontSize: 13,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {genMode === 'all' || genMode === 'text' ? (
            <div style={{ marginBottom: sections?.text ? 10 : 0 }}>
              <div style={{ fontSize: 10, color: PALETTE.muted, marginBottom: 4 }}>TEXT</div>
              {sections?.text || (genMode === 'text' ? rawOutput : '')}
            </div>
          ) : null}
          {genMode === 'all' || genMode === 'email' ? (
            <div style={{ marginBottom: sections?.email ? 10 : 0 }}>
              <div style={{ fontSize: 10, color: PALETTE.muted, marginBottom: 4 }}>EMAIL</div>
              {sections?.email || (genMode === 'email' ? rawOutput : '')}
            </div>
          ) : null}
          {genMode === 'all' || genMode === 'crm' ? (
            <div>
              <div style={{ fontSize: 10, color: PALETTE.muted, marginBottom: 4 }}>CRM NOTE</div>
              {sections?.crm || (genMode === 'crm' ? rawOutput : '')}
            </div>
          ) : null}
          {genMode === 'all' && !sections?.text && !sections?.email && !sections?.crm ? rawOutput : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {sections?.text ? (
              <>
                <button
                  type="button"
                  style={btnSecondary}
                  onClick={() => void handleCopy('text', sections.text)}
                >
                  {copyFlash === 'text' ? 'Copied' : 'Copy text'}
                </button>
                <button type="button" style={btnSecondary} onClick={() => void handleInject(sections.text)}>
                  Insert text
                </button>
              </>
            ) : null}
            {sections?.email ? (
              <>
                <button
                  type="button"
                  style={btnSecondary}
                  onClick={() => void handleCopy('email', sections.email)}
                >
                  {copyFlash === 'email' ? 'Copied' : 'Copy email'}
                </button>
                <button type="button" style={btnSecondary} onClick={() => void handleInject(sections.email)}>
                  Insert email
                </button>
              </>
            ) : null}
            {sections?.crm ? (
              <>
                <button
                  type="button"
                  style={btnSecondary}
                  onClick={() => void handleCopy('crm', sections.crm)}
                >
                  {copyFlash === 'crm' ? 'Copied' : 'Copy note'}
                </button>
                <button type="button" style={btnSecondary} onClick={() => void handleInject(sections.crm)}>
                  Insert note
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}

      {history.length > 0 ? (
        <div style={{ padding: '0 14px 20px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: PALETTE.muted, marginBottom: 6 }}>RECENT</div>
          {history.map((h) => (
            <div
              key={h.id}
              style={{
                fontSize: 11,
                padding: 8,
                border: `1px solid ${PALETTE.border}`,
                borderRadius: 6,
                marginBottom: 6,
                background: '#fff',
              }}
            >
              {h.summary}…
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const base: CSSProperties = {
  fontFamily: 'Inter, system-ui, sans-serif',
  background: PALETTE.bone,
  minHeight: '100vh',
  margin: 0,
  color: PALETTE.charcoal,
};

const btnSecondary: CSSProperties = {
  padding: '6px 10px',
  fontSize: 11,
  borderRadius: 6,
  border: `1px solid ${PALETTE.deepTeal}`,
  background: PALETTE.deepTeal,
  color: '#fff',
  cursor: 'pointer',
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<BrevmontSidePanel />);
}
