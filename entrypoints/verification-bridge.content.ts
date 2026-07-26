type VerifyMethod = 'runScan' | 'runInject' | 'captureBundle' | 'dealerKit' | 'overdriveSmoke';

const MATCHES = [
  '*://*.vinsolutions.com/*',
  '*://vinsolutions.app.coxautoinc.com/*',
  '*://mail.google.com/*',
  '*://*.facebook.com/*',
  '*://www.facebook.com/messages/*',
  '*://www.facebook.com/marketplace/t/*',
  '*://*.messenger.com/*',
  '*://www.messenger.com/*',
  '*://*.linkedin.com/*',
  '*://www.linkedin.com/*',
  '*://*.instagram.com/*',
  '*://www.instagram.com/direct/*',
  '*://www.instagram.com/direct/t/*',
  '*://web.whatsapp.com/*',
  '*://messages.google.com/*',
  '*://*.cargurus.com/*',
  '*://*.cars.com/*',
  '*://*.autotrader.com/*',
  '*://*.dealersocket.com/*',
  '*://*.elead-crm.com/*',
  '*://*.eleadcrm.com/*',
];

export default defineContentScript({
  matches: MATCHES,
  allFrames: false,
  runAt: 'document_idle',
  world: 'MAIN',

  main() {
    // DEV-ONLY QA harness. In production/store builds import.meta.env.DEV is
    // false, so esbuild dead-code-eliminates everything below this guard — the
    // page-callable __brevmontVerify hooks, the console banner, and the
    // postMessage bridge never ship. Never expose automation hooks in the MAIN
    // world on Gmail/Facebook/etc. in a released build (store-review + security).
    if (!import.meta.env.DEV) return;
    const w = window as any;
    if (w.__brevmontVerify?.__pageBridge === true) return;

    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timeout: number }>();

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data || {};
      if (data.source !== 'brevmont:verify:content') return;
      const request = pending.get(data.requestId);
      if (!request) return;
      pending.delete(data.requestId);
      window.clearTimeout(request.timeout);
      if (data.ok) request.resolve(data.result);
      else request.reject(new Error(data.error || 'verify_bridge_failed'));
    });

    function call(method: VerifyMethod, args: unknown[] = []) {
      const requestId = `verify-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`verify_bridge_timeout:${method}`));
        }, 45000);
        pending.set(requestId, { resolve, reject, timeout });
        window.postMessage({ source: 'brevmont:verify:page', requestId, method, args }, '*');
      });
    }

    w.__brevmontVerify = {
      __pageBridge: true,
      runScan: () => call('runScan'),
      runInject: (text?: string) => call('runInject', text === undefined ? [] : [text]),
      captureBundle: (opts?: unknown) => call('captureBundle', opts === undefined ? [] : [opts]),
      dealerKit: (notes?: string) => call('dealerKit', notes === undefined ? [] : [notes]),
      overdriveSmoke: () => call('overdriveSmoke'),
      help: () => `Brevmont Universal Capture verification harness

  await __brevmontVerify.runScan()
  await __brevmontVerify.runInject("hello")
  await __brevmontVerify.captureBundle()
  await __brevmontVerify.dealerKit(notes)
  await __brevmontVerify.overdriveSmoke()
`,
    };
    console.log('[brevmont] verification page bridge installed. Try __brevmontVerify.help()');
  },
});
