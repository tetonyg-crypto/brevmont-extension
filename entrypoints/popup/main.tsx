import { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import SupportModal from './SupportModal';
import {
  TRIAL_ENDED_BODY,
  TRIAL_ENDED_CTA,
  TRIAL_ENDED_TITLE,
} from '../../lib/accessState';

interface PopupState {
  rep_name: string;
  rep_email: string;
  dealership: string;
  dealer_token: string;
  rep_auth_token: string;
  extension_role: string;
  tier: string;
  license_revoked: boolean;
  license_access_state: string;
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
    rep_email: '',
    dealership: '',
    dealer_token: '',
    rep_auth_token: '',
    extension_role: 'rep',
    tier: 'Free',
    license_revoked: false,
    license_access_state: '',
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
      try {
        await browser.runtime.sendMessage({ type: 'SYNC_AUTH_FROM_COOKIE' });
      } catch {
        /* service worker may be waking; storage fallback below still renders */
      }
      const local = (await browser.storage.local.get([
        'rep_name',
        'rep_email',
        'dealership',
        'dealer_token',
        'rep_auth_token',
        'brevmont_rep_auth_token',
        'brevmont_extension_role',
        'brevmont_tier',
        'dealership_tier',
        'dealership_plan',
        'license_revoked',
        'license_access_state',
      ])) as Record<string, string>;
      const sync = (await browser.storage.sync.get(['rep_name', 'dealership'])) as Record<
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
        rep_email: local.rep_email || '',
        dealership: local.dealership || sync.dealership || '',
        dealer_token: local.dealer_token || sync.dealer_token || '',
        rep_auth_token: local.brevmont_rep_auth_token || local.rep_auth_token || sync.rep_auth_token || '',
        extension_role: local.brevmont_extension_role || 'rep',
        tier: local.brevmont_tier || local.dealership_tier || local.dealership_plan || 'Free',
        license_revoked: !!local.license_revoked,
        license_access_state: local.license_access_state || '',
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
          'brevmont_extension_role' in changes ||
          'license_revoked' in changes ||
          'license_access_state' in changes)
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

  const displayTier = (tier: string) => {
    const value = String(tier || 'free').replace(/[_-]+/g, ' ').trim();
    return value ? value.replace(/\b\w/g, (ch) => ch.toUpperCase()) : 'Free';
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

  const notifyGm = () => {
    void browser.tabs.create({
      url: 'mailto:?subject=Activate%20Brevmont%20pilot&body=Our%207-day%20Brevmont%20trial%20ended.%20Can%20you%20activate%20the%20pilot%20so%20we%20can%20reopen%20access%3F',
    });
    window.close();
  };

  const openGoogleActivation = () => {
    void browser.tabs.create({ url: 'https://app.brevmont.com/auth/extension' });
    window.close();
  };

  const openManualSetup = () => {
    void browser.tabs.create({ url: browser.runtime.getURL('onboarding.html?manual=1') });
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

  const authenticated = !!(settings.dealer_token || settings.rep_auth_token);
  const role = settings.extension_role || 'rep';
  const showGmLink = isManagerRole(role) && !isRepLike(role);
  const trialEnded = settings.license_revoked && settings.license_access_state === 'trial_ended';

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
        <p style={{ fontSize: 13, color: PALETTE.textBody, lineHeight: '1.5', margin: 0, fontWeight: 700 }}>Sign in to activate Brevmont.</p>
        <p style={{ fontSize: 12, color: PALETTE.textMuted, lineHeight: '1.5', margin: 0 }}>Use your dealership Google account. Brevmont finds your store and activates the extension automatically.</p>
        <button
          type="button"
          onClick={openGoogleActivation}
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
          Continue with Google
        </button>
        <button
          type="button"
          onClick={openManualSetup}
          style={{
            border: 'none',
            background: 'transparent',
            color: PALETTE.textMuted,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          Trouble activating? Try manual setup
        </button>
        <a
          href="mailto:founder@brevmont.com"
          style={{ fontSize: 11, color: PALETTE.textFaint, textDecoration: 'none', textAlign: 'center' }}
        >
          Need help? founder@brevmont.com
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

      {trialEnded && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B', marginBottom: 4 }}>{TRIAL_ENDED_TITLE}</div>
          <div style={{ fontSize: 12, color: '#991B1B', lineHeight: '1.45', marginBottom: 10 }}>{TRIAL_ENDED_BODY}</div>
          <button
            type="button"
            onClick={notifyGm}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              border: 'none',
              background: PALETTE.deepTeal,
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {TRIAL_ENDED_CTA}
          </button>
        </div>
      )}

      <div style={{ background: PALETTE.cardWhite, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: PALETTE.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
          Where you are
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: PALETTE.charcoal }}>
          {isOnCrm ? 'Supported CRM / messaging tab' : 'Outside CRM workspace'}
        </div>
        <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 6 }}>
          {isOnCrm
            ? 'Use the Brevmont sidebar on this page for voice + follow-ups.'
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
        {settings.rep_email && <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 4 }}>{settings.rep_email}</div>}
      </div>

      <div style={{ background: PALETTE.cardWhite, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: PALETTE.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
          Tier
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: PALETTE.charcoal }}>{displayTier(settings.tier)}</div>
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
              {queueSize} queued follow-up{queueSize > 1 ? 's' : ''}
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
        <a href="mailto:founder@brevmont.com" style={{ fontSize: 12, color: PALETTE.textMuted, textDecoration: 'none' }}>
          Or email founder@brevmont.com
        </a>
      </div>

      <div style={{ textAlign: 'center', paddingTop: 8, borderTop: `1px solid ${PALETTE.border}` }}>
        <span style={{ fontSize: 10, color: PALETTE.textFaint }}>Brevmont Labs LLC, brevmont.com</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
