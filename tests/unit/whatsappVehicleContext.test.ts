import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('WhatsApp vehicle context safety', () => {
  it('does not scan the whole WhatsApp page for stale vehicle text', () => {
    const source = readFileSync(resolve(process.cwd(), 'entrypoints/lib/platforms/whatsapp.ts'), 'utf8');
    expect(source).toContain('const thread = scrapeThread();');
    expect(source).toContain('extractVehicleHint(thread.last_inbound_text || \'\')');
    expect(source).not.toContain("const body = (findMainPanel()?.innerText || '').slice(0, 4000);");
  });

  it('retries WhatsApp scans while a contact switch settles', () => {
    const source = readFileSync(resolve(process.cwd(), 'entrypoints/sidepanel/main.ts'), 'utf8');
    expect(source).toContain('const whatsappSurface = platformId === \'whatsapp\';');
    expect(source).toContain('const flakyDom = linkedInMessaging || linkedInProfile || facebookStrict || whatsappSurface;');
  });
});
