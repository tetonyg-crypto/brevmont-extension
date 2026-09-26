import { describe, expect, it } from "vitest";
import { parsePageTitle } from "../../entrypoints/lib/customerDetection";

// The signal round 3 of the LinkedIn lead-scan name fix relies on: LinkedIn
// sets document.title to the OTHER party's name on a messaging thread,
// regardless of which of the two people sent the first message -- unlike
// every DOM-selector approach tried before it, this is order-independent.
describe("parsePageTitle — LinkedIn messaging tab title", () => {
  it("extracts the conversation partner's name, stripping the unread badge and site suffix", () => {
    const result = parsePageTitle("(1) Alec Langton | LinkedIn");
    expect(result?.name).toBe("Alec Langton");
  });

  it("extracts the name with no unread badge present", () => {
    const result = parsePageTitle("Darrin Guttman | LinkedIn");
    expect(result?.name).toBe("Darrin Guttman");
  });

  it("returns null for a generic LinkedIn chrome title with no person name", () => {
    const result = parsePageTitle("(12) LinkedIn");
    expect(result).toBeNull();
  });

  it("returns null for the bare Messaging inbox title", () => {
    const result = parsePageTitle("Messaging | LinkedIn");
    expect(result).toBeNull();
  });
});
