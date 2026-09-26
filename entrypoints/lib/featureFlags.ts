/**
 * Build-time feature switches.
 *
 * DEALER_INVENTORY: the dealer-site inventory scanner and the Facebook
 * Marketplace vehicle-listing autofill. Frozen until the dealership rollout.
 * While false, the two Marketplace listing content scripts and the jazelc.com
 * photo host permission are left out of the Chrome build entirely.
 */
export const DEALER_INVENTORY = false;
