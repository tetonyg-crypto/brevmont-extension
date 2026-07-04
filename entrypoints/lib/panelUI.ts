/**
 * Shared panel HTML generator.
 * Extracted from content.ts getHTML() so both the Side Panel page and the
 * legacy content-script DOM injection share the same markup.
 *
 * Platform-specific logic (VinSolutions customer card, placeholder text)
 * is driven by the `platform` parameter.
 */

type Platform = 'vinsolutions' | 'gmail' | 'facebook' | 'linkedin' | 'whatsapp' | 'instagram' | 'unknown';

export function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getBadge(platform: Platform) {
  switch (platform) {
    case 'vinsolutions': return { label: 'Dealer CRM', color: '#0D6E6E', bg: '#F0EFFF' };
    case 'gmail': return { label: 'Gmail', color: '#dc2626', bg: '#fef2f2' };
    case 'facebook': return { label: 'Messenger', color: '#1877f2', bg: '#eff6ff' };
    case 'linkedin': return { label: 'LinkedIn', color: '#0a66c2', bg: '#eff6ff' };
    case 'whatsapp': return { label: 'WhatsApp', color: '#25D366', bg: '#f0fdf4' };
    case 'instagram': return { label: 'Instagram', color: '#E1306C', bg: '#fef2f8' };
    default: return { label: '', color: '#64748b', bg: '#f1f5f9' };
  }
}

function getSettingsHTML(): string {
  return `<div class="settings-section">
    <div style="font-size:12px;color:#6B7280;line-height:1.5;margin-bottom:4px;">Controls how Brevmont writes for you. Changes apply to your next follow-up.</div>
    <div class="settings-label">Your name</div>
    <input id="sp-rep-first-name" class="settings-input" type="text" placeholder="First name" autocomplete="given-name" />
    <div class="settings-label">Tone</div>
    <div class="settings-options"><label><input type="radio" name="brevmont-tone" value="professional" checked> Professional</label><label><input type="radio" name="brevmont-tone" value="friendly"> Friendly</label><label><input type="radio" name="brevmont-tone" value="casual"> Casual</label><label><input type="radio" name="brevmont-tone" value="direct"> Direct</label></div>
    <div class="settings-label">Goal</div>
    <div class="settings-options"><label><input type="radio" name="brevmont-goal" value="close_deal" checked> Close the deal<span class="goal-desc">Ask for the sale, push for commitment</span></label><label><input type="radio" name="brevmont-goal" value="book_appointment"> Book appointment<span class="goal-desc">Get them on the lot or on a call</span></label><label><input type="radio" name="brevmont-goal" value="gather_info"> Gather info<span class="goal-desc">Learn what they need before pitching</span></label><label><input type="radio" name="brevmont-goal" value="nurture"> Nurture long-term<span class="goal-desc">Stay top of mind, no pressure</span></label></div>
    <button id="sp-save-settings" class="settings-save" type="button">Save preferences</button>
    <span id="sp-settings-saved" class="settings-saved">Saved</span>
    <div style="border-top:1px solid #E5E7EB;margin-top:14px;padding-top:10px;display:flex;flex-direction:column;gap:6px">
      <a id="sp-link-changelog" href="https://app.brevmont.com/changelog" target="_blank" rel="noopener" style="font-size:11px;color:#6B7280;text-decoration:none">Changelog</a>
      <button id="sp-link-help" style="background:none;border:none;padding:0;font-size:11px;color:#0D6E6E;cursor:pointer;text-align:left;font-weight:500;font-family:inherit">Get help</button>
      <button id="sp-link-report" style="background:none;border:none;padding:0;font-size:11px;color:#0D6E6E;cursor:pointer;text-align:left;font-weight:500;font-family:inherit">Report issue</button>
    </div>
  </div>`;
}

export function getPanelHTML(platform: Platform): string {
  const isVinSolutions = platform === 'vinsolutions';
  const badge = getBadge(platform);
  const customerCard = isVinSolutions ? `<div id="o8-card" class="card"><div id="o8-name" class="name" style="font-style:italic;color:#94a3b8">Open a customer record</div><div id="o8-vehicle" class="vehicle"></div><div id="o8-meta" class="meta"></div></div>` : '';
  const placeholder = 'e.g., Customer left the lot, wants to think about the payment';

  return `
<div class="header">
  <span class="version-badge" id="o8-version-badge"></span>
  <span style="flex:1"></span>
  ${badge.label ? `<span id="o8-platform-badge" style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;color:${badge.color};background:${badge.bg}">${esc(badge.label)}</span>` : '<span id="o8-platform-badge" style="display:none"></span>'}
  <button id="o8-account-btn" class="account-btn" type="button" title="Account" aria-label="Account">•</button>
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
  <div style="display:flex;align-items:center;gap:8px;">
    <span id="o8-overdrive-pill-dot" style="width:8px;height:8px;border-radius:50%;background:#94a3b8;flex-shrink:0;"></span>
    <div style="flex:1;min-width:0;line-height:1.35;">
      <div id="o8-overdrive-pill-title" style="font-weight:700;color:#0F1419;font-size:12px;">Overdrive: off</div>
      <div id="o8-overdrive-pill-sub" style="color:rgba(15,20,25,0.55);font-size:10.5px;margin-top:1px;">Auto-answers your Marketplace leads</div>
    </div>
    <button id="o8-overdrive-pill-toggle" type="button" style="background:#0D6E6E;color:#fff;border:0;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0;">Turn on</button>
  </div>
</div>
<div id="o8-challenge-banner" class="challenge-banner" style="display:none"></div>
<div id="o8-customer-stamp" class="customer-stamp" style="display:none"></div>
<div id="o8-customer-picker" class="customer-picker" style="display:none"></div>
<div id="o8-quick" class="quick-mode">
  ${customerCard}
  <div class="input-section">
    <div id="o8-first-use" class="first-use-card" style="display:none;">
      <button id="o8-first-use-dismiss" class="first-use-dismiss" type="button" aria-label="Dismiss onboarding banner">&times;</button>
      <div class="first-use-eyebrow">Try your first follow-up</div>
      <div class="first-use-title">Type one sentence about a customer.</div>
      <div class="first-use-copy">Brevmont will write a follow-up text, email, and CRM note. You review it, copy it, and move to the next deal.</div>
      <button id="o8-first-use-example" class="first-use-example" type="button">Use example</button>
    </div>
    <div class="chips">
      <button class="chip on" data-type="text">Message</button>
      <button class="chip on" data-type="email">Email</button>
      <button class="chip on" data-type="crm">CRM Note</button>
    </div>
    <div class="input-wrap">
      <textarea id="o8-input" class="main-input" placeholder="${esc(placeholder)}" rows="3"></textarea>
      <button id="o8-customer-open" class="customer-picker-trigger" title="Stamp to a customer" type="button">Customer</button>
      <button id="o8-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button>
    </div>
    <div class="input-hint">One sentence. Text, email, CRM note.</div>
    <button id="o8-generate" class="gen-btn">Generate</button>
    <div id="o8-usage-counter" class="usage-counter" style="display:none;"></div>
    <div id="o8-upgrade-prompt" class="upgrade-prompt" style="display:none;"></div>
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
    <button class="tool-tab-btn" data-tool="context">Screenshot Reply</button>
    <button class="tool-tab-btn" data-tool="command">Ask Anything</button>
  </div>
  <div id="tool-coach" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><textarea id="o8-coach-input" class="main-input" placeholder="What did the customer just say?" rows="2"></textarea><button id="o8-coach-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><div class="coach-chips"><button class="coach-chip">Need to think about it</button><button class="coach-chip">Price too high</button><button class="coach-chip">Bad credit</button><button class="coach-chip">Spouse not here</button><button class="coach-chip">Just looking</button><button class="coach-chip">Trading in my car</button><button class="coach-chip">Found it cheaper</button><button class="coach-chip">Need to check with my bank</button></div><button id="o8-coach-btn" class="gen-btn">Coach Me</button></div><div id="o8-coach-output" class="tool-output"></div></div>
  <div id="tool-alerts" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><input id="o8-alert-input" class="main-input" placeholder="e.g., Call Sally back at 2pm about the Tahoe" /><button id="o8-alert-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-alert-btn" class="gen-btn" style="background:#0D6E6E">Set Reminder</button></div><div id="o8-alert-list" class="tool-output"></div></div>
  <div id="tool-context" class="tool-content" style="display:none"><div class="tool-section"><div id="o8-ctx-dropzone" class="ctx-dropzone" tabindex="0"><span>Paste a screenshot of the conversation (Ctrl+V)</span></div><button id="o8-ctx-capture" class="gen-btn" style="margin-top:8px;background:#1E3A5F">Capture Current Tab</button><div id="o8-ctx-preview" class="ctx-preview" style="display:none"><img id="o8-ctx-img" class="ctx-img" /><button id="o8-ctx-remove" class="ctx-remove">&times;</button></div><div class="input-wrap"><textarea id="o8-ctx-direction" class="main-input" placeholder="e.g., Politely follow up on the test drive" rows="2"></textarea><button id="o8-ctx-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-ctx-generate" class="gen-btn" disabled>Generate Reply</button></div><div id="o8-ctx-output" class="tool-output"></div></div>
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
  <div id="o8-going-dark-alerts" class="tool-section" style="padding:12px 14px 0;display:none"></div>
  <div id="o8-my-leads-content" class="tool-section" style="padding:12px 14px;">
    <div style="text-align:center;color:#94a3b8;font-size:12px;padding:24px;">Loading your pipeline...</div>
  </div>
</div>
<div id="o8-settings-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-settings-back" class="back-btn">&larr; Back</button><span class="tools-title">Settings</span></div>
  ${getSettingsHTML()}
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
