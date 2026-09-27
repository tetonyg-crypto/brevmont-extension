import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { planSweepAgainstBaseline, preferenceFromStatus } from '../../entrypoints/lib/overdrive/radarPreference';

// 2026-09-27: Facebook Lead Radar is opt-in. Before this, the background
// controller captured leads whenever Facebook was linked + disclosure acked,
// with no on/off control ("Lead radar active — 40 captured today").

const radar = vi.hoisted(() => ({
  status: null as any,
  captures: [] as any[],
  toggles: [] as boolean[],
}));

vi.mock('../../entrypoints/lib/overdrive/radarClient', () => ({
  radarStatus: vi.fn(async () => radar.status),
  radarCapture: vi.fn(async (body: any) => { radar.captures.push(body); return { ok: true, mode: 'created' }; }),
  radarSweepDone: vi.fn(async () => {}),
  radarToggle: vi.fn(async (enabled: boolean) => { radar.toggles.push(enabled); return true; }),
}));

vi.mock('../../entrypoints/lib/overdrive/apiClient', () => ({
  getOverdriveSettings: vi.fn(async () => ({
    settings: { enabled: false },
    dealership_enabled: false,
    linked: { facebook: true, disclosure_ack_at: '2026-09-01T00:00:00Z' },
    defaults: { active_hours_start: 8, active_hours_end: 20, timezone: 'UTC', cap_per_thread_per_minute: 1, cap_per_thread_per_day: 5, cap_per_rep_per_day: 50 },
  })),
  getOverdriveStateSeq: vi.fn(async () => ({ seq: null })),
  reportOverdriveDetection: vi.fn(async () => ({ ok: true })),
  reportOverdriveBlocked: vi.fn(async () => ({ ok: true })),
  reportOverdriveDraftPrefilled: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../entrypoints/lib/overdrive/orchestrator', () => ({
  orchestrateReply: vi.fn(async () => ({})),
  isHeroStage: vi.fn(() => false),
  replayPendingConfirms: vi.fn(async () => {}),
}));

interface Harness {
  storage: Record<string, any>;
  tabMessages: any[];
  onMessage: Array<(msg: any, sender: any, respond: (r: any) => void) => any>;
  onAlarm: Array<(alarm: { name: string }) => any>;
  sweepItems: any[];
  scrape: any;
}

let h: Harness;
let clock = 1_000_000;

function installChromeMock() {
  h = { storage: {}, tabMessages: [], onMessage: [], onAlarm: [], sweepItems: [], scrape: null };
  const chromeMock: any = {
    runtime: {
      lastError: undefined,
      onStartup: { addListener: () => {} },
      onMessage: { addListener: (fn: any) => h.onMessage.push(fn) },
      sendMessage: vi.fn(() => Promise.resolve()),
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string[] | string) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, any> = {};
          for (const k of list) if (k in h.storage) out[k] = h.storage[k];
          return out;
        }),
        set: vi.fn(async (obj: Record<string, any>) => { Object.assign(h.storage, obj); }),
      },
    },
    alarms: { create: vi.fn(), onAlarm: { addListener: (fn: any) => h.onAlarm.push(fn) } },
    tabs: {
      query: vi.fn((_q: any, cb: any) => cb([{ id: 7, url: 'https://www.facebook.com/marketplace/t/123/' }])),
      sendMessage: vi.fn((_tabId: number, msg: any, cb: any) => {
        h.tabMessages.push(msg.type);
        if (msg.type === 'OVERDRIVE_INSTALL_DETECTOR') return cb({ ok: true });
        if (msg.type === 'OVERDRIVE_SCRAPE_THREAD') return cb({ ok: true, scrape: h.scrape });
        if (msg.type === 'RADAR_SWEEP_LIST') return cb({ ok: true, items: h.sweepItems });
        return cb({ ok: true });
      }),
      onUpdated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      create: vi.fn(),
    },
    notifications: { create: vi.fn() },
    action: { setBadgeText: vi.fn() },
  };
  (globalThis as any).chrome = chromeMock;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function install() {
  vi.resetModules();
  const mod = await import('../../entrypoints/lib/overdrive/backgroundController');
  await mod.installOverdriveController();
  await sleep(20);
  return mod;
}

function sendRuntime(msg: any, sender: any = { tab: { id: 7 } }) {
  for (const fn of h.onMessage) fn(msg, sender, () => {});
}

async function fireAlarm(name: string) {
  for (const fn of h.onAlarm) await fn({ name });
}

async function liveSignal() {
  h.scrape = {
    conversation_key: `mp:${Math.random().toString(36).slice(2)}`,
    last_inbound_hash: `h${Math.random()}`,
    last_inbound_text: 'Is the 2021 Tahoe still available?',
    header_text: 'Jordan Buyer · 2021 Chevrolet Tahoe',
    url: 'https://www.facebook.com/marketplace/t/123/',
  };
  sendRuntime({ type: 'OVERDRIVE_DETECTION_SIGNAL', signal: { type: 'mutation', trigger_origin: 'unread_or_new_inbound' } });
  await sleep(450);
}

const sweepItem = (key: string, hash: string) => ({
  conversation_key: key,
  header_text: 'Sam Buyer · 2020 Toyota Tacoma',
  last_inbound_text: 'Still for sale?',
  last_inbound_hash: hash,
  url: `https://www.facebook.com/marketplace/t/${key.replace('mp:', '')}/`,
});

describe('Facebook Lead Radar control (background controller)', () => {
  beforeEach(() => {
    radar.status = null;
    radar.captures = [];
    radar.toggles = [];
    clock = 1_000_000 + Math.floor(Math.random() * 1000);
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    installChromeMock();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('fresh account starts OFF: browsing Facebook creates zero automatic leads and no sweep runs', async () => {
    radar.status = { enabled: false, opt_in: false, reason_if_disabled: 'rep_not_opted_in', count_today: 0 };
    await install();
    await liveSignal();
    await fireAlarm('radar-catchup-sweep');
    await fireAlarm('overdrive-keepalive');
    expect(radar.captures).toHaveLength(0);
    expect(h.tabMessages).not.toContain('RADAR_SWEEP_LIST');
    expect(h.tabMessages).not.toContain('OVERDRIVE_INSTALL_DETECTOR');
  });

  it('an older server that does not report opt_in is treated as OFF (existing users never flip ON by accident)', async () => {
    radar.status = { enabled: true, reason_if_disabled: null, count_today: 40 };
    await install();
    await liveSignal();
    await fireAlarm('radar-catchup-sweep');
    expect(radar.captures).toHaveLength(0);
    expect(h.tabMessages).not.toContain('RADAR_SWEEP_LIST');
  });

  it('turn Radar ON: a new supported lead auto-captures', async () => {
    radar.status = { enabled: true, opt_in: true, enabled_at: '2026-09-27T20:00:00Z', count_today: 0 };
    await install();
    await liveSignal();
    expect(radar.captures).toHaveLength(1);
    expect(radar.captures[0]).toMatchObject({ sweep_source: 'live', source_platform: 'facebook_marketplace' });
  });

  it('turn Radar OFF: capture stops immediately (no TTL wait), including sweeps', async () => {
    radar.status = { enabled: true, opt_in: true, enabled_at: '2026-09-27T20:00:00Z', count_today: 0 };
    await install();
    await liveSignal();
    expect(radar.captures).toHaveLength(1);
    radar.status = { enabled: false, opt_in: false, count_today: 1 };
    sendRuntime({ type: 'LEAD_RADAR_PREF_CHANGED', pref: { opt_in: false } }, {});
    await sleep(20);
    await liveSignal();
    clock += 60_000;
    await fireAlarm('radar-catchup-sweep');
    expect(radar.captures).toHaveLength(1);
  });

  it('turning ON does not ingest the existing inbox: first sweep only baselines, later sweeps capture new inbound', async () => {
    radar.status = { enabled: true, opt_in: true, enabled_at: '2026-09-27T20:00:00Z', count_today: 0 };
    h.sweepItems = [sweepItem('mp:111', 'a'), sweepItem('mp:222', 'b'), sweepItem('mp:333', 'c')];
    await install();
    await sleep(50);
    expect(h.tabMessages).toContain('RADAR_SWEEP_LIST');
    expect(radar.captures).toHaveLength(0);

    h.sweepItems = [sweepItem('mp:111', 'a'), sweepItem('mp:222', 'b2'), sweepItem('mp:444', 'd')];
    clock += 60_000;
    await fireAlarm('radar-catchup-sweep');
    await sleep(400);
    expect(radar.captures.map((c) => c.conversation_key).sort()).toEqual(['mp:222', 'mp:444']);
    expect(radar.captures.every((c) => c.sweep_source === 'catchup_sweep')).toBe(true);
  });

  it('reload / Chrome restart: the preference comes back from the server, and from the persisted cache when offline', async () => {
    radar.status = { enabled: true, opt_in: true, enabled_at: '2026-09-27T20:00:00Z', count_today: 0 };
    await install();
    expect(h.storage.lead_radar_pref).toMatchObject({ opt_in: true });

    // Simulated extension reload: fresh module state, same chrome.storage.
    const persisted = { ...h.storage };
    installChromeMock();
    Object.assign(h.storage, persisted);
    radar.status = null; // server unreachable on restart
    await install();
    await liveSignal();
    expect(radar.captures).toHaveLength(1);

    // And OFF persists the same way.
    installChromeMock();
    h.storage.lead_radar_pref = { opt_in: false, enabled_at: null, count_today: 0, fetchedAt: 0 };
    radar.status = null;
    radar.captures = [];
    await install();
    await liveSignal();
    expect(radar.captures).toHaveLength(0);
  });
});

describe('Lead Radar preference rules', () => {
  it('unknown or legacy status reads OFF; only enabled + explicit opt_in is ON', () => {
    expect(preferenceFromStatus(null).opt_in).toBe(false);
    expect(preferenceFromStatus({ enabled: true }).opt_in).toBe(false);
    expect(preferenceFromStatus({ enabled: false, opt_in: true }).opt_in).toBe(false);
    expect(preferenceFromStatus({ enabled: true, opt_in: true }).opt_in).toBe(true);
  });

  it('a new enable (different enabled_at) re-baselines instead of capturing history', () => {
    const first = planSweepAgainstBaseline([{ conversation_key: 'mp:1', last_inbound_hash: 'a' }], null, 'T1');
    expect(first.toCapture).toHaveLength(0);
    const again = planSweepAgainstBaseline([{ conversation_key: 'mp:1', last_inbound_hash: 'a' }, { conversation_key: 'mp:2', last_inbound_hash: 'b' }], first.nextBaseline, 'T2');
    expect(again.toCapture).toHaveLength(0);
  });
});

describe('manual capture and other platforms are independent of Lead Radar', () => {
  it('manual + Lead (PARSE_LEAD) never consults the radar gate', () => {
    const bg = readFileSync(join(__dirname, '../../entrypoints/background.ts'), 'utf8');
    const start = bg.indexOf("if (msg.type === 'PARSE_LEAD')");
    const block = bg.slice(start, bg.indexOf("if (msg.type === 'UPDATE_LOCAL_LEAD_STAGE_AT_CAPTURE')"));
    expect(start).toBeGreaterThan(-1);
    expect(block).not.toMatch(/radar/i);
    const panel = readFileSync(join(__dirname, '../../entrypoints/sidepanel/main.ts'), 'utf8');
    const scan = panel.slice(panel.indexOf('// Scan — asks content script to scrape'), panel.indexOf('// Voice mic for lead'));
    expect(scan).not.toMatch(/radar/i);
  });

  it('LinkedIn / Instagram / WhatsApp / X adapters do not reference Lead Radar', () => {
    for (const f of ['linkedin', 'instagram', 'x']) {
      const src = readFileSync(join(__dirname, `../../entrypoints/lib/platforms/${f}.ts`), 'utf8');
      expect(src).not.toMatch(/radarPreference|LEAD_RADAR_PREF/);
    }
  });
});

describe('Settings card', () => {
  it('sits directly below Disclosure, defaults to OFF, and uses the agreed copy', async () => {
    const { getPanelHTML } = await import('../../entrypoints/lib/panelUI');
    document.body.innerHTML = getPanelHTML('facebook' as any);
    const cards = Array.from(document.querySelectorAll('.settings-card'));
    const disclosure = cards.findIndex((c) => c.textContent?.includes('Disclosure'));
    const radarCard = document.querySelector('#sp-radar-card');
    expect(disclosure).toBeGreaterThan(-1);
    expect(cards[disclosure + 1]).toBe(radarCard);
    expect(radarCard?.textContent).toContain('Facebook Lead Radar');
    expect(radarCard?.textContent).toContain('Automatically captures new Facebook and Marketplace leads while you work.');
    expect(document.querySelector('#sp-radar-off')?.classList.contains('active')).toBe(true);
    expect(document.querySelector('#sp-radar-on')?.classList.contains('active')).toBe(false);
    expect(document.querySelector('#sp-radar-help')?.textContent).toBe('Brevmont will only save leads when you add them manually.');
    expect((document.querySelector('#o8-radar-status') as HTMLElement).style.display).toBe('none');
  });
});
