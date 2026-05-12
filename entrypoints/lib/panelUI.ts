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
    <div style="font-size:12px;color:#6B7280;line-height:1.5;margin-bottom:4px;">Controls how Brevmont writes for you. Changes apply to your next generation.</div>
    <div class="settings-label">Tone</div>
    <div class="settings-options"><label><input type="radio" name="brevmont-tone" value="professional" checked> Professional</label><label><input type="radio" name="brevmont-tone" value="friendly"> Friendly</label><label><input type="radio" name="brevmont-tone" value="casual"> Casual</label><label><input type="radio" name="brevmont-tone" value="direct"> Direct</label></div>
    <div class="settings-label">Goal</div>
    <div class="settings-options"><label><input type="radio" name="brevmont-goal" value="close_deal" checked> Close the deal<span class="goal-desc">Ask for the sale, push for commitment</span></label><label><input type="radio" name="brevmont-goal" value="book_appointment"> Book appointment<span class="goal-desc">Get them on the lot or on a call</span></label><label><input type="radio" name="brevmont-goal" value="gather_info"> Gather info<span class="goal-desc">Learn what they need before pitching</span></label><label><input type="radio" name="brevmont-goal" value="nurture"> Nurture long-term<span class="goal-desc">Stay top of mind, no pressure</span></label></div>
    <div style="border-top:1px solid #E5E7EB;margin-top:14px;padding-top:10px"></div>
    <div class="settings-label">Account</div>
    <div id="sp-account-info" style="font-size:12px;color:#1a202c;display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;justify-content:space-between"><span style="color:#6B7280">Dealership</span><span id="sp-dealership" style="font-weight:600">—</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#6B7280">Rep</span><span id="sp-rep-name" style="font-weight:600">—</span></div>
      <div style="display:flex;justify-content:space-between;align-items:center"><span style="color:#6B7280">License</span><span style="display:flex;align-items:center;gap:4px"><code id="sp-license" style="font-size:11px;font-family:ui-monospace,monospace;color:#0D6E6E">—</code><button id="sp-copy-license" style="background:none;border:none;font-size:10px;color:#0D6E6E;cursor:pointer;font-weight:600">Copy</button></span></div>
      <div style="display:flex;justify-content:space-between;align-items:center"><span style="color:#6B7280">Status</span><span id="sp-status" style="display:flex;align-items:center;gap:4px"><span id="sp-status-dot" style="width:7px;height:7px;border-radius:50%;background:#F59E0B;display:inline-block"></span><span id="sp-status-text" style="font-size:11px;color:#6B7280">Checking</span></span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#6B7280">Version</span><span id="sp-version" style="font-size:11px;color:#9CA3AF">—</span></div>
      <div id="sp-queue-row" style="display:none;background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;padding:6px 8px;font-size:11px;color:#92400E;margin-top:2px"><span id="sp-queue-count">0</span> queued — will send when connection returns</div>
    </div>
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
  <svg class="header-icon" width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#0D6E6E"/><text x="12" y="16" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">BM</text></svg>
  <span class="logo">BREVMONT</span>
  <span class="version-badge" id="o8-version-badge"></span>
  <span style="flex:1"></span>
  ${badge.label ? `<span id="o8-platform-badge" style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;color:${badge.color};background:${badge.bg}">${esc(badge.label)}</span>` : '<span id="o8-platform-badge" style="display:none"></span>'}
  <button id="o8-lead-btn" class="lead-btn">+ Lead</button>
  <span id="o8-close" class="close">&times;</span>
</div>
<div id="o8-quick" class="quick-mode">
  ${customerCard}
  <div class="input-section">
    <div id="o8-first-use" class="first-use-card" style="display:none;">
      <div class="first-use-eyebrow">Try your first generation</div>
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
      <button id="o8-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button>
    </div>
    <div class="input-hint">One sentence. Three generations.</div>
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
    <div class="inline-links"><button id="o8-tools-btn-inline" class="link-btn nav-link">&#x1F4AC; Coach</button><span class="link-sep">|</span><button id="o8-stats-btn-inline" class="link-btn nav-link">&#x1F4CA; My Stats</button><span class="link-sep">|</span><button id="o8-settings-btn-inline" class="link-btn nav-link">&#x2699;&#xFE0F; Settings</button></div>
    <div class="tcpa-inline">Messages are for human review. TCPA compliance is your responsibility.</div>
  </div>
  <div id="o8-outputs" class="outputs"></div>
</div>
<div id="o8-tools-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-tools-back" class="back-btn">← Back</button><span class="tools-title">Coach</span></div>
  <div class="tool-tabs">
    <button class="tool-tab-btn active" data-tool="coach">Coach</button>
    <button class="tool-tab-btn" data-tool="alerts">Reminders</button>
    <button class="tool-tab-btn" data-tool="context">Screenshot Reply</button>
    <button class="tool-tab-btn" data-tool="command">Ask Anything</button>
  </div>
  <div id="tool-coach" class="tool-content" style="display:block"><div class="tool-section"><div class="input-wrap"><textarea id="o8-coach-input" class="main-input" placeholder="What did the customer just say?" rows="2"></textarea><button id="o8-coach-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><div class="coach-chips"><button class="coach-chip">Need to think about it</button><button class="coach-chip">Price too high</button><button class="coach-chip">Bad credit</button><button class="coach-chip">Spouse not here</button><button class="coach-chip">Just looking</button><button class="coach-chip">Trading in my car</button><button class="coach-chip">Found it cheaper</button><button class="coach-chip">Need to check with my bank</button></div><button id="o8-coach-btn" class="gen-btn">Coach Me</button></div><div id="o8-coach-output" class="tool-output"></div></div>
  <div id="tool-alerts" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><input id="o8-alert-input" class="main-input" placeholder="e.g., Call Sally back at 2pm about the Tahoe" /><button id="o8-alert-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-alert-btn" class="gen-btn" style="background:#0D6E6E">Set Reminder</button></div><div id="o8-alert-list" class="tool-output"></div></div>
  <div id="tool-context" class="tool-content" style="display:none"><div class="tool-section"><div id="o8-ctx-dropzone" class="ctx-dropzone" tabindex="0"><span>Paste a screenshot of the conversation (Ctrl+V)</span></div><button id="o8-ctx-capture" class="gen-btn" style="margin-top:8px;background:#1E3A5F">Capture Current Tab</button><div id="o8-ctx-preview" class="ctx-preview" style="display:none"><img id="o8-ctx-img" class="ctx-img" /><button id="o8-ctx-remove" class="ctx-remove">&times;</button></div><div class="input-wrap"><textarea id="o8-ctx-direction" class="main-input" placeholder="e.g., Politely follow up on the test drive" rows="2"></textarea><button id="o8-ctx-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-ctx-generate" class="gen-btn" disabled>Generate Reply</button></div><div id="o8-ctx-output" class="tool-output"></div></div>
  <div id="tool-command" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><textarea id="o8-cmd-input" class="main-input" placeholder="e.g., Calculate payment on $35,000 at 6.9% for 72mo" rows="2"></textarea><button id="o8-cmd-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-cmd-execute" class="gen-btn">Ask</button></div><div id="o8-cmd-status" class="tool-output"></div></div>
</div>
<div id="o8-stats-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-stats-back" class="back-btn">← Back</button><span class="tools-title">My Stats</span></div>
  <div id="o8-stats-content" class="tool-section" style="padding:12px;">
    <div style="text-align:center;color:#94a3b8;font-size:12px;padding:24px;">Loading stats...</div>
  </div>
</div>
<div id="o8-settings-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-settings-back" class="back-btn">← Back</button><span class="tools-title">Settings</span></div>
  ${getSettingsHTML()}
</div>
<div id="o8-lead-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-lead-back" class="back-btn">← Back</button><span class="tools-title">Capture Lead</span></div>
  <div class="tool-tabs">
    <button class="lead-tab-btn active" data-ltab="scan">Scan</button>
    <button class="lead-tab-btn" data-ltab="voice">Voice</button>
    <button class="lead-tab-btn" data-ltab="paste">Paste</button>
  </div>
  <div id="lead-scan" class="tool-content" style="display:block"><div class="tool-section"><button id="o8-scan-btn" class="gen-btn">Scan This Page</button><div style="font-size:11px;color:#9CA3AF;text-align:center;margin-top:8px">Reads this page and pulls name, phone, email, and vehicle of interest.</div><div id="o8-scan-empty" style="display:none;font-size:11px;color:#F59E0B;text-align:center;margin-top:8px;padding:8px;background:#FFFBEB;border-radius:6px;">No lead info found on this page. Try the Paste tab instead.</div></div></div>
  <div id="lead-voice" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><textarea id="o8-lead-voice-input" class="main-input" placeholder="Tap mic and describe the lead..." rows="3"></textarea><button id="o8-lead-voice-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-lead-voice-parse" class="gen-btn" style="margin-top:8px">Parse</button></div></div>
  <div id="lead-paste" class="tool-content" style="display:none"><div class="tool-section"><textarea id="o8-lead-paste-input" class="main-input" placeholder="Paste a text thread, email, or Facebook message with customer info..." rows="4"></textarea><button id="o8-lead-paste-parse" class="gen-btn" style="margin-top:8px">Parse</button></div></div>
  <div id="o8-lead-result" class="tool-content" style="display:none"></div>
</div>
`;
}
