import { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import SupportModal from './SupportModal';

interface PopupState {
  rep_name: string;
  dealership: string;
  dealer_token: string;
  rep_auth_token: string;
  extension_role: string;
}

const CRM_HOST_FRAGMENTS = [
  'vinsolutions.com',
  'coxautoinc.com',
  'mail.google.com',
  'facebook.com',
  'messenger.com',
  'linkedin.com',
  'instagram.com',
  'web.whatsapp.com',
];

function isManagerRole(role: string): boolean {
  return [
    'owner',
    'owner_principal',
    'gm',
    'manager_gm',
    'manager_used_car',
    'manager_new_car',
    'manager_internet',
    'manager_finance',
    'manager_bdc',
    'founder',
    'admin_founder',
    'manager',
  ].includes(role);
}

function isRepLike(role: string): boolean {
  return role === 'rep' || role === 'sales_rep';
}

function App() {
  const [settings, setSettings] = useState<PopupState>({
    rep_name: '',
    dealership: '',
    dealer_token: '',
    rep_auth_token: '',
    extension_role: 'rep',
  });
  const [queueSize, setQueueSize] = useState(0);
  const [version, setVersion] = useState('');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [supportOpen, setSupportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportHint, setReportHint] = useState('');
  const [isOnCrm, setIsOnCrm] = useState(false);
  const versionTapRef = useRef({ n: 0, t: 0 });

  async function loadQueueSize() {
    try {
      const r = (await browser.runtime.sendMessage({ type: 'GET_SYNC_QUEUE_COUNT' })) as { count?: number };
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
      const r = (await browser.runtime.sendMessage({
        type: 'SUPPORT_REPORT',
        payload: { note: '', tab_domain: tabDomain },
      })) as { ok?: boolean };
      setReportHint(r?.ok ? 'Report sent. We are on it.' : 'Could not send. Try again later.');
    } catch {
      setReportHint('Could not send. Try again later.');
    }
    setReportBusy(false);
  }

  useEffect(() => {
    const loadSettings = async () => {
      const local = (await browser.storage.local.get([
        'rep_name',
        'dealership',
        'dealer_token',
        'rep_auth_token',
        'brevmont_rep_auth_token',
        'brevmont_extension_role',
      ])) as Record<string, string>;
      const sync = (await browser.storage.sync.get(['rep_name', 'dealership', 'dealer_token', 'rep_auth_token'])) as Record<
        string,
        string
      >;
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      let onCrm = false;
      if (tab?.url) {
        try {
          const host = new URL(tab.url).hostname;
          onCrm = CRM_HOST_FRAGMENTS.some((f) => host.includes(f));
        } catch {
          onCrm = false;
        }
      }
      setIsOnCrm(onCrm);
      setSettings({
        rep_name: local.rep_name || sync.rep_name || '',
        dealership: local.dealership || sync.dealership || '',
        dealer_token: local.dealer_token || sync.dealer_token || '',
        rep_auth_token: local.brevmont_rep_auth_token || local.rep_auth_token || sync.rep_auth_token || '',
        extension_role: local.brevmont_extension_role || 'rep',
      });
    };
    void loadSettings();
    void loadQueueSize();

    const onChange = (changes: Record<string, unknown>, area: string) => {
      if (
        (area === 'local' || area === 'sync') &&
        ('rep_name' in changes ||
          'dealership' in changes ||
          'dealer_token' in changes ||
          'rep_auth_token' in changes ||
          'brevmont_rep_auth_token' in changes ||
          'brevmont_extension_role' in changes)
      ) {
        void loadSettings();
      }
      if (area === 'local') void loadQueueSize();
    };
    browser.storage.onChanged.addListener(onChange);

    const qTimer = window.setInterval(() => void loadQueueSize(), 15000);

    const manifest = browser.runtime.getManifest();
    setVersion(manifest.version || '');

    fetch('https://api.brevmont.com/health')
      .then((r) => setStatus(r.ok ? 'online' : 'offline'))
      .catch(() => setStatus('offline'));

    const onTabUpdated = () => void loadSettings();
    browser.tabs.onUpdated.addListener(onTabUpdated);
    browser.tabs.onActivated.addListener(onTabUpdated);

    return () => {
      try {
        browser.storage.onChanged.removeListener(onChange);
      } catch {
        /* noop */
      }
      window.clearInterval(qTimer);
      browser.tabs.onUpdated.removeListener(onTabUpdated);
      browser.tabs.onActivated.removeListener(onTabUpdated);
    };
  }, []);

  const copyToken = () => {
    if (settings.dealer_token) {
      void navigator.clipboard.writeText(settings.dealer_token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const maskToken = (token: string) => {
    if (!token || token.length < 8) return token || 'Not set';
    return token.slice(0, 6) + '...' + token.slice(-4);
  };

  /** Reps use many CRMs — open extension options (instructions / dealership CRM field), not a fixed host. */
  const openCrmSetupInstructions = () => {
    void browser.runtime.openOptionsPage();
    window.close();
  };

  const goToGmDashboard = () => {
    void browser.tabs.create({ url: 'https://app.brevmont.com/manager/overview' });
    window.close();
  };

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
    status === 'online' ? PALETTE.statusOk : status === 'offline' ? PALETTE.statusCrit : PALETTE.statusWarn;

  const authenticated = !!settings.dealer_token;
  const role = settings.extension_role || 'rep';
  const showGmLink = isManagerRole(role) && !isRepLike(role);

  if (supportOpen) {
    return <SupportModal onClose={() => setSupportOpen(false)} repAuthToken={settings.rep_auth_token} />;
  }

  if (!authenticated) {
    return (
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', background: PALETTE.bone }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '12px', borderBottom: `1px solid ${PALETTE.border}` }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: PALETTE.deepTeal, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: PALETTE.bone, fontWeight: 700, fontSize: 12 }}>b</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, color: PALETTE.charcoal, letterSpacing: '-0.02em' }}>brevmont</div>
        </div>
        <p style={{ fontSize: 13, color: PALETTE.textBody, lineHeight: '1.5', margin: 0 }}>Not activated yet.</p>
        <p style={{ fontSize: 12, color: PALETTE.textMuted, lineHeight: '1.5', margin: 0 }}>Ask your manager to send you an activation link, or open the activation page below.</p>
        <button
          type="button"
          onClick={() => {
            void browser.tabs.create({ url: 'https://app.brevmont.com/install' });
            window.close();
          }}
          style={{
            padding: '10px',
            borderRadius: 8,
            border: 'none',
            background: PALETTE.deepTeal,
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Open Activation Page
        </button>
        <a
          href="mailto:team@brevmont.com"
          style={{ fontSize: 11, color: PALETTE.textFaint, textDecoration: 'none', textAlign: 'center' }}
        >
          Need help? team@brevmont.com
        </a>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', background: PALETTE.bone }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '12px', borderBottom: `1px solid ${PALETTE.border}` }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: PALETTE.deepTeal,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ color: PALETTE.bone, fontWeight: 700, fontSize: 13, letterSpacing: '-0.02em' }}>b</span>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: PALETTE.charcoal, letterSpacing: '-0.02em' }}>brevmont</div>
          <div role="presentation" onClick={onVersionClick} style={{ fontSize: 11, color: PALETTE.textFaint, cursor: 'default', userSelect: 'none' }}>
            v{version}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
          <span style={{ fontSize: 11, color: PALETTE.textMuted }}>{status === 'checking' ? 'Checking' : status}</span>
        </div>
      </div>

      <div style={{ background: PALETTE.cardWhite, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: PALETTE.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
          Where you are
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: PALETTE.charcoal }}>
          {isOnCrm ? 'Supported CRM / messaging tab' : 'Outside CRM workspace'}
        </div>
        <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 6 }}>
          {isOnCrm
            ? 'Use the Brevmont sidebar on this page for voice + generation.'
            : 'Open your CRM (from Brevmont settings if needed) or your messaging tab, then look for the Brevmont sidebar.'}
        </div>
      </div>

      <div style={{ background: PALETTE.cardWhite, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: PALETTE.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
          Dealership
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: PALETTE.charcoal }}>{settings.dealership || 'Not configured'}</div>
      </div>

      <div style={{ background: PALETTE.cardWhite, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: PALETTE.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
          Rep
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: PALETTE.charcoal }}>{settings.rep_name || 'Not configured'}</div>
      </div>

      <div style={{ background: PALETTE.cardWhite, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: PALETTE.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
            License Key
          </div>
          <code style={{ fontSize: 12, color: PALETTE.deepTeal, fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace' }}>
            {maskToken(settings.dealer_token)}
          </code>
        </div>
        <button
          type="button"
          onClick={copyToken}
          style={{ background: 'none', border: 'none', fontSize: 11, color: PALETTE.deepTeal, cursor: 'pointer', fontWeight: 600 }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {queueSize > 0 && (
        <div
          style={{
            background: PALETTE.statusWarnBg,
            border: `1px solid ${PALETTE.statusWarnBorder}`,
            borderRadius: 8,
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: PALETTE.statusWarn, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: PALETTE.charcoal }}>
              {queueSize} queued generation{queueSize > 1 ? 's' : ''}
            </div>
            <div style={{ fontSize: 11, color: PALETTE.textBody }}>Will send when connection returns.</div>
          </div>
        </div>
      )}

      {!isOnCrm && (
        <button
          type="button"
          onClick={openCrmSetupInstructions}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: 8,
            border: `1px solid ${PALETTE.border}`,
            background: '#fff',
            color: PALETTE.charcoal,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          CRM setup
        </button>
      )}

      {showGmLink && (
        <button
          type="button"
          onClick={goToGmDashboard}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: 8,
            border: `1px solid ${PALETTE.border}`,
            background: PALETTE.cardWhite,
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          GM dashboard
        </button>
      )}

      {reportHint && <div style={{ fontSize: 11, color: PALETTE.textBody, textAlign: 'center' }}>{reportHint}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: `1px solid ${PALETTE.border}` }}>
        <a href="https://app.brevmont.com/changelog" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: PALETTE.textMuted, textDecoration: 'none' }}>
          Changelog
        </a>
        <button
          type="button"
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
        <a href="mailto:team@brevmont.com" style={{ fontSize: 12, color: PALETTE.textMuted, textDecoration: 'none' }}>
          Or email team@brevmont.com
        </a>
      </div>

      <div style={{ textAlign: 'center', paddingTop: 8, borderTop: `1px solid ${PALETTE.border}` }}>
        <span style={{ fontSize: 10, color: PALETTE.textFaint }}>Brevmont Labs LLC, brevmont.com</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
