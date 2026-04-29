import { useState, useEffect } from 'react';
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

    // Live-update when onboarding finishes (or when a manager rotates tokens).
    const onChange = (changes: any, area: string) => {
      if ((area === 'local' || area === 'sync') && ('rep_name' in changes || 'dealership' in changes || 'dealer_token' in changes || 'rep_auth_token' in changes || 'brevmont_rep_auth_token' in changes)) {
        loadSettings();
      }
    };
    browser.storage.onChanged.addListener(onChange);

    // Load offline queue size
    browser.storage.local.get('brevmont_offline_queue').then((data: any) => {
      const queue = data.brevmont_offline_queue || [];
      setQueueSize(queue.length);
    });

    // Get version
    const manifest = browser.runtime.getManifest();
    setVersion(manifest.version || '');

    // Check connectivity
    fetch('https://oper8er-proxy-production.up.railway.app/health')
      .then(r => setStatus(r.ok ? 'online' : 'offline'))
      .catch(() => setStatus('offline'));

    return () => {
      try { browser.storage.onChanged.removeListener(onChange); } catch (_) { /* noop */ }
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

  const statusColor = status === 'online' ? '#34C759' : status === 'offline' ? '#FF3B30' : '#FF9500';

  // Support modal takes over the popup when open. Reps don't need
  // dealership-info chrome while they're typing a ticket; surfacing it
  // would just compete for attention.
  if (supportOpen) {
    return <SupportModal onClose={() => setSupportOpen(false)} repAuthToken={settings.rep_auth_token} />;
  }

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '12px', borderBottom: '1px solid #E5E7EB' }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#0D6E6E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>BM</span>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1C1C1E' }}>Brevmont</div>
          <div style={{ fontSize: 11, color: '#AEAEB2' }}>v{version}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
          <span style={{ fontSize: 11, color: '#636366' }}>{status === 'checking' ? 'Checking...' : status}</span>
        </div>
      </div>

      {/* Dealership Info */}
      <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Dealership</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1C1C1E' }}>{settings.dealership || 'Not configured'}</div>
      </div>

      {/* Rep Info */}
      <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Rep</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1C1C1E' }}>{settings.rep_name || 'Not configured'}</div>
      </div>

      {/* License Key */}
      <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>License Key</div>
          <code style={{ fontSize: 12, color: '#0D6E6E', fontFamily: 'monospace' }}>{maskToken(settings.dealer_token)}</code>
        </div>
        <button
          onClick={copyToken}
          style={{ background: 'none', border: 'none', fontSize: 11, color: '#0D6E6E', cursor: 'pointer', fontWeight: 600 }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Queue Status */}
      {queueSize > 0 && (
        <div style={{ background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>&#9888;</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#C2410C' }}>{queueSize} queued generation{queueSize > 1 ? 's' : ''}</div>
            <div style={{ fontSize: 11, color: '#EA580C' }}>Will send when connection returns</div>
          </div>
        </div>
      )}

      {/* Links */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid #E5E7EB' }}>
        <a
          href="https://app.brevmont.com/owner"
          target="_blank"
          rel="noopener"
          style={{ fontSize: 12, color: '#0D6E6E', textDecoration: 'none', fontWeight: 500 }}
        >
          Open Dashboard &rarr;
        </a>
        <a
          href="https://app.brevmont.com/changelog"
          target="_blank"
          rel="noopener"
          style={{ fontSize: 12, color: '#636366', textDecoration: 'none' }}
        >
          Changelog
        </a>
        <button
          onClick={() => setSupportOpen(true)}
          style={{
            fontSize: 12,
            color: '#0D6E6E',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
            fontWeight: 500,
            fontFamily: 'inherit',
          }}
        >
          Get help &rarr;
        </button>
        <a
          href="mailto:founder@brevmont.com"
          style={{ fontSize: 12, color: '#636366', textDecoration: 'none' }}
        >
          Or email: founder@brevmont.com
        </a>
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', paddingTop: 8, borderTop: '1px solid #E5E7EB' }}>
        <span style={{ fontSize: 10, color: '#AEAEB2' }}>Brevmont Labs LLC &middot; brevmont.com</span>
      </div>
    </div>
  );
}

export default App;
