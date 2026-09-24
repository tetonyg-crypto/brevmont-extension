import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

test('LinkedIn messaging discovers and targets the active conversation frame', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const routing = read('entrypoints/lib/linkedinFrameRouting.ts');
  const content = read('entrypoints/content.ts');
  expect(source).toContain('discoverLinkedInConversationFrame');
  expect(source).toContain("tabMessage(currentPlatform.tabId, msg, { frameId: first.frameId })");
  expect(source).toContain("tabMessage(currentPlatform.tabId, msg, { frameId: retry.frameId })");
  expect(source).toContain('linkedin_conversation_frame_not_found');
  expect(content).toContain('if (window !== window.top && !isLinkedIn) return;');
  expect(content).not.toContain('if (window !== window.top) return;');
  expect(routing).toContain('target: { tabId, allFrames: true }');
  expect(routing).toContain("document.querySelectorAll('.msg-s-message-list-content').length");
  expect(routing).toContain("'.msg-form__contenteditable, [aria-label*=\"Write a message\" i][contenteditable=\"true\"]'");
});

test('LinkedIn conversation reads never fall back to whole-page chrome', () => {
  const content = read('entrypoints/content.ts');
  const adapter = read('entrypoints/lib/platforms/linkedin.ts');
  const scanStart = content.indexOf("if (msg.type === 'SCAN_LEAD')");
  const scanEnd = content.indexOf("if (msg.type === 'INJECT_CONTENT'", scanStart);
  const scanBody = content.slice(scanStart, scanEnd);
  const linkedinScanStart = scanBody.indexOf('} else if (isLinkedIn) {');
  const linkedinScanEnd = scanBody.indexOf('} else if (isGmail)', linkedinScanStart);
  const linkedinScanBody = scanBody.slice(linkedinScanStart, linkedinScanEnd);
  const textStart = content.indexOf("if (msg.type === 'GET_CONVERSATION_TEXT')");
  const textEnd = content.indexOf('return false;', textStart);
  const textBody = content.slice(textStart, textEnd);
  const linkedinTextStart = textBody.indexOf('} else if (isLinkedIn) {');
  const linkedinTextEnd = textBody.indexOf('} else if (isGmail)', linkedinTextStart);
  const linkedinTextBody = textBody.slice(linkedinTextStart, linkedinTextEnd);
  expect(linkedinScanBody).toContain("rawText = thread?.innerText || ''");
  expect(linkedinScanBody).not.toContain('document.body');
  expect(linkedinTextBody).toContain("text = thread ? (thread as HTMLElement).innerText.slice(0, 5000) : ''");
  expect(linkedinTextBody).not.toContain('document.body');
  expect(adapter).toContain("threadRoot || (isMessaging ? null : document.querySelector('[role=\"main\"]'))");
});

test('background screenshot fallback also targets the LinkedIn conversation frame', () => {
  const background = read('entrypoints/background.ts');
  expect(background).toContain('discoverLinkedInConversationFrame(activeTab.id)');
  expect(background).toContain('const target = frame ? { frameId: frame.frameId } : {}');
  expect(background).toContain("{ type: 'GET_CONVERSATION_TEXT' }, target");
  expect(background).toContain("{ type: 'GET_LEAD_CONTEXT' }, target");
});
