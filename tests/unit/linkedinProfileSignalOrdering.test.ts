import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Founder-reported defect 2026-09-26: "Scan This Page" on a LinkedIn
// messaging thread (Darrin Guttman, then again on Alec Langton) captured
// the REP ("Yancy Garcia") as the Buyer, even though the separate lead-radar
// detector correctly showed "This for Alec Langton?" beforehand. Root cause:
// extractLinkedInProfileSignal() in entrypoints/content.ts tried the
// PROFILE-PAGE name selectors (h1.text-heading-xlarge etc, which can match
// LinkedIn's own persistent global identity markup showing the logged-in
// rep's own name) before the messaging-thread-specific selectors
// (.msg-entity-lockup__entity-title etc) -- and since a real person's name
// is never caught by isLikelyUiName()'s generic-chrome-text filter, the
// wrong name won outright on every messaging thread scan. Fixed by trying
// the messaging-thread selectors FIRST whenever the current page is a
// messaging thread.
describe("extractLinkedInProfileSignal selector ordering", () => {
  const source = readFileSync(resolve(process.cwd(), "entrypoints/content.ts"), "utf8");
  const fnStart = source.indexOf("function extractLinkedInProfileSignal(");
  const fnBody = source.slice(fnStart, source.indexOf("\n    }\n", fnStart));

  it("detects whether the current page is a messaging thread", () => {
    expect(fnBody).toContain("const isMessagingThread =");
    expect(fnBody).toContain("/\\/messaging\\//i.test(String(location.href || ''))");
    expect(fnBody).toContain(".msg-s-message-list-content");
  });

  it("tries messaging-thread selectors before profile-page selectors on a thread page", () => {
    const nameSelectorsIdx = fnBody.indexOf("const nameSelectors = isMessagingThread");
    expect(nameSelectorsIdx).toBeGreaterThan(-1);
    const ternary = fnBody.slice(nameSelectorsIdx, nameSelectorsIdx + 400);
    // The messagingSelectors spread must appear before profileSelectors in
    // the true (isMessagingThread) branch of the ternary.
    const trueBranch = ternary.slice(ternary.indexOf('?'), ternary.indexOf(':'));
    expect(trueBranch.indexOf('...messagingSelectors')).toBeGreaterThan(-1);
    expect(trueBranch.indexOf('...messagingSelectors')).toBeLessThan(trueBranch.indexOf('...profileSelectors'));
  });

  it("still falls back to profile selectors when not on a messaging thread", () => {
    const nameSelectorsIdx = fnBody.indexOf("const nameSelectors = isMessagingThread");
    const ternary = fnBody.slice(nameSelectorsIdx, nameSelectorsIdx + 400);
    const falseBranch = ternary.slice(ternary.indexOf(':'));
    expect(falseBranch.indexOf('...profileSelectors')).toBeGreaterThan(-1);
  });

  it("messaging selector list includes the thread-participant markers", () => {
    expect(fnBody).toContain("'.msg-overlay-bubble-header__title'");
    expect(fnBody).toContain("'.msg-entity-lockup__entity-title'");
    expect(fnBody).toContain("'.msg-thread__link-to-profile'");
  });
});
