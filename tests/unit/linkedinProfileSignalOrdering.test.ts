import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Founder-reported defect 2026-09-26, two rounds:
//
// Round 1: extractLinkedInProfileSignal() in entrypoints/content.ts tried
// profile-page selectors (h1.text-heading-xlarge etc) before messaging-
// thread selectors, so LinkedIn's own persistent identity markup for the
// logged-in rep won on every messaging-thread scan ("Scan This Page"
// captured "Yancy Garcia" instead of Darrin Guttman / Alec Langton).
//
// Round 1 fix (reordering the raw selector list) made it WORSE ("Brevmont
// Yancy Garcia"): .msg-thread__link-to-profile and .msg-s-message-group__name
// are PER-MESSAGE-GROUP selectors, not a single header element, so an
// unscoped document.querySelector grabbed whichever sender's name-lockup
// happened to appear first in DOM order -- the rep's own, since the rep
// sent the first message in both broken threads.
//
// Round 2 fix: delegate to extractLinkedInPersonName() (lib/leadContextScan.ts),
// the function the separate, already-correct lead-radar detector uses. It
// scopes to the actual open thread root, prefers the selected
// conversation-list item's name, and filters every candidate through
// isLinkedInSelfOrCompanyLabel so the rep's own name/company can never win.
describe("extractLinkedInProfileSignal delegates to the proven name extractor", () => {
  const source = readFileSync(resolve(process.cwd(), "entrypoints/content.ts"), "utf8");
  const fnStart = source.indexOf("function extractLinkedInProfileSignal(");
  const fnBody = source.slice(fnStart, source.indexOf("\n    }\n", fnStart));

  it("imports the proven, scoped name extractor and its self/company filter", () => {
    const importLine = source.split("\n").find((line) => line.includes("from './lib/leadContextScan'")) || "";
    expect(importLine).toContain("extractLinkedInPersonName");
    expect(importLine).toContain("isLinkedInSelfOrCompanyLabel");
  });

  it("tries extractLinkedInPersonName() before any raw selector fallback", () => {
    const idx = fnBody.indexOf("const rawName = extractLinkedInPersonName()");
    expect(idx).toBeGreaterThan(-1);
    const fallbackIdx = fnBody.indexOf("fallbackNameSelectors.map(pickText)");
    expect(fallbackIdx).toBeGreaterThan(idx);
  });

  it("the raw-selector fallback still filters self/company labels", () => {
    expect(fnBody).toContain("!isLinkedInSelfOrCompanyLabel(candidate)");
  });

  it("does not resurrect the unscoped document-wide selector reorder from round 1", () => {
    expect(fnBody).not.toContain("isMessagingThread");
    expect(fnBody).not.toContain("messagingSelectors");
  });
});
