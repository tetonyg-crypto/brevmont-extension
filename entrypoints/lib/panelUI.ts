/**
 * Shared panel HTML generator.
 * Extracted from content.ts getHTML() so both the Side Panel page and the
 * legacy content-script DOM injection share the same markup.
 *
 * Platform-specific logic (VinSolutions customer card, placeholder text)
 * is driven by the `platform` parameter.
 */

type Platform =
  | 'vinsolutions'
  | 'gmail'
  | 'outlook'
  | 'facebook'
  | 'linkedin'
  | 'whatsapp'
  | 'instagram'
  | 'google-messages'
  | 'cargurus'
  | 'carsdotcom'
  | 'autotrader'
  | 'dealersocket'
  | 'elead'
  | 'unknown';

export function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getBadge(platform: Platform) {
  switch (platform) {
    case 'vinsolutions': return { label: 'Dealer CRM', color: '#0D6E6E', bg: '#F0EFFF' };
    case 'gmail': return { label: 'Gmail', color: '#dc2626', bg: '#fef2f2' };
    case 'outlook': return { label: 'Outlook', color: '#2563eb', bg: '#eff6ff' };
    case 'facebook': return { label: 'Messenger', color: '#1877f2', bg: '#eff6ff' };
    case 'linkedin': return { label: 'LinkedIn', color: '#0a66c2', bg: '#eff6ff' };
    case 'whatsapp': return { label: 'WhatsApp', color: '#25D366', bg: '#f0fdf4' };
    case 'instagram': return { label: 'Instagram', color: '#E1306C', bg: '#fef2f8' };
    case 'google-messages': return { label: 'Google Messages', color: '#0D6E6E', bg: '#F0FAFA' };
    case 'cargurus': return { label: 'CarGurus', color: '#0D6E6E', bg: '#F0FAFA' };
    case 'carsdotcom': return { label: 'Cars.com', color: '#0D6E6E', bg: '#F0FAFA' };
    case 'autotrader': return { label: 'AutoTrader', color: '#0D6E6E', bg: '#F0FAFA' };
    case 'dealersocket': return { label: 'DealerSocket', color: '#0D6E6E', bg: '#F0FAFA' };
    case 'elead': return { label: 'Elead', color: '#0D6E6E', bg: '#F0FAFA' };
    default: return { label: '', color: '#64748b', bg: '#f1f5f9' };
  }
}

function getSettingsHTML(): string {
  return `<div class="settings-section">
    <div class="settings-kicker">Profile</div>
    <div class="settings-card settings-account-card">
      <div class="settings-account-row"><span>Name</span><strong id="sp-rep-name">Loading...</strong></div>
      <div class="settings-account-row"><span>Dealership</span><strong id="sp-dealership">Loading...</strong></div>
      <div class="settings-account-row"><span>Plan</span><strong id="sp-license">Loading...</strong></div>
      <div class="settings-account-row"><span>Version</span><strong id="sp-version">Loading...</strong></div>
      <div id="sp-queue-row" class="settings-account-row" style="display:none"><span>Queue</span><strong id="sp-queue-count">0</strong></div>
      <div class="settings-account-status"><span id="sp-status-dot"></span><span id="sp-status-text">Checking account</span></div>
    </div>
    <div style="font-size:12px;color:#6B7280;line-height:1.5;margin-bottom:4px;">Controls how Brevmont writes for you. Changes apply to your next follow-up.</div>
    <div class="settings-label">Your name</div>
    <input id="sp-rep-first-name" class="settings-input" type="text" placeholder="First name" autocomplete="given-name" />
    <div class="settings-label">Tone</div>
    <div class="settings-options"><label><input type="radio" name="brevmont-tone" value="professional" checked> Professional</label><label><input type="radio" name="brevmont-tone" value="friendly"> Friendly</label><label><input type="radio" name="brevmont-tone" value="casual"> Casual</label><label><input type="radio" name="brevmont-tone" value="direct"> Direct</label></div>
    <div class="settings-label">Goal</div>
    <div class="settings-options"><label><input type="radio" name="brevmont-goal" value="close_deal" checked> Close the deal<span class="goal-desc">Ask for the sale, push for commitment</span></label><label><input type="radio" name="brevmont-goal" value="book_appointment"> Book appointment<span class="goal-desc">Get them on the lot or on a call</span></label><label><input type="radio" name="brevmont-goal" value="gather_info"> Gather info<span class="goal-desc">Learn what they need before pitching</span></label><label><input type="radio" name="brevmont-goal" value="nurture"> Nurture long-term<span class="goal-desc">Stay top of mind, no pressure</span></label></div>
    <button id="sp-save-settings" class="settings-save" type="button">Save preferences</button>
    <span id="sp-settings-saved" class="settings-saved">Saved</span>
    <div class="settings-card settings-note-card">
      <div class="settings-note-title">Voice learning</div>
      <div class="settings-note-copy">Brevmont keeps your tone and dealership rules attached to every follow-up.</div>
    </div>
    <div class="settings-card settings-note-card">
      <div class="settings-note-title">Disclosure</div>
      <div class="settings-note-copy">Overdrive only reads supported customer conversations and logs every held draft and rep-approved reply to the manager view.</div>
    </div>
    <button id="sp-settings-sign-out" class="settings-secondary" type="button">Sign out</button>
    <div class="settings-divider"></div>
    <div class="settings-kicker settings-kicker-row"><span>Overdrive</span><button id="sp-link-overdrive-manual" class="settings-inline-help" type="button">Guide</button></div>
    <div id="overdrive-panel-mount"></div>
    <div id="sp-support-card" class="settings-card settings-support-card" style="display:none">
      <div class="settings-note-title" id="sp-support-title">Support</div>
      <div class="settings-note-copy" id="sp-support-copy">Tell us what happened and include the copied details.</div>
      <div class="settings-support-email" id="sp-support-email">founder@brevmont.com</div>
      <div class="settings-support-actions">
        <button id="sp-copy-support-email" class="settings-support-action primary" type="button">Copy email</button>
        <button id="sp-copy-support-details" class="settings-support-action" type="button">Copy details</button>
        <button id="sp-close-support-card" class="settings-support-action" type="button">Close</button>
      </div>
    </div>
    <div class="settings-footer-links">
      <button id="sp-link-help" type="button">Owner's manual</button>
      <button id="sp-link-changelog" type="button">Changelog</button>
      <button id="sp-link-support" type="button">Contact support</button>
      <button id="sp-link-report" type="button">Report issue</button>
      <button id="sp-settings-bottom-back" class="settings-secondary settings-back-bottom" type="button">Back to Generate</button>
    </div>
  </div>`;
}

export function getPanelHTML(platform: Platform): string {
  const isVinSolutions = platform === 'vinsolutions';
  const badge = getBadge(platform);
  const customerCard = isVinSolutions ? `<div id="o8-card" class="card"><div id="o8-name" class="name" style="font-style:italic;color:#94a3b8">Open a customer record</div><div id="o8-vehicle" class="vehicle"></div><div id="o8-meta" class="meta"></div></div>` : '';
  const placeholder = 'Optional: steer it, like "push for appointment"';

  return `
<div class="header">
  <span class="version-badge" id="o8-version-badge"></span>
  <span style="flex:1"></span>
  ${badge.label ? `<span id="o8-platform-badge" style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;color:${badge.color};background:${badge.bg}">${esc(badge.label)}</span>` : '<span id="o8-platform-badge" style="display:none"></span>'}
  <button id="o8-manual-btn" class="manual-btn" type="button" title="Open help for this view" aria-label="Open help for this view">?</button>
  <button id="o8-account-btn" class="account-btn overdrive-dot-off" type="button" title="Open settings" aria-label="Open settings">•</button>
  <button id="o8-lead-btn" class="lead-btn">+ Lead</button>
  <span id="o8-close" class="close">&times;</span>
</div>
<div id="o8-radar-status" class="radar-status" style="display:none;padding:6px 12px;font-size:11px;color:rgba(0,0,0,0.55);background:rgba(13,110,110,0.06);border-bottom:1px solid rgba(0,0,0,0.05);">
  <span style="display:inline-flex;align-items:center;gap:6px;">
    <span style="width:6px;height:6px;border-radius:50%;background:#0D6E6E;box-shadow:0 0 0 3px rgba(13,110,110,0.15);"></span>
    <span id="o8-radar-status-text">Lead radar active</span>
  </span>
</div>
<!-- 2026-07-03 Overdrive discoverability: persistent status pill at
     the top of every sidepanel view. Prior to this, Overdrive was
     buried in Settings and Yancy — who built it — could not find the
     toggle. This pill always shows the current master state and is a
     one-tap toggle. renderOverdriveStatusPill() in main.ts drives the
     visible text + toggle handler. -->
<div id="o8-overdrive-pill" class="overdrive-pill" style="display:none;padding:8px 12px;font-size:11px;background:#fff;border-bottom:1px solid rgba(0,0,0,0.06);">
  <div class="overdrive-pill-row">
    <span id="o8-overdrive-pill-dot" style="width:8px;height:8px;border-radius:50%;background:#94a3b8;flex-shrink:0;"></span>
    <button id="o8-overdrive-pill-summary" class="overdrive-pill-summary" type="button">
      <span id="o8-overdrive-pill-title">Overdrive: off</span>
      <span class="overdrive-pill-dot-sep">·</span>
      <span id="o8-overdrive-pill-action-label">Turn on</span>
    </button>
    <button id="o8-overdrive-pill-toggle" type="button" class="overdrive-pill-toggle">Turn on</button>
  </div>
  <div id="o8-overdrive-pill-details" class="overdrive-pill-details" style="display:none">
    <div id="o8-overdrive-pill-sub" class="overdrive-pill-sub">Drafts Marketplace replies for your review</div>
    <div id="o8-needs-answering" style="margin-top:6px"></div>
  </div>
</div>
<div id="o8-challenge-banner" class="challenge-banner" style="display:none"></div>
<div id="o8-customer-stamp" class="customer-stamp" style="display:none"></div>
<div id="o8-overdrive-heartbeat-strip" class="overdrive-heartbeat-strip" style="display:none"></div>
<div id="o8-customer-picker" class="customer-picker" style="display:none"></div>
<div id="o8-quick" class="quick-mode">
  ${customerCard}
  <div class="input-section">
    <div id="o8-first-use" class="first-use-card" style="display:none;">
      <button id="o8-first-use-dismiss" class="first-use-dismiss" type="button" aria-label="Dismiss onboarding banner">&times;</button>
      <div class="first-use-eyebrow">Try your first follow-up</div>
      <div class="first-use-title">Open a conversation and tap Generate.</div>
      <div class="first-use-copy">Brevmont reads the thread, writes the follow-up, and lets you review before sending.</div>
      <button id="o8-first-use-example" class="first-use-example" type="button">Use example</button>
    </div>
    <div class="chips">
      <button class="chip on" data-type="text">Message</button>
      <button class="chip" data-type="email">Email</button>
      <button class="chip" data-type="crm">CRM Note</button>
    </div>
    <div class="input-wrap">
      <textarea id="o8-input" class="main-input" placeholder="${esc(placeholder)}" rows="3"></textarea>
      <button id="o8-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button>
    </div>
    <div class="input-hint">Optional steer. Text, email, CRM note.</div>
    <div id="o8-reply-context" class="reply-context" style="display:none"></div>
    <button id="o8-generate" class="gen-btn">Generate</button>
    ${isVinSolutions ? `<div id="o8-outcome-section" class="outcome-section" style="display:none; margin-top:8px; padding:8px; background:#f8fafc; border-radius:8px; border:1px solid #E5E7EB;">
  <div style="font-size:11px; font-weight:600; color:#64748b; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px;">Deal Outcome</div>
  <select id="o8-outcome-select" style="width:100%; padding:8px; border:1px solid #E5E7EB; border-radius:6px; font-size:12px; background:#fff; margin-bottom:6px;">
    <option value="">Select outcome...</option>
    <option value="vehicle_sold">Vehicle Sold</option>
    <option value="appointment_set">Appointment Set</option>
    <option value="appointment_completed">Appointment Completed</option>
    <option value="deal_lost">Deal Lost</option>
    <option value="no_response">No Response</option>
  </select>
  <button id="o8-outcome-btn" class="gen-btn" style="background:#34C759; font-size:12px; padding:8px;">Mark Outcome</button>
  <div id="o8-outcome-status" style="font-size:11px; color:#64748b; text-align:center; margin-top:4px;"></div>
</div>` : ''}
    <div class="inline-links"><button id="o8-my-leads-btn-inline" class="link-btn nav-link">My Leads<span id="o8-my-leads-count" class="nav-count" style="display:none"></span></button><span class="link-sep">|</span><button id="o8-followups-btn-inline" class="link-btn nav-link" style="display:none">Follow-ups<span id="o8-followups-count" class="nav-count"></span></button><span id="o8-followups-sep" class="link-sep" style="display:none">|</span><button id="o8-tools-btn-inline" class="link-btn nav-link">&#x1F4AC; Coach</button><span class="link-sep">|</span><button id="o8-stats-btn-inline" class="link-btn nav-link">&#x1F4CA; My Stats</button><span class="link-sep">|</span><button id="o8-settings-btn-inline" class="link-btn nav-link">&#x2699;&#xFE0F; Settings</button></div>
  </div>
  <div id="o8-outputs" class="outputs"></div>
</div>
<div id="o8-tools-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-tools-back" class="back-btn">&larr; Back</button><span class="tools-title">Tools</span></div>
  <div class="tool-tabs">
    <button class="tool-tab-btn" data-tool="coach">Coach</button>
    <button class="tool-tab-btn" data-tool="alerts">Reminders</button>
    <button class="tool-tab-btn" data-tool="command">Ask Anything</button>
  </div>
  <div id="tool-coach" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><textarea id="o8-coach-input" class="main-input" placeholder="What did the customer just say?" rows="2"></textarea><button id="o8-coach-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><div class="coach-chips"><button class="coach-chip">Need to think about it</button><button class="coach-chip">Price too high</button><button class="coach-chip">Bad credit</button><button class="coach-chip">Spouse not here</button><button class="coach-chip">Just looking</button><button class="coach-chip">Trading in my car</button><button class="coach-chip">Found it cheaper</button><button class="coach-chip">Need to check with my bank</button></div><button id="o8-coach-btn" class="gen-btn">Coach Me</button></div><div id="o8-coach-output" class="tool-output"></div></div>
  <div id="tool-alerts" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><input id="o8-alert-input" class="main-input" placeholder="e.g., Call Sally back at 2pm about the Tahoe" /><button id="o8-alert-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-alert-btn" class="gen-btn" style="background:#0D6E6E">Set Reminder</button></div><div id="o8-alert-list" class="tool-output"></div></div>
  <div id="tool-command" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><textarea id="o8-cmd-input" class="main-input" placeholder="e.g., Calculate payment on $35,000 at 6.9% for 72mo" rows="2"></textarea><button id="o8-cmd-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-cmd-execute" class="gen-btn">Ask</button></div><div id="o8-cmd-status" class="tool-output"></div></div>
</div>
<div id="o8-stats-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-stats-back" class="back-btn">&larr; Back</button><span class="tools-title">My Stats</span></div>
  <div id="o8-stats-content" class="tool-section" style="padding:12px;">
    <div style="text-align:center;color:#94a3b8;font-size:12px;padding:24px;">Loading stats...</div>
  </div>
</div>
<div id="o8-my-leads-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-my-leads-back" class="back-btn">&larr; Back</button><span class="tools-title">My Leads</span></div>
  <div id="o8-my-leads-scroll" class="my-leads-scroll">
    <div id="o8-going-dark-alerts" class="tool-section" style="display:none"></div>
    <div id="o8-my-leads-content" class="tool-section">
      <div style="text-align:center;color:#94a3b8;font-size:12px;padding:24px;">Loading your pipeline...</div>
    </div>
  </div>
</div>
<div id="o8-settings-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-settings-back" class="back-btn">&larr; Back</button><span class="tools-title">Settings</span></div>
  <div id="o8-settings-scroll" class="settings-scroll">
    ${getSettingsHTML()}
  </div>
</div>
<div id="o8-lead-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-lead-back" class="back-btn">&larr; Back</button><span class="tools-title">Save Lead</span></div>
  <div class="tool-tabs">
    <button class="lead-tab-btn active" data-ltab="scan">Scan</button>
    <button class="lead-tab-btn" data-ltab="voice">Voice</button>
    <button class="lead-tab-btn" data-ltab="paste">Paste</button>
  </div>
  <div id="lead-scan" class="tool-content" style="display:block"><div class="tool-section"><button id="o8-scan-btn" class="gen-btn">Scan This Page</button><div style="font-size:11px;color:#9CA3AF;text-align:center;margin-top:8px">Reads this page and looks for buying intent, fleet requests, customer details, and vehicle interest.</div><div id="o8-scan-empty" style="display:none;font-size:11px;color:#F59E0B;text-align:center;margin-top:8px;padding:8px;background:#FFFBEB;border-radius:6px;">No buying intent detected. If this is a customer, use Voice or Paste tab.</div></div></div>
  <div id="lead-voice" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><textarea id="o8-lead-voice-input" class="main-input" placeholder="Tap mic and describe the lead..." rows="3"></textarea><button id="o8-lead-voice-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-lead-voice-parse" class="gen-btn" style="margin-top:8px">Pull details</button></div></div>
  <div id="lead-paste" class="tool-content" style="display:none"><div class="tool-section"><textarea id="o8-lead-paste-input" class="main-input" placeholder="Paste a text thread, email, or Facebook message with customer info..." rows="4"></textarea><button id="o8-lead-paste-parse" class="gen-btn" style="margin-top:8px">Pull details</button></div></div>
  <div id="o8-lead-result" class="tool-content" style="display:none"></div>
</div>
<div id="o8-review-prompt" class="review-prompt" style="display:none;">
  <button id="o8-review-dismiss" class="review-dismiss" type="button" aria-label="Dismiss review prompt">&times;</button>
  <div class="review-title">Brevmont has saved you a lot of typing.</div>
  <button id="o8-review-link" class="review-link" type="button">Leave a quick rating</button>
</div>
<div id="o8-account-chip" class="account-chip" style="display:none;">
  <div class="account-chip-row">
    <div class="account-chip-text">
      <div id="o8-account-chip-name" class="account-chip-name"></div>
      <div id="o8-account-chip-dealership" class="account-chip-dealership"></div>
      <div id="o8-account-chip-email" class="account-chip-email"></div>
    </div>
    <span id="o8-account-chip-plan" class="account-chip-plan"></span>
    <button id="o8-account-chip-upgrade" class="account-chip-upgrade" type="button" style="display:none;">Upgrade</button>
    <button id="o8-account-chip-menu" class="account-chip-menu" type="button" aria-label="Account menu" title="Account menu">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="6" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18" r="1.4"/></svg>
    </button>
  </div>
  <div id="o8-account-chip-popover" class="account-chip-popover" style="display:none;">
    <div class="account-chip-popover-hd">Signed in as</div>
    <div id="o8-account-chip-popover-email" class="account-chip-popover-email"></div>
    <button id="o8-signout-action" class="account-chip-signout-btn" type="button">Sign out</button>
  </div>
  <div id="o8-account-chip-confirm" class="account-chip-confirm" style="display:none;">
    <div class="account-chip-confirm-msg">Sign out of Brevmont?</div>
    <div class="account-chip-confirm-actions">
      <button id="o8-signout-cancel" class="account-chip-btn account-chip-btn-secondary" type="button">Cancel</button>
      <button id="o8-signout-confirm" class="account-chip-btn account-chip-btn-danger" type="button">Sign out</button>
    </div>
  </div>
</div>
`;
}
