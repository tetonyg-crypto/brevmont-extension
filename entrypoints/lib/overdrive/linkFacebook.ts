/**
 * Link Facebook flow — client-side.
 *
 * When the rep clicks "Link personal Facebook" in the extension
 * settings, the extension opens facebook.com (or brings the existing
 * tab to focus) and scrapes the logged-in profile name + avatar +
 * profile URL from the DOM. No OAuth, no credentials stored — we just
 * verify the extension can see the rep's active session.
 *
 * The scrape function is called from the content script running on
 * facebook.com after the rep confirms. Returns null if no logged-in
 * user is detected.
 *
 * Stable anchors as of 2026-07 (best-known selectors, subject to
 * change; needs live verification):
 *   - Profile avatar in top-right nav: [aria-label*="Your profile"] img
 *     or [aria-label*="account"] img
 *   - Profile display name: [role="banner"] a[aria-label][href*="/"],
 *     usually the aria-label contains the user's full name
 *   - Profile URL: /me redirects to /profile.php?id=<id> or the
 *     vanity URL. We prefer the vanity URL from the profile link
 *     in the left nav ([role="navigation"] a[aria-label] with a
 *     data-visualcompletion-set avatar or first-position role="link"
 *     in the shortcut list).
 */

export interface FacebookProfileScrape {
  profile_name: string;
  profile_url: string | null;
  avatar_url: string | null;
  raw_source: string; // which selector path won, for debugging
}

/**
 * Attempt to scrape the logged-in FB profile. Non-throwing — returns
 * null on any failure.
 */
export function scrapeFacebookProfile(): FacebookProfileScrape | null {
  try {
    if (!/facebook\.com|messenger\.com/i.test(window.location.hostname)) return null;

    let profile_name: string | null = null;
    let profile_url: string | null = null;
    let avatar_url: string | null = null;
    let raw_source = '';

    // ── Try 1: top nav profile shortcut ────────────────────────────────
    // Facebook renders the logged-in user's shortcut as the last item
    // in the top nav with aria-label containing their name.
    const navProfile = document.querySelector(
      '[role="navigation"] a[aria-label][role="link"][href*="/"]:not([aria-label*="Home" i]):not([aria-label*="Menu" i])'
    ) as HTMLAnchorElement | null;
    if (navProfile) {
      const label = navProfile.getAttribute('aria-label') || '';
      const isPlausibleName = label.length > 1 && label.length < 60 && !/home|menu|notifications|messages|marketplace/i.test(label);
      if (isPlausibleName) {
        profile_name = label.trim();
        profile_url = navProfile.href || null;
        raw_source = 'nav_profile_shortcut';
      }
    }

    // ── Try 2: left rail profile card ──────────────────────────────────
    if (!profile_name) {
      const leftRailProfile = document.querySelector(
        '[role="navigation"] a[href*="/profile.php?id="], [role="navigation"] a[href^="/"][role="link"]'
      ) as HTMLAnchorElement | null;
      if (leftRailProfile) {
        const label = leftRailProfile.getAttribute('aria-label') || leftRailProfile.textContent?.trim() || '';
        if (label && label.length > 1 && label.length < 60 && !/facebook|marketplace|watch|groups|gaming/i.test(label)) {
          profile_name = label;
          profile_url = leftRailProfile.href || null;
          raw_source = 'left_rail_profile';
        }
      }
    }

    // ── Try 3: page title fallback ─────────────────────────────────────
    // "(N) Facebook" — no name, useless. But "Bob Smith | Facebook" is
    // sometimes visible on the profile page itself. Not the login home,
    // but useful as a last resort.
    if (!profile_name) {
      const t = document.title || '';
      const m = t.match(/^([^|\-—]+)\s*[|\-—]\s*Facebook/);
      if (m) {
        const candidate = m[1].trim();
        if (candidate && candidate.length > 1 && candidate.length < 60 && !/^\(\d+\)/.test(candidate)) {
          profile_name = candidate;
          raw_source = 'page_title';
        }
      }
    }

    // ── Avatar URL ─────────────────────────────────────────────────────
    // Any <img> whose alt/aria-label matches profile_name.
    if (profile_name) {
      const imgs = Array.from(document.querySelectorAll('img'));
      for (const img of imgs) {
        const alt = (img as HTMLImageElement).alt || '';
        const label = img.getAttribute('aria-label') || '';
        if (alt === profile_name || label === profile_name) {
          avatar_url = (img as HTMLImageElement).src || null;
          break;
        }
      }
      // Fallback: pick the highest-res <img> in the top banner.
      if (!avatar_url) {
        const banner = document.querySelector('[role="banner"]');
        if (banner) {
          const bannerImgs = Array.from(banner.querySelectorAll('img'));
          const largest = bannerImgs.sort((a, b) => {
            const aArea = (a as HTMLImageElement).naturalWidth * (a as HTMLImageElement).naturalHeight;
            const bArea = (b as HTMLImageElement).naturalWidth * (b as HTMLImageElement).naturalHeight;
            return bArea - aArea;
          })[0];
          if (largest) avatar_url = (largest as HTMLImageElement).src || null;
        }
      }
    }

    if (!profile_name) return null;

    return {
      profile_name,
      profile_url,
      avatar_url,
      raw_source,
    };
  } catch {
    return null;
  }
}
