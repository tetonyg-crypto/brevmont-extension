import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Founder-reported defect 2026-09-26, three rounds:
//
// Round 1: extractLinkedInProfileSignal() tried profile-page selectors
// before messaging-thread selectors -- LinkedIn's own persistent identity
// markup for the logged-in rep won on every messaging-thread scan.
//
// Round 1 fix (reorder the raw selector list) made it WORSE ("Brevmont
// Yancy Garcia"): .msg-thread__link-to-profile / .msg-s-message-group__name
// are PER-MESSAGE-GROUP selectors, so an unscoped query grabbed whichever
// sender's name-lockup appeared first in DOM order -- the rep's, since he
// sent the first message in both broken threads.
//
// Round 2 fix (delegate to extractLinkedInPersonName(), scoped to
// threadRoot + self-filtered via isLinkedInSelfOrCompanyLabel) STILL
// returned "Yancy Garcia": isLinkedInSelfOrCompanyLabel's self-name set
// comes from reading .global-nav__me DOM elements live, which found nothing
// on this page state, so the filter silently no-op'd -- and even the
// threadRoot-scoped selector loop can't tell WHICH message group's name
// it's reading when both parties have multiple groups in scope.
//
// Round 3 fix: prefer the browser tab title. LinkedIn sets it to the OTHER
// party's name on a messaging thread ("(1) Alec Langton | LinkedIn") --
// this is exactly what the separate, always-correct "This for Alec
// Langton?" lead-radar chip reads under the hood (GET_LEAD_CONTEXT ->
// detectCustomerFromPage -> parsePageTitle in lib/customerDetection.ts). It
// has no dependency on message order or DOM self-identity lookups at all.
describe("extractLinkedInProfileSignal prefers the tab-title signal", () => {
  const source = readFileSync(resolve(process.cwd(), "entrypoints/content.ts"), "utf8");
  const fnStart = source.indexOf("function extractLinkedInProfileSignal(");
  const fnBody = source.slice(fnStart, source.indexOf("\n    }\n", fnStart));

  it("imports parsePageTitle from the shared customer-detection module", () => {
    const importLine = source.split("\n").find((line) => line.includes("from './lib/customerDetection'")) || "";
    expect(importLine).toContain("parsePageTitle");
  });

  it("reads the tab title as the primary name candidate", () => {
    expect(fnBody).toContain("const titleName = parsePageTitle(document.title || '')?.name || null;");
  });

  it("order: chip name, then tab title, then extractLinkedInPersonName(), then raw selectors", () => {
    const chipIdx = fnBody.indexOf("const rawName = (chip &&");
    const titleIdx = fnBody.indexOf("|| (titleName &&");
    const personNameIdx = fnBody.indexOf("|| extractLinkedInPersonName()");
    const fallbackIdx = fnBody.indexOf("fallbackNameSelectors.map(pickText)");
    expect(chipIdx).toBeGreaterThan(-1);
    expect(titleIdx).toBeGreaterThan(chipIdx);
    expect(personNameIdx).toBeGreaterThan(titleIdx);
    expect(fallbackIdx).toBeGreaterThan(personNameIdx);
  });

  it("SCAN_LEAD passes the chip's own source (detectCustomerFromPage) into the signal", () => {
    expect(source).toContain("const linkedinSignal = extractLinkedInProfileSignal(detected?.name);");
  });

  it("background forwards the detected name to /api/parse-lead", () => {
    const bg = readFileSync(resolve(process.cwd(), "entrypoints/background.ts"), "utf8");
    const call = bg.slice(bg.indexOf("`${PROXY_URL}/api/parse-lead`"), bg.indexOf("`${PROXY_URL}/api/parse-lead`") + 600);
    expect(call).toContain("name: msg.payload.name || msg.payload.customer_name || null");
  });

  it("still guards the title candidate against a self/company label", () => {
    expect(fnBody).toContain("!isLinkedInSelfOrCompanyLabel(titleName)");
  });
});
