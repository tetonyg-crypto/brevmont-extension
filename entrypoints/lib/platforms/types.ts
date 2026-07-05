/**
 * Universal Capture — platform adapter interface.
 *
 * One core scan → context → generation pipeline, N thin platform
 * adapters. Every adapter implements this interface. The core owns
 * the shared safety (safeInjectText double-inject fix, isChannelOrUiName
 * blocklist, post-inject verification); adapters own only the DOM
 * knowledge specific to their surface.
 */

export type PlatformId =
  | 'facebook'          // Marketplace + Messenger (shared FB adapter)
  | 'gmail'
  | 'outlook'
  | 'linkedin'
  | 'vinsolutions'
  | 'instagram'
  | 'whatsapp'
  | 'google-messages'
  | 'cargurus'
  | 'carsdotcom'
  | 'autotrader'
  | 'dealersocket'
  | 'elead';

export type SurfaceKind =
  | 'social_dm'          // Messenger, Instagram DM, LinkedIn DM, WhatsApp
  | 'marketplace_inbox'  // Marketplace threads, CarGurus/Cars/AutoTrader dealer inboxes
  | 'email'              // Gmail (and future email surfaces)
  | 'sms'                // Google Messages web
  | 'crm';               // VinSolutions, DealerSocket, Elead

export type InjectKind = 'text' | 'email' | 'crm_note';

/**
 * Everything an adapter can tell the core about the current thread.
 * Free of platform-specific idioms — the core reads these fields
 * uniformly for scanning, generation, and dashboard attribution.
 */
export interface ThreadContext {
  /** Stable identifier for this conversation on this platform. */
  conversation_key: string;
  /** Full-thread visible text, oldest → newest. Bounded ~5000 chars. */
  raw_text: string;
  /** Individual messages if we can distinguish them, oldest → newest. */
  messages: Array<{
    text: string;
    direction: 'inbound' | 'outbound' | 'unknown';
    role?: 'customer' | 'rep' | 'unknown';
    ts?: number;
    source_selector?: string;
    extraction_method?: string;
    confidence?: number;
    is_system?: boolean;
    hash?: string;
  }>;
  /** The most recent inbound message text, verbatim. */
  last_inbound_text: string;
  /** Header/subject line if the surface has one (e.g. Gmail subject, Marketplace listing title). */
  header_text: string;
  /** Full URL of the surface. */
  url: string;
  scanned_at?: number;
  last_inbound_hash?: string;
  message_count?: number;
  listing?: {
    title?: string | null;
    sold?: boolean | null;
  } | null;
}

/**
 * Structured customer candidate. Adapter returns its best guess plus
 * confidence + method. The core runs pickCleanName across candidates
 * to filter out channel/UI labels.
 */
export interface CustomerCandidate {
  name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  raw_source?: string;   // "profile_header" / "gmail_sender" / "listing_buyer" / etc
  confidence?: number;   // 0..1, adapter-scored
}

/**
 * Business-relevant context on the conversation.
 */
export interface DealContext {
  vehicle?: string | null;         // "2016 GMC Yukon Denali"
  vehicle_year?: number | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  listing_title?: string | null;
  listing_url?: string | null;
  subject_line?: string | null;    // Gmail
  crm_context?: string | null;     // "VinSolutions_ContactRecord" / etc
}

/**
 * Structured result from inject(). The core's post-inject verify runs
 * after the adapter returns, so verified/latency come back from core
 * not adapter.
 */
export interface InjectResult {
  ok: boolean;
  reason?: string;
  method?: string;             // adapter's own description of what path it used
  composer_selector?: string;  // for debugging
}

/**
 * Capabilities descriptor — the sidebar reads this to decide which
 * outputs to offer + which to default. E.g. Gmail defaults to email;
 * Messenger defaults to text; CRM adapters default to CRM note.
 */
export interface AdapterCapabilities {
  supports_inject_text: boolean;
  supports_inject_email: boolean;
  supports_inject_crm_note: boolean;
  supports_thread_history: boolean;
  /** If false, extract_customer will return empty on this surface (e.g. a listing page with no thread). */
  supports_customer_extraction: boolean;
  surface_kind: SurfaceKind;
  /** Which output type is the natural default for this surface. */
  default_output: InjectKind;
}

/**
 * The interface every platform module implements.
 * Adapters are constructed once per content-script load and cached
 * in the registry. All methods are called after `detect()` has
 * confirmed the current tab matches this platform.
 */
export interface PlatformAdapter {
  id: PlatformId;
  /** Read-only description of what this surface can do. */
  capabilities: AdapterCapabilities;

  /** Does the current URL fall inside this platform's match list? */
  hostMatches(url: string): boolean;

  /**
   * A tighter check: are we on a THREAD view (not the inbox root)?
   * Some adapters activate only on specific paths (`/marketplace/t/`,
   * `mail.google.com/mail/u/0/#inbox/<id>`, etc).
   */
  detect(): boolean;

  /** Return the current thread's messages + header + url. */
  scrapeThread(): ThreadContext;

  /**
   * Return best-guess customer identity. May return `{ name: null }`
   * if no signal is legible; the core then falls back to detected/scan.
   */
  extractCustomer(): CustomerCandidate;

  /** Return vehicle + listing + subject context if the surface exposes it. */
  extractContext(): DealContext;

  /**
   * Inject `text` into the current composer for the given output
   * kind. Adapter does its own composer resolution, calls the shared
   * safeInjectText, returns structured result. Post-inject verify is
   * run by the core, not here.
   */
  inject(text: string, kind: InjectKind): Promise<InjectResult>;
}
