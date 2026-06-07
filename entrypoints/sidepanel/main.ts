/**
 * Brevmont Side Panel — main entry point.
 *
 * Runs inside Chrome's native Side Panel (browser chrome, NOT the host page).
 * Communicates with content scripts via chrome.runtime message passing through
 * the background service worker.
 *
 * Phase 1: shell bootstrap + message bridge skeleton.
 * Phase 2: full panel UI extracted from content.ts getHTML/getCSS.
 */

import { getPanelHTML } from '../lib/panelUI';
import { getPanelCSS } from '../lib/panelCSS';
import {
  appendFreeTierEmailSignature,
  BREVMONT_CWS_REVIEWS,
  dismissedReviewState,
  LOCAL_GENERATION_COUNT_KEY,
  reviewClickedState,
  REVIEW_PROMPT_STATE_KEY,
  shouldShowReviewPrompt,
} from '../lib/cwsDistribution';
import { clearJwtCache } from '../../lib/jwtCache';
import { clearAuth } from '../../lib/storage';
import { getFeatureAccess } from '../../lib/featureGate';

// ─── Types ───────────────────────────────────────────────────────────────────
type Platform = 'vinsolutions' | 'gmail' | 'facebook' | 'linkedin' | 'whatsapp' | 'instagram' | 'unknown';

interface PlatformContext {
  platform: Platform;
  tabId: number;
  url: string;
}

interface VersionStatus {
  locked?: boolean;
  deprecated?: boolean;
  updateRequired?: boolean;
  forceUpdate?: boolean;
  message?: string | null;
  latest?: string | null;
  downloadUrl?: string | null;
}

interface PinnedCustomer {
  id: string;
  name: string;
  vehicle?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  confidence?: number | null;
  detectionMethod: string;
  pinnedAt: number;
}

// ─── State ───────────────────────────────────────────────────────────────────
let currentPlatform: PlatformContext = { platform: 'unknown', tabId: -1, url: '' };
let isGenerating = false;
let challengePollTimer: number | null = null;
let pinnedCustomer: PinnedCustomer | null = null;
let pendingCustomerSuggestion: any = null;
let customerDetectionTimer: number | null = null;
let customerDetectionUrl = '';
const dismissedChallengeIds = new Set<string>();
const FIRST_GENERATION_KEY = 'first_generation_completed';
const ONBOARDING_BANNER_DISMISSED_KEY = 'onboarding_banner_dismissed';
const FIRST_GENERATION_EXAMPLE = 'Follow up with John about the Silverado, he wanted to think about the payment';
const CONTEXT_SCREENSHOT_TARGET_BYTES = 1_600_000;
const CONTEXT_SCREENSHOT_MAX_DIMS = [1800, 1600, 1400, 1200, 1000, 850];
const CONTEXT_SCREENSHOT_QUALITIES = [0.82, 0.74, 0.66, 0.58, 0.5];
const CONTEXT_PAGE_TEXT_MAX = 5000;
const GENERATION_FAILURE_MESSAGE = 'Generation failed. Try again or contact support@brevmont.com';

const AUTH_SYNC_KEYS = [
  'license_key',
  'license_secret',
  'brevmont_license_secret',
  'dealer_token',
  'rep_auth_token',
  'brevmont_rep_auth_token',
  'rep_id',
  'rep_name',
  'dealership_id',
  'dealership',
  'profile_onboarded',
  'profile',
  'install_token',
  'brevmont_tier',
  'dealership_tier',
  'dealership_plan',
];

async function clearCredentialsForReconnect(): Promise<void> {
  await Promise.allSettled([
    clearJwtCache(),
    clearAuth(),
    chrome.storage.sync.remove(AUTH_SYNC_KEYS),
    chrome.storage.local.remove([
      'license_revoked',
      'license_revoked_at',
      'license_revoked_message',
      'brevmont_jwt_cache',
      'brevmont_tier',
      'dealership_tier',
      'dealership_plan',
      'brevmont_features',
      'brevmont_usage',
    ]),
  ]);
}

// ─── Platform detection from URL (no DOM access needed) ──────────────────────
function detectPlatformFromURL(url: string): Platform {
  if (!url) return 'unknown';
  if (url.includes('vinsolutions') || url.includes('coxautoinc')) return 'vinsolutions';
  if (url.includes('mail.google.com')) return 'gmail';
  if (url.includes('messenger.com') || url.includes('facebook.com/messages') || url.includes('facebook.com/marketplace/t/')) return 'facebook';
  if (url.includes('facebook.com')) return 'facebook';
  if (url.includes('linkedin.com')) return 'linkedin';
  if (url.includes('instagram.com/direct')) return 'instagram';
  if (url.includes('instagram.com')) return 'unknown';
  if (url.includes('web.whatsapp.com')) return 'whatsapp';
  return 'unknown';
}

// ─── Badge config per platform (matches content.ts getBadge) ─────────────────
function getBadge(platform: Platform) {
  switch (platform) {
    case 'vinsolutions': return { label: 'Dealer CRM', color: '#0D6E6E', bg: '#F0EFFF' };
    case 'gmail': return { label: 'Gmail', color: '#dc2626', bg: '#fef2f2' };
    case 'facebook': return { label: 'Facebook', color: '#1877f2', bg: '#eff6ff' };
    case 'linkedin': return { label: 'LinkedIn', color: '#0a66c2', bg: '#eff6ff' };
    case 'whatsapp': return { label: 'WhatsApp', color: '#25D366', bg: '#f0fdf4' };
    case 'instagram': return { label: 'Instagram', color: '#E1306C', bg: '#fef2f8' };
    default: return { label: '', color: '#64748b', bg: '#f1f5f9' };
  }
}

// ─── Escape HTML ─────────────────────────────────────────────────────────────
function esc(s: string) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const DISPLAY_LABELS: Record<string, string> = {
  NO_OBJECTION: 'No objection raised',
  PRICE_TOO_HIGH: 'Price too high',
  PAYMENT_SHOCK: 'Payment shock',
  SPOUSE_NOT_HERE: 'Spouse not present',
  JUST_LOOKING: 'Just looking',
  TRADE_VALUE: 'Trade value concern',
  CREDIT: 'Credit concern',
  FOUND_CHEAPER: 'Found it cheaper',
  NEED_TO_THINK: 'Needs to think',
  captured: 'Captured',
  contacted: 'Contacted',
  appointment_set: 'Appt set',
  showed: 'Showed',
  sold: 'Sold',
  lost: 'Lost',
  logged_to_crm: 'Logged to CRM',
  text: 'Text follow-up',
  text_message: 'Text follow-up',
  email: 'Email follow-up',
  crm: 'CRM note',
  crm_note: 'CRM note',
  coach: 'Coach',
  command: 'Ask Anything',
  screenshot_reply: 'Screenshot reply',
  gmail: 'Gmail',
  facebook: 'Facebook',
  messenger: 'Messenger',
  linkedin: 'LinkedIn',
  vinsolutions: 'Dealer CRM',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  extension: 'Extension',
};

function stripMarkdownText(value: unknown): string {
  return String(value ?? '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMarkdownPreserveLines(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function displayOutputContent(content: string, outputType?: string): string {
  if (outputType === 'email') return stripMarkdownPreserveLines(content) || content;
  return stripMarkdownText(content) || content;
}

function getDisplayLabel(value: unknown): string {
  const raw = stripMarkdownText(value);
  if (!raw || /^[-\s]+$/.test(raw)) return '';
  if (DISPLAY_LABELS[raw]) return DISPLAY_LABELS[raw];
  const lower = raw.toLowerCase();
  if (DISPLAY_LABELS[lower]) return DISPLAY_LABELS[lower];
  return lower
    .replace(/^crm[._-]/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function displayText(value: unknown, fallback = 'No data yet'): string {
  const text = stripMarkdownText(value);
  if (!text || /^[-\s]+$/.test(text) || /^(null|undefined)$/i.test(text)) return fallback;
  return text;
}

function optionalDisplayText(value: unknown): string {
  const text = displayText(value, '');
  return text === 'No data yet' ? '' : text;
}

function csvField(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function truncateCsv(value: unknown, max = 500): string {
  const s = stripMarkdownText(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function normalizeEventPlatform(platform: Platform): string {
  if (platform === 'facebook') return 'messenger';
  if (platform === 'gmail' || platform === 'linkedin' || platform === 'vinsolutions') return platform;
  return 'unknown';
}

function normalizeOutputType(outputType?: string): 'text' | 'email' | 'crm_note' {
  if (outputType === 'email') return 'email';
  if (outputType === 'crm') return 'crm_note';
  return 'text';
}

function hasVehicleOrBuyingSignal(rawText: unknown): boolean {
  const raw = String(rawText || '');
  return /\b(?:19|20)\d{2}\s*(?:Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian|Tacoma|Silverado|Tahoe|Suburban|F-?150|Camry|Corolla|Accord|Civic|Telluride|Sorento|Sportage)\b/i.test(raw)
    || /\b(?:buy|purchase|quote|price|pricing|payment|finance|lease|trade(?:-?in)?|test drive|appointment|interested|availability|in stock|inventory|fleet|company car|work truck|vehicle inquiry|looking for|need|want)\b/i.test(raw);
}

function extractVehicleMention(rawText: unknown): string | null {
  const raw = String(rawText || '');
  const yearMakeModel = raw.match(/\b((?:19|20)\d{2}\s+(?:Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian)\s+[A-Za-z0-9-]+(?:\s+[A-Za-z0-9-]+){0,2})\b/i);
  const yearModel = raw.match(/\b((?:19|20)\d{2}\s+(?:Tacoma|Tundra|Camry|Corolla|RAV4|Highlander|Silverado|Sierra|Suburban|Tahoe|Colorado|Equinox|Malibu|F-?150|F-?250|Explorer|Escape|Bronco|Wrangler|Cherokee|Grand Cherokee|Pilot|Civic|Accord|CR-V|Telluride|Sorento|Sportage|Outback|Forester|Crosstrek|Ascent|Model [3YSX]))\b/i);
  const modelOnly = raw.match(/\b(Silverado|Telluride|Tahoe|Suburban|Tacoma|Tundra|Camry|Corolla|RAV4|Highlander|Sierra|Colorado|Equinox|Malibu|F-?150|F-?250|Explorer|Escape|Bronco|Wrangler|Grand Cherokee|Cherokee|Pilot|Civic|Accord|CR-V|Sorento|Sportage|Outback|Forester|Crosstrek|Ascent|Model [3YSX])\b/i);
  return (yearMakeModel?.[1] || yearModel?.[1] || modelOnly?.[1] || null)?.replace(/\s+/g, ' ').trim() || null;
}

function looksLikeSystemSender(rawText: unknown): boolean {
  const raw = String(rawText || '').toLowerCase();
  return /(?:brevmont\.com|onboarding@|no-?reply|donotreply|mailer-daemon|mailchimp|sendgrid|twilio|stripe|google calendar|calendly|resend|postmark|mailgun)/i.test(raw);
}

function isSystemPasteWithoutBuyingSignal(rawText: unknown): boolean {
  return looksLikeSystemSender(rawText) && !hasVehicleOrBuyingSignal(rawText);
}

function downloadCsvFile(filename: string, rows: unknown[][]): void {
  const csv = rows.map(row => row.map(csvField).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Send message to background and get response ─────────────────────────────
const BACKGROUND_RESPONSE_TIMEOUT_MS = 75_000;

// Keep this longer than the background generation polling window. Otherwise
// the panel can show a generic message timeout while the worker is still
// polling a healthy queued generation.
function safeSend(msg: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timed out — please try again.'));
    }, BACKGROUND_RESPONSE_TIMEOUT_MS);

    chrome.runtime.sendMessage(msg, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'Message send failed'));
        return;
      }
      // Chrome auto-completes the channel with undefined when the background
      // handler never calls sendResponse (e.g., service worker restart).
      if (response === undefined || response === null) {
        reject(new Error('No response from background — try again.'));
        return;
      }
      // Surface API errors instead of silently swallowing them.
      // Background handlers send { error: '...' } when the API fails.
      if (response?.error && typeof response.error === 'string') {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

// ─── Token check helper — avoids sending API calls destined to 401 ──────────
function accessEndedMessage(message?: string): string {
  return message || 'Your access at this dealership has ended. Been invited to a new store? Open Settings and reconnect.';
}

async function requireToken(): Promise<string> {
  const [sync, local] = await Promise.all([
    chrome.storage.local.get(['dealer_token', 'rep_auth_token']),
    chrome.storage.local.get(['dealer_token', 'rep_auth_token', 'brevmont_rep_auth_token', 'license_revoked', 'license_revoked_message']),
  ]);
  if (local.license_revoked) {
    throw new Error(accessEndedMessage(local.license_revoked_message as string | undefined));
  }
  const token = (
    sync.dealer_token ||
    local.dealer_token ||
    sync.rep_auth_token ||
    local.rep_auth_token ||
    local.brevmont_rep_auth_token ||
    ''
  ) as string;
  if (!token) throw new Error('Brevmont is not activated. Open Settings and activate your rep account.');
  return token;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isContentScriptMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /receiving end does not exist|could not establish connection|no tab with id/i.test(message);
}

function canInjectIntoUrl(url?: string): boolean {
  if (!url) return false;
  return /^https?:\/\/(mail\.google\.com|[^/]+\.vinsolutions\.com|vinsolutions\.app\.coxautoinc\.com|[^/]+\.facebook\.com|www\.facebook\.com|[^/]+\.messenger\.com|www\.messenger\.com|[^/]+\.linkedin\.com|www\.linkedin\.com|[^/]+\.instagram\.com|www\.instagram\.com|web\.whatsapp\.com)\//i.test(url);
}

function tabMessage(tabId: number, msg: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'Content message failed'));
        return;
      }
      resolve(response);
    });
  });
}

async function ensureContentScript(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (!canInjectIntoUrl(tab.url)) {
    throw new Error('Open Gmail, VinSolutions, or a supported sales page, then try Inject again.');
  }

  if (!chrome.scripting?.executeScript) {
    throw new Error('Reload the extension and this page, then try Inject again.');
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content-scripts/content.js'],
    });
    await sleep(150);
  } catch (error: any) {
    throw new Error(error?.message || 'Could not connect Brevmont to this page. Reload the page and try again.');
  }
}

// ─── Send message to content script in active tab ────────────────────────────
async function sendToContent(msg: any): Promise<any> {
  await refreshPlatform();
  if (currentPlatform.tabId < 0) return null;

  try {
    return await tabMessage(currentPlatform.tabId, msg);
  } catch (error) {
    if (!isContentScriptMissing(error)) throw error;
    await ensureContentScript(currentPlatform.tabId);
    return await tabMessage(currentPlatform.tabId, msg);
  }
}

// ─── Detect active tab platform ─────────────────────────────────────────────
function dataUrlByteLength(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function loadDataUrlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read screenshot.'));
    image.src = dataUrl;
  });
}

async function optimizeContextScreenshot(dataUrl: string): Promise<{
  dataUrl: string;
  bytes: number;
  width: number;
  height: number;
  originalBytes: number;
  originalWidth: number;
  originalHeight: number;
}> {
  const image = await loadDataUrlImage(dataUrl);
  const originalBytes = dataUrlByteLength(dataUrl);
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;

  let best = {
    dataUrl,
    bytes: originalBytes,
    width: originalWidth,
    height: originalHeight,
  };

  for (const maxDim of CONTEXT_SCREENSHOT_MAX_DIMS) {
    const scale = Math.min(1, maxDim / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare screenshot.');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    for (const quality of CONTEXT_SCREENSHOT_QUALITIES) {
      const candidate = canvas.toDataURL('image/jpeg', quality);
      const bytes = dataUrlByteLength(candidate);
      if (bytes < best.bytes) best = { dataUrl: candidate, bytes, width, height };
      if (bytes <= CONTEXT_SCREENSHOT_TARGET_BYTES) {
        return { ...best, originalBytes, originalWidth, originalHeight };
      }
    }
  }

  return { ...best, originalBytes, originalWidth, originalHeight };
}

function cleanContextText(value: unknown, max = CONTEXT_PAGE_TEXT_MAX): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function collectContextReplyPageText(): Promise<string> {
  const parts: string[] = [];

  try {
    const ctx = await sendToContent({ type: 'GET_CONVERSATION_TEXT' });
    const text = cleanContextText(ctx?.text);
    if (text) parts.push(`Visible conversation text: ${text}`);
  } catch {}

  try {
    const lead = await sendToContent({ type: 'GET_LEAD_CONTEXT' });
    const leadBits = [
      lead?.customerName ? `Customer: ${lead.customerName}` : '',
      lead?.phone ? `Phone: ${lead.phone}` : '',
      lead?.email ? `Email: ${lead.email}` : '',
      (lead?.vehicle || lead?.vehicleOfInterest) ? `Vehicle: ${lead.vehicle || lead.vehicleOfInterest}` : '',
      lead?.source ? `Source: ${lead.source}` : '',
    ].filter(Boolean);
    if (leadBits.length) parts.push(`Detected lead context: ${leadBits.join(' | ')}`);
  } catch {}

  return cleanContextText(parts.join('\n'), CONTEXT_PAGE_TEXT_MAX);
}

async function collectCurrentLeadContext(): Promise<any> {
  try {
    const lead = await sendToContent({ type: 'GET_LEAD_CONTEXT' });
    if (lead && typeof lead === 'object') return lead;
  } catch {}
  return {};
}

function customerStampPayload(): Record<string, any> {
  if (!pinnedCustomer) return {};
  return {
    customer_id: pinnedCustomer.id,
    detection_method: pinnedCustomer.detectionMethod || 'auto_pin',
    detection_confidence: pinnedCustomer.confidence ?? 1,
    vehicle_context: pinnedCustomer.vehicle || null,
  };
}

function enrichLeadContextWithPinnedCustomer(leadContext: any = {}): any {
  if (!pinnedCustomer) return leadContext || {};
  return {
    ...(leadContext || {}),
    customer_id: pinnedCustomer.id,
    customerName: pinnedCustomer.name,
    customer_name: pinnedCustomer.name,
    name: pinnedCustomer.name,
    phone: pinnedCustomer.phone || leadContext?.phone || null,
    email: pinnedCustomer.email || leadContext?.email || null,
    vehicle: pinnedCustomer.vehicle || leadContext?.vehicle || leadContext?.vehicleOfInterest || null,
    vehicleOfInterest: pinnedCustomer.vehicle || leadContext?.vehicleOfInterest || leadContext?.vehicle || null,
    source: pinnedCustomer.source || leadContext?.source || currentPlatform.platform,
    detectionMethod: pinnedCustomer.detectionMethod,
    detection_method: pinnedCustomer.detectionMethod,
    detectionConfidence: pinnedCustomer.confidence ?? leadContext?.detectionConfidence ?? 1,
    detection_confidence: pinnedCustomer.confidence ?? leadContext?.detection_confidence ?? 1,
  };
}

function getCustomerNameFromContext(ctx: any): string {
  return String(ctx?.customerName || ctx?.customer_name || ctx?.name || '').trim();
}

function getCustomerVehicleFromContext(ctx: any): string | null {
  return optionalDisplayText(ctx?.vehicle || ctx?.vehicleOfInterest || ctx?.vehicle_interest || ctx?.vehicle_of_interest) || null;
}

async function resolveCustomerForDetection(ctx: any): Promise<PinnedCustomer | null> {
  const name = getCustomerNameFromContext(ctx);
  if (!name) return null;
  const payload = {
    name,
    phone: ctx?.phone || ctx?.customer_phone || null,
    email: ctx?.email || ctx?.customer_email || null,
    vehicle: getCustomerVehicleFromContext(ctx),
    vehicle_interest: getCustomerVehicleFromContext(ctx),
    source: ctx?.source || currentPlatform.platform,
  };

  let record: any = null;
  try {
    const match = await safeSend({ type: 'CUSTOMER_MATCH', payload });
    if (match?.match && Number(match.confidence || 0) >= 0.7) record = match.match;
  } catch {}

  if (!record) {
    try {
      const created = await safeSend({ type: 'CUSTOMER_CREATE', payload });
      record = created?.customer || created;
    } catch {
      return null;
    }
  }

  const id = String(record?.id || '').trim();
  if (!id) return null;
  return {
    id,
    name: record.name || name,
    vehicle: record.vehicle_interest || payload.vehicle || null,
    phone: record.phone || payload.phone || null,
    email: record.email || payload.email || null,
    source: record.source || payload.source || null,
    confidence: Number(ctx?.detectionConfidence ?? ctx?.detection_confidence ?? 1),
    detectionMethod: ctx?.detectionMethod || ctx?.detection_method || 'auto_page',
    pinnedAt: Date.now(),
  };
}

function pinCustomer(root: HTMLElement, customer: PinnedCustomer | null): void {
  if (!customer?.id || !customer.name) return;
  pinnedCustomer = { ...customer, pinnedAt: Date.now() };
  pendingCustomerSuggestion = null;
  renderCustomerStamp(root);
}

function clearPinnedCustomer(root: HTMLElement): void {
  pinnedCustomer = null;
  pendingCustomerSuggestion = null;
  renderCustomerStamp(root);
}

function renderCustomerStamp(root: HTMLElement): void {
  const stamp = root.querySelector('#o8-customer-stamp') as HTMLElement | null;
  const picker = root.querySelector('#o8-customer-picker') as HTMLElement | null;
  if (!stamp) return;
  if (picker && (pinnedCustomer || pendingCustomerSuggestion)) picker.style.display = 'none';

  if (pinnedCustomer) {
    stamp.style.display = 'block';
    stamp.innerHTML = `
      <div class="customer-stamp-row">
        <span class="customer-stamp-badge"></span>
        <div style="min-width:0;flex:1">
          <div class="customer-stamp-main">${esc(pinnedCustomer.name)}</div>
          <div class="customer-stamp-sub">${esc(pinnedCustomer.vehicle || 'Customer context active')}</div>
        </div>
        <div class="customer-stamp-actions">
          <button class="customer-stamp-btn" id="o8-customer-change" type="button">Change</button>
          <button class="customer-stamp-clear" id="o8-customer-clear" type="button" aria-label="Clear customer">&times;</button>
        </div>
      </div>
    `;
    stamp.querySelector('#o8-customer-change')?.addEventListener('click', () => openCustomerPicker(root));
    stamp.querySelector('#o8-customer-clear')?.addEventListener('click', () => clearPinnedCustomer(root));
    return;
  }

  if (pendingCustomerSuggestion) {
    const name = getCustomerNameFromContext(pendingCustomerSuggestion);
    const vehicle = getCustomerVehicleFromContext(pendingCustomerSuggestion);
    if (!name) {
      stamp.style.display = 'none';
      stamp.innerHTML = '';
      return;
    }
    stamp.style.display = 'block';
    stamp.innerHTML = `
      <div class="customer-stamp-row">
        <span class="customer-stamp-badge"></span>
        <div style="min-width:0;flex:1">
          <div class="customer-stamp-main">This for ${esc(name)}?</div>
          <div class="customer-stamp-sub">${esc(vehicle || 'Confirm once, then keep working.')}</div>
        </div>
        <div class="customer-stamp-actions">
          <button class="customer-stamp-btn primary" id="o8-customer-yes" type="button">Yes</button>
          <button class="customer-stamp-btn" id="o8-customer-no" type="button">No</button>
        </div>
      </div>
    `;
    stamp.querySelector('#o8-customer-yes')?.addEventListener('click', async () => {
      const resolved = await resolveCustomerForDetection(pendingCustomerSuggestion);
      if (resolved) {
        pinCustomer(root, { ...resolved, detectionMethod: 'one_tap' });
        showToast(root, 'Customer stamped');
      } else {
        showToast(root, 'Could not stamp customer. You can still keep working.');
      }
    });
    stamp.querySelector('#o8-customer-no')?.addEventListener('click', () => {
      pendingCustomerSuggestion = null;
      renderCustomerStamp(root);
    });
    return;
  }

  stamp.style.display = 'none';
  stamp.innerHTML = '';
}

async function openCustomerPicker(root: HTMLElement): Promise<void> {
  const picker = root.querySelector('#o8-customer-picker') as HTMLElement | null;
  if (!picker) return;

  picker.style.display = 'block';
  picker.innerHTML = `
    <div class="customer-picker-head">
      <div class="customer-picker-title">Who's this for?</div>
      <button id="o8-customer-picker-close" class="customer-picker-close" type="button" aria-label="Close customer picker">&times;</button>
    </div>
    <input id="o8-customer-search" class="customer-picker-input" placeholder="Search customer..." />
    <div id="o8-customer-picker-list" class="customer-picker-list">
      <div class="customer-picker-row"><div class="customer-picker-meta">Loading recent customers...</div></div>
    </div>
    <div class="customer-picker-actions">
      <button id="o8-customer-new" type="button">New customer</button>
      <button id="o8-customer-skip" type="button">Skip</button>
    </div>
  `;

  const input = picker.querySelector('#o8-customer-search') as HTMLInputElement | null;
  const list = picker.querySelector('#o8-customer-picker-list') as HTMLElement | null;
  picker.querySelector('#o8-customer-picker-close')?.addEventListener('click', () => {
    picker.style.display = 'none';
  });

  const renderList = (customers: any[]) => {
    if (!list) return;
    if (!customers.length) {
      list.innerHTML = '<div class="customer-picker-row"><div class="customer-picker-meta">No customers found. Create one from the name above.</div></div>';
      return;
    }
    list.innerHTML = customers.map((customer) => `
      <button class="customer-picker-row" data-customer-id="${esc(customer.id)}" type="button">
        <div class="customer-picker-name">${esc(customer.name || 'Unnamed customer')}</div>
        <div class="customer-picker-meta">${esc(customer.vehicle_interest || customer.phone || customer.email || 'Recent customer')}</div>
      </button>
    `).join('');
    list.querySelectorAll<HTMLButtonElement>('.customer-picker-row[data-customer-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const customer = customers.find((item) => String(item.id) === button.dataset.customerId);
        if (!customer) return;
        pinCustomer(root, {
          id: customer.id,
          name: customer.name,
          vehicle: customer.vehicle_interest || null,
          phone: customer.phone || null,
          email: customer.email || null,
          source: customer.source || null,
          confidence: 1,
          detectionMethod: 'manual',
          pinnedAt: Date.now(),
        });
      });
    });
  };

  const load = async (search = '') => {
    try {
      const resp = await safeSend({ type: 'CUSTOMER_LIST', payload: { search, limit: 8 } });
      renderList(Array.isArray(resp?.customers) ? resp.customers : []);
    } catch {
      renderList([]);
    }
  };

  await load('');

  let debounce: number | null = null;
  input?.addEventListener('input', () => {
    if (debounce) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => load(input.value.trim()), 200);
  });

  picker.querySelector('#o8-customer-new')?.addEventListener('click', async () => {
    const typed = input?.value.trim();
    const ctx = pendingCustomerSuggestion || await collectCurrentLeadContext();
    const name = typed || getCustomerNameFromContext(ctx);
    if (!name) {
      showToast(root, 'Type a customer name first.');
      return;
    }
    const resolved = await resolveCustomerForDetection({ ...ctx, name, customerName: name, detectionMethod: 'manual', detectionConfidence: 1 });
    if (resolved) pinCustomer(root, { ...resolved, detectionMethod: 'manual', confidence: 1 });
  });

  picker.querySelector('#o8-customer-skip')?.addEventListener('click', () => {
    pinnedCustomer = null;
    pendingCustomerSuggestion = null;
    picker.style.display = 'none';
    renderCustomerStamp(root);
  });
}

async function refreshCustomerDetection(root: HTMLElement): Promise<void> {
  let ctx: any = {};
  try {
    ctx = await collectCurrentLeadContext();
  } catch {
    return;
  }

  const name = getCustomerNameFromContext(ctx);
  if (!name) {
    pendingCustomerSuggestion = null;
    if (!pinnedCustomer) renderCustomerStamp(root);
    return;
  }

  const confidence = Number(ctx?.detectionConfidence ?? ctx?.detection_confidence ?? 0.5);
  const currentName = pinnedCustomer?.name?.toLowerCase();
  const detectedName = name.toLowerCase();
  const isSamePinned = currentName && currentName === detectedName;

  if (isSamePinned) return;

  if (confidence >= 0.8) {
    const resolved = await resolveCustomerForDetection(ctx);
    if (resolved) {
      pinCustomer(root, { ...resolved, detectionMethod: ctx?.detectionMethod || ctx?.detection_method || 'auto_page' });
    }
    return;
  }

  if (!pinnedCustomer && confidence >= 0.5) {
    pendingCustomerSuggestion = ctx;
    renderCustomerStamp(root);
  }
}

function startCustomerDetection(root: HTMLElement): void {
  if (customerDetectionTimer) window.clearInterval(customerDetectionTimer);
  customerDetectionUrl = currentPlatform.url || '';
  renderCustomerStamp(root);
  refreshCustomerDetection(root).catch(() => {});
  customerDetectionTimer = window.setInterval(async () => {
    await refreshPlatform();
    const activeUrl = currentPlatform.url || '';
    if (activeUrl !== customerDetectionUrl) {
      customerDetectionUrl = activeUrl;
      pendingCustomerSuggestion = null;
    }
    refreshCustomerDetection(root).catch(() => {});
  }, 3000);
}

async function refreshPlatform(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && tab.id) {
      const platform = detectPlatformFromURL(tab.url);
      currentPlatform = { platform, tabId: tab.id, url: tab.url };
    } else {
      currentPlatform = { platform: 'unknown', tabId: -1, url: '' };
    }
  } catch {
    currentPlatform = { platform: 'unknown', tabId: -1, url: '' };
  }
}

// ─── Free tier usage counter ────────────────────────────────────────────────
type GenerationUsage = {
  generations_used?: number;
  generations_limit?: number;
  generations_remaining?: number;
  resets_at?: string | null;
};

function normalizeUsageTier(tier: unknown): string {
  const value = String(tier || '').trim().toLowerCase();
  return value === 'free' ? 'free_trial' : value;
}

function isLimitedFreeTier(tier: unknown): boolean {
  return normalizeUsageTier(tier) === 'free_trial';
}

async function contentForEmailOutput(raw: string): Promise<string> {
  const data = await chrome.storage.local.get(['brevmont_tier']).catch(() => ({}));
  return isLimitedFreeTier(data.brevmont_tier) ? appendFreeTierEmailSignature(raw) : raw;
}

function renderUsageWarning(root: HTMLElement, remaining: number, limit: number): void {
  const prompt = root.querySelector('#o8-upgrade-prompt') as HTMLElement;
  if (!prompt) return;
  prompt.style.display = 'block';
  prompt.innerHTML = `
    <div class="upgrade-title">${remaining} follow-ups remaining this month.</div>
    <div class="upgrade-msg">Want unlimited? Ask your GM to unlock the dashboard.</div>
    <button id="o8-tell-gm" class="upgrade-btn" type="button">Tell My GM -></button>
  `;
  const button = prompt.querySelector('#o8-tell-gm') as HTMLButtonElement | null;
  if (button) button.onclick = () => showInviteGmModal(root, { generations_used: limit - remaining, generations_limit: limit, generations_remaining: remaining });
}

function hideUsageWarning(root: HTMLElement): void {
  const prompt = root.querySelector('#o8-upgrade-prompt') as HTMLElement | null;
  if (prompt) prompt.style.display = 'none';
}

function renderUsageCounter(root: HTMLElement, tier: unknown, usage?: GenerationUsage): void {
  const counter = root.querySelector('#o8-usage-counter') as HTMLElement;
  if (!counter) return;

  if (!isLimitedFreeTier(tier) || !usage) {
    counter.style.display = 'none';
    hideUsageWarning(root);
    const generateButton = root.querySelector('#o8-generate') as HTMLButtonElement | null;
    if (generateButton && !isGenerating) {
      generateButton.disabled = false;
      generateButton.title = '';
    }
    return;
  }

  const used = Number(usage.generations_used || 0);
  const limit = Number(usage.generations_limit || 500);
  const remaining = Math.max(0, Number.isFinite(Number(usage.generations_remaining)) ? Number(usage.generations_remaining) : limit - used);
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const generateButton = root.querySelector('#o8-generate') as HTMLButtonElement | null;

  counter.style.display = 'block';
  counter.className = 'usage-counter' + (pct >= 100 ? ' usage-critical' : pct >= 90 ? ' usage-warning' : '');
  counter.innerHTML = `<span>${used} / ${limit} this month</span><div class="usage-bar"><div class="usage-fill" style="width:${pct}%"></div></div>`;
  chrome.action?.setBadgeBackgroundColor?.({ color: '#0D6E6E' }).catch?.(() => {});
  chrome.action?.setBadgeText?.({ text: String(remaining) }).catch?.(() => {});

  if (used >= limit || remaining <= 0) {
    if (generateButton) {
      generateButton.disabled = true;
      generateButton.title = 'Send a GM request to unlock more Brevmont follow-ups.';
    }
    hideUsageWarning(root);
    showInviteGmModal(root, { ...usage, generations_used: used, generations_limit: limit, generations_remaining: remaining });
  } else if (used >= 450 || remaining <= 50) {
    if (generateButton && !isGenerating) {
      generateButton.disabled = false;
      generateButton.title = '';
    }
    renderUsageWarning(root, remaining, limit);
  } else {
    if (generateButton && !isGenerating) {
      generateButton.disabled = false;
      generateButton.title = '';
    }
    hideUsageWarning(root);
  }
}

async function refreshGenerationStatus(root: HTMLElement): Promise<void> {
  try {
    const response = await safeSend({ type: 'GET_GENERATION_STATUS' });
    if (!response?.ok) return;
    renderUsageCounter(root, response.tier, {
      generations_used: response.used,
      generations_limit: response.limit,
      generations_remaining: response.remaining,
      resets_at: response.resets_at,
    });
  } catch {
    updateUsageCounter(root);
  }
}

function updateUsageCounter(root: HTMLElement): void {
  chrome.storage.local.get(['brevmont_tier', 'brevmont_usage']).then(data => {
    renderUsageCounter(root, data.brevmont_tier, data.brevmont_usage as GenerationUsage | undefined);
  }).catch(() => {});
}

function showUpgradePrompt(root: HTMLElement, message: string, upgradeUrl?: string): void {
  showInviteGmModal(root);
  const prompt = root.querySelector('#o8-upgrade-prompt') as HTMLElement | null;
  if (prompt) {
    prompt.style.display = 'block';
    prompt.innerHTML = `
      <div class="upgrade-title">Free follow-ups used up</div>
      <div class="upgrade-msg">${esc(message)}</div>
      <button id="o8-tell-gm-limit" class="upgrade-btn" type="button">Tell My GM -></button>
      <div class="upgrade-phone"><a href="${upgradeUrl || 'https://brevmont.com/pricing'}" target="_blank" rel="noopener">See Plans</a></div>
    `;
    const button = prompt.querySelector('#o8-tell-gm-limit') as HTMLButtonElement | null;
    if (button) button.onclick = () => showInviteGmModal(root);
  }
}

function showInviteGmModal(root: HTMLElement, usage?: GenerationUsage): void {
  if (root.querySelector('#o8-gm-invite-modal')) return;
  const limit = usage?.generations_limit || 500;
  const used = usage?.generations_used || limit;
  const remaining = Math.max(0, usage?.generations_remaining ?? (limit - used));
  const hoursSaved = Math.max(1, Math.round((Math.min(used, limit) * 1.45) / 60));
  const title = remaining > 0
    ? `${remaining} follow-ups remaining this month.`
    : `You've used all ${limit} free follow-ups this month.`;
  const backdrop = document.createElement('div');
  backdrop.id = 'o8-gm-invite-modal';
  backdrop.className = 'gm-invite-backdrop';
  backdrop.innerHTML = `
    <div class="gm-invite-modal" role="dialog" aria-modal="true" aria-labelledby="o8-gm-invite-title">
      <button class="gm-invite-close" type="button" aria-label="Close">&times;</button>
      <div class="gm-invite-eyebrow">Unlock the floor</div>
      <h2 id="o8-gm-invite-title" class="gm-invite-title">${esc(title)}</h2>
      <p class="gm-invite-copy">You saved approximately ${hoursSaved} hours of typing this month using Brevmont.</p>
      <p class="gm-invite-copy">Don't go back to typing manually. Send a one-click request to your GM to unlock unlimited Brevmont for your entire floor.</p>
      <label class="gm-invite-label" for="o8-gm-email">GM's Email</label>
      <input id="o8-gm-email" class="gm-invite-input" type="email" placeholder="gm@dealership.com" />
      <div id="o8-gm-invite-error" class="gm-invite-error"></div>
      <button id="o8-gm-send" class="gm-invite-send" type="button">Send Request -></button>
      <button id="o8-gm-plans" class="gm-invite-plans" type="button">Or upgrade yourself: See Plans</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  const closeButton = backdrop.querySelector('.gm-invite-close') as HTMLButtonElement | null;
  if (closeButton) closeButton.onclick = close;
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });

  const plans = backdrop.querySelector('#o8-gm-plans') as HTMLButtonElement | null;
  if (plans) plans.onclick = () => chrome.tabs.create({ url: 'https://brevmont.com/pricing?utm_source=extension&utm_medium=limit_modal&utm_campaign=see_plans' });

  const input = backdrop.querySelector('#o8-gm-email') as HTMLInputElement | null;
  const error = backdrop.querySelector('#o8-gm-invite-error') as HTMLElement | null;
  const send = backdrop.querySelector('#o8-gm-send') as HTMLButtonElement | null;
  if (send && input) {
    send.onclick = async () => {
      const gmEmail = input.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(gmEmail)) {
        if (error) error.textContent = 'Enter a valid GM email.';
        return;
      }
      send.disabled = true;
      send.textContent = 'Sending...';
      if (error) error.textContent = '';
      try {
        await safeSend({ type: 'INVITE_GM', payload: { gm_email: gmEmail } });
        showToast(root, 'GM request sent.');
        close();
      } catch (err: any) {
        if (error) error.textContent = err?.message || 'Could not send request.';
        send.disabled = false;
        send.textContent = 'Send Request ->';
      }
    };
  }

  setTimeout(() => input?.focus(), 50);
}

function normalizeVersionStatus(raw: unknown): VersionStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as VersionStatus;
  const forceUpdate = Boolean(value.forceUpdate || value.locked);
  const updateRequired = Boolean(value.updateRequired || value.deprecated || forceUpdate);
  if (!updateRequired && !forceUpdate) return null;
  return {
    ...value,
    updateRequired,
    forceUpdate,
    message: value.message || (forceUpdate ? 'Please update Brevmont to continue.' : 'A new version of Brevmont is available.'),
    downloadUrl: value.downloadUrl || 'https://api.brevmont.com/api/extension-download',
  };
}

async function getVersionStatus(): Promise<VersionStatus | null> {
  const data = await chrome.storage.local.get('brevmont_version_status');
  return normalizeVersionStatus(data.brevmont_version_status);
}

async function applyVersionStatus(root: HTMLElement): Promise<void> {
  const existing = root.querySelector('#o8-version-update-banner');
  if (existing) existing.remove();

  const status = await getVersionStatus();
  if (!status) return;

  const banner = document.createElement('div');
  banner.id = 'o8-version-update-banner';
  banner.className = `version-update-banner${status.forceUpdate ? ' force' : ''}`;
  banner.innerHTML = `
    <div class="version-update-title">${status.forceUpdate ? 'Update required' : 'Update available'}</div>
    <div class="version-update-copy">${esc(status.message || '')}</div>
    <button id="o8-version-download" class="version-update-btn" type="button">Download latest${status.latest ? ` v${esc(String(status.latest))}` : ''}</button>
  `;

  const header = root.querySelector('.header');
  if (header) header.insertAdjacentElement('afterend', banner);
  else root.prepend(banner);

  const download = banner.querySelector('#o8-version-download') as HTMLButtonElement | null;
  if (download) {
    download.onclick = () => chrome.tabs.create({ url: status.downloadUrl || 'https://api.brevmont.com/api/extension-download' });
  }

  if (status.forceUpdate) {
    root.querySelectorAll<HTMLButtonElement>('#o8-generate,#o8-coach-btn,#o8-cmd-execute,#o8-ctx-generate').forEach((button) => {
      button.disabled = true;
      button.title = 'Update Brevmont to keep writing follow-ups.';
    });
  }
}

async function ensureGenerationAllowed(root: HTMLElement): Promise<boolean> {
  const status = await getVersionStatus();
  if (status?.forceUpdate) {
    await applyVersionStatus(root);
    showToast(root, 'Update Brevmont to keep writing follow-ups.');
    return false;
  }

  const data = await chrome.storage.local.get(['brevmont_tier', 'brevmont_usage']);
  const usage = data.brevmont_usage as GenerationUsage | undefined;
  if (isLimitedFreeTier(data.brevmont_tier) && usage) {
    const used = Number(usage.generations_used || 0);
    const limit = Number(usage.generations_limit || 500);
    const remaining = Number.isFinite(Number(usage.generations_remaining))
      ? Number(usage.generations_remaining)
      : limit - used;
    if (used >= limit || remaining <= 0) {
      showInviteGmModal(root, { ...usage, generations_used: used, generations_limit: limit, generations_remaining: Math.max(0, remaining) });
      return false;
    }
  }
  return true;
}

// ─── Build panel DOM ─────────────────────────────────────────────────────────
function setDisplay(root: HTMLElement, selector: string, visible: boolean): void {
  const node = root.querySelector(selector) as HTMLElement | null;
  if (node) node.style.display = visible ? '' : 'none';
}

function hidePrimaryPanels(root: HTMLElement): void {
  ['#o8-tools-panel', '#o8-stats-panel', '#o8-settings-panel', '#o8-lead-panel', '#o8-my-leads-panel'].forEach((selector) => {
    const node = root.querySelector(selector) as HTMLElement | null;
    if (node) node.style.display = 'none';
  });
}

function toolLabel(tool: string | null): string {
  switch (tool) {
    case 'coach': return 'Coach';
    case 'alerts': return 'Reminders';
    case 'context': return 'Screenshot Reply';
    case 'command': return 'Ask Anything';
    default: return 'Tools';
  }
}

function setActiveToolSection(root: HTMLElement, activeTool: string | null): void {
  const toolsPanel = root.querySelector('#o8-tools-panel') as HTMLElement | null;
  if (!toolsPanel) return;

  toolsPanel.querySelectorAll<HTMLElement>('.tool-tab-btn').forEach((button) => {
    const isActive = !!activeTool && button.dataset.tool === activeTool;
    button.classList.toggle('active', isActive);
  });

  toolsPanel.querySelectorAll<HTMLElement>('.tool-content').forEach((content) => {
    content.style.display = activeTool && content.id === `tool-${activeTool}` ? 'block' : 'none';
  });

  const title = toolsPanel.querySelector('.tools-title') as HTMLElement | null;
  if (title) title.textContent = toolLabel(activeTool);

  if (activeTool === 'coach') {
    const output = root.querySelector('#o8-coach-output') as HTMLElement | null;
    if (output && !output.textContent?.trim()) {
      output.innerHTML = '<div class="tool-result" style="color:#64748b">What objection are you facing?</div>';
    }
  }
}

function applyFeatureGates(root: HTMLElement): void {
  getFeatureAccess().then(access => {
    setDisplay(root, '#o8-lead-btn', access.addLead);
    if (!access.addLead) setDisplay(root, '#o8-lead-panel', false);
    setDisplay(root, '#o8-outcome-section', access.markOutcome);
    setDisplay(root, '.inline-links', access.addLead || access.coachMe || access.stats || access.settings);
    setDisplay(root, '#o8-my-leads-btn-inline', access.addLead);
    if (!access.addLead) setDisplay(root, '#o8-my-leads-panel', false);
    setDisplay(root, '#o8-tools-btn-inline', access.coachMe);
    if (!(access.coachMe || access.notifications || access.screenshotCapture || access.commandMode)) setDisplay(root, '#o8-tools-panel', false);
    setDisplay(root, '#o8-stats-btn-inline', access.stats);
    if (!access.stats) setDisplay(root, '#o8-stats-panel', false);
    setDisplay(root, '#o8-settings-btn-inline', access.settings);
    if (!access.settings) setDisplay(root, '#o8-settings-panel', false);

    const gates = [
      { tab: '[data-tool="coach"]', content: '#tool-coach', allowed: access.coachMe },
      { tab: '[data-tool="alerts"]', content: '#tool-alerts', allowed: access.notifications },
      { tab: '[data-tool="context"]', content: '#tool-context', allowed: access.screenshotCapture },
      { tab: '[data-tool="command"]', content: '#tool-command', allowed: access.commandMode },
    ];

    for (const gate of gates) {
      setDisplay(root, gate.tab, gate.allowed);
      if (!gate.allowed) setDisplay(root, gate.content, false);
    }

    if (!access.coachMe && !access.notifications && !access.screenshotCapture && !access.commandMode) {
      const toolsPanel = root.querySelector('#o8-tools-panel') as HTMLElement | null;
      if (toolsPanel) toolsPanel.style.display = 'none';
    }

    const activeTab = root.querySelector('#o8-tools-panel .tool-tab-btn.active') as HTMLElement | null;
    if (activeTab && activeTab.style.display === 'none') setActiveToolSection(root, null);
  }).catch(() => {
    for (const selector of [
      '#o8-lead-btn',
      '#o8-lead-panel',
      '#o8-outcome-section',
      '.inline-links',
      '#o8-tools-panel',
      '#o8-stats-panel',
      '#o8-settings-panel',
      '#o8-my-leads-panel',
      '[data-tool="coach"]',
      '[data-tool="alerts"]',
      '[data-tool="context"]',
      '[data-tool="command"]',
      '#tool-coach',
      '#tool-alerts',
      '#tool-context',
      '#tool-command',
    ]) {
      setDisplay(root, selector, false);
    }
  });
}

function renderPanel(): void {
  const root = document.getElementById('sp-root')!;
  const loading = document.getElementById('sp-loading');

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = getPanelCSS(currentPlatform.platform);
  document.head.appendChild(style);

  // Inject HTML
  root.innerHTML = getPanelHTML(currentPlatform.platform, { chromeSidePanel: true });

  // Hide loading, show panel
  if (loading) loading.style.display = 'none';
  root.style.display = 'block';

  // Wire event handlers
  wireHandlers(root);
  startCustomerDetection(root);

  chrome.runtime.sendMessage({ type: 'SYNC_AUTH_FROM_COOKIE' }).then((resp: any) => {
    if (resp?.configured) {
      renderAccountChip().catch(() => {});
      refreshGenerationStatus(root).catch(() => {});
    }
  }).catch(() => {});

  // Show free tier usage counter if applicable
  applyFirstUseGuide(root);
  updateUsageCounter(root);
  refreshGenerationStatus(root).catch(() => {});
  applyFeatureGates(root);
  showAccessEndedBanner(root);
  applyVersionStatus(root).catch(() => {});
  startChallengePolling(root);
  renderMyLeads(root).catch(() => {});
  renderAccountChip().catch(() => {});
}

const PLAN_DISPLAY: Record<string, string> = {
  free: 'Free',
  pilot: 'Pilot',
  command: 'Command',
  annual: 'Annual',
  custom: 'Custom',
};

async function renderAccountChip(): Promise<void> {
  const chip = document.getElementById('o8-account-chip') as HTMLElement | null;
  const nameEl = document.getElementById('o8-account-chip-name');
  const dealershipEl = document.getElementById('o8-account-chip-dealership');
  const emailEl = document.getElementById('o8-account-chip-email');
  const planEl = document.getElementById('o8-account-chip-plan') as HTMLElement | null;
  const upgradeBtn = document.getElementById('o8-account-chip-upgrade') as HTMLButtonElement | null;
  if (!chip || !nameEl || !dealershipEl || !planEl) return;

  // Always-show fallback: read whatever we have in storage so the chip
  // never stays totally hidden. The API call below upgrades the chip
  // with the resolved access; if the API is offline we still show the
  // rep + dealership name + cached tier.
  let repName = '';
  let repEmail = '';
  let dealership = '';
  let cachedTier = 'free';
  try {
    const sync = await browser.storage.sync.get(['rep_name', 'dealership']);
    repName = String(sync.rep_name || '');
    dealership = String(sync.dealership || '');
    const local = await browser.storage.local.get(['brevmont_tier', 'rep_email']);
    repEmail = String(local.rep_email || '');
    cachedTier = String(local.brevmont_tier || 'free').toLowerCase();
  } catch { /* storage may not be available in some test contexts */ }

  const setPlanBadge = (plan: string, status: string, isOverridden: boolean) => {
    planEl.classList.remove('plan-free', 'plan-pilot', 'plan-command', 'plan-annual', 'plan-custom', 'plan-upgrade', 'status-paused', 'status-terminated');
    if (status === 'paused') {
      planEl.classList.add('status-paused');
      planEl.textContent = 'Paused';
    } else if (status === 'terminated') {
      planEl.classList.add('status-terminated');
      planEl.textContent = 'Terminated';
    } else {
      planEl.classList.add(`plan-${plan}`);
      if (isOverridden) planEl.classList.add('plan-upgrade');
      planEl.textContent = isOverridden ? `↑ ${PLAN_DISPLAY[plan] || plan}` : (PLAN_DISPLAY[plan] || plan);
    }
  };

  // Render the fallback IMMEDIATELY so the chip is visible even if the
  // API call below takes a few seconds (cold-start service worker).
  const cachedPlan = cachedTier === 'free' || cachedTier === 'free_trial' ? 'free'
    : cachedTier === 'founding_pilot' || cachedTier === 'pilot' ? 'pilot'
    : cachedTier === 'command' ? 'command'
    : cachedTier === 'annual' || cachedTier === 'command_annual' ? 'annual'
    : 'free';
  nameEl.textContent = repName || 'Brevmont rep';
  dealershipEl.textContent = dealership || 'No dealership linked';
  if (emailEl) emailEl.textContent = repEmail;
  setPlanBadge(cachedPlan, 'active', false);
  if (upgradeBtn) {
    upgradeBtn.style.display = cachedPlan === 'free' ? 'inline-block' : 'none';
    upgradeBtn.onclick = () => {
      chrome.tabs.create({ url: 'https://brevmont.com/pricing?utm_source=extension&utm_medium=account_chip&utm_campaign=upgrade' });
    };
  }
  chip.style.display = 'block';

  // Now upgrade with the live resolved access. If this fails (cold SW,
  // network error), the fallback stays on screen.
  try {
    const resp: any = await chrome.runtime.sendMessage({ type: 'GET_RESOLVED_ACCESS' });
    if (!resp?.ok) return;
    const access = resp.access || {};
    const plan = String(access.plan || cachedPlan).toLowerCase();
    const status = String(access.status || 'active').toLowerCase();
    const isOverridden = !!(access.source?.plan_overridden_by_rep);
    if (resp.rep_name) nameEl.textContent = resp.rep_name;
    if (resp.dealership) dealershipEl.textContent = resp.dealership;
    setPlanBadge(plan, status, isOverridden);
    if (upgradeBtn) {
      upgradeBtn.style.display = (plan === 'free' && status === 'active') ? 'inline-block' : 'none';
    }
  } catch {
    /* keep fallback render */
  }
}

async function applyFirstUseGuide(root: HTMLElement): Promise<void> {
  const card = root.querySelector('#o8-first-use') as HTMLElement | null;
  const input = root.querySelector('#o8-input') as HTMLTextAreaElement | null;
  if (!card) return;

  const state = await chrome.storage.local.get([FIRST_GENERATION_KEY, ONBOARDING_BANNER_DISMISSED_KEY, 'rep_name']);
  if (state[FIRST_GENERATION_KEY] || state[ONBOARDING_BANNER_DISMISSED_KEY]) {
    card.style.display = 'none';
    return;
  }

  const dismissButton = card.querySelector('#o8-first-use-dismiss') as HTMLButtonElement | null;
  if (dismissButton) {
    dismissButton.onclick = async () => {
      await chrome.storage.local.set({ [ONBOARDING_BANNER_DISMISSED_KEY]: true });
      card.style.display = 'none';
    };
  }

  const repName = String(state.rep_name || '').trim();
  card.style.display = 'block';
  const title = card.querySelector('.first-use-title') as HTMLElement | null;
  if (title && repName) title.textContent = `Welcome, ${repName}. Try your first follow-up.`;
  if (input && !input.value.trim()) {
    input.placeholder = FIRST_GENERATION_EXAMPLE;
  }
}

async function markFirstGenerationComplete(root: HTMLElement): Promise<void> {
  await chrome.storage.local.set({
    [FIRST_GENERATION_KEY]: true,
    [ONBOARDING_BANNER_DISMISSED_KEY]: true,
  });
  const card = root.querySelector('#o8-first-use') as HTMLElement | null;
  if (!card) return;
  card.style.display = 'none';
}

async function recordSuccessfulGeneration(root: HTMLElement): Promise<void> {
  const data = await chrome.storage.local.get([LOCAL_GENERATION_COUNT_KEY, REVIEW_PROMPT_STATE_KEY]).catch(() => ({}));
  const count = Number(data[LOCAL_GENERATION_COUNT_KEY] || 0) + 1;
  await chrome.storage.local.set({ [LOCAL_GENERATION_COUNT_KEY]: count });
  const state = data[REVIEW_PROMPT_STATE_KEY] || {};
  if (shouldShowReviewPrompt(count, state)) showReviewPrompt(root);
}

function showReviewPrompt(root: HTMLElement): void {
  const prompt = root.querySelector('#o8-review-prompt') as HTMLElement | null;
  if (!prompt) return;
  prompt.style.display = 'block';
  const dismiss = prompt.querySelector('#o8-review-dismiss') as HTMLButtonElement | null;
  const link = prompt.querySelector('#o8-review-link') as HTMLButtonElement | null;
  if (dismiss) {
    dismiss.onclick = async () => {
      await chrome.storage.local.set({ [REVIEW_PROMPT_STATE_KEY]: dismissedReviewState() });
      prompt.style.display = 'none';
    };
  }
  if (link) {
    link.onclick = async () => {
      await chrome.storage.local.set({ [REVIEW_PROMPT_STATE_KEY]: reviewClickedState() });
      prompt.style.display = 'none';
      chrome.tabs.create({ url: BREVMONT_CWS_REVIEWS });
    };
  }
}

async function showAccessEndedBanner(root: HTMLElement): Promise<void> {
  const local = await chrome.storage.local.get(['license_revoked', 'license_revoked_message', 'dealership']);
  const existing = root.querySelector('#o8-access-ended-banner');
  if (existing) existing.remove();
  if (!local.license_revoked) return;

  const banner = document.createElement('div');
  banner.id = 'o8-access-ended-banner';
  banner.style.cssText = 'margin:8px 12px 0;padding:10px;border:1px solid #FCA5A5;border-radius:8px;background:#FEF2F2;color:#991B1B;font-size:12px;line-height:1.45;';
  banner.innerHTML = `
    <div style="font-weight:700;margin-bottom:4px;">Access ended${local.dealership ? ` at ${esc(String(local.dealership))}` : ''}</div>
    <div>${esc(accessEndedMessage(local.license_revoked_message as string | undefined))}</div>
    <button id="o8-access-reconnect" style="margin-top:8px;border:0;border-radius:6px;background:#0D6E6E;color:#fff;font-size:12px;font-weight:700;padding:7px 10px;cursor:pointer;">Reconnect</button>
  `;
  const header = root.querySelector('.header');
  if (header) header.insertAdjacentElement('afterend', banner);
  else root.prepend(banner);

  const reconnect = banner.querySelector('#o8-access-reconnect') as HTMLButtonElement | null;
  if (reconnect) {
    reconnect.onclick = async () => {
      reconnect.disabled = true;
      reconnect.textContent = 'Opening setup...';
      await clearCredentialsForReconnect();
      chrome.runtime.sendMessage({ type: 'OPEN_ONBOARDING' }, () => {
        if (chrome.runtime.lastError) {
          try { chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') }); } catch {}
        }
      });
    };
  }
}

// ─── Load account info into Settings panel (migrated from popup) ────────────
function loadAccountInfo(root: HTMLElement): void {
  const setText = (id: string, val: string) => { const e = root.querySelector(`#${id}`); if (e) e.textContent = val; };
  const maskToken = (t: string) => (!t || t.length < 8) ? (t || '—') : t.slice(0, 6) + '...' + t.slice(-4);

  // Version
  const manifest = chrome.runtime.getManifest();
  setText('sp-version', 'v' + (manifest.version || '?'));

  // Storage data
  chrome.storage.local.get(['rep_name', 'dealership', 'dealer_token', 'rep_auth_token', 'brevmont_rep_auth_token']).then(local => {
    chrome.storage.sync.get(['rep_name', 'dealership']).then(sync => {
      setText('sp-dealership', (local.dealership || sync.dealership || 'Not configured') as string);
      setText('sp-rep-name', (local.rep_name || sync.rep_name || 'Not configured') as string);
      setText('sp-license', maskToken((local.dealer_token || '') as string));
    });
  });

  // Queue size
  chrome.runtime.sendMessage({ type: 'GET_SYNC_QUEUE_COUNT' }).then((r: any) => {
    const count = typeof r?.count === 'number' ? r.count : 0;
    const row = root.querySelector('#sp-queue-row') as HTMLElement;
    if (row) { row.style.display = count > 0 ? 'block' : 'none'; }
    setText('sp-queue-count', String(count));
  }).catch(() => {});

  // Health check
  fetch('https://api.brevmont.com/health')
    .then(r => {
      const dot = root.querySelector('#sp-status-dot') as HTMLElement;
      const txt = root.querySelector('#sp-status-text') as HTMLElement;
      if (dot) dot.style.background = r.ok ? '#22C55E' : '#EF4444';
      if (txt) txt.textContent = r.ok ? 'Online' : 'Offline';
    })
    .catch(() => {
      const dot = root.querySelector('#sp-status-dot') as HTMLElement;
      const txt = root.querySelector('#sp-status-text') as HTMLElement;
      if (dot) dot.style.background = '#EF4444';
      if (txt) txt.textContent = 'Offline';
    });
}

// ─── Wire up all interactive elements ────────────────────────────────────────
function loadRepPreferences(root: HTMLElement): void {
  chrome.storage.local.get(['rep_name', 'profile']).then(local => {
    chrome.storage.sync.get(['rep_name', 'profile']).then(sync => {
      const nameInput = root.querySelector('#sp-rep-first-name') as HTMLInputElement | null;
      if (!nameInput) return;
      let firstName = String(local.rep_name || sync.rep_name || '').trim().split(/\s+/)[0] || '';
      try {
        const profile = JSON.parse(String(local.profile || sync.profile || '{}'));
        firstName = profile?.identity?.firstName || firstName;
      } catch {}
      nameInput.value = firstName;
    });
  });
}

async function saveRepPreferences(root: HTMLElement): Promise<void> {
  const nameInput = root.querySelector('#sp-rep-first-name') as HTMLInputElement | null;
  const firstName = nameInput?.value.trim() || '';
  const tone = (root.querySelector('input[name="brevmont-tone"]:checked') as HTMLInputElement | null)?.value || 'professional';
  const goal = (root.querySelector('input[name="brevmont-goal"]:checked') as HTMLInputElement | null)?.value || 'close_deal';
  let profile: Record<string, any> = {};
  const stored = await chrome.storage.local.get(['profile']);
  try { profile = stored.profile ? JSON.parse(String(stored.profile)) : {}; } catch { profile = {}; }
  profile.identity = { ...(profile.identity || {}), firstName };
  profile.voice = { ...(profile.voice || {}), tone };
  const payload: Record<string, any> = {
    profile: JSON.stringify(profile),
    brevmont_tone: tone,
    brevmont_goal: goal,
  };
  if (firstName) payload.rep_name = firstName;
  await chrome.storage.local.set(payload);
  await chrome.storage.sync.set(payload);
  const saved = root.querySelector('#sp-settings-saved') as HTMLElement | null;
  if (saved) {
    saved.classList.add('show');
    setTimeout(() => saved.classList.remove('show'), 1800);
  }
  showToast(root, 'Preferences saved');
}

function wireHandlers(root: HTMLElement): void {
  const el = (id: string) => root.querySelector(`#${id}`) as HTMLElement | null;

  // Version badge
  try {
    const vb = el('o8-version-badge');
    if (vb) {
      const v = chrome?.runtime?.getManifest?.()?.version || 'unknown';
      vb.textContent = `v${v}`;
    }
  } catch {}

  // Output chips — toggle selection
  root.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => {
      const hasCards = root.querySelectorAll('.out-card').length > 0;
      if (hasCards) {
        setActiveOutputTab(root, c.getAttribute('data-type') || '');
      } else {
        c.classList.toggle('on');
      }
    });
  });

  // Generate button
  const genBtn = el('o8-generate');
  if (genBtn) genBtn.onclick = () => doGenerate(root);
  const accountBtn = el('o8-account-btn') as HTMLButtonElement | null;
  if (accountBtn) {
    accountBtn.onclick = () => {
      const chip = document.getElementById('o8-account-chip') as HTMLElement | null;
      if (!chip) return;
      chip.style.display = 'block';
      chip.scrollIntoView({ block: 'end', behavior: 'smooth' });
      chip.classList.add('account-chip-focus');
      window.setTimeout(() => chip.classList.remove('account-chip-focus'), 900);
    };
  }
  const customerBtn = el('o8-customer-open');
  if (customerBtn) customerBtn.onclick = () => openCustomerPicker(root);
  const exampleBtn = el('o8-first-use-example') as HTMLButtonElement | null;
  if (exampleBtn) {
    exampleBtn.onclick = () => {
      const input = el('o8-input') as HTMLTextAreaElement | null;
      if (!input) return;
      input.value = FIRST_GENERATION_EXAMPLE;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    };
  }

  // Enter key in input
  const mainInput = el('o8-input') as HTMLTextAreaElement | null;
  if (mainInput) {
    mainInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doGenerate(root); }
    });
  }

  // Mic — Web Speech API works natively in Side Panel (extension page origin)
  const mic = el('o8-mic');
  if (mic && mainInput) attachMic(mainInput, mic);

  // Settings panel
  const settingsPanel = el('o8-settings-panel');
  const settingsBack = el('o8-settings-back');
  if (settingsBack) {
    settingsBack.onclick = () => { settingsPanel!.style.display = 'none'; el('o8-quick')!.style.display = 'flex'; };
  }
  const settingsBtnInline = el('o8-settings-btn-inline');
  if (settingsBtnInline) {
    settingsBtnInline.onclick = () => {
      el('o8-quick')!.style.display = 'none';
      const tp = el('o8-tools-panel'); if (tp) tp.style.display = 'none';
      const stats = el('o8-stats-panel'); if (stats) stats.style.display = 'none';
      const lead = el('o8-lead-panel'); if (lead) lead.style.display = 'none';
      const myLeads = el('o8-my-leads-panel'); if (myLeads) myLeads.style.display = 'none';
      if (settingsPanel) settingsPanel.style.display = 'flex';
    };
  }

  // Tone/goal radios
  root.querySelectorAll('input[name="brevmont-tone"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const brevmont_tone = (radio as HTMLInputElement).value;
      chrome.storage.local.set({ brevmont_tone });
      chrome.storage.sync.set({ brevmont_tone });
    });
  });
  root.querySelectorAll('input[name="brevmont-goal"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const brevmont_goal = (radio as HTMLInputElement).value;
      chrome.storage.local.set({ brevmont_goal });
      chrome.storage.sync.set({ brevmont_goal });
    });
  });
  // Restore saved tone/goal
  chrome.storage.local.get(['brevmont_tone', 'brevmont_goal']).then(r => {
    if (r.brevmont_tone) { const e = root.querySelector(`input[name="brevmont-tone"][value="${r.brevmont_tone}"]`) as HTMLInputElement; if (e) e.checked = true; }
    if (r.brevmont_goal) { const e = root.querySelector(`input[name="brevmont-goal"][value="${r.brevmont_goal}"]`) as HTMLInputElement; if (e) e.checked = true; }
  });

  // ─── Account info (migrated from popup) ─────────────────────────────────────
  loadRepPreferences(root);
  const saveSettingsBtn = root.querySelector('#sp-save-settings') as HTMLButtonElement | null;
  if (saveSettingsBtn) {
    saveSettingsBtn.onclick = () => { void saveRepPreferences(root); };
  }
  const reportBtn = root.querySelector('#sp-link-report') as HTMLButtonElement;
  if (reportBtn) {
    reportBtn.onclick = async () => {
      reportBtn.disabled = true; reportBtn.textContent = 'Sending...';
      try {
        let tabDomain: string | null = null;
        try { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (tab?.url) tabDomain = new URL(tab.url).hostname; } catch { /* noop */ }
        await chrome.runtime.sendMessage({ type: 'SUPPORT_REPORT', payload: { note: '', tab_domain: tabDomain } });
        reportBtn.textContent = 'Sent!';
      } catch { reportBtn.textContent = 'Failed'; }
      setTimeout(() => { reportBtn.disabled = false; reportBtn.textContent = 'Report issue'; }, 3000);
    };
  }
  const helpBtn = root.querySelector('#sp-link-help') as HTMLButtonElement;
  if (helpBtn) {
    helpBtn.onclick = () => { chrome.tabs.create({ url: 'mailto:support@brevmont.com' }); };
  }

  // Tools panel
  const toolsPanel = el('o8-tools-panel');
  const toolsBack = el('o8-tools-back');
  const toolsBtnInline = el('o8-tools-btn-inline');
  if (toolsBtnInline) {
    toolsBtnInline.onclick = () => {
      el('o8-quick')!.style.display = 'none';
      const sp = el('o8-settings-panel'); if (sp) sp.style.display = 'none';
      const stats = el('o8-stats-panel'); if (stats) stats.style.display = 'none';
      const lead = el('o8-lead-panel'); if (lead) lead.style.display = 'none';
      const myLeads = el('o8-my-leads-panel'); if (myLeads) myLeads.style.display = 'none';
      if (toolsPanel) toolsPanel.style.display = 'flex';
      setActiveToolSection(root, 'coach');
    };
  }
  if (toolsBack) toolsBack.onclick = () => { setActiveToolSection(root, null); toolsPanel!.style.display = 'none'; el('o8-quick')!.style.display = 'flex'; };

  // Tool tab switching
  root.querySelectorAll('.tool-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = (btn as HTMLElement).dataset.tool;
      const target = root.querySelector(`#tool-${tool}`) as HTMLElement | null;
      const isOpen = btn.classList.contains('active') && target?.style.display !== 'none';
      setActiveToolSection(root, isOpen ? null : tool || null);
      if (!isOpen && tool === 'coach') {
        const coachInput = root.querySelector('#o8-coach-input') as HTMLTextAreaElement | null;
        if (coachInput) {
          setTimeout(() => {
            coachInput.focus();
            coachInput.placeholder = 'Tell Brevmont what the customer said, then click Coach Me below.';
          }, 100);
        }
      }
    });
  });

  // Stats panel
  const statsPanel = el('o8-stats-panel');
  const statsBack = el('o8-stats-back');
  const statsBtnInline = el('o8-stats-btn-inline');
  if (statsBtnInline) statsBtnInline.onclick = () => openStats(root);
  if (statsBack) statsBack.onclick = () => { statsPanel!.style.display = 'none'; el('o8-quick')!.style.display = 'flex'; };

  // My Leads panel
  const myLeadsPanel = el('o8-my-leads-panel');
  const myLeadsBack = el('o8-my-leads-back');
  const myLeadsBtn = el('o8-my-leads-btn-inline');
  if (myLeadsBtn) myLeadsBtn.onclick = () => openMyLeads(root);
  if (myLeadsBack) myLeadsBack.onclick = () => { if (myLeadsPanel) myLeadsPanel.style.display = 'none'; el('o8-quick')!.style.display = 'flex'; };

  // Coach
  const coachBtn = el('o8-coach-btn');
  if (coachBtn) coachBtn.onclick = () => doCoach(root);
  const coachMic = el('o8-coach-mic');
  const coachInput = el('o8-coach-input') as HTMLTextAreaElement | null;
  if (coachMic && coachInput) attachMic(coachInput, coachMic);

  // Coach chips
  root.querySelectorAll('.coach-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = el('o8-coach-input') as HTMLTextAreaElement;
      if (input) input.value = (chip as HTMLElement).textContent || '';
      void doCoach(root);
    });
  });

  // Alerts
  const alertBtn = el('o8-alert-btn');
  if (alertBtn) alertBtn.onclick = () => doSetAlert(root);
  const alertMic = el('o8-alert-mic');
  const alertInput = el('o8-alert-input') as HTMLInputElement | null;
  if (alertMic && alertInput) attachMic(alertInput, alertMic);

  // Context tool (screenshot + generate reply)
  wireContextTool(root);

  // Command tool
  const cmdBtn = el('o8-cmd-execute');
  if (cmdBtn) cmdBtn.onclick = () => doCommand(root);
  const cmdMic = el('o8-cmd-mic');
  const cmdInput = el('o8-cmd-input') as HTMLTextAreaElement | null;
  if (cmdMic && cmdInput) attachMic(cmdInput, cmdMic);

  // Lead capture panel
  wireLeadCapture(root);

  // Platform badge update
  updatePlatformBadge(root);

  // No close button in Side Panel — Chrome handles that natively.
  // Hide the X if it exists (carried over from content.ts HTML).
  const closeBtn = el('o8-close');
  if (closeBtn) closeBtn.style.display = 'none';
}

// ─── Tab-switching for output cards ──────────────────────────────────────────
function setActiveOutputTab(root: HTMLElement, type: string): void {
  root.querySelectorAll('.chip').forEach(c => c.classList.remove('tab-active'));
  const chip = root.querySelector(`.chip[data-type="${type}"]`);
  if (chip) chip.classList.add('tab-active');
  root.querySelectorAll('.out-card[data-output-type]').forEach(card => {
    (card as HTMLElement).classList.toggle('tab-visible', card.getAttribute('data-output-type') === type);
  });
}

// ─── Platform badge ──────────────────────────────────────────────────────────
function updatePlatformBadge(root: HTMLElement): void {
  const badge = getBadge(currentPlatform.platform);
  const badgeEl = root.querySelector('#o8-platform-badge') as HTMLElement;
  if (badgeEl && badge.label) {
    badgeEl.textContent = badge.label;
    badgeEl.style.color = badge.color;
    badgeEl.style.background = badge.bg;
    badgeEl.style.display = 'inline-block';
  } else if (badgeEl) {
    badgeEl.style.display = 'none';
  }
}

// ─── Mic (Direct SpeechRecognition in Side Panel) ───────────────────────────
// SpeechRecognition works natively in chrome-extension:// side panel pages.
// ─── Microphone ─────────────────────────────────────────────────────────────
// Chrome SILENTLY SWALLOWS SpeechRecognition.start() in side panels when
// mic permission hasn't been granted — no error, no event, nothing fires.
//
// Architecture:
// 1. Load mic permission flag into module var at boot (async, before any click)
// 2. Click handler is fully SYNCHRONOUS — checks module var, no await
// 3. If not granted → open mic-permission.html via background + two fallbacks
// 4. mic-permission.html sets the flag → next click goes to recognition
// 5. Timeout guard catches revoked permission (onstart doesn't fire in 1500ms)
let activeMicRecognition: any = null;
let activeMicBtn: HTMLElement | null = null;
const MIC_PERM_KEY = 'brevmont_mic_granted';
let micPermGranted = false; // sync module-level flag, loaded at boot

// Load permission state at boot — called once during init
function loadMicPermFlag(): void {
  try {
    chrome.storage.local.get([MIC_PERM_KEY], (result) => {
      micPermGranted = !!result?.[MIC_PERM_KEY];
    });
  } catch { /* storage unavailable — flag stays false */ }
}
loadMicPermFlag(); // fire immediately at module load

// Listen for flag changes (set by mic-permission.html after user grants access)
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[MIC_PERM_KEY]) {
      micPermGranted = !!changes[MIC_PERM_KEY].newValue;
    }
  });
} catch { /* side panel may not support onChanged — non-critical */ }

function openMicPermissionPage(): void {
  const url = chrome.runtime.getURL('permission.html');
  // Cascade: background message → chrome.tabs.create → window.open
  // Each level catches the previous failure.
  try {
    chrome.runtime.sendMessage({ type: 'OPEN_MIC_PERMISSION' }, () => {
      if (chrome.runtime.lastError) {
        try {
          chrome.tabs.create({ url });
        } catch {
          window.open(url, '_blank', 'width=420,height=340,popup=yes');
        }
      }
    });
  } catch {
    try {
      chrome.tabs.create({ url });
    } catch {
      window.open(url, '_blank', 'width=420,height=340,popup=yes');
    }
  }
}

function attachMic(input: HTMLTextAreaElement | HTMLInputElement, micBtn: HTMLElement): void {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) {
    micBtn.style.display = 'none';
    return;
  }

  // FULLY SYNCHRONOUS click handler — no async, no await, no silent rejections
  micBtn.addEventListener('click', () => {
    // If this mic is active — stop it
    if (activeMicBtn === micBtn && activeMicRecognition) {
      activeMicRecognition.stop();
      return;
    }
    // If another mic is active — stop that one first
    if (activeMicRecognition) {
      activeMicRecognition.stop();
    }

    // Gate: if mic permission was never granted, open bootstrap page immediately
    if (!micPermGranted) {
      openMicPermissionPage();
      const root = document.getElementById('sp-root');
      if (root) showToast(root, 'Grant microphone access in the popup, then click mic again.');
      return;
    }

    // Permission was granted before — start recognition with timeout guard.
    const recognition = new SR();
    recognition.continuous = true;
    // Stream partial results as the user speaks. Without this, Chrome waits
    // for a full pause+silence before emitting ANY text, which made the mic
    // feel like a 1-2s lag — users thought it wasn't working.
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';
    const existingText = input.value.trim();
    let started = false;

    // Timeout guard: if onstart hasn't fired within 1500ms, Chrome silently
    // swallowed the request (permission revoked, or browser cleared it).
    const startTimeout = setTimeout(() => {
      if (!started) {
        micPermGranted = false;
        try { chrome.storage.local.remove(MIC_PERM_KEY); } catch {}
        openMicPermissionPage();
        const root = document.getElementById('sp-root');
        if (root) showToast(root, 'Microphone permission expired. Grant access again.');
        micBtn.classList.remove('mic-active');
        activeMicRecognition = null;
        activeMicBtn = null;
      }
    }, 1500);

    recognition.onstart = () => {
      started = true;
      clearTimeout(startTimeout);
      activeMicRecognition = recognition;
      activeMicBtn = micBtn;
      micBtn.classList.add('mic-active');
    };

    recognition.onresult = (event: any) => {
      let nextFinalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          nextFinalTranscript += `${transcript.trim()} `;
        } else {
          interimTranscript += transcript;
        }
      }
      if (nextFinalTranscript.trim()) {
        finalTranscript = `${finalTranscript} ${nextFinalTranscript}`.trim();
      }
      // Render every event (final OR interim) so the textarea updates live
      // while the user is mid-sentence. interimTranscript is appended visually
      // but NOT persisted — once the result finalizes it folds into
      // finalTranscript and replaces the interim view.
      const live = [existingText, finalTranscript, interimTranscript.trim()]
        .filter(Boolean)
        .join(' ');
      if (input.value !== live) {
        input.value = live;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };

    recognition.onerror = (event: any) => {
      clearTimeout(startTimeout);
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        micPermGranted = false;
        try { chrome.storage.local.remove(MIC_PERM_KEY); } catch {}
        openMicPermissionPage();
        const root = document.getElementById('sp-root');
        if (root) showToast(root, 'Grant microphone access, then click mic again.');
      } else {
        const root = document.getElementById('sp-root');
        if (root) showToast(root, 'Mic error: ' + event.error);
      }
      micBtn.classList.remove('mic-active');
      activeMicRecognition = null;
      activeMicBtn = null;
    };

    recognition.onend = () => {
      clearTimeout(startTimeout);
      micBtn.classList.remove('mic-active');
      activeMicRecognition = null;
      activeMicBtn = null;
    };

    try {
      recognition.start();
    } catch (e: any) {
      clearTimeout(startTimeout);
      micPermGranted = false;
      try { chrome.storage.local.remove(MIC_PERM_KEY); } catch {}
      openMicPermissionPage();
      const root = document.getElementById('sp-root');
      if (root) showToast(root, 'Grant microphone access, then click mic again.');
      micBtn.classList.remove('mic-active');
      activeMicRecognition = null;
      activeMicBtn = null;
    }
  });
}

// ─── Generate ────────────────────────────────────────────────────────────────
async function doGenerate(root: HTMLElement): Promise<void> {
  if (!(await ensureGenerationAllowed(root))) return;
  if (isGenerating) return;
  isGenerating = true;

  const input = (root.querySelector('#o8-input') as HTMLTextAreaElement)?.value.trim() || '';
  const chips = root.querySelectorAll('.chip.on');
  const selected = Array.from(chips).map(c => c.getAttribute('data-type'));
  if (selected.length === 0) { isGenerating = false; return; }

  const type = selected.length === 3 ? 'all' : selected.length === 1 ? selected[0]! : 'all';
  const btn = root.querySelector('#o8-generate') as HTMLButtonElement;
  btn.innerHTML = '<span class="gen-spinner"></span> Generating…';
  btn.disabled = true;
  root.querySelector('#o8-outputs')!.innerHTML = '';
  root.querySelectorAll('.chip.tab-active').forEach(c => c.classList.remove('tab-active'));

  let tone = 'professional', goal = 'close_deal';
  try {
    const stored = await chrome.storage.local.get(['brevmont_tone', 'brevmont_goal']);
    tone = stored.brevmont_tone || 'professional';
    goal = stored.brevmont_goal || 'close_deal';
  } catch {}

  // Ask content script for lead context (DOM scraping happens there)
  let leadContext: any = {};
  try {
    const ctx = await sendToContent({ type: 'GET_LEAD_CONTEXT' });
    if (ctx) leadContext = ctx;
  } catch {}
  if (!pinnedCustomer) {
    const detectedName = getCustomerNameFromContext(leadContext);
    const detectedConfidence = Number(leadContext?.detectionConfidence ?? leadContext?.detection_confidence ?? 0);
    if (detectedName && detectedConfidence >= 0.8) {
      const resolved = await resolveCustomerForDetection(leadContext);
      if (resolved) pinCustomer(root, resolved);
    } else if (detectedName && detectedConfidence >= 0.5) {
      pendingCustomerSuggestion = leadContext;
      renderCustomerStamp(root);
    }
  }
  leadContext = enrichLeadContextWithPinnedCustomer(leadContext);

  const _generationId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const repInputVehicle = extractVehicleMention(input);
  const vehicleForGeneration = leadContext.vehicle || leadContext.vehicleOfInterest || repInputVehicle || null;
  const stamp = customerStampPayload();

  const _meta: Record<string, any> = {
    workflow_type: type === 'all' ? 'all' : type,
    customer_name: leadContext.customerName || null,
    vehicle: vehicleForGeneration,
    customer_phone: leadContext.phone || null,
    customer_email: leadContext.email || null,
    email: leadContext.email || null,
    vehicle_make: leadContext.vehicleMake || null,
    vehicle_model: leadContext.vehicleModel || null,
    vehicle_of_interest: vehicleForGeneration,
    lead_source: leadContext.source || null,
    generation_id: _generationId,
    lead_id: (root as any).__pendingLeadId || null,
    customer_id: stamp.customer_id || leadContext.customer_id || null,
    detection_method: stamp.detection_method || leadContext.detectionMethod || leadContext.detection_method || null,
    detection_confidence: stamp.detection_confidence ?? leadContext.detectionConfidence ?? leadContext.detection_confidence ?? null,
    vehicle_context: stamp.vehicle_context || vehicleForGeneration || null,
  };

  try {
    const outputsEl = root.querySelector('#o8-outputs') as HTMLElement | null;
    if (outputsEl) {
      outputsEl.innerHTML = `
        <div id="o8-streaming-output" class="out-card" data-generation-id="${esc(_generationId)}">
          <div class="out-label">Generating</div>
          <textarea class="out-textarea" rows="7" readonly></textarea>
        </div>
      `;
    }
    const response = await safeSend({
      type: 'GENERATE_OUTPUT',
      payload: {
        type, leadContext, repInput: input + (vehicleForGeneration ? '' : '\n[SYSTEM: No vehicle of interest detected. Do not mention or invent a vehicle in the response.]'),
        repName: '', dealership: '', platform: currentPlatform.platform, tone, goal,
        metadata: _meta,
        lead_id: (root as any).__pendingLeadId || null,
      },
    });
    // Clear pending lead_id after sending
    (root as any).__pendingLeadId = null;

    if (response?.generation_limit_reached) {
      showUpgradePrompt(root, response.message || 'You\'ve used all your free follow-ups this month.', response.upgrade_url);
      updateUsageCounter(root);
    } else if (response?.queued) {
      showToast(root, response.message || 'Saved. Will sync when online.');
    } else if (response?.error) {
      addOutput(root, 'Error', GENERATION_FAILURE_MESSAGE);
    } else {
      root.querySelector('#o8-streaming-output')?.remove();
      const sec = response.sections;
      if (selected.includes('text') && sec?.text) addOutput(root, 'MESSAGE', sec.text, 'text', _generationId);
      if (selected.includes('email') && sec?.email) addOutput(root, 'EMAIL', await contentForEmailOutput(sec.email), 'email', _generationId);
      if (selected.includes('crm') && sec?.crm) {
        if (sec.crm.trim() === 'NO_NEW_NOTE') showToast(root, 'Nothing new to log. Last note covers this.');
        else addOutput(root, 'CRM NOTE', sec.crm, 'crm', _generationId);
      }
      if (!sec?.text && !sec?.email && !sec?.crm) addOutput(root, 'GENERATION', response.text || 'Generation returned empty.', 'text', _generationId);

      // Auto-activate first tab
      const tabOrder: Array<'text' | 'email' | 'crm'> = ['text', 'email', 'crm'];
      const firstReady = tabOrder.find(t => !!root.querySelector(`.out-card[data-output-type="${t}"]`));
      if (firstReady) setActiveOutputTab(root, firstReady);
      await markFirstGenerationComplete(root);
      await recordSuccessfulGeneration(root);

      // Honest event tracking via background
      try {
        const outputs: Array<{ key: string; content: string }> = [];
        if (selected.includes('text') && sec?.text) outputs.push({ key: 'text', content: sec.text });
        if (selected.includes('email') && sec?.email) outputs.push({ key: 'email', content: sec.email });
        if (selected.includes('crm') && sec?.crm && sec.crm.trim() !== 'NO_NEW_NOTE') outputs.push({ key: 'crm', content: sec.crm });
        for (const o of outputs) {
          safeSend({
            type: 'LOG_HONEST_EVENT',
            payload: {
              event_type: 'generation.created',
              platform: normalizeEventPlatform(currentPlatform.platform),
              output_type: o.key === 'text' ? 'text' : o.key === 'email' ? 'email' : 'crm_note',
              generation_id: _generationId,
              customer_context: { name: _meta.customer_name, vehicle: _meta.vehicle },
              action_metadata: {
                customer_id: _meta.customer_id,
                detection_method: _meta.detection_method,
                detection_confidence: _meta.detection_confidence,
                vehicle_context: _meta.vehicle_context,
              },
              output_length: (o.content || '').length,
            },
          }).catch(() => {});
        }
      } catch {}

      // Increment local usage counter for immediate UI feedback (free tier)
      chrome.storage.local.get(['brevmont_tier', 'brevmont_usage']).then(data => {
        if (isLimitedFreeTier(data.brevmont_tier) && data.brevmont_usage) {
          const u = data.brevmont_usage as { generations_used?: number; generations_limit?: number };
          const newUsed = (u.generations_used || 0) + 1;
          chrome.storage.local.set({
            brevmont_usage: { ...u, generations_used: newUsed, generations_remaining: Math.max(0, (u.generations_limit || 500) - newUsed) },
          });
        }
      }).catch(() => {});
      updateUsageCounter(root);
    }
  } catch (_e: any) {
    addOutput(root, 'Error', GENERATION_FAILURE_MESSAGE);
  }

  btn.innerHTML = 'Generate';
  btn.disabled = false;
  isGenerating = false;
  updateUsageCounter(root);
}

// ─── Add output card ─────────────────────────────────────────────────────────
function addOutput(root: HTMLElement, label: string, content: string, outputType?: string, generationId?: string): void {
  const outputs = root.querySelector('#o8-outputs')!;
  const card = document.createElement('div');
  const visibleContent = displayOutputContent(content, outputType);
  card.className = 'out-card';
  if (generationId) card.dataset.generationId = generationId;
  if (outputType) {
    card.setAttribute('data-output-type', outputType);
    card.classList.add('tab-visible');
  }
  card.innerHTML = `
    <div class="out-label">${esc(getDisplayLabel(label) || label)}</div>
    <textarea class="out-textarea" rows="${outputType === 'email' ? 16 : outputType === 'crm' ? 8 : 5}" readonly>${esc(visibleContent)}</textarea>
    <div class="out-actions">
      <button class="out-action out-primary">Copy</button>
      ${currentPlatform.platform !== 'unknown' ? '<button class="out-action out-primary">Inject</button>' : ''}
      <button class="out-action out-regen">Regen</button>
    </div>
    <div class="out-status"></div>
  `;

  // Copy
  card.querySelector('.out-primary')!.addEventListener('click', async () => {
    const ta = card.querySelector('.out-textarea') as HTMLTextAreaElement;
    await navigator.clipboard.writeText(ta.value);
    const generation_id = card.dataset.generationId || null;
    if (generation_id) {
      safeSend({
        type: 'LOG_HONEST_EVENT',
        payload: {
          event_type: 'generation.copied',
          platform: normalizeEventPlatform(currentPlatform.platform),
          output_type: normalizeOutputType(outputType),
          generation_id,
          customer_context: { name: pinnedCustomer?.name || null, vehicle: pinnedCustomer?.vehicle || null },
          action_metadata: customerStampPayload(),
          output_length: ta.value.length,
        },
      }).catch(() => {});
    }
    const status = card.querySelector('.out-status') as HTMLElement;
    status.textContent = 'Copied';
    status.style.color = '#16a34a';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });

  // Inject — send to content script
  const injectBtn = card.querySelectorAll('.out-primary')[1] as HTMLButtonElement | undefined;
  if (injectBtn) {
    let injectLocked = false;
    injectBtn.addEventListener('click', async () => {
      if (injectLocked) return;
      injectLocked = true;
      injectBtn.disabled = true;
      const ta = card.querySelector('.out-textarea') as HTMLTextAreaElement;
      const status = card.querySelector('.out-status') as HTMLElement;
      try {
        const resp = await sendToContent({
          type: 'INJECT_CONTENT',
          payload: { content: ta.value, outputType: outputType || 'text', platform: currentPlatform.platform },
        });
        if (resp && resp.ok === false) throw new Error('No compose or CRM field found. Open the field and try Inject again.');
        const generation_id = card.dataset.generationId || null;
        if (generation_id) {
          safeSend({
            type: 'LOG_HONEST_EVENT',
            payload: {
              event_type: 'generation.pasted',
              platform: normalizeEventPlatform(currentPlatform.platform),
              output_type: normalizeOutputType(outputType),
              generation_id,
              customer_context: { name: pinnedCustomer?.name || null, vehicle: pinnedCustomer?.vehicle || null },
              action_metadata: { ...customerStampPayload(), injected: true },
              output_length: ta.value.length,
            },
          }).catch(() => {});
        }
        status.textContent = 'Injected';
        status.style.color = '#16a34a';
      } catch (e: any) {
        status.textContent = e.message || 'Inject failed';
        status.style.color = '#ef4444';
      }
      setTimeout(() => {
        status.textContent = '';
        injectLocked = false;
        injectBtn.disabled = false;
      }, 2000);
    });
  }

  // Regen
  const regenBtn = card.querySelector('.out-regen') as HTMLElement;
  if (regenBtn) regenBtn.addEventListener('click', () => doGenerate(root));

  outputs.appendChild(card);
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(root: HTMLElement, msg: string): void {
  const existing = root.querySelector('#brevmont-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'brevmont-toast';
  toast.textContent = msg;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
    background: '#1a202c', color: '#fff', padding: '8px 16px', borderRadius: '6px',
    fontSize: '11px', fontWeight: '500', zIndex: '99', opacity: '1', transition: 'opacity 0.3s',
  });
  root.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
}

// ─── Coach ────────────────────────────────────────────────────────────────────
async function doCoach(root: HTMLElement): Promise<void> {
  if (!(await ensureGenerationAllowed(root))) return;
  const input = (root.querySelector('#o8-coach-input') as HTMLTextAreaElement)?.value.trim();
  if (!input) {
    showToast(root, 'Type a sales scenario first, then click Coach Me.');
    return;
  }
  const output = root.querySelector('#o8-coach-output') as HTMLElement;
  const coachBtn = root.querySelector('#o8-coach-btn') as HTMLButtonElement | null;
  if (coachBtn) {
    coachBtn.disabled = true;
    coachBtn.textContent = 'Thinking...';
  }
  output.innerHTML = '<div class="tool-result" data-stream-target="coach" style="color:#94a3b8;white-space:pre-wrap">Thinking...</div>';
  try {
    await requireToken();
    const leadContext = enrichLeadContextWithPinnedCustomer(await collectCurrentLeadContext());
    const resp = await safeSend({ type: 'COACH_ME', payload: { situation: input, platform: currentPlatform.platform, leadContext } });
    const text = resp?.coaching || resp?.text || '';
    if (!text) {
      output.innerHTML = '<div class="tool-result" style="color:#ef4444">Empty response from Coach. Try again.</div>';
      return;
    }
    output.innerHTML = `<div class="tool-result">${esc(displayText(text, 'No coaching response returned.'))}</div>`;
  } catch (e: any) {
    output.innerHTML = `<div class="tool-result" style="color:#ef4444">${esc(e.message)}</div>`;
  } finally {
    if (coachBtn) {
      coachBtn.disabled = false;
      coachBtn.textContent = 'Coach Me';
    }
  }
}

// ─── Alert Time Parser (ported from content.ts) ─────────────────────────────
function parseAlertTime(text: string): number {
  const now = Date.now();
  const inMin = text.match(/in\s+(\d+)\s*min/i);
  if (inMin) return now + parseInt(inMin[1]) * 60000;
  const inHr = text.match(/in\s+(\d+)\s*hour/i);
  if (inHr) return now + parseInt(inHr[1]) * 3600000;
  if (/\bnoon\b/i.test(text)) { const d = new Date(); d.setHours(12, 0, 0, 0); if (d.getTime() < now) d.setDate(d.getDate() + 1); return d.getTime(); }
  if (/\b(eod|end of day|close of business|cob)\b/i.test(text)) { const d = new Date(); d.setHours(17, 0, 0, 0); if (d.getTime() < now) d.setDate(d.getDate() + 1); return d.getTime(); }
  const isTomorrow = /\btomorrow\b/i.test(text);
  const byTime = text.match(/(?:by|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (byTime) {
    let h = parseInt(byTime[1]); const m = byTime[2] ? parseInt(byTime[2]) : 0;
    const ampm = (byTime[3] || '').toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    if (!ampm && h < 7) h += 12;
    const d = new Date(); d.setHours(h, m, 0, 0);
    if (isTomorrow) d.setDate(d.getDate() + 1);
    else if (d.getTime() < now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return now + 30 * 60000;
}

// ─── Set Alert ───────────────────────────────────────────────────────────────
async function doSetAlert(root: HTMLElement): Promise<void> {
  const input = (root.querySelector('#o8-alert-input') as HTMLInputElement)?.value.trim();
  if (!input) return;
  try {
    const leadContext = enrichLeadContextWithPinnedCustomer(await collectCurrentLeadContext());
    await safeSend({ type: 'SET_ALERT', payload: { task: input, alertTime: parseAlertTime(input), leadContext, ...customerStampPayload() } });
    (root.querySelector('#o8-alert-input') as HTMLInputElement).value = '';
    showToast(root, 'Alert set');
    loadAlerts(root);
  } catch {}
}

async function loadAlerts(root: HTMLElement): Promise<void> {
  const list = root.querySelector('#o8-alert-list') as HTMLElement;
  if (!list) return;
  try {
    const alerts = await safeSend({ type: 'GET_ALERTS' });
    if (!alerts || alerts.length === 0) {
      list.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:12px">No active reminders</div>';
      return;
    }
    list.innerHTML = alerts.map((a: any) =>
      `<div class="alert-item"><span>${esc(a.task)}</span><span class="alert-time">${new Date(a.alertTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><button class="alert-done" data-id="${a.id}">Done</button></div>`
    ).join('');
    list.querySelectorAll('.alert-done').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id;
        if (id) { await safeSend({ type: 'DISMISS_ALERT', payload: { id } }); loadAlerts(root); }
      });
    });
  } catch {}
}

// ─── Command ─────────────────────────────────────────────────────────────────
async function doCommand(root: HTMLElement): Promise<void> {
  if (!(await ensureGenerationAllowed(root))) return;
  const input = (root.querySelector('#o8-cmd-input') as HTMLTextAreaElement)?.value.trim();
  if (!input) return;
  const status = root.querySelector('#o8-cmd-status') as HTMLElement;
  status.innerHTML = '<div class="tool-result" data-stream-target="command" style="color:#94a3b8;white-space:pre-wrap">Executing...</div>';
  try {
    await requireToken();
    const leadContext = enrichLeadContextWithPinnedCustomer(await collectCurrentLeadContext());
    const resp = await safeSend({ type: 'EXECUTE_COMMAND', payload: { command: input, platform: currentPlatform.platform, currentUrl: currentPlatform.url, leadContext } });
    // API returns { parsed: { action, content, ... }, usage }.
    // Display the content field from the parsed command JSON.
    const text = resp?.parsed?.content || resp?.result || resp?.text || '';
    if (!text) {
      status.innerHTML = '<div class="tool-result" style="color:#ef4444">Empty response. Try again.</div>';
      return;
    }
    status.innerHTML = `<div class="tool-result">${esc(displayText(text, 'No answer returned.'))}</div>`;
  } catch (e: any) {
    status.innerHTML = `<div class="tool-result" style="color:#ef4444">${esc(e.message)}</div>`;
  }
}

// ─── Context Tool (screenshot + reply) ───────────────────────────────────────
function wireContextTool(root: HTMLElement): void {
  const dropzone = root.querySelector('#o8-ctx-dropzone') as HTMLElement;
  const preview = root.querySelector('#o8-ctx-preview') as HTMLElement;
  const img = root.querySelector('#o8-ctx-img') as HTMLImageElement;
  const removeBtn = root.querySelector('#o8-ctx-remove') as HTMLElement;
  const captureBtn = root.querySelector('#o8-ctx-capture') as HTMLButtonElement | null;
  const genBtn = root.querySelector('#o8-ctx-generate') as HTMLButtonElement;
  const directionInput = root.querySelector('#o8-ctx-direction') as HTMLTextAreaElement;
  const output = root.querySelector('#o8-ctx-output') as HTMLElement;
  let screenshotData: string | null = null;
  let screenshotMeta: any = null;

  if (!dropzone) return;

  const setScreenshot = async (dataUrl: string) => {
    if (output) output.innerHTML = '<div class="tool-result" style="color:#94a3b8">Preparing screenshot...</div>';
    const optimized = await optimizeContextScreenshot(dataUrl);
    screenshotData = optimized.dataUrl;
    screenshotMeta = {
      bytes: optimized.bytes,
      width: optimized.width,
      height: optimized.height,
      original_bytes: optimized.originalBytes,
      original_width: optimized.originalWidth,
      original_height: optimized.originalHeight,
    };
    if (img) img.src = screenshotData;
    if (preview) preview.style.display = 'block';
    if (dropzone) dropzone.style.display = 'none';
    if (genBtn) genBtn.disabled = false;
    if (output) output.innerHTML = '';
  };

  dropzone.tabIndex = 0;
  dropzone.addEventListener('click', () => dropzone.focus());

  // Paste handler
  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              await setScreenshot(reader.result as string);
            } catch (err: any) {
              output.innerHTML = `<div class="tool-result" style="color:#ef4444">${esc(err?.message || 'Could not prepare screenshot.')}</div>`;
            }
          };
          reader.readAsDataURL(blob);
        }
        e.preventDefault();
        break;
      }
    }
  };
  document.addEventListener('paste', handlePaste);
  dropzone.addEventListener('paste', handlePaste);

  if (captureBtn) {
    captureBtn.onclick = async () => {
      captureBtn.disabled = true;
      captureBtn.textContent = 'Capturing...';
      try {
        await requireToken();
        const resp = await safeSend({ type: 'CAPTURE_SCREENSHOT' });
        if (!resp?.image) throw new Error(resp?.error || 'Screenshot capture failed');
        await setScreenshot(resp.image);
        if (resp?.fallback) {
          screenshotMeta = {
            ...screenshotMeta,
            fallback: resp.fallback,
            capture_warning: resp.warning || null,
            captured_page_text: resp.page_text || '',
          };
          output.innerHTML = '<div class="tool-result" style="color:#0D6E6E">Screenshot permission was not available, so Brevmont captured the visible conversation text instead.</div>';
        }
      } catch (e: any) {
        output.innerHTML = `<div class="tool-result" style="color:#ef4444">${esc(e.message || 'Screenshot capture failed')}</div>`;
      } finally {
        captureBtn.disabled = false;
        captureBtn.textContent = 'Capture Current Tab';
      }
    };
  }

  if (removeBtn) {
    removeBtn.onclick = () => {
      screenshotData = null;
      screenshotMeta = null;
      preview.style.display = 'none';
      dropzone.style.display = 'flex';
      genBtn.disabled = true;
    };
  }

  if (genBtn) {
    genBtn.onclick = async () => {
      if (!(await ensureGenerationAllowed(root))) return;
      if (!screenshotData) return;
      const direction = directionInput?.value.trim() || '';
        output.innerHTML = '<div class="tool-result" style="color:#94a3b8">Analyzing screenshot...</div>';
        try {
        await requireToken();
        const collectedPageText = await collectContextReplyPageText();
        const pageText = cleanContextText([
          collectedPageText,
          screenshotMeta?.captured_page_text ? `Fallback captured page text: ${screenshotMeta.captured_page_text}` : '',
        ].filter(Boolean).join('\n'), CONTEXT_PAGE_TEXT_MAX);
        const leadContext = enrichLeadContextWithPinnedCustomer(await collectCurrentLeadContext());
        const resp = await safeSend({
          type: 'CONTEXT_REPLY',
          payload: {
            image: screenshotData,
            direction,
            page_text: pageText,
            platform: currentPlatform.platform,
            image_meta: screenshotMeta,
            leadContext,
          },
        });
        const replyText = resp?.reply || resp?.text || '';
        if (!replyText) {
          output.innerHTML = '<div class="tool-result" style="color:#ef4444">Empty response. Try again.</div>';
          return;
        }
        const cleanReply = displayText(replyText, 'No screenshot reply returned.');
        output.innerHTML = `<div class="out-card"><div class="out-label">Screenshot reply</div><textarea class="out-textarea" rows="5" readonly>${esc(cleanReply)}</textarea><div class="out-actions"><button class="out-action out-primary">Copy</button><button class="out-action out-regen">Regen</button></div></div>`;
        output.querySelector('.out-primary')?.addEventListener('click', async () => { await navigator.clipboard.writeText(replyText); const b = output.querySelector('.out-primary'); if (b) { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 2000); } });
        output.querySelector('.out-regen')?.addEventListener('click', () => genBtn.click());
      } catch (e: any) {
        output.innerHTML = `<div class="tool-result" style="color:#ef4444">${esc(e.message)}</div>`;
      }
    };
  }

  // Mic for context direction
  const ctxMic = root.querySelector('#o8-ctx-mic') as HTMLElement;
  if (ctxMic && directionInput) attachMic(directionInput, ctxMic);
}

// ─── Pipeline stage helpers ──────────────────────────────────────────────────
const PIPELINE_STAGES = ['captured', 'contacted', 'appointment_set', 'showed', 'sold', 'lost'] as const;
type PipelineStage = typeof PIPELINE_STAGES[number];
type LostReasonKey =
  | 'bought_elsewhere'
  | 'price'
  | 'payment'
  | 'credit'
  | 'trade_value'
  | 'inventory'
  | 'lost_contact'
  | 'timing'
  | 'bad_lead'
  | 'duplicate';

const LOST_REASON_OPTIONS: Array<{ value: LostReasonKey; label: string }> = [
  { value: 'bought_elsewhere', label: 'Bought elsewhere' },
  { value: 'price', label: 'Price too high' },
  { value: 'payment', label: 'Payment too high' },
  { value: 'credit', label: 'Credit issues' },
  { value: 'trade_value', label: 'Trade value too low' },
  { value: 'inventory', label: 'Vehicle not available' },
  { value: 'lost_contact', label: 'Lost contact' },
  { value: 'timing', label: 'Not ready to buy' },
  { value: 'bad_lead', label: 'Bad lead / not real' },
  { value: 'duplicate', label: 'Duplicate' },
];

function stageLabelMap(stage: string): string {
  return getDisplayLabel(stage) || 'Captured';
}

function lostReasonLabel(reason: unknown): string {
  const raw = String(reason || '').toLowerCase().trim();
  return LOST_REASON_OPTIONS.find((option) => option.value === raw)?.label || getDisplayLabel(raw);
}

function renderMyLeadsFilterControls(filter: 'active' | 'lost'): string {
  return `
    <div class="my-leads-filter-row" role="tablist" aria-label="Lead filter">
      <button class="my-leads-filter-btn ${filter === 'active' ? 'active' : ''}" data-stage-filter="active" type="button">Active</button>
      <button class="my-leads-filter-btn ${filter === 'lost' ? 'active' : ''}" data-stage-filter="lost" type="button">Lost</button>
    </div>
  `;
}

function openLostReasonModal(
  root: HTMLElement,
  lead: any,
  onConfirm: (payload: { lost_reason: LostReasonKey; lost_reason_detail?: string }) => Promise<void>,
): void {
  root.querySelector('.lost-reason-backdrop')?.remove();
  const customer = displayText(lead?.customer_name, 'this lead');
  const modal = document.createElement('div');
  modal.className = 'lost-reason-backdrop';
  modal.innerHTML = `
    <div class="lost-reason-modal" role="dialog" aria-modal="true" aria-labelledby="lost-reason-title">
      <div class="lost-reason-header">
        <div>
          <div id="lost-reason-title" class="lost-reason-title">Why are you marking this lead lost?</div>
          <div class="lost-reason-subtitle">${esc(customer)}</div>
        </div>
        <button class="lost-reason-close" type="button" aria-label="Cancel">&times;</button>
      </div>
      <div class="lost-reason-grid">
        ${LOST_REASON_OPTIONS.map((option) => `
          <button class="lost-reason-option" type="button" data-lost-reason="${esc(option.value)}">${esc(option.label)}</button>
        `).join('')}
      </div>
      <label class="lost-reason-note-label" for="lost-reason-note">Optional</label>
      <textarea id="lost-reason-note" class="lost-reason-note" rows="3" maxlength="1000" placeholder="Add a note..."></textarea>
      <div class="lost-reason-error" aria-live="polite"></div>
      <div class="lost-reason-actions">
        <button class="lost-reason-cancel" type="button">Cancel</button>
        <button class="lost-reason-confirm" type="button" disabled>Mark Lost</button>
      </div>
    </div>
  `;
  root.appendChild(modal);

  let selected: LostReasonKey | null = null;
  const confirm = modal.querySelector('.lost-reason-confirm') as HTMLButtonElement;
  const cancel = modal.querySelector('.lost-reason-cancel') as HTMLButtonElement;
  const close = modal.querySelector('.lost-reason-close') as HTMLButtonElement;
  const note = modal.querySelector('#lost-reason-note') as HTMLTextAreaElement;
  const error = modal.querySelector('.lost-reason-error') as HTMLElement;
  const dismiss = () => modal.remove();
  cancel.onclick = dismiss;
  close.onclick = dismiss;
  modal.addEventListener('click', (event) => {
    if (event.target === modal) dismiss();
  });

  modal.querySelectorAll<HTMLButtonElement>('.lost-reason-option').forEach((button) => {
    button.onclick = () => {
      const value = button.dataset.lostReason as LostReasonKey | undefined;
      if (!value) return;
      selected = value;
      modal.querySelectorAll('.lost-reason-option').forEach((el) => el.classList.toggle('selected', el === button));
      confirm.disabled = false;
      error.textContent = '';
    };
  });

  confirm.onclick = async () => {
    if (!selected) return;
    confirm.disabled = true;
    cancel.disabled = true;
    close.disabled = true;
    confirm.textContent = 'Saving...';
    error.textContent = '';
    try {
      const detail = note.value.trim();
      await onConfirm({
        lost_reason: selected,
        ...(detail ? { lost_reason_detail: detail } : {}),
      });
      modal.remove();
    } catch (err: any) {
      error.textContent = err?.message || 'Could not mark lost. Try again.';
      confirm.disabled = false;
      cancel.disabled = false;
      close.disabled = false;
      confirm.textContent = 'Mark Lost';
    }
  };
}

function stageBadgeStyle(stage: string): string {
  const map: Record<string, string> = {
    captured: 'background:#F1F5F9;color:#475569;',
    contacted: 'background:#EFF6FF;color:#1D4ED8;',
    appointment_set: 'background:#F5F3FF;color:#7C3AED;',
    showed: 'background:#F0FDFA;color:#0F766E;',
    sold: 'background:#F0FDF4;color:#166534;',
    lost: 'background:#FEF2F2;color:#991B1B;',
  };
  return map[stage] || 'background:#F1F5F9;color:#475569;';
}

function timeAgo(value: unknown): string {
  const date = value ? new Date(String(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return 'no recent contact';
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 60 * 1000) return 'today';
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function leadSourceLabel(value: unknown): string {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('gmail')) return 'Gmail';
  if (raw.includes('facebook') || raw.includes('messenger')) return 'Facebook';
  if (raw.includes('voice')) return 'Voice';
  if (raw.includes('scan')) return 'Scan';
  if (raw.includes('paste')) return 'Paste';
  return getDisplayLabel(raw || 'extension') || 'Saved';
}

function tierBadge(tier: unknown): string {
  const raw = String(tier || 'bronze').toLowerCase();
  if (raw === 'gold') return 'Gold';
  if (raw === 'silver') return 'Silver';
  return 'Bronze';
}

function renderChallengeBanner(root: HTMLElement, challenges: any[]): void {
  const banner = root.querySelector('#o8-challenge-banner') as HTMLElement | null;
  if (!banner) return;
  const active = (challenges || []).find((challenge) => challenge && !dismissedChallengeIds.has(challenge.id));
  if (!active) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  const target = Math.max(1, Number(active.goal_target || 1));
  const progress = Math.max(0, Number(active.progress || 0));
  const percent = Math.min(100, Math.round((progress / target) * 100));
  const goalLabel = active.goal_type === 'lead_capture'
    ? `Capture ${target} leads`
    : active.goal_type === 'appt_set'
      ? `Set ${target} appointments`
      : active.goal_type === 'follow_ups'
        ? `Write ${target} follow-ups`
        : `Hit ${target}`;
  banner.innerHTML = `
    <div class="challenge-title"><span>Flash Challenge Active</span><button class="challenge-close" id="o8-challenge-dismiss" type="button" aria-label="Dismiss challenge">&times;</button></div>
    <div style="font-weight:800;color:#0F172A">${esc(goalLabel)} &rarr; ${esc(active.reward_description || 'Reward')}</div>
    <div class="challenge-bar"><div class="challenge-fill" style="width:${percent}%"></div></div>
    <div style="margin-top:5px;color:#475569;font-size:11px">${progress} / ${target} &nbsp; ${Math.max(0, target - progress)} to go</div>
  `;
  banner.style.display = 'block';
  const dismiss = banner.querySelector('#o8-challenge-dismiss') as HTMLButtonElement | null;
  if (dismiss) dismiss.onclick = () => {
    if (active.id) dismissedChallengeIds.add(active.id);
    banner.style.display = 'none';
  };
  if (progress >= target) {
    banner.querySelector('.challenge-title span')!.textContent = 'Challenge Complete';
    const bold = banner.querySelector('div[style*="font-weight"]') as HTMLElement | null;
    if (bold) bold.textContent = 'Great work. Challenge complete.';
  }
}

async function refreshChallengeBanner(root: HTMLElement): Promise<void> {
  try {
    const resp = await safeSend({ type: 'GET_REP_CHALLENGES' });
    renderChallengeBanner(root, Array.isArray(resp?.challenges) ? resp.challenges : []);
  } catch {
    renderChallengeBanner(root, []);
  }
}

function startChallengePolling(root: HTMLElement): void {
  if (challengePollTimer !== null) window.clearInterval(challengePollTimer);
  void refreshChallengeBanner(root);
  challengePollTimer = window.setInterval(() => {
    const liveRoot = document.getElementById('sp-root');
    if (liveRoot) void refreshChallengeBanner(liveRoot);
  }, 2000);
}

function renderLeadCard(lead: any, index: number): string {
  const customer = displayText(lead.customer_name, 'Unknown customer');
  const vehicle = optionalDisplayText(lead.vehicle_interest);
  const heat = Number(lead.heat_score ?? 0);
  const stage = String(lead.pipeline_stage || lead.status || 'captured');
  const isLost = stage === 'lost';
  const lastContact = lead.last_contacted_at || lead.last_activity_at || lead.captured_at;
  const appointment = lead.appointment_at ? `<div style="font-size:11px;color:#7C3AED;margin-top:6px;font-weight:700;">Appt: ${esc(new Date(lead.appointment_at).toLocaleString())}</div>` : '';
  const reminder = Array.isArray(lead.upcoming_reminders) && lead.upcoming_reminders[0]
    ? `<div style="font-size:11px;color:#0D6E6E;margin-top:6px;font-weight:700;">&#128338; ${esc(lead.upcoming_reminders[0].input || 'Follow-up reminder')} ${lead.upcoming_reminders[0].reminder_time ? `â€” ${esc(new Date(lead.upcoming_reminders[0].reminder_time).toLocaleString())}` : ''}</div>`
    : '';
  const lostReason = lostReasonLabel(lead.lost_reason);
  const lostDetail = optionalDisplayText(lead.lost_reason_detail);
  const lostAt = lead.lost_at ? new Date(lead.lost_at).toLocaleString() : '';
  const lostBlock = isLost ? `
      <div class="lost-lead-detail">
        <div><strong>Reason:</strong> ${esc(lostReason || 'Lost')}</div>
        ${lostDetail ? `<div>${esc(lostDetail)}</div>` : ''}
        ${lostAt ? `<div class="lost-lead-time">Lost ${esc(lostAt)}</div>` : ''}
      </div>` : '';
  return `
    <div class="my-lead-card ${isLost ? 'lost' : ''}" data-lead-id="${esc(lead.id)}" data-lead-index="${index}">
      <div style="display:flex;align-items:start;justify-content:space-between;gap:8px;">
        <div>
          <div class="lead-card-title">${esc(customer)}</div>
          ${vehicle ? `<div style="font-size:12px;color:#475569;margin-top:2px;">${esc(vehicle)}</div>` : ''}
        </div>
        <span class="${isLost ? 'lost-lead-badge' : 'your-lead-badge'}">${isLost ? 'LOST' : 'YOUR LEAD'}</span>
      </div>
      <div class="lead-card-meta">
        <span class="lead-pill">&#128293; ${heat}</span>
        <span class="lead-pill">${esc(timeAgo(lastContact))}</span>
        <span class="lead-pill">${esc(leadSourceLabel(lead.source_platform))}</span>
        <span class="lead-pill" style="${stageBadgeStyle(stage)}">${esc(stageLabelMap(stage))}</span>
      </div>
      ${appointment}
      ${reminder}
      ${lostBlock}
      <button class="lead-primary-action" data-action="generate">Generate Follow-up</button>
      <div class="lead-secondary-row">
        <button class="lead-secondary-action" data-action="contacted">→ Contacted</button>
        <button class="lead-secondary-action" data-action="appt">Set Appt</button>
        <button class="lead-secondary-action" data-action="lost">Mark Lost</button>
      </div>
      <div class="appt-inline" style="display:none;margin-top:8px;">
        <input type="datetime-local" class="appt-input" style="width:100%;padding:8px;border:1px solid #E5E7EB;border-radius:7px;font-size:12px;font-family:inherit;" />
        <button class="lead-primary-action" data-action="save-appt" style="margin-top:6px;">Save Appointment</button>
      </div>
    </div>
  `;
}

async function renderMyLeads(root: HTMLElement): Promise<void> {
  const content = root.querySelector('#o8-my-leads-content') as HTMLElement | null;
  const alerts = root.querySelector('#o8-going-dark-alerts') as HTMLElement | null;
  const count = root.querySelector('#o8-my-leads-count') as HTMLElement | null;
  if (!content) return;
  content.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:24px;">Loading your pipeline...</div>';

  try {
    const leadFilter: 'active' | 'lost' = (root as any).__myLeadsStageFilter === 'lost' ? 'lost' : 'active';
    const resp = await safeSend({ type: 'GET_MY_LEADS', payload: { stage: leadFilter } });
    const leads = Array.isArray(resp?.leads) ? resp.leads : [];
    leads.sort((a: any, b: any) => {
      if (leadFilter === 'lost') {
        const aLost = new Date(a.lost_at || a.last_activity_at || a.captured_at || 0).getTime();
        const bLost = new Date(b.lost_at || b.last_activity_at || b.captured_at || 0).getTime();
        return bLost - aLost;
      }
      const heat = Number(b.heat_score || 0) - Number(a.heat_score || 0);
      if (heat !== 0) return heat;
      const aTime = new Date(a.last_contacted_at || a.last_activity_at || a.captured_at || 0).getTime();
      const bTime = new Date(b.last_contacted_at || b.last_activity_at || b.captured_at || 0).getTime();
      return aTime - bTime;
    });
    (root as any).__myLeads = leads;

    const goingDark = leadFilter === 'active' ? leads.filter((lead: any) => lead.going_dark) : [];
    if (count && goingDark.length) {
      count.textContent = String(goingDark.length);
      count.style.display = 'inline-flex';
    } else if (count) {
      count.style.display = 'none';
    }

    if (alerts) {
      if (goingDark.length) {
        const lead = goingDark[0];
        alerts.style.display = 'flex';
        alerts.innerHTML = `
          <div class="going-dark-card">
            <div style="font-weight:900;color:#92400E;">Don't lose this one — they're going cold.</div>
            <div style="margin-top:3px;">${esc(displayText(lead.customer_name, 'This lead'))} hasn't heard from you in ${esc(timeAgo(lead.last_contacted_at || lead.last_activity_at || lead.captured_at))}.</div>
            <div style="font-size:11px;color:#78350F;margin-top:2px;">${esc(optionalDisplayText(lead.vehicle_interest) || 'General follow-up')} — Heat ${Number(lead.heat_score || 0)}</div>
          </div>`;
      } else {
        alerts.style.display = 'none';
        alerts.innerHTML = '';
      }
    }

    if (!leads.length) {
      content.innerHTML = `
        ${renderMyLeadsFilterControls(leadFilter)}
        <div style="text-align:center;color:#64748b;font-size:12px;padding:24px;line-height:1.5;">
          ${leadFilter === 'lost' ? 'No lost leads yet.' : 'Your pipeline will show the leads you capture here.'}
        </div>`;
      wireMyLeadCardActions(root);
      return;
    }

    const showAll = Boolean((root as any).__myLeadsShowAll);
    const visible = showAll ? leads : leads.slice(0, 7);
    content.innerHTML = `
      ${renderMyLeadsFilterControls(leadFilter)}
      <div style="font-size:11px;color:#64748B;margin-bottom:8px;">
        ${leadFilter === 'lost' ? 'Lost leads stay tucked away with the reason preserved.' : 'Your active leads, sorted by heat and who needs attention first.'}
      </div>
      ${visible.map(renderLeadCard).join('')}
      ${leads.length > 7 ? `<button id="o8-my-leads-show-more" class="lead-secondary-action" style="width:100%;margin-top:10px;">${showAll ? 'Show top 7' : `Show more (${leads.length - 7})`}</button>` : ''}
    `;
    wireMyLeadCardActions(root);
  } catch (err: any) {
    content.innerHTML = `<div style="text-align:center;color:#EF4444;font-size:12px;padding:24px;">Could not load your pipeline. ${esc(err?.message || '')}</div>`;
  }
}

function wireMyLeadCardActions(root: HTMLElement): void {
  const content = root.querySelector('#o8-my-leads-content') as HTMLElement | null;
  if (!content) return;
  content.querySelectorAll<HTMLButtonElement>('[data-stage-filter]').forEach((button) => {
    button.onclick = () => {
      const stageFilter = button.dataset.stageFilter === 'lost' ? 'lost' : 'active';
      (root as any).__myLeadsStageFilter = stageFilter;
      (root as any).__myLeadsShowAll = false;
      void renderMyLeads(root);
    };
  });
  const showMore = content.querySelector('#o8-my-leads-show-more') as HTMLButtonElement | null;
  if (showMore) {
    showMore.onclick = () => {
      (root as any).__myLeadsShowAll = !Boolean((root as any).__myLeadsShowAll);
      void renderMyLeads(root);
    };
  }

  content.querySelectorAll<HTMLElement>('.my-lead-card').forEach((card) => {
    const leadId = card.dataset.leadId;
    const index = Number(card.dataset.leadIndex || 0);
    const lead = ((root as any).__myLeads || [])[index];
    card.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((button) => {
      button.onclick = async () => {
        const action = button.dataset.action;
        if (!leadId || !lead) return;
        if (action === 'generate') {
          const input = root.querySelector('#o8-input') as HTMLTextAreaElement | null;
          const customer = displayText(lead.customer_name, 'this customer');
          const vehicle = optionalDisplayText(lead.vehicle_interest);
          const stage = stageLabelMap(lead.pipeline_stage || 'captured').toLowerCase();
          if (input) {
            input.value = `Follow up with ${customer}${vehicle ? ` about the ${vehicle}` : ''}. Current stage: ${stage}.`;
            input.focus();
          }
          (root as any).__pendingLeadId = leadId;
          hidePrimaryPanels(root);
          const quick = root.querySelector('#o8-quick') as HTMLElement | null;
          if (quick) quick.style.display = 'flex';
          showToast(root, 'Lead context loaded. Hit Generate.');
          return;
        }
        if (action === 'appt') {
          const box = card.querySelector('.appt-inline') as HTMLElement | null;
          if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
          return;
        }
        if (action === 'lost') {
          openLostReasonModal(root, lead, async ({ lost_reason, lost_reason_detail }) => {
            await safeSend({
              type: 'CHANGE_LEAD_STAGE',
              payload: { leadId, stage: 'lost', lost_reason, lost_reason_detail },
            });
            card.classList.add('my-lead-card-exiting');
            await sleep(300);
            showToast(root, `${displayText(lead.customer_name, 'Lead')} marked as lost. Moved to Lost tab.`);
            await renderMyLeads(root);
          });
          return;
        }
        if (action === 'save-appt') {
          const input = card.querySelector('.appt-input') as HTMLInputElement | null;
          if (!input?.value) {
            showToast(root, 'Pick a date and time first.');
            return;
          }
          await safeSend({ type: 'CHANGE_LEAD_STAGE', payload: { leadId, stage: 'appointment_set', appointment_at: new Date(input.value).toISOString() } });
          showToast(root, 'Appointment saved');
          await renderMyLeads(root);
          return;
        }
        const stage = action === 'contacted' ? 'contacted' : null;
        if (stage) {
          await safeSend({ type: 'CHANGE_LEAD_STAGE', payload: { leadId, stage } });
          showToast(root, stage === 'contacted' ? 'Marked contacted' : 'Marked lost');
          await renderMyLeads(root);
        }
      };
    });
  });
}

async function openMyLeads(root: HTMLElement): Promise<void> {
  const quick = root.querySelector('#o8-quick') as HTMLElement | null;
  if (quick) quick.style.display = 'none';
  hidePrimaryPanels(root);
  const panel = root.querySelector('#o8-my-leads-panel') as HTMLElement | null;
  if (panel) panel.style.display = 'flex';
  await renderMyLeads(root);
}

function getNextStage(current: string): PipelineStage | null {
  const mainFlow: PipelineStage[] = ['captured', 'contacted', 'appointment_set', 'showed', 'sold'];
  const idx = mainFlow.indexOf(current as PipelineStage);
  if (idx >= 0 && idx < mainFlow.length - 1) return mainFlow[idx + 1];
  return null;
}

function leadCaptureIcon(kind: 'buyer' | 'phone' | 'email' | 'vehicle' | 'signal'): string {
  const pathMap: Record<typeof kind, string> = {
    buyer: '<circle cx="12" cy="8" r="3"/><path d="M5 20c1.4-4 4-6 7-6s5.6 2 7 6"/>',
    phone: '<path d="M22 16.9v2.2a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 3.4 2 2 0 0 1 4.1 1h2.2a2 2 0 0 1 2 1.7c.1.9.3 1.7.6 2.5a2 2 0 0 1-.4 2.1L7.5 8.4a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.5.6a2 2 0 0 1 1.8 2z"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    vehicle: '<path d="M5 17h14l-1.4-5.3A3 3 0 0 0 14.7 9H9.3a3 3 0 0 0-2.9 2.7L5 17z"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>',
    signal: '<path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.9 4.9 2.8 2.8"/><path d="m16.3 16.3 2.8 2.8"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.9 19.1 2.8-2.8"/><path d="m16.3 7.7 2.8-2.8"/><circle cx="12" cy="12" r="3"/>',
  };
  return `<span class="lead-capture-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${pathMap[kind]}</svg></span>`;
}

function leadSignalSummary(lead: any, intent: string, rawText: string): string {
  const sourceText = `${rawText} ${lead.notes || ''} ${lead.context || ''}`.toLowerCase();
  if (sourceText.includes('engine') || sourceText.includes('motor')) return 'Engine inquiry - actively shopping';
  if (lead.finance_intent || sourceText.includes('finance') || sourceText.includes('payment')) return 'Finance signal - payment conversation';
  if (lead.has_trade_in || sourceText.includes('trade')) return 'Trade-in signal - vehicle to appraise';
  if (intent === 'fleet_inquiry') return 'Fleet request - multiple vehicle potential';
  if (intent && intent !== 'unknown') return getDisplayLabel(intent);
  return 'Buying context found';
}

// ─── Show parsed lead result ─────────────────────────────────────────────────
function showLeadResult(root: HTMLElement, lead: any): void {
  const result = root.querySelector('#o8-lead-result') as HTMLElement;
  if (!result || !lead) return;
  if (lead.is_lead === false || lead.intent === 'not_a_lead') {
    result.style.display = 'block';
    result.innerHTML = `<div class="tool-result" style="color:#64748B;text-align:center;padding:14px;line-height:1.45;">${esc(lead.notes || 'No buying intent detected. If this is a customer, use Voice or Paste tab.')}</div>`;
    return;
  }

  const company = optionalDisplayText(lead.company);
  const intent = String(lead.intent || '').toLowerCase();
  const confidence = String(lead.confidence || '').toLowerCase();
  const isFleet = intent === 'fleet_inquiry' || !!company;
  const name = displayText([lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.name || lead.customer_name || company, 'Unknown lead');
  const vehicle = optionalDisplayText(lead.vehicle_of_interest || lead.vehicle_interest || lead.vehicle);
  const rawText = stripMarkdownText(lead.source_raw_text || '');
  const leadId = lead.id || null;
  const pipelineStage = lead.pipeline_stage || 'captured';
  const heatScore = lead.heat_score ?? null;
  const hasTrade = lead.has_trade_in || false;
  const hasFinance = lead.finance_intent || false;
  const nextStage = getNextStage(pipelineStage);
  const sourceLabel = getDisplayLabel(lead.source_platform || currentPlatform.platform || 'Extension') || 'Extension';
  const signalSummary = leadSignalSummary(lead, intent, rawText);
  const contextCopy = optionalDisplayText(lead.notes)
    || (rawText ? rawText.substring(0, 160) : '')
    || `${name} was captured from ${sourceLabel}${vehicle ? ` with interest in ${vehicle}` : ''}.`;
  if (name && name !== 'Unknown lead') {
    if (lead.customer_id) {
      pinCustomer(root, {
        id: String(lead.customer_id),
        name,
        vehicle: vehicle || null,
        phone: lead.phone || null,
        email: lead.email || null,
        source: lead.source_platform || currentPlatform.platform,
        confidence: 1,
        detectionMethod: 'lead_link',
        pinnedAt: Date.now(),
      });
    } else {
      resolveCustomerForDetection({
        name,
        phone: lead.phone || null,
        email: lead.email || null,
        vehicle,
        source: lead.source_platform || currentPlatform.platform,
        detectionMethod: 'manual',
        detectionConfidence: confidence === 'low' ? 0.5 : 0.8,
      }).then((customer) => {
        if (customer) pinCustomer(root, { ...customer, detectionMethod: 'lead_link' });
      }).catch(() => {});
    }
  }
  const confidenceNote =
    confidence === 'medium'
      ? 'Possible lead — review before saving'
      : confidence === 'low'
        ? 'Low confidence — verify this is a customer'
        : '';

  result.style.display = 'block';
  result.innerHTML = `<div class="lead-capture-card">
    <div class="lead-capture-topline">
      ${isFleet ? '<span class="lead-capture-mode">Fleet inquiry</span>' : '<span class="lead-capture-mode">Captured buyer</span>'}
      ${confidenceNote ? `<span class="lead-capture-review">${esc(confidenceNote)}</span>` : ''}
    </div>
    <div class="lead-capture-rows">
      <div class="lead-capture-row">
        ${leadCaptureIcon('buyer')}
        <div class="lead-capture-copy">
          <div class="lead-capture-label">Buyer</div>
          <div class="lead-capture-value">${company ? esc(company) : esc(name)}${company && name && name !== company ? ` <span>${esc(name)}</span>` : ''}</div>
        </div>
      </div>
      ${lead.phone ? `<div class="lead-capture-row">${leadCaptureIcon('phone')}<div class="lead-capture-copy"><div class="lead-capture-label">Phone</div><div class="lead-capture-value">${esc(lead.phone)}</div></div></div>` : ''}
      ${lead.email ? `<div class="lead-capture-row">${leadCaptureIcon('email')}<div class="lead-capture-copy"><div class="lead-capture-label">Email</div><div class="lead-capture-value">${esc(lead.email)}</div></div></div>` : ''}
      ${vehicle ? `<div class="lead-capture-row">${leadCaptureIcon('vehicle')}<div class="lead-capture-copy"><div class="lead-capture-label">Vehicle</div><div class="lead-capture-value">${esc(vehicle)}</div></div></div>` : ''}
      <div class="lead-capture-row">
        ${leadCaptureIcon('signal')}
        <div class="lead-capture-copy">
          <div class="lead-capture-label">Signal</div>
          <div class="lead-capture-value">${esc(signalSummary)}</div>
        </div>
      </div>
    </div>
    <div class="lead-capture-stage">
      <div class="lead-capture-stage-title">Where is this lead at?</div>
      <div class="lead-capture-stage-grid">
        ${[
          ['fresh_contact', 'Fresh contact'],
          ['in_conversation', 'In conversation'],
          ['be_back', 'Be-back'],
          ['internet_lead', 'Internet lead'],
        ].map(([stageKey, label]) => `<button class="stage-capture-chip ${lead.lead_stage_at_capture === stageKey ? 'selected' : ''}" data-stage-capture="${stageKey}" type="button">${esc(label)}</button>`).join('')}
      </div>
    </div>
    <div class="lead-capture-tags">
      <span class="lead-capture-tag">${esc(stageLabelMap(pipelineStage))}</span>
      <span class="lead-capture-tag muted">${esc(sourceLabel)}</span>
      ${intent ? `<span class="lead-capture-tag muted">${esc(getDisplayLabel(intent))}</span>` : ''}
      ${heatScore !== null ? `<span class="lead-capture-tag heat">Heat ${esc(String(heatScore))}</span>` : ''}
      ${hasTrade ? '<span class="lead-capture-tag warm">Trade-in</span>' : ''}
      ${hasFinance ? '<span class="lead-capture-tag cool">Finance</span>' : ''}
    </div>
    <div class="lead-capture-context">
      <div class="lead-capture-context-label">Buyer context</div>
      <div class="lead-capture-context-copy">${esc(contextCopy)}</div>
    </div>
    <div class="lead-capture-actions">
      <button class="out-action out-primary" id="o8-lead-copy">Copy</button>
      <button class="out-action" id="o8-lead-followup" style="background:#0D6E6E;color:#fff">Generate Reply</button>
      <button class="out-action" id="o8-lead-log-crm" style="background:#1E3A5F;color:#fff">Log to CRM</button>
    </div>
    ${leadId && nextStage && pipelineStage !== 'sold' && pipelineStage !== 'lost' ? `<div class="lead-capture-actions secondary">
      <button class="out-action" id="o8-lead-advance" style="background:#0D6E6E;color:#fff;font-size:11px">Next: ${esc(stageLabelMap(nextStage))}</button>
      <button class="out-action" id="o8-lead-lost" style="background:#fff;color:#DC2626;border:1px solid #FECACA;font-size:11px">Mark Lost</button>
    </div>` : ''}
  </div>`;

  // Copy button
  const copyBtn = result.querySelector('#o8-lead-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const text = [name, lead.phone, lead.email, vehicle].filter(Boolean).join('\n');
      await navigator.clipboard.writeText(text);
      (copyBtn as HTMLElement).textContent = 'Copied';
      setTimeout(() => { (copyBtn as HTMLElement).textContent = 'Copy'; }, 2000);
    });
  }

  result.querySelectorAll<HTMLButtonElement>('.stage-capture-chip').forEach((button) => {
    button.addEventListener('click', async () => {
      const stage = button.dataset.stageCapture;
      if (!stage) return;
      lead.lead_stage_at_capture = stage;
      if (leadId) {
        try {
          await safeSend({ type: 'UPDATE_LOCAL_LEAD_STAGE_AT_CAPTURE', payload: { leadId, stage } });
        } catch {
          /* optional context should never block the lead card */
        }
      }
      showLeadResult(root, lead);
      showToast(root, 'Lead context saved');
    });
  });

  // Feature 2: Generate Follow-Up — pre-fill main input with lead context + pass lead_id
  const followUpBtn = result.querySelector('#o8-lead-followup');
  if (followUpBtn) {
    followUpBtn.addEventListener('click', () => {
      const mainInput = root.querySelector('#o8-input') as HTMLTextAreaElement;
      if (mainInput) {
        mainInput.value = `Follow up with ${name}. ` +
          (vehicle ? `Vehicle interest: ${vehicle}. ` : '') +
          (lead.source_platform ? `Source: ${getDisplayLabel(lead.source_platform)}. ` : '') +
          (lead.phone ? `Phone: ${lead.phone}. ` : '') +
          (rawText ? `Original context: ${rawText.substring(0, 200)}` : '');
      }
      // Store lead_id for doGenerate to include in payload
      if (leadId) (root as any).__pendingLeadId = leadId;
      // Switch to Generate view
      const leadPanel = root.querySelector('#o8-lead-panel') as HTMLElement;
      if (leadPanel) leadPanel.style.display = 'none';
      root.querySelector('#o8-quick')!.setAttribute('style', 'display:flex');
      if (mainInput) mainInput.focus();
    });
  }

  // Feature 3: Log to CRM — inject into active field or clipboard fallback
  const logCrmBtn = result.querySelector('#o8-lead-log-crm') as HTMLButtonElement;
  if (logCrmBtn) {
    logCrmBtn.addEventListener('click', async () => {
      const noteText = [
        `[Brevmont Lead Capture]`,
        `Source: ${getDisplayLabel(lead.source_platform) || 'Extension'}`,
        `Name: ${name}`,
        lead.phone ? `Phone: ${lead.phone}` : null,
        lead.email ? `Email: ${lead.email}` : null,
        vehicle ? `Vehicle Interest: ${vehicle}` : null,
        `Captured: ${lead.captured_at ? new Date(lead.captured_at).toLocaleDateString() : 'Now'}`,
        ``,
        `Original context:`,
        rawText?.substring(0, 500) || 'No additional context',
      ].filter(Boolean).join('\n');

      // Try injecting into active CRM field
      let injected = false;
      try {
        const resp = await sendToContent({ type: 'INJECT_CONTENT', payload: { content: noteText, outputType: 'crm' } });
        injected = !!resp?.ok;
      } catch { /* content script unavailable */ }

      if (!injected) {
        // Clipboard fallback
        try {
          await navigator.clipboard.writeText(noteText);
          showToast(root, 'Copied to clipboard — paste into CRM notes');
        } catch {
          showToast(root, 'Could not copy. Try manually.');
          return;
        }
      } else {
        showToast(root, 'Lead logged to CRM');
      }

      // Update status to logged_to_crm
      if (leadId) {
        try {
          await safeSend({ type: 'UPDATE_LEAD_STATUS', payload: { leadId, status: 'logged_to_crm' } });
        } catch { /* non-fatal */ }
      }

      // Update button state
      logCrmBtn.textContent = 'Logged';
      logCrmBtn.disabled = true;
      logCrmBtn.style.background = '#065F46';
    });
  }

  // Feature 4: Pipeline stage advancement
  const advanceBtn = result.querySelector('#o8-lead-advance') as HTMLButtonElement;
  if (advanceBtn && leadId && nextStage) {
    advanceBtn.addEventListener('click', async () => {
      advanceBtn.disabled = true;
      advanceBtn.textContent = '...';
      try {
        await safeSend({ type: 'CHANGE_LEAD_STAGE', payload: { leadId, stage: nextStage } });
        lead.pipeline_stage = nextStage;
        showLeadResult(root, lead);
        showToast(root, `Advanced to ${stageLabelMap(nextStage)}`);
      } catch (e: any) {
        showToast(root, e.message || 'Stage change failed');
        advanceBtn.disabled = false;
        advanceBtn.textContent = `→ ${stageLabelMap(nextStage)}`;
      }
    });
  }

  const lostBtn = result.querySelector('#o8-lead-lost') as HTMLButtonElement;
  if (lostBtn && leadId) {
    lostBtn.addEventListener('click', () => {
      openLostReasonModal(root, lead, async ({ lost_reason, lost_reason_detail }) => {
        lostBtn.disabled = true;
        lostBtn.textContent = '...';
        try {
          await safeSend({ type: 'CHANGE_LEAD_STAGE', payload: { leadId, stage: 'lost', lost_reason, lost_reason_detail } });
          lead.pipeline_stage = 'lost';
          lead.lost_reason = lost_reason;
          lead.lost_reason_detail = lost_reason_detail || null;
          lead.lost_at = new Date().toISOString();
          showLeadResult(root, lead);
          showToast(root, `${displayText(lead.customer_name, 'Lead')} marked as lost. Moved to Lost tab.`);
        } catch (e) {
          lostBtn.disabled = false;
          lostBtn.textContent = 'Mark Lost';
          throw e;
        }
      });
    });
  }
}

// ─── Lead Capture ────────────────────────────────────────────────────────────
function wireLeadCapture(root: HTMLElement): void {
  const leadBtn = root.querySelector('#o8-lead-btn') as HTMLElement;
  const leadPanel = root.querySelector('#o8-lead-panel') as HTMLElement;
  const leadBack = root.querySelector('#o8-lead-back') as HTMLElement;
  let autoScanTimer: number | null = null;

  const activateLeadTab = (tab: 'scan' | 'voice' | 'paste') => {
    root.querySelectorAll('.lead-tab-btn').forEach(b => {
      const active = (b as HTMLElement).dataset.ltab === tab;
      b.classList.toggle('active', active);
    });
    ['lead-scan', 'lead-voice', 'lead-paste'].forEach(id => {
      const el = root.querySelector(`#${id}`) as HTMLElement;
      if (el) el.style.display = id === `lead-${tab}` ? 'block' : 'none';
    });
  };

  const openLeadScan = () => {
    root.querySelector('#o8-quick')!.setAttribute('style', 'display:none');
    const tp = root.querySelector('#o8-tools-panel') as HTMLElement; if (tp) tp.style.display = 'none';
    const sp = root.querySelector('#o8-settings-panel') as HTMLElement; if (sp) sp.style.display = 'none';
    const stats = root.querySelector('#o8-stats-panel') as HTMLElement; if (stats) stats.style.display = 'none';
    const myLeads = root.querySelector('#o8-my-leads-panel') as HTMLElement; if (myLeads) myLeads.style.display = 'none';
    const result = root.querySelector('#o8-lead-result') as HTMLElement; if (result) result.style.display = 'none';
    const emptyMsg = root.querySelector('#o8-scan-empty') as HTMLElement; if (emptyMsg) emptyMsg.style.display = 'none';
    activateLeadTab('scan');
    if (leadPanel) leadPanel.style.display = 'flex';

    if (autoScanTimer) window.clearTimeout(autoScanTimer);
    autoScanTimer = window.setTimeout(() => {
      const scanBtn = root.querySelector('#o8-scan-btn') as HTMLButtonElement;
      if (scanBtn && !scanBtn.disabled) scanBtn.click();
      autoScanTimer = null;
    }, 75);
  };

  if (leadBtn) leadBtn.onclick = openLeadScan;
  if (leadBack) leadBack.onclick = () => {
    if (autoScanTimer) {
      window.clearTimeout(autoScanTimer);
      autoScanTimer = null;
    }
    if (leadPanel) leadPanel.style.display = 'none';
    root.querySelector('#o8-quick')!.setAttribute('style', 'display:flex');
  };

  // Tab switching
  root.querySelectorAll('.lead-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.ltab;
      if (tab === 'scan' || tab === 'voice' || tab === 'paste') {
        activateLeadTab(tab);
        if (tab === 'scan') {
          const scanBtn = root.querySelector('#o8-scan-btn') as HTMLButtonElement;
          if (scanBtn && !scanBtn.disabled) scanBtn.click();
        }
      }
    });
  });

  // Scan — asks content script to scrape
  const scanBtn = root.querySelector('#o8-scan-btn') as HTMLElement;
  if (scanBtn) {
    scanBtn.onclick = async () => {
      if ((scanBtn as HTMLButtonElement).disabled) return;
      (scanBtn as HTMLButtonElement).disabled = true;
      scanBtn.textContent = 'Scanning...';
      const emptyMsg = root.querySelector('#o8-scan-empty') as HTMLElement;
      if (emptyMsg) emptyMsg.style.display = 'none';
      try {
        const ctx = await sendToContent({ type: 'SCAN_LEAD' });
        const detectedName = ctx?.customerName || ctx?.customer_name || ctx?.name || '';
        if (ctx && (detectedName || ctx.phone || ctx.email || ctx.raw_text || ctx.source_raw_text)) {
          await requireToken();
          const rawText = ctx.raw_text || ctx.source_raw_text || [
            detectedName ? `Name: ${detectedName}` : '',
            ctx.phone ? `Phone: ${ctx.phone}` : '',
            ctx.email ? `Email: ${ctx.email}` : '',
            ctx.vehicle || ctx.vehicle_interest ? `Vehicle: ${ctx.vehicle || ctx.vehicle_interest}` : '',
          ].filter(Boolean).join('\n');
          const resp = await safeSend({
            type: 'PARSE_LEAD',
            payload: {
              raw_text: rawText,
              platform: ctx.platform || currentPlatform.platform,
              customer_name: detectedName || null,
              name: detectedName || null,
              phone: ctx.phone || null,
              email: ctx.email || null,
              vehicle_interest: ctx.vehicle_interest || ctx.vehicle || null,
            },
          });
          showLeadResult(root, resp?.lead || resp || ctx);
        } else if (emptyMsg) {
          emptyMsg.style.display = 'block';
        }
      } catch (e: any) {
        showToast(root, e.message || 'Scan failed');
        if (emptyMsg) emptyMsg.style.display = 'block';
      }
      scanBtn.textContent = 'Scan This Page';
      (scanBtn as HTMLButtonElement).disabled = false;
    };
  }

  // Voice mic for lead
  const leadVoiceInput = root.querySelector('#o8-lead-voice-input') as HTMLTextAreaElement;
  const leadVoiceMic = root.querySelector('#o8-lead-voice-mic') as HTMLElement;
  if (leadVoiceInput && leadVoiceMic) {
    attachMic(leadVoiceInput, leadVoiceMic);

    // Auto-trigger parse when mic stops and there's text (one-click voice capture)
    const micObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          if (!leadVoiceMic.classList.contains('mic-active') && leadVoiceInput.value.trim()) {
            const vParseBtn = root.querySelector('#o8-lead-voice-parse') as HTMLButtonElement;
            if (vParseBtn && !vParseBtn.disabled) vParseBtn.click();
          }
        }
      }
    });
    micObserver.observe(leadVoiceMic, { attributes: true });
  }

  // Voice parse button
  const voiceParseBtn = root.querySelector('#o8-lead-voice-parse') as HTMLButtonElement;
  if (voiceParseBtn) {
    voiceParseBtn.onclick = async () => {
      const input = (root.querySelector('#o8-lead-voice-input') as HTMLTextAreaElement)?.value?.trim();
      if (!input) return;
      voiceParseBtn.innerHTML = '<span class="gen-spinner"></span> Pulling details…';
      voiceParseBtn.disabled = true;
      try {
        await requireToken();
        const leadContext = enrichLeadContextWithPinnedCustomer(await collectCurrentLeadContext());
        const resp = await safeSend({
          type: 'PARSE_LEAD',
          payload: {
            raw_text: input,
            platform: currentPlatform.platform,
            customer_id: leadContext.customer_id || null,
            customer_name: leadContext.customerName || leadContext.customer_name || null,
            name: leadContext.customerName || leadContext.customer_name || null,
            phone: leadContext.phone || null,
            email: leadContext.email || null,
            vehicle_interest: leadContext.vehicle || leadContext.vehicleOfInterest || null,
          },
        });
        showLeadResult(root, resp?.lead || resp);
      } catch (e: any) { showToast(root, e.message || 'Could not pull details'); }
      voiceParseBtn.innerHTML = 'Pull details';
      voiceParseBtn.disabled = false;
    };
  }

  // Paste parse button
  const pasteParseBtn = root.querySelector('#o8-lead-paste-parse') as HTMLButtonElement;
  if (pasteParseBtn) {
    pasteParseBtn.onclick = async () => {
      const input = (root.querySelector('#o8-lead-paste-input') as HTMLTextAreaElement)?.value?.trim();
      if (!input) return;
      if (isSystemPasteWithoutBuyingSignal(input)) {
        showLeadResult(root, {
          is_lead: false,
          intent: 'not_a_lead',
          notes: "This looks like a system email. Paste a customer's contact info instead.",
        });
        return;
      }
      pasteParseBtn.innerHTML = '<span class="gen-spinner"></span> Pulling details…';
      pasteParseBtn.disabled = true;
      try {
        await requireToken();
        const leadContext = enrichLeadContextWithPinnedCustomer(await collectCurrentLeadContext());
        const resp = await safeSend({
          type: 'PARSE_LEAD',
          payload: {
            raw_text: input,
            platform: currentPlatform.platform,
            customer_id: leadContext.customer_id || null,
            customer_name: leadContext.customerName || leadContext.customer_name || null,
            name: leadContext.customerName || leadContext.customer_name || null,
            phone: leadContext.phone || null,
            email: leadContext.email || null,
            vehicle_interest: leadContext.vehicle || leadContext.vehicleOfInterest || null,
          },
        });
        showLeadResult(root, resp?.lead || resp);
      } catch (e: any) { showToast(root, e.message || 'Could not pull details'); }
      pasteParseBtn.innerHTML = 'Pull details';
      pasteParseBtn.disabled = false;
    };
  }
}

// ─── Stats panel ─────────────────────────────────────────────────────────────
async function openStats(root: HTMLElement): Promise<void> {
  root.querySelector('#o8-quick')!.setAttribute('style', 'display:none');
  const tp = root.querySelector('#o8-tools-panel') as HTMLElement; if (tp) tp.style.display = 'none';
  const sp = root.querySelector('#o8-settings-panel') as HTMLElement; if (sp) sp.style.display = 'none';
  const lp = root.querySelector('#o8-lead-panel') as HTMLElement; if (lp) lp.style.display = 'none';
  const ml = root.querySelector('#o8-my-leads-panel') as HTMLElement; if (ml) ml.style.display = 'none';
  const statsPanel = root.querySelector('#o8-stats-panel') as HTMLElement;
  if (statsPanel) statsPanel.style.display = 'flex';
  const statsContent = root.querySelector('#o8-stats-content') as HTMLElement;
  if (statsContent) statsContent.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:24px;">Loading stats...</div>';
  try {
    const resp = await safeSend({ type: 'GET_REP_STATS' });
    if (resp && statsContent) {
      const total = resp.total ?? 0;
      const today = resp.today_count ?? 0;
      const isZero = total === 0 && today === 0;
      const standing = resp.floor_standing || {};
      const tier = tierBadge(standing.tier);
      const score = Number(standing.score || 0);
      const pointsToNext = Number(standing.points_to_next_tier || 0);
      const topReps = Array.isArray(standing.top_reps) ? standing.top_reps : [];
      const personAbove = standing.person_above;
      const streak = Number(resp.streak || 0);
      const streakText = streak > 0
        ? `🔥 ${streak}-day streak`
        : resp.last_active_date
          ? 'Streak ended. Start a new one today.'
          : 'Start your streak today — generate a follow-up';
      const topHtml = topReps.length
        ? topReps.map((rep: any) => `<div style="display:flex;justify-content:space-between;"><span>${esc(rep.name || 'Rep')}</span><strong>${Number(rep.score || 0)}</strong></div>`).join('')
        : '<div style="color:#94a3b8">Write follow-ups to light up the floor.</div>';
      statsContent.innerHTML = `
        ${isZero ? '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:16px 8px 8px;line-height:1.5;">Write your first follow-up to start tracking stats.</div>' : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <div style="background:#F0FDF4;border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#166534;">${total}</div>
            <div style="font-size:10px;color:#4B5563;text-transform:uppercase;font-weight:600;">Total (30d)</div>
          </div>
          <div style="background:#EFF6FF;border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#1E40AF;">${today}</div>
            <div style="font-size:10px;color:#4B5563;text-transform:uppercase;font-weight:600;">Today</div>
          </div>
        </div>
        <div class="standing-card">
          <div style="font-size:10px;color:#4B5563;text-transform:uppercase;font-weight:800;letter-spacing:.06em;">Floor Standing</div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
            <div class="standing-tier">${esc(tier)}</div>
            <div style="font-size:18px;font-weight:900;color:#0D6E6E;">${score} pts</div>
          </div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;">${pointsToNext > 0 ? `${pointsToNext} point${pointsToNext === 1 ? '' : 's'} to the next tier.` : 'Protect your tier this week.'}</div>
          <div class="standing-list">
            <div style="font-weight:800;color:#0F172A;">Top of the floor</div>
            ${topHtml}
            ${personAbove ? `<div style="border-top:1px solid #E5E7EB;margin-top:4px;padding-top:5px;">${esc(personAbove.name || 'Someone')} is just ahead at <strong>${Number(personAbove.score || 0)}</strong>.</div>` : ''}
          </div>
        </div>
        <div class="standing-card" style="background:#FFF7ED;border-color:#FED7AA;text-align:center;">
          <div style="font-size:14px;font-weight:900;color:#92400E;">${esc(streakText)}</div>
        </div>
        <div style="text-align:center;margin-top:4px;"><button id="o8-export-csv" style="background:none;border:none;color:#0D6E6E;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;text-decoration:underline;">Export to CSV</button></div>`;
      // Wire CSV export button
      const csvBtn = statsContent.querySelector('#o8-export-csv') as HTMLElement;
      if (csvBtn) {
        csvBtn.onclick = () => {
          const history = Array.isArray(resp.history) ? resp.history : [];
          const rows: unknown[][] = [
            ['Date', 'Workflow Type', 'Rep Input', 'AI Output', 'Channel'],
            ...history.map((event: any) => [
              event.created_at || event.server_ts || '',
              getDisplayLabel(event.workflow_type || event.output_type || ''),
              truncateCsv(event.scenario_input || event.rep_input || ''),
              truncateCsv(event.ai_output || event.output || ''),
              getDisplayLabel(event.platform || ''),
            ]),
          ];
          downloadCsvFile(`brevmont-stats-${new Date().toISOString().slice(0, 10)}.csv`, rows);
          showToast(root, 'CSV downloaded');
        };
      }
    }
  } catch {
    if (statsContent) statsContent.innerHTML = '<div style="text-align:center;color:#EF4444;font-size:12px;padding:24px;">Could not load stats.</div>';
  }
}

// ─── Listen for tab changes to update platform ───────────────────────────────
chrome.tabs.onActivated.addListener(async () => {
  await refreshPlatform();
  const root = document.getElementById('sp-root');
  if (root && root.style.display !== 'none') updatePlatformBadge(root);
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo) => {
  if (changeInfo.url) {
    await refreshPlatform();
    const root = document.getElementById('sp-root');
    if (root && root.style.display !== 'none') updatePlatformBadge(root);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'GENERATION_STREAM') return false;
  const root = document.getElementById('sp-root');
  if (!root || root.style.display === 'none') return false;
  const target = String(msg.target || 'generation');
  if (target === 'coach' || target === 'command') {
    const result = root.querySelector(`[data-stream-target="${target}"]`) as HTMLElement | null;
    if (!result) return false;
    if (msg.event === 'delta') {
      const existing = /^(Thinking|Executing)\.\.\.$/.test(result.textContent || '') ? '' : (result.textContent || '');
      result.textContent = existing + String(msg.text || '');
      result.style.color = '#0f172a';
    }
    return false;
  }
  const card = root.querySelector(`#o8-streaming-output[data-generation-id="${CSS.escape(String(msg.generation_id || ''))}"]`) as HTMLElement | null;
  if (!card) return false;
  const textarea = card.querySelector('textarea') as HTMLTextAreaElement | null;
  if (!textarea) return false;
  if (msg.event === 'delta') {
    textarea.value += String(msg.text || '');
    textarea.scrollTop = textarea.scrollHeight;
  } else if (msg.event === 'done') {
    card.querySelector('.out-label')!.textContent = 'Generated';
  }
  return false;
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'TIER_CHANGED') return false;
  const root = document.getElementById('sp-root');
  if (root && root.style.display !== 'none') {
    applyFeatureGates(root);
    updateUsageCounter(root);
  }
  return false;
});

// ─── VinSolutions coexistence: show info banner when DOM sidebar is also active ─
async function checkCoexistence(root: HTMLElement): Promise<void> {
  if (currentPlatform.platform !== 'vinsolutions') return;
  try {
    const state = await sendToContent({ type: 'GET_SIDEBAR_STATE' });
    if (state?.sidebarOpen) {
      const banner = document.createElement('div');
      banner.id = 'sp-coexist-banner';
      banner.style.cssText = 'background:#FFFBEB;border:1px solid #F59E0B;border-radius:6px;padding:8px 10px;margin:8px 12px 0;font-size:11px;color:#92400E;line-height:1.4;';
      banner.textContent = 'CRM sidebar is also open. Use the in-page sidebar for auto-inject, or this panel for cross-tab workflows.';
      const header = root.querySelector('.header');
      if (header) header.insertAdjacentElement('afterend', banner);
    }
  } catch { /* content script not available — ignore */ }
}

// ─── Boot ────────────────────────────────────────────────────────────────────
(async () => {
  await refreshPlatform();
  renderPanel();
  checkCoexistence(document.getElementById('sp-root')!);
})();
