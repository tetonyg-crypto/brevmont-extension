/**
 * Facebook scan ownership for the side panel.
 *
 * Facebook is an SPA: the rep can move from profile A to profile B while a
 * scan of A is still in flight (content-script read + PARSE_LEAD round trip),
 * and the background auto-scan can run at the same time as a manual
 * "+ Lead / Scan This Page". Without an owner, whichever response lands last
 * paints the card — which is how Prospect Context for Mark Fulton ended up
 * under Piotr's header.
 *
 * Rules:
 *  - every scan takes a ticket bound to the Facebook route it started on;
 *  - a ticket may only commit while the live tab AND the response it read are
 *    still on that same route;
 *  - starting a manual scan kills every older ticket (auto or manual);
 *  - auto scans cannot commit while a manual scan is in flight;
 *  - a route change kills every outstanding ticket.
 */

import { classifyFacebookSurface } from './platforms/facebookSurface';

export type FacebookScanKind = 'auto' | 'manual';

export interface FacebookScanTicket {
  id: number;
  kind: FacebookScanKind;
  route: string;
}

/** Stable identity of the Facebook prospect/thread a URL points at. Query
 *  noise is ignored, but profile.php?id=A and profile.php?id=B differ. */
export function facebookScanRouteKey(url: string | null | undefined): string {
  const value = String(url || '');
  if (!value) return '';
  const info = classifyFacebookSurface(value);
  // Only prospect/thread surfaces carry an owner; the feed and other
  // unsupported pages keep their previous (path-based) behaviour.
  return info.supported ? info.route_key : '';
}

export function createFacebookScanOwner() {
  let seq = 0;
  let floor = 0;
  let manualInFlight: FacebookScanTicket | null = null;

  const routeMatches = (ticket: FacebookScanTicket, url: string | null | undefined): boolean => {
    const route = facebookScanRouteKey(url);
    return !!route && route === ticket.route;
  };

  return {
    begin(kind: FacebookScanKind, url: string | null | undefined): FacebookScanTicket {
      const ticket: FacebookScanTicket = { id: ++seq, kind, route: facebookScanRouteKey(url) };
      if (kind === 'manual') {
        floor = ticket.id - 1;
        manualInFlight = ticket;
      }
      return ticket;
    },

    /**
     * May this ticket paint its result? `liveUrl` is the tab URL right now;
     * `responseUrl` is the URL the content script actually read (optional).
     */
    canCommit(ticket: FacebookScanTicket, liveUrl: string | null | undefined, responseUrl?: string | null): boolean {
      if (ticket.id <= floor) return false;
      if (!ticket.route || !routeMatches(ticket, liveUrl)) return false;
      if (responseUrl && !routeMatches(ticket, responseUrl)) return false;
      if (ticket.kind === 'manual') return manualInFlight?.id === ticket.id;
      return manualInFlight === null;
    },

    finish(ticket: FacebookScanTicket): void {
      if (manualInFlight?.id === ticket.id) manualInFlight = null;
    },

    /** The tab moved to a different prospect: nothing in flight may commit. */
    invalidate(): void {
      floor = seq;
      manualInFlight = null;
    },
  };
}

export type FacebookScanOwner = ReturnType<typeof createFacebookScanOwner>;
