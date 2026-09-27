import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('My Leads false-positive protection', () => {
  const source = readFileSync(resolve(process.cwd(), 'entrypoints/sidepanel/main.ts'), 'utf8');

  it('filters channel and UI labels before rendering remote or local leads', () => {
    const start = source.indexOf('function mergeLeadInboxRows');
    const body = source.slice(start, source.indexOf('\nfunction openLostReasonModal', start));
    expect(body).toContain('isChannelOrUiName(name)');
    expect(body).toContain('isUsableLeadName(lead)');
  });

  it('preserves rendered cards during selection refreshes', () => {
    const start = source.indexOf('async function renderMyLeads');
    const body = source.slice(start, source.indexOf('\nfunction wireMyLeadCardActions', start));
    expect(body).toContain('preserveRenderedLeads');
    expect(body).toContain("content.querySelector('.my-lead-card')");
  });
});
