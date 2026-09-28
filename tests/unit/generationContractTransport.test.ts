import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('generation controls transport contract', () => {
  const sidepanel = read('entrypoints/sidepanel/main.ts');
  const background = read('entrypoints/background.ts');

  it('forwards the selected tone from side panel through the API body', () => {
    expect(sidepanel).toContain("chrome.storage.local.get(['brevmont_tone', 'brevmont_goal'])");
    expect(sidepanel).toContain("tone = stored.brevmont_tone || 'professional'");
    expect(sidepanel).toContain('tone,\n    goal,');
    expect(background).toContain('tone: payload.tone || payload.metadata?.tone || null');
    expect(background).toContain('tone: metadata?.tone ?? null');
  });

  it.each(['close_deal', 'book_appointment', 'gather_info', 'nurture'])(
    'forwards the %s goal unchanged from side panel through the API body',
    (goal) => {
      expect(read('entrypoints/lib/panelUI.ts')).toContain(`value="${goal}"`);
      expect(sidepanel).toContain("goal = stored.brevmont_goal || 'close_deal'");
      expect(sidepanel).toContain('tone,\n    goal,');
      expect(background).toContain('goal: payload.goal || payload.metadata?.goal || null');
      expect(background).toContain('goal: metadata?.goal ?? null');
    },
  );

  it('forwards structured rep_instruction while retaining the legacy repInput fallback', () => {
    expect(sidepanel).toContain('repInstruction: generateInputs.repInstruction');
    expect(sidepanel).toContain('rep_instruction: generateInputs.repInstruction || null');
    expect(background).toContain('payload.repInstruction || payload.metadata?.rep_instruction || payload.repInput');
    expect(background).toContain('rep_instruction: metadata?.rep_instruction ?? null');
    expect(background).toContain('payload.repInstruction || payload.repInput');
  });

  it.each([
    ['Message', 'text'],
    ['Email', 'email'],
    ['CRM Note', 'crm'],
  ])('one Generate click bundles all outputs regardless of the selected %s chip (%s)', (label, type) => {
    expect(read('entrypoints/lib/panelUI.ts')).toContain(`data-type="${type}">${label}</button>`);
    expect(sidepanel).toContain("const type = 'all'");
    expect(sidepanel).toContain('workflow_type: type');
    expect(background).toContain("workflow_type: payload.metadata?.workflow_type || payload.type || 'all'");
    expect(background).toContain('workflow_type: metadata?.workflow_type ?? null');
  });

  it('the selected output chip only switches the visible tab, never triggers a new generation', () => {
    const chipHandlerStart = sidepanel.indexOf("root.querySelectorAll('.chip').forEach(c => {");
    const chipHandlerBody = sidepanel.slice(chipHandlerStart, sidepanel.indexOf('});', chipHandlerStart) + 3);
    expect(chipHandlerBody).not.toContain('doGenerate');
    expect(chipHandlerBody).toContain('setActiveOutputTab');
  });

  it('does not force a generic closing question', () => {
    expect(background).not.toContain('Every text message must end with a question');
    expect(background).toContain('do not append a generic question');
  });
});

describe('offline retry preserves the same generation-control fields', () => {
  const background = read('entrypoints/background.ts');

  it('queues the exact same metadata object (tone, goal, rep_instruction, workflow_type) used for the live call', () => {
    const handleGenerateStart = background.indexOf('async function handleGenerate(payload: {');
    const handleGenerateBody = background.slice(handleGenerateStart, background.indexOf('\nasync function ', handleGenerateStart + 1));
    // The metadata object literal (built once from payload.tone/goal/rep_instruction)
    // must be the same value passed to both the live proxy call and the
    // offline-queue fallback -- no separate queue-only body loses the fields.
    expect(handleGenerateBody).toContain('tone: payload.tone || payload.metadata?.tone || null');
    expect(handleGenerateBody).toContain('goal: payload.goal || payload.metadata?.goal || null');
    expect(handleGenerateBody).toContain('rep_instruction: cleanRepSteer(payload.repInstruction || payload.metadata?.rep_instruction || payload.repInput) || null');
    expect(handleGenerateBody).toContain('generateViaProxy(\n      dealerToken,\n      userMessage,\n      detectedPlatform,\n      metadata,');
    expect(handleGenerateBody).toContain("const queueId = await enqueue('/v1/generate', 'POST', xh, body);");
    expect(handleGenerateBody).toContain('buildGenerateProxyBody(dealerToken, userMessage, detectedPlatform, metadata)');
  });
});
