import { useState, useEffect, useRef } from 'react';
import SupportModal from './SupportModal';

interface Settings {
  rep_name: string;
  dealership: string;
  dealer_token: string;
  rep_auth_token: string;
}

function App() {
  const [settings, setSettings] = useState<Settings>({ rep_name: '', dealership: '', dealer_token: '', rep_auth_token: '' });
  const [queueSize, setQueueSize] = useState(0);
  const [version, setVersion] = useState('');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [supportOpen, setSupportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportHint, setReportHint] = useState('');
  const versionTapRef = useRef({ n: 0, t: 0 });

  async function loadQueueSize() {
    try {
      const r = await browser.runtime.sendMessage({ type: 'GET_SYNC_QUEUE_COUNT' }) as { count?: number };
      setQueueSize(typeof r?.count === 'number' ? r.count : 0);
    } catch {
      setQueueSize(0);
    }
  }

  function onVersionClick() {
    const now = Date.now();
    if (now - versionTapRef.current.t > 3000) versionTapRef.current.n = 0;
    versionTapRef.current.t = now;
    versionTapRef.current.n += 1;
    if (versionTapRef.current.n >= 5) {
      versionTapRef.current.n = 0;
      void (async () => {
        await browser.storage.local.clear();
        await browser.storage.session.clear();
        await browser.storage.sync.clear();
        const { retryDB } = await import('../../lib/retryQueue');
        await retryDB.delete();
        browser.runtime.reload();
      })();
    }
  }

  async function sendQuickReport() {
    setReportBusy(true);
    setReportHint('');
    let tabDomain: string | null = null;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        try {
          tabDomain = new URL(tab.url).hostname;
        } catch {
          tabDomain = null;
        }
      }
    } catch {
      tabDomain = null;
    }
    try {
      const r = await browser.runtime.sendMessage({
        type: 'SUPPORT_REPORT',
        payload: { note: '', tab_domain: tabDomain },
      }) as { ok?: boolean };
      setReportHint(r?.ok ? 'Report sent. We are on it.' : 'Could not send. Try again later.');
    } catch {
      setReportHint('Could not send. Try again later.');
    }
    setReportBusy(false);
  }

  useEffect(() => {
    // Load settings — prefer local (no sync-replication lag), fall back to sync
    // for users onboarded on another device. Both buckets are checked so the
    // popup shows rep identity instantly after onboarding.
    const loadSettings = async () => {
      const local = await browser.storage.local.get(['rep_name', 'dealership', 'dealer_token', 'rep_auth_token', 'brevmont_rep_auth_token']) as any;
      const sync = await browser.storage.sync.get(['rep_name', 'dealership', 'dealer_token', 'rep_auth_token']) as any;
      setSettings({
        rep_name: local.rep_name || sync.rep_name || '',
        dealership: local.dealership || sync.dealership || '',
        dealer_token: local.dealer_token || sync.dealer_token || '',
        rep_auth_token: local.brevmont_rep_auth_token || local.rep_auth_token || sync.rep_auth_token || '',
      });
    };
    loadSettings();
    void loadQueueSize();

    // Live-update when onboarding finishes (or when a manager rotates tokens).
    const onChange = (changes: any, area: string) => {
      if ((area === 'local' || area === 'sync') && ('rep_name' in changes || 'dealership' in changes || 'dealer_token' in changes || 'rep_auth_token' in changes || 'brevmont_rep_auth_token' in changes)) {
        loadSettings();
      }
      if (area === 'local') {
        void loadQueueSize();
      }
    };
    browser.storage.onChanged.addListener(onChange);

    const qTimer = window.setInterval(() => void loadQueueSize(), 15000);

    // Get version
    const manifest = browser.runtime.getManifest();
    setVersion(manifest.version || '');

    // Check connectivity
    fetch('https://api.brevmont.com/health')
      .then(r => setStatus(r.ok ? 'online' : 'offline'))
      .catch(() => setStatus('offline'));

    return () => {
      try { browser.storage.onChanged.removeListener(onChange); } catch (_) { /* noop */ }
      window.clearInterval(qTimer);
    };
  }, []);

  const copyToken = () => {
    if (settings.dealer_token) {
      navigator.clipboard.writeText(settings.dealer_token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const maskToken = (token: string) => {
    if (!token || token.length < 8) return token || 'Not set';
    return token.slice(0, 6) + '...' + token.slice(-4);
  };

  // Brand-locked palette per brevmont-vault/brand/BRAND.md.
  // Light surface: Bone background, Charcoal text, Deep Teal accent.
  // Status colors per design-system.md §1.6.
  const PALETTE = {
    bone: '#F8F6F1',
    charcoal: '#0F1419',
    deepTeal: '#0D6E6E',
    cardWhite: '#FFFFFF',
    border: '#E5E7EB',
    textBody: '#1F2937',
    textMuted: '#6B7280',
    textFaint: '#9CA3AF',
    statusOk: '#22C55E',
    statusWarn: '#F59E0B',
    statusCrit: '#EF4444',
    statusWarnBg: '#FEF3C7',
    statusWarnBorder: '#F59E0B',
  };

  const statusColor =
    status === 'online' ? PALETTE.statusOk :
    status === 'offline' ? PALETTE.statusCrit :
    PALETTE.statusWarn;

  // Support modal takes over the popup when open. Reps don't need
  // dealership-info chrome while they're typing a ticket; surfacing it
  // would just compete for attention.
  if (supportOpen) {
    return <SupportModal onClose={() => setSupportOpen(false)} repAuthToken={settings.rep_auth_token} />;
  }

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', background: PALETTE.bone }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '12px', borderBottom: `1px solid ${PALETTE.border}` }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: PALETTE.deepTeal, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: PALETTE.bone, fontWeight: 700, fontSize: 13, letterSpacing: '-0.02em' }}>b</span>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: PALETTE.charcoal, letterSpacing: '-0.02em' }}>brevmont</div>
          <div
            role="presentation"
            onClick={onVersionClick}
            style={{ fontSize: 11, color: PALETTE.textFaint, cursor: 'default', userSelect: 'none' }}
          >
            v{version}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
          <span style={{ fontSize: 11, color: PALETTE.textMuted }}>{status === 'checking' ? 'Checking' : status}</span>
        </div>
      </div>

      {/* Dealership */}
      <div style={{ background: PALETTE.cardWhite, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: PALETTE.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Dealership</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: PALETTE.charcoal }}>{settings.dealership || 'Not configured'}</div>
      </div>

      {/* Rep */}
      <div style={{ background: PALETTE.cardWhite, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: PALETTE.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Rep</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: PALETTE.charcoal }}>{settings.rep_name || 'Not configured'}</div>
      </div>

      {/* License Key */}
      <div style={{ background: PALETTE.cardWhite, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: PALETTE.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>License Key</div>
          <code style={{ fontSize: 12, color: PALETTE.deepTeal, fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace' }}>{maskToken(settings.dealer_token)}</code>
        </div>
        <button
          onClick={copyToken}
          style={{ background: 'none', border: 'none', fontSize: 11, color: PALETTE.deepTeal, cursor: 'pointer', fontWeight: 600 }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Queue Status */}
      {queueSize > 0 && (
        <div style={{ background: PALETTE.statusWarnBg, border: `1px solid ${PALETTE.statusWarnBorder}`, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: PALETTE.statusWarn, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: PALETTE.charcoal }}>Syncing {queueSize} item{queueSize > 1 ? 's' : ''}...</div>
            <div style={{ fontSize: 11, color: PALETTE.textBody }}>Will send when connection returns.</div>
          </div>
        </div>
      )}

      {reportHint && (
        <div style={{ fontSize: 11, color: PALETTE.textBody, textAlign: 'center' }}>{reportHint}</div>
      )}

      {/* Links */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: `1px solid ${PALETTE.border}` }}>
        <a
          href="https://app.brevmont.com/owner"
          target="_blank"
          rel="noopener"
          style={{ fontSize: 12, color: PALETTE.deepTeal, textDecoration: 'none', fontWeight: 500 }}
        >
          Open Dashboard
        </a>
        <a
          href="https://app.brevmont.com/changelog"
          target="_blank"
          rel="noopener"
          style={{ fontSize: 12, color: PALETTE.textMuted, textDecoration: 'none' }}
        >
          Changelog
        </a>
        <button
          onClick={() => setSupportOpen(true)}
          style={{
            fontSize: 12,
            color: PALETTE.deepTeal,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
            fontWeight: 500,
            fontFamily: 'inherit',
          }}
        >
          Get help
        </button>
        <button
          type="button"
          disabled={reportBusy}
          onClick={() => void sendQuickReport()}
          style={{
            fontSize: 12,
            color: PALETTE.deepTeal,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: reportBusy ? 'wait' : 'pointer',
            textAlign: 'left',
            fontWeight: 500,
            fontFamily: 'inherit',
            opacity: reportBusy ? 0.6 : 1,
          }}
        >
          Report issue
        </button>
        <a
          href="mailto:founder@brevmont.com"
          style={{ fontSize: 12, color: PALETTE.textMuted, textDecoration: 'none' }}
        >
          Or email founder@brevmont.com
        </a>
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', paddingTop: 8, borderTop: `1px solid ${PALETTE.border}` }}>
        <span style={{ fontSize: 10, color: PALETTE.textFaint }}>Brevmont Labs LLC, brevmont.com</span>
      </div>
    </div>
  );
}

export default App;
