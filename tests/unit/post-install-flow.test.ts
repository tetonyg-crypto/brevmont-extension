import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..", "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("web store post-install flow", () => {
  it("opens the welcome page first and keeps install-screen in the background on a fresh install with NO org auto-config", () => {
    const background = read("entrypoints/background.ts");
    // This is the genuinely-unknown, unauthenticated fallback branch
    // (autoConfigured === false) — it must keep showing the generic
    // two-button /welcome chooser.
    expect(background).toContain("} else if (details.reason === 'install' && !alreadySetup) {");
    expect(background).toContain("browser.tabs.create({ url: BREVMONT_WELCOME_URL, active: true });");
    expect(background).toContain("browser.tabs.create({ url: browser.runtime.getURL('install-screen.html'), active: false });");
  });

  it("routes a not-activated install-screen user back to the welcome page", () => {
    const installScreen = read("entrypoints/install-screen/main.ts");
    expect(installScreen).toContain("window.location.href = BREVMONT_WELCOME_URL");
    expect(installScreen).not.toContain("https://app.brevmont.com/auth/extension");
  });

  it("does NOT show the generic /welcome vertical chooser to a known-org rep (autoConfigured === true)", () => {
    const background = read("entrypoints/background.ts");
    const autoConfiguredBranchStart = background.indexOf("if (autoConfigured) {");
    const autoConfiguredBranchEnd = background.indexOf("} else if (details.reason === 'install' && !alreadySetup) {");
    expect(autoConfiguredBranchStart).toBeGreaterThan(-1);
    expect(autoConfiguredBranchEnd).toBeGreaterThan(autoConfiguredBranchStart);
    const autoConfiguredBranch = background.slice(autoConfiguredBranchStart, autoConfiguredBranchEnd);

    // Org already resolved via tryCookieShareAutoConfig() — must route
    // straight into install-screen.html as the active tab (which itself
    // resumes into onboarding.html from stored credentials), never into
    // the generic BREVMONT_WELCOME_URL chooser.
    expect(autoConfiguredBranch).toContain(
      "browser.tabs.create({ url: browser.runtime.getURL('install-screen.html'), active: true });",
    );
    expect(autoConfiguredBranch).not.toContain(
      "browser.tabs.create({ url: BREVMONT_WELCOME_URL, active: true });",
    );
  });

  it("keeps update installs from ever restarting onboarding", () => {
    const background = read("entrypoints/background.ts");
    expect(background).toContain("if (details.reason === 'update' && alreadySetup) {");
  });
});
