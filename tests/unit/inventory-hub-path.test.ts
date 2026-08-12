import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("inventory view hub path", () => {
  it("opens the dedicated full-width inventory page", () => {
    const source = readFileSync(resolve(process.cwd(), "entrypoints/lib/inventory/ui.ts"), "utf8");
    expect(source).toContain("const HUB_INVENTORY_PATH = '/rep/inventory'");
    expect(source).toContain("HUB_INVENTORY_LEGACY_PATH = '/rep/app/inventory'");
  });

  it("opens the mini lot as the primary inventory surface", () => {
    const source = readFileSync(resolve(process.cwd(), "entrypoints/lib/inventory/ui.ts"), "utf8");
    expect(source).toContain("createMiniPanel");
    expect(source).toContain("Scan Inventory");
    expect(source).toContain("void mini.openList()");
  });

  it("scaffolds Marketplace inject without claiming Publish", () => {
    const background = readFileSync(resolve(process.cwd(), "entrypoints/background.ts"), "utf8");
    const stub = readFileSync(resolve(process.cwd(), "entrypoints/marketplace-create.content.ts"), "utf8");
    const inject = readFileSync(resolve(process.cwd(), "entrypoints/lib/inventory/marketplaceInject.ts"), "utf8");
    expect(background).toContain("BREVMONT_MARKETPLACE_START_POST");
    expect(background).toContain("exploratory_stub");
    expect(background).toContain("BREVMONT_FETCH_LISTING_PHOTOS");
    expect(background).toContain("BREVMONT_MARKETPLACE_ITEM_PUBLISHED");
    expect(background).toContain("openMarketplaceCreateFromDraft");
    expect(stub).toContain("Does NOT select comboboxes and does NOT click Publish");
    expect(stub).toContain("applyIndependentZoom");
    const panel = readFileSync(resolve(process.cwd(), "entrypoints/sidepanel/main.ts"), "utf8");
    expect(panel).toContain("lockDocumentZoom");
    expect(inject).toContain("publish: 'not_clicked'");
    expect(inject).toContain("attempt_combo");
  });
});
