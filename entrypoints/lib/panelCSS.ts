/**
 * Shared panel CSS generator.
 * Extracted from content.ts getCSS() so both the Side Panel page and the
 * legacy content-script Shadow DOM share the same styles.
 *
 * The Side Panel renders in a normal document (no Shadow DOM), so the
 * `:host` selector is harmless — browsers ignore unknown pseudo-elements
 * on non-shadow roots.
 *
 * When `domMode` is true the CSS adds border / shadow / border-radius
 * that the DOM-injected sidebar needs (content.ts Shadow DOM).  The Side
 * Panel omits those because the browser chrome frames the panel already.
 */

type Platform = 'vinsolutions' | 'gmail' | 'facebook' | 'linkedin' | 'whatsapp' | 'instagram' | 'unknown';

export interface PanelCSSOptions {
  /** DOM-injected sidebar width (e.g. '320px'). Ignored when domMode is false. */
  width?: string;
  /** If true, adds border/shadow/border-radius for DOM-injected sidebar mode. */
  domMode?: boolean;
}

export function getPanelCSS(platform: Platform, options?: PanelCSSOptions): string {
  const isGmail = platform === 'gmail';
  const isLinkedIn = platform === 'linkedin';
  const isVinSolutions = platform === 'vinsolutions';
  const domMode = options?.domMode ?? false;
  const rootWidth = domMode ? (options?.width ?? '320px') : '100%';

  // DOM mode extras: floating sidebar needs its own border / shadow
  const rootBorder = domMode ? ' border:1px solid #E5E7EB; border-radius:12px; box-shadow:0 0 0 1px rgba(0,0,0,0.05), 0 8px 24px -4px rgba(0,0,0,0.1);' : '';
  const headerRadius = domMode ? ' border-radius:12px 12px 0 0;' : '';

  return `
* { margin:0; padding:0; box-sizing:border-box; }
:host { all:initial; font-family:system-ui,-apple-system,sans-serif; font-size:13px; color:#1a202c; }
#sp-root, #o8 { width:${rootWidth};${rootBorder} height:auto; max-height:100%; background:#FFFFFF; overflow:hidden; overscroll-behavior:contain; display:flex; flex-direction:column; padding-bottom:0; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size:13px; color:#1a202c; }
.header { position:relative; padding:10px 14px; min-height:44px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; gap:8px; flex-shrink:0; background:#fff;${headerRadius} }
.panel-toolbar { min-height:34px; padding:6px 10px; background:#FFFFFF; border-bottom:1px solid #EEF2F7; }
.version-badge { font-size:10px; font-family:'JetBrains Mono',ui-monospace,monospace; color:#4f8f8f; background:#F0FAFA; border:1px solid #D6E4E4; padding:2px 7px; border-radius:999px; letter-spacing:0; white-space:nowrap; line-height:1.2; }
.close { font-size:20px; color:#94a3b8; cursor:pointer; padding:0 4px; flex-shrink:0; line-height:1; } .close:hover { color:#475569; }
.quick-mode { display:flex; flex-direction:column; flex:0 0 auto; overflow:hidden; }
.card { padding:10px 14px; border-bottom:1px solid #e8eaed; flex-shrink:0; }
.name { font-size:14px; font-weight:600; } .vehicle { font-size:11px; color:#2563eb; margin-top:1px; } .meta { font-size:10px; color:#64748b; margin-top:2px; }
.input-section { padding:12px 14px; border-bottom:1px solid #e8eaed; flex-shrink:0; }
.chips { display:flex; gap:5px; margin-bottom:8px; }
.chip { padding:5px 12px; border-radius:16px; font-size:11px; font-weight:600; font-family:inherit; border:1.5px solid #e2e8f0; background:#fff; color:#94a3b8; cursor:pointer; transition:all 0.15s; position:relative; }
.chip.on { border-color:#0D6E6E; color:#0D6E6E; background:#F0EFFF; }
.chip.on::after { content:''; position:absolute; top:-2px; right:-2px; width:7px; height:7px; border-radius:50%; background:#16a34a; border:1.5px solid #fff; }
.chip.tab-active { background:#0D6E6E; color:#F5F1E8; border-color:#0D6E6E; }
.chip.tab-active.on::after { background:#F5F1E8; border-color:#0D6E6E; }
.input-wrap { position:relative; display:flex; align-items:flex-start; }
.main-input { flex:1; padding:8px 40px 8px 10px; border:1px solid #e2e8f0; border-radius:6px; font-size:13px; font-family:inherit; resize:none; outline:none; color:#1a202c; }
.main-input:focus { border-color:#0D6E6E; } .main-input::placeholder { color:#94a3b8; }
.inline-mic { position:absolute; right:6px; top:6px; width:28px; height:28px; border-radius:50%; border:none; background:#0D6E6E; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s; }
.inline-mic:hover { background:#0A5555; transform:scale(1.05); }
.inline-mic.mic-active { background:#B91C1C; animation:mic-pulse 1s infinite; }
@keyframes mic-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.12)} }
.gen-btn { width:100%; padding:10px; background:#0D6E6E; color:#fff; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; margin-top:8px; transition:background 0.15s; }
.gen-btn:hover { background:#0A5555; } .gen-btn:disabled { background:#94a3b8; cursor:wait; }
.gen-spinner { display:inline-block; width:14px; height:14px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:gen-spin 0.6s linear infinite; vertical-align:middle; margin-right:4px; }
@keyframes gen-spin { to { transform:rotate(360deg); } }
.first-use-card { position:relative; margin-bottom:10px; padding:12px 34px 12px 12px; border:1px solid rgba(13,110,110,0.18); border-radius:10px; background:#F8F6F1; }
.first-use-card.done { border-color:rgba(22,163,74,0.22); background:#F0FDF4; }
.first-use-eyebrow { font-size:9px; font-weight:800; letter-spacing:1px; text-transform:uppercase; color:#0D6E6E; margin-bottom:4px; }
.first-use-title { font-size:14px; font-weight:750; color:#0F1419; margin-bottom:4px; }
.first-use-copy { font-size:11px; line-height:1.45; color:#64748b; }
.first-use-example { margin-top:8px; border:1px solid rgba(13,110,110,0.22); background:#fff; color:#0D6E6E; border-radius:7px; padding:6px 9px; font-size:11px; font-weight:700; font-family:inherit; cursor:pointer; }
.first-use-example:hover { background:#eef8f5; }
.first-use-dismiss { position:absolute; top:8px; right:8px; width:22px; height:22px; display:flex; align-items:center; justify-content:center; border:none; border-radius:999px; background:rgba(15,20,25,0.06); color:#64748b; font-size:16px; line-height:1; cursor:pointer; font-family:inherit; }
.first-use-dismiss:hover { background:rgba(15,20,25,0.11); color:#0F1419; }
.usage-counter { text-align:center; font-size:11px; color:#64748b; margin-top:6px; padding:4px 8px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; }
.usage-counter .usage-bar { height:3px; background:#e2e8f0; border-radius:2px; margin-top:4px; overflow:hidden; }
.usage-counter .usage-fill { height:100%; background:#0D6E6E; border-radius:2px; transition:width 0.3s ease; }
.usage-counter.usage-warning .usage-fill { background:#f59e0b; }
.usage-counter.usage-critical .usage-fill { background:#ef4444; }
.upgrade-prompt { margin-top:8px; padding:12px; background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; text-align:center; }
.upgrade-prompt .upgrade-title { font-size:12px; font-weight:700; color:#92400e; margin-bottom:4px; }
.upgrade-prompt .upgrade-msg { font-size:11px; color:#78350f; line-height:1.4; margin-bottom:8px; }
.upgrade-prompt .upgrade-btn { display:inline-block; padding:8px 16px; background:#0D6E6E; color:#fff; border-radius:6px; font-size:12px; font-weight:600; text-decoration:none; cursor:pointer; border:none; }
.upgrade-prompt .upgrade-btn:hover { background:#0A5555; }
.upgrade-prompt .upgrade-phone { font-size:11px; color:#78350f; margin-top:6px; }
.review-prompt { margin:10px 12px 0; border:1px solid rgba(13,110,110,.22); background:#F0FDF4; border-radius:8px; padding:10px 34px 10px 12px; position:relative; }
.review-title { color:#0F1419; font-size:12px; font-weight:700; line-height:1.35; }
.review-link { margin-top:6px; border:0; background:#0D6E6E; color:white; border-radius:6px; padding:7px 10px; font:700 11px Inter,system-ui,sans-serif; cursor:pointer; }
.review-dismiss { position:absolute; top:6px; right:8px; border:0; background:transparent; color:#64748b; font-size:18px; cursor:pointer; line-height:1; }
.gm-invite-backdrop { position:fixed; inset:0; z-index:10000; display:flex; align-items:center; justify-content:center; padding:14px; background:rgba(15,20,25,.48); }
.gm-invite-modal { position:relative; width:100%; max-width:340px; border-radius:12px; background:#fff; box-shadow:0 20px 60px rgba(15,23,42,.28); padding:16px; color:#0F1419; }
.gm-invite-close { position:absolute; top:10px; right:10px; width:24px; height:24px; border:0; border-radius:999px; background:#F1F5F9; color:#64748B; cursor:pointer; font-size:17px; line-height:1; }
.gm-invite-eyebrow { font-size:10px; font-weight:900; letter-spacing:.12em; text-transform:uppercase; color:#0D6E6E; margin-bottom:6px; }
.gm-invite-title { padding-right:24px; font-size:18px; line-height:1.2; font-weight:900; letter-spacing:0; color:#0F1419; }
.gm-invite-copy { margin-top:9px; font-size:12px; line-height:1.45; color:#475569; }
.gm-invite-label { display:block; margin-top:12px; margin-bottom:5px; font-size:10px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; color:#64748B; }
.gm-invite-input { width:100%; height:40px; border:1px solid #E5E7EB; border-radius:8px; padding:0 10px; font-size:13px; font-family:inherit; color:#0F1419; outline:none; }
.gm-invite-input:focus { border-color:#0D6E6E; box-shadow:0 0 0 3px rgba(13,110,110,.08); }
.gm-invite-error { min-height:16px; margin-top:6px; font-size:11px; color:#DC2626; line-height:1.35; }
.gm-invite-send { width:100%; height:40px; border:0; border-radius:8px; background:#0D6E6E; color:#fff; font-size:13px; font-weight:800; font-family:inherit; cursor:pointer; }
.gm-invite-send:hover { background:#0A5555; }
.gm-invite-send:disabled { opacity:.62; cursor:wait; }
.gm-invite-plans { width:100%; margin-top:8px; border:0; background:transparent; color:#0D6E6E; font-size:12px; font-weight:800; font-family:inherit; cursor:pointer; }
.gm-invite-plans:hover { text-decoration:underline; }
.version-update-banner { margin:8px 12px 0; padding:10px 11px; border:1px solid #D6E4E4; border-radius:9px; background:#F0FAFA; color:#0F1419; font-size:12px; line-height:1.4; }
.version-update-banner.force { border-color:#FCA5A5; background:#FEF2F2; }
.version-update-title { font-size:11px; font-weight:800; color:#0D6E6E; text-transform:uppercase; letter-spacing:0.7px; margin-bottom:3px; }
.version-update-banner.force .version-update-title { color:#991B1B; }
.version-update-copy { color:#4B5563; margin-bottom:8px; }
.version-update-btn { border:0; border-radius:7px; background:#0D6E6E; color:#fff; font-size:11px; font-weight:700; padding:7px 9px; cursor:pointer; font-family:inherit; }
.version-update-btn:hover { background:#0A5555; }
.version-update-banner.force .version-update-btn { background:#991B1B; }
.version-update-banner.force .version-update-btn:hover { background:#7F1D1D; }
.challenge-banner { margin:8px 12px 0; padding:10px 11px; border:1px solid #BAE6FD; border-radius:10px; background:#F0F9FF; color:#0F172A; font-size:12px; line-height:1.35; }
.challenge-title { font-size:10px; font-weight:800; color:#0369A1; letter-spacing:.08em; text-transform:uppercase; margin-bottom:4px; display:flex; justify-content:space-between; gap:8px; }
.challenge-close { border:0; background:transparent; color:#64748B; cursor:pointer; font-size:14px; line-height:1; padding:0; }
.challenge-bar { height:7px; border-radius:999px; background:#E0F2FE; overflow:hidden; margin-top:7px; }
.challenge-fill { height:100%; border-radius:999px; background:#0D6E6E; transition:width .2s ease; }
.customer-stamp { margin:8px 12px 0; border:1px solid #D9E7E7; border-radius:12px; background:#F8FAFC; color:#0F1419; overflow:hidden; box-shadow:0 1px 2px rgba(15,23,42,.04); }
.customer-stamp-row { display:flex; align-items:center; gap:9px; padding:8px 9px; min-height:38px; }
.customer-stamp-main { flex:1; min-width:0; font-size:12px; font-weight:850; color:#0F1419; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.customer-stamp-sub { font-size:10px; font-weight:600; color:#64748B; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.customer-stamp-badge { width:8px; height:8px; flex:0 0 8px; border-radius:999px; background:#0D6E6E; box-shadow:0 0 0 4px rgba(13,110,110,.1); }
.customer-stamp-actions { display:flex; gap:6px; align-items:center; }
.customer-stamp-btn { border:1px solid #D9E7E7; border-radius:999px; background:#fff; color:#0D6E6E; padding:5px 9px; font-size:11px; line-height:1; font-weight:850; font-family:inherit; cursor:pointer; }
.customer-stamp-btn.primary { border-color:#0D6E6E; background:#0D6E6E; color:#fff; }
.customer-stamp-clear { border:0; background:transparent; color:#94A3B8; font-size:16px; line-height:1; cursor:pointer; padding:2px; }
.customer-stamp-clear:hover { color:#0F1419; }
.customer-picker { margin:8px 12px 0; padding:10px; border:1px solid #D9E7E7; border-radius:12px; background:#fff; box-shadow:0 8px 24px rgba(15,23,42,.08); }
.customer-picker-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
.customer-picker-title { font-size:12px; font-weight:850; color:#0F1419; }
.customer-picker-close { width:22px; height:22px; border:0; border-radius:999px; background:#F1F5F9; color:#64748B; cursor:pointer; font-size:15px; line-height:1; }
.customer-picker-close:hover { background:#E2E8F0; color:#0F1419; }
.customer-picker-input { width:100%; height:34px; border:1px solid #E2E8F0; border-radius:8px; padding:0 9px; font-size:12px; font-family:inherit; outline:none; }
.customer-picker-input:focus { border-color:#0D6E6E; box-shadow:0 0 0 3px rgba(13,110,110,.08); }
.customer-picker-list { margin-top:8px; display:flex; flex-direction:column; gap:4px; max-height:120px; overflow:auto; }
.customer-picker-row { border:0; background:#F8FAFC; border-radius:8px; padding:7px 8px; font-family:inherit; text-align:left; cursor:pointer; }
.customer-picker-row:hover { background:#E6F4F1; }
.customer-picker-name { font-size:12px; font-weight:800; color:#0F1419; }
.customer-picker-meta { font-size:10px; color:#64748B; margin-top:1px; }
.customer-picker-actions { display:flex; gap:6px; margin-top:8px; }
.customer-picker-actions button { flex:1; border:1px solid #D9E7E7; background:#fff; border-radius:8px; padding:7px; font-size:11px; font-weight:800; font-family:inherit; color:#0D6E6E; cursor:pointer; }
.customer-picker-trigger { position:absolute; right:42px; bottom:8px; border:1px solid #D9E7E7; background:#fff; color:#0D6E6E; border-radius:999px; padding:3px 7px; font-family:inherit; font-size:10px; font-weight:800; cursor:pointer; }
.customer-picker-trigger:hover { border-color:#0D6E6E; background:#E6F4F1; }
.nav-count { display:inline-flex; align-items:center; justify-content:center; min-width:16px; height:16px; margin-left:4px; border-radius:999px; background:#DC2626; color:#fff; font-size:10px; font-weight:800; padding:0 4px; }
.my-lead-card { border:1px solid #E5E7EB; border-radius:10px; padding:10px; background:#fff; box-shadow:0 1px 2px rgba(15,23,42,.04); }
.my-lead-card + .my-lead-card { margin-top:8px; }
.my-lead-card.lost { background:#FFF7F7; border-color:#FECACA; opacity:.86; }
.my-lead-card.lost .lead-card-title { color:#6B7280; text-decoration:line-through; }
.my-lead-card.lost .lead-primary-action, .my-lead-card.lost .lead-secondary-row, .my-lead-card.lost .appt-inline { display:none !important; }
.my-lead-card-exiting { transform:translateX(-24px); opacity:0; transition:transform .3s ease, opacity .3s ease; }
.my-leads-filter-row { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:10px; }
.my-leads-filter-btn { border:1px solid #E5E7EB; border-radius:8px; background:#fff; color:#64748B; font-family:inherit; font-size:11px; font-weight:800; line-height:1.2; padding:8px; cursor:pointer; }
.my-leads-filter-btn.active { background:#0D6E6E; border-color:#0D6E6E; color:#fff; }
.your-lead-badge { display:inline-flex; align-items:center; padding:2px 7px; border-radius:999px; background:#ECFDF5; color:#047857; font-size:9px; font-weight:900; letter-spacing:.07em; text-transform:uppercase; }
.lost-lead-badge { display:inline-flex; align-items:center; padding:2px 7px; border-radius:999px; background:#FEE2E2; color:#991B1B; font-size:9px; font-weight:900; letter-spacing:.07em; text-transform:uppercase; }
.lost-lead-detail { margin-top:8px; border:1px solid #FECACA; border-radius:8px; background:#fff; color:#7F1D1D; padding:8px; font-size:11px; line-height:1.35; }
.lost-lead-time { margin-top:4px; color:#991B1B; font-weight:700; }
.lead-card-title { font-size:14px; font-weight:800; color:#111827; line-height:1.25; }
.lead-card-meta { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
.lead-pill { display:inline-flex; align-items:center; gap:3px; border-radius:999px; padding:2px 7px; font-size:10px; font-weight:700; background:#F1F5F9; color:#475569; }
.lead-primary-action { width:100%; border:0; border-radius:8px; background:#0D6E6E; color:#fff; padding:9px; margin-top:9px; font-size:12px; font-weight:800; font-family:inherit; cursor:pointer; }
.lead-primary-action:hover { background:#0A5555; }
.lead-secondary-row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; margin-top:6px; }
.lead-secondary-action { border:1px solid #E5E7EB; border-radius:7px; background:#fff; color:#475569; padding:7px 4px; font-size:10px; font-weight:700; font-family:inherit; cursor:pointer; }
.lead-secondary-action:hover { background:#F8FAFC; color:#0D6E6E; }
.lost-reason-backdrop { position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; padding:14px; background:rgba(15,20,25,.45); }
.lost-reason-modal { width:100%; max-width:330px; max-height:calc(100% - 18px); overflow:auto; border-radius:12px; background:#fff; box-shadow:0 18px 50px rgba(15,23,42,.25); padding:14px; }
.lost-reason-header { display:flex; align-items:start; justify-content:space-between; gap:10px; margin-bottom:10px; }
.lost-reason-title { color:#0F1419; font-size:14px; font-weight:900; line-height:1.25; }
.lost-reason-subtitle { margin-top:2px; color:#64748B; font-size:11px; }
.lost-reason-close { border:0; background:transparent; color:#64748B; cursor:pointer; font-size:18px; line-height:1; padding:0 2px; }
.lost-reason-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.lost-reason-option { min-height:34px; border:1px solid #E5E7EB; border-radius:8px; background:#fff; color:#334155; font-family:inherit; font-size:11px; font-weight:700; line-height:1.2; text-align:left; padding:7px 8px; cursor:pointer; }
.lost-reason-option:hover { border-color:#0D6E6E; color:#0D6E6E; }
.lost-reason-option.selected { border-color:#DC2626; background:#FEF2F2; color:#991B1B; }
.lost-reason-note-label { display:block; margin-top:10px; margin-bottom:4px; color:#64748B; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
.lost-reason-note { width:100%; border:1px solid #E5E7EB; border-radius:8px; color:#0F1419; font-family:inherit; font-size:12px; line-height:1.4; outline:none; padding:8px; resize:vertical; }
.lost-reason-note:focus { border-color:#0D6E6E; box-shadow:0 0 0 3px rgba(13,110,110,.08); }
.lost-reason-error { min-height:16px; margin-top:6px; color:#DC2626; font-size:11px; line-height:1.35; }
.lost-reason-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:8px; }
.lost-reason-cancel, .lost-reason-confirm { border-radius:8px; font-family:inherit; font-size:12px; font-weight:800; line-height:1; padding:9px 11px; cursor:pointer; }
.lost-reason-cancel { border:1px solid #E5E7EB; background:#fff; color:#475569; }
.lost-reason-confirm { border:1px solid #DC2626; background:#DC2626; color:#fff; }
.lost-reason-confirm:disabled { opacity:.45; cursor:not-allowed; }
.going-dark-card { border:1px solid #FCD34D; border-radius:10px; padding:10px; background:#FFFBEB; color:#92400E; font-size:12px; line-height:1.35; }
.standing-card { border:1px solid #E5E7EB; border-radius:10px; padding:10px; background:#fff; margin-bottom:8px; }
.standing-tier { font-size:18px; font-weight:900; color:#0F172A; }
.standing-list { margin-top:7px; display:flex; flex-direction:column; gap:4px; font-size:11px; color:#475569; }
.outputs { padding:0 14px; overflow-y:auto; flex:0 0 auto; }
.outputs:not(:empty) { padding:8px 14px; flex:1 1 auto; min-height:0; }
.out-card { background:#fff; border:1px solid #E5E7EB; border-radius:12px; padding:10px 12px; margin-bottom:8px; }
.out-card[data-output-type]:not(.tab-visible) { display:none !important; }
.out-card[data-output-type].tab-visible { display:block !important; }
.out-label { font-size:9px; font-weight:700; color:#0D6E6E; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px; }
.out-textarea { width:100%; min-height:120px; max-height:500px; height:auto; padding:10px; border:1px solid #E5E7EB; border-radius:8px; font-size:12px; line-height:1.6; font-family:inherit; color:#1a202c; background:#fff; resize:vertical; outline:none; } .out-textarea:focus { border-color:#0D6E6E; }
.out-card[data-output-type="email"] .out-textarea { min-height:300px; }
.out-card[data-output-type="crm"] .out-textarea { min-height:150px; }
.out-actions { display:flex; gap:6px; margin-top:8px; }
.out-status { font-size:10px; margin-top:4px; min-height:14px; }
.out-action { padding:6px 14px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; transition:all .15s; }
.out-primary { background:#0D6E6E; border:1px solid #6B63C7; color:#fff; } .out-primary:hover { background:#0A5555; }
.out-regen { background:transparent; border:1px solid #E5E7EB; color:#475569; } .out-regen:hover { background:#f3f4f6; }
.tools-panel { display:flex; flex-direction:column; flex:1; overflow:hidden; }
.tools-header { padding:10px 14px; border-bottom:1px solid #e8eaed; display:flex; align-items:center; gap:8px; }
.back-btn { background:none; border:none; color:#0D6E6E; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; } .tools-title { font-size:13px; font-weight:600; }
.tool-tabs { display:flex; border-bottom:1px solid #e8eaed; }
.tool-tab-btn { flex:1; padding:8px 4px; font-size:11px; font-weight:600; font-family:inherit; border:none; background:transparent; color:#94a3b8; cursor:pointer; border-bottom:2px solid transparent; } .tool-tab-btn.active { color:#0D6E6E; border-bottom-color:#0D6E6E; }
.tool-content { padding:12px 14px; flex:1; overflow-y:auto; display:none; }
.tool-section { display:flex; flex-direction:column; gap:8px; } .tool-output { padding:8px 0; }
.tool-result { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; font-size:12px; line-height:1.6; margin-top:8px; }
.coach-chips { display:flex; flex-wrap:wrap; gap:4px; } .coach-chip { padding:4px 10px; border-radius:14px; font-size:10px; font-weight:500; font-family:inherit; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; cursor:pointer; } .coach-chip:hover { border-color:#0D6E6E; color:#0D6E6E; background:#F0EFFF; }
.input-hint { font-size:11px; color:#9CA3AF; text-align:center; margin-top:6px; letter-spacing:0.2px; }
.inline-links { display:flex; align-items:center; justify-content:center; gap:6px; margin-top:8px; } .link-btn { background:none; border:none; color:#0D6E6E; font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; padding:2px 4px; } .link-btn:hover { text-decoration:underline; } .link-sep { color:#e2e8f0; font-size:11px; }
.nav-link { font-size:13px; padding:8px 4px; }
.goal-desc { display:block; font-size:10px; color:#9CA3AF; margin-left:20px; margin-top:1px; font-weight:400; }
.ctx-dropzone { border:2px dashed #0D6E6E; border-radius:8px; background:#F0EFFF; padding:16px; text-align:center; font-size:11px; color:#0D6E6E; display:flex; align-items:center; justify-content:center; min-height:60px; cursor:pointer; } .ctx-dropzone.dragover { background:#e8e4ff; }
.ctx-preview { position:relative; text-align:center; margin-bottom:8px; } .ctx-img { max-width:180px; max-height:100px; border-radius:6px; border:1px solid #e2e8f0; } .ctx-remove { position:absolute; top:-6px; right:calc(50% - 96px); width:18px; height:18px; border-radius:50%; background:#FF3B30; color:#fff; border:none; font-size:11px; cursor:pointer; }
.alert-item { display:flex; align-items:center; padding:6px 8px; background:#FFF7ED; border:1px solid #FBBF24; border-radius:6px; margin-bottom:4px; font-size:11px; gap:6px; } .alert-time { font-size:10px; color:#92400E; margin-left:auto; } .alert-done { border:1px solid #F59E0B; border-radius:5px; background:#FFFFFF; color:#92400E; cursor:pointer; font:600 10px/1.1 inherit; padding:4px 7px; } .alert-done:hover { background:#FFFBEB; }
.lead-btn { height:24px; padding:0 8px; border-radius:6px; border:1px solid #E5E7EB; background:#fff; color:${isVinSolutions ? '#9CA3AF' : '#0D6E6E'}; font-size:12px; font-weight:500; cursor:pointer; font-family:inherit; margin-right:4px; flex-shrink:0; white-space:nowrap; line-height:1; } .lead-btn:hover { background:#f3f4f6; }
.lead-tab-btn { flex:1; padding:8px 4px; font-size:11px; font-weight:600; font-family:inherit; border:none; background:transparent; color:#94a3b8; cursor:pointer; border-bottom:2px solid transparent; } .lead-tab-btn.active { color:#0D6E6E; border-bottom-color:#0D6E6E; }
.lead-field { display:flex; flex-direction:column; gap:2px; margin-bottom:8px; } .lead-field label { font-size:10px; font-weight:600; color:#6B7280; text-transform:uppercase; letter-spacing:0.5px; } .lead-field input { padding:6px 8px; border:1px solid #E5E7EB; border-radius:4px; font-size:13px; font-family:inherit; outline:none; color:#1a202c; } .lead-field input:focus { border-color:#0D6E6E; } .lead-field input.empty { background:#FEF08A; }
.lead-capture-card { background:#fff; border:1px solid #D9E7E7; border-radius:12px; padding:10px; color:#0F1419; box-shadow:0 1px 2px rgba(15,23,42,.04); }
.lead-capture-topline { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; }
.lead-capture-mode { font-size:9px; font-weight:900; letter-spacing:.14em; text-transform:uppercase; color:#0D6E6E; }
.lead-capture-review { border-radius:999px; padding:3px 7px; background:#FFFBEB; color:#92400E; font-size:10px; font-weight:800; white-space:nowrap; }
.lead-capture-rows { display:flex; flex-direction:column; gap:7px; }
.lead-capture-row { display:flex; align-items:center; gap:9px; padding:8px 9px; border-radius:9px; background:#F8FAFC; border:1px solid #EEF2F4; }
.lead-capture-icon { width:22px; height:22px; flex:0 0 22px; border-radius:999px; display:flex; align-items:center; justify-content:center; color:#0D6E6E; background:#E6F4F1; }
.lead-capture-icon svg { width:14px; height:14px; }
.lead-capture-copy { min-width:0; flex:1; }
.lead-capture-label { font-size:9px; font-weight:900; letter-spacing:.09em; text-transform:uppercase; color:#64748B; line-height:1.1; }
.lead-capture-value { margin-top:2px; font-size:12px; line-height:1.25; font-weight:850; color:#0F1419; overflow-wrap:anywhere; }
.lead-capture-value span { color:#64748B; font-weight:650; }
.lead-capture-stage { margin-top:9px; padding:9px; border:1px solid #E2E8F0; border-radius:10px; background:#FBFCFD; }
.lead-capture-stage-title { margin-bottom:7px; font-size:10px; font-weight:900; color:#334155; letter-spacing:.04em; }
.lead-capture-stage-grid { display:flex; flex-wrap:wrap; gap:5px; }
.stage-capture-chip { border:1px solid #CBD5E1; background:#fff; color:#0F172A; border-radius:999px; padding:5px 8px; font-size:11px; font-weight:800; font-family:inherit; line-height:1; cursor:pointer; }
.stage-capture-chip:hover { border-color:#0D6E6E; color:#0D6E6E; }
.stage-capture-chip.selected { border-color:#0D6E6E; background:#E6F4F1; color:#0D6E6E; }
.lead-capture-tags { margin-top:8px; display:flex; gap:4px; flex-wrap:wrap; align-items:center; }
.lead-capture-tag { display:inline-flex; align-items:center; border-radius:999px; padding:3px 7px; font-size:10px; font-weight:800; background:#E6F4F1; color:#0D6E6E; }
.lead-capture-tag.muted { background:#F1F5F9; color:#475569; }
.lead-capture-tag.heat { background:#FEF2F2; color:#DC2626; }
.lead-capture-tag.warm { background:#FFFBEB; color:#92400E; }
.lead-capture-tag.cool { background:#EEF2FF; color:#4338CA; }
.lead-capture-context { margin-top:9px; border:1px solid #E5E7EB; border-radius:10px; background:#F8F6F1; padding:9px; }
.lead-capture-context-label { margin-bottom:5px; padding-bottom:5px; border-bottom:1px solid #E5E0D8; font-size:9px; font-weight:900; letter-spacing:.16em; text-transform:uppercase; color:#0D6E6E; }
.lead-capture-context-copy { font-size:11px; line-height:1.45; color:#0F1419; }
.lead-capture-actions { display:grid; grid-template-columns:1fr 1.35fr 1.15fr; gap:6px; margin-top:9px; }
.lead-capture-actions.secondary { grid-template-columns:1.2fr 1fr; padding-top:9px; border-top:1px solid #E5E7EB; }
.lead-capture-actions .out-action { width:100%; padding:8px 6px; text-align:center; }
.lead-confidence { text-align:center; font-size:11px; color:#6B7280; margin-bottom:10px; padding:4px 8px; background:#f3f4f6; border-radius:4px; }
.lead-inject-btn { width:100%; padding:10px; background:#0D6E6E; color:#fff; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; margin-top:4px; } .lead-inject-btn:hover { background:#0A5555; }
.lead-inject-btn.locked { background:#9CA3AF; cursor:not-allowed; } .lead-inject-btn.locked:hover { background:#9CA3AF; }
.lead-cancel-btn { width:100%; padding:8px; background:transparent; border:1px solid #E5E7EB; border-radius:8px; font-size:12px; font-weight:500; color:#475569; cursor:pointer; font-family:inherit; margin-top:6px; } .lead-cancel-btn:hover { background:#f3f4f6; }
.lead-gate-msg { font-size:10px; color:#9CA3AF; text-align:center; margin-top:6px; }
.lead-banner { padding:8px 12px; background:#F0EFFF; border-bottom:1px solid #E5E7EB; cursor:pointer; font-size:12px; color:#0D6E6E; font-weight:600; display:flex; align-items:center; gap:6px; } .lead-banner:hover { background:#e8e4ff; }
.settings-section { padding:16px 14px; } .settings-label { font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px; margin-top:12px; }
.settings-options { display:flex; flex-direction:column; gap:6px; position:relative; } .settings-options label { font-size:12px; color:#1a202c; display:flex; align-items:center; gap:6px; } .settings-options input[type="radio"] { accent-color:#0D6E6E; }
.settings-input { width:100%; padding:9px 10px; border:1px solid #E5E7EB; border-radius:6px; font-size:13px; color:#1a202c; outline:none; font-family:inherit; } .settings-input:focus { border-color:#0D6E6E; box-shadow:0 0 0 3px rgba(13,110,110,.08); }
.settings-save { margin-top:14px; padding:9px 12px; border:0; border-radius:7px; background:#0D6E6E; color:#fff; font-size:12px; font-weight:700; font-family:inherit; cursor:pointer; } .settings-save:hover { background:#0A5555; }
.settings-saved { margin-left:8px; color:#16A34A; font-size:11px; font-weight:700; opacity:0; transition:opacity .2s; } .settings-saved.show { opacity:1; }
.outcome-section select { color:#1a202c; }
${domMode && isGmail ? `
/* Gmail DOM-sidebar overrides */
#o8 { font-size:13px; border-radius:0; box-shadow:none; border:none; }
.header { border-radius:0; }
.quick-mode { overflow:auto; }
.input-section { padding:10px 12px; }
.chips { gap:4px; margin-bottom:8px; }
.chip { padding:4px 10px; font-size:11px; border-radius:14px; }
.main-input { padding:8px 36px 8px 10px; font-size:13px; }
.inline-mic { width:26px; height:26px; right:5px; top:5px; }
.gen-btn { padding:9px; font-size:13px; margin-top:8px; border-radius:6px; }
.inline-links { margin-top:6px; gap:5px; } .link-btn { font-size:11px; }
.outputs { padding:6px 12px; overflow-y:auto; flex:1; min-height:0; }
.out-card { padding:8px 10px; margin-bottom:6px; }
.out-label { font-size:9px; margin-bottom:3px; }
.out-textarea { min-height:120px; max-height:300px; height:auto; font-size:11px; }
.out-actions { gap:5px; margin-top:5px; }
.out-action { padding:4px 12px; font-size:11px; }
` : ''}
${domMode && isLinkedIn ? `
/* LinkedIn DOM-sidebar overrides */
.input-section { padding:10px 12px; }
.chips { gap:4px; margin-bottom:8px; }
.chip { padding:4px 10px; font-size:11px; border-radius:14px; }
.gen-btn { padding:8px; font-size:13px; margin-top:6px; }
.inline-links { margin-top:6px; } .link-btn { font-size:10px; }
` : ''}

/* Account chip — pinned to the bottom of the panel. Always shows who you
   are, what dealership you're on, and what tier is active. Reads from
   /api/v1/access/resolved on boot. */
.account-chip {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 20, 25, 0.96);
  border-top: 1px solid rgba(13, 110, 110, 0.45);
  padding: 6px 10px;
  z-index: 60;
  backdrop-filter: blur(6px);
}
.account-chip-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}
.account-chip-text {
  flex: 1;
  min-width: 0;
}
.account-chip-name {
  font-size: 11px;
  font-weight: 600;
  color: #F8F6F1;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.account-chip-dealership {
  font-size: 10px;
  color: rgba(248, 246, 241, 0.55);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.account-chip-email {
  font-size: 10px;
  color: rgba(248, 246, 241, 0.45);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.account-btn {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1px solid rgba(13, 110, 110, 0.25);
  background: #fff;
  color: #0D6E6E;
  font-size: 18px;
  line-height: 1;
  font-weight: 900;
  cursor: pointer;
}
.account-btn:hover { background: #F0EFFF; }
.account-chip-plan {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 4px;
  color: #fff;
  background: #64748b;
}
.account-chip-plan.plan-free    { background: #64748b; }
.account-chip-plan.plan-pilot   { background: #d97706; }
.account-chip-plan.plan-command { background: #0D6E6E; }
.account-chip-plan.plan-annual  { background: #4338ca; }
.account-chip-plan.plan-custom  { background: #7c3aed; }
.account-chip-plan.plan-upgrade { background: #0D6E6E; box-shadow: 0 0 0 1px rgba(248, 246, 241, 0.18); }
.account-chip-plan.status-paused     { background: #d97706; }
.account-chip-plan.status-terminated { background: #b91c1c; }
.account-chip-upgrade {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 4px 9px;
  border-radius: 4px;
  background: #0D6E6E;
  color: #F8F6F1;
  border: 0;
  cursor: pointer;
  transition: filter 0.15s ease;
}
.account-chip-upgrade:hover { filter: brightness(1.12); }
.account-chip.account-chip-focus { box-shadow: 0 -2px 0 #0D6E6E; }
/* Reserve space at the bottom of the scrollable area so the chip doesn't
   cover the last UI element. */
body { padding-bottom: 88px; }
.tool-content { padding-bottom: 96px; }
`;
}
