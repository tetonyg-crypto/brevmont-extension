import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..", "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("web store post-install flow", () => {
  it("opens the welcome page first and keeps install-screen in the background on a fresh install", () => {
    const background = read("entrypoints/background.ts");
    expect(background).toContain("browser.tabs.create({ url: BREVMONT_WELCOME_URL, active: true });");
    expect(background).toContain("browser.tabs.create({ url: browser.runtime.getURL('install-screen.html'), active: false });");
    expect(background).toContain("if (details.reason === 'install' && !alreadySetup)");
  });

  it("routes a not-activated install-screen user back to the welcome page", () => {
    const installScreen = read("entrypoints/install-screen/main.ts");
    expect(installScreen).toContain("window.location.href = BREVMONT_WELCOME_URL");
    expect(installScreen).not.toContain("https://app.brevmont.com/auth/extension");
  });
});
