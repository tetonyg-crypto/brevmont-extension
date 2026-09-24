export interface LinkedInFrameSignals {
  href: string;
  hasThreadView: boolean;
  messageListCount: number;
  composerCount: number;
  visibleMessageCount: number;
  hasMessagingSurface: boolean;
  score: number;
}

export interface LinkedInFrameProbe extends LinkedInFrameSignals {
  frameId: number;
}

export function scoreLinkedInFrame(
  signals: Omit<LinkedInFrameSignals, 'hasMessagingSurface' | 'score'>,
): LinkedInFrameSignals {
  const hasMessagingSurface = signals.hasThreadView || signals.messageListCount > 0;
  const score = hasMessagingSurface
    ? (signals.hasThreadView ? 100 : 0)
      + (signals.messageListCount > 0 ? 80 : 0)
      + (signals.composerCount > 0 ? 40 : 0)
      + Math.min(signals.visibleMessageCount, 20)
    : 0;
  return { ...signals, hasMessagingSurface, score };
}

export function selectLinkedInConversationFrame(
  probes: LinkedInFrameProbe[],
): LinkedInFrameProbe | null {
  return probes
    .filter((probe) => probe.hasMessagingSurface && probe.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || right.visibleMessageCount - left.visibleMessageCount
      || left.frameId - right.frameId
    ))[0] || null;
}

/**
 * Runs inside each LinkedIn frame through chrome.scripting.executeScript.
 * Keep this function self-contained: Chrome serializes it without module scope.
 */
export function probeLinkedInConversationDocument(): LinkedInFrameSignals {
  const threadViewCount = document.querySelectorAll(
    '.msg-conversations-container__thread-view, .msg-overlay-conversation-bubble--is-active, .msg-overlay-conversation-bubble.is-active',
  ).length;
  const messageListCount = document.querySelectorAll('.msg-s-message-list-content').length;
  const composerCount = document.querySelectorAll(
    '.msg-form__contenteditable, [aria-label*="Write a message" i][contenteditable="true"]',
  ).length;
  const visibleMessageCount = document.querySelectorAll(
    '.msg-s-event-listitem, .msg-s-message-group, .msg-s-message-list__event',
  ).length;
  const hasThreadView = threadViewCount > 0;
  const hasMessagingSurface = hasThreadView || messageListCount > 0;
  const score = hasMessagingSurface
    ? (hasThreadView ? 100 : 0)
      + (messageListCount > 0 ? 80 : 0)
      + (composerCount > 0 ? 40 : 0)
      + Math.min(visibleMessageCount, 20)
    : 0;

  return {
    href: String(window.location.href || ''),
    hasThreadView,
    messageListCount,
    composerCount,
    visibleMessageCount,
    hasMessagingSurface,
    score,
  };
}

export async function discoverLinkedInConversationFrame(
  tabId: number,
): Promise<LinkedInFrameProbe | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: probeLinkedInConversationDocument,
  });
  const probes = results.flatMap((entry) => (
    entry.result
      ? [{ frameId: entry.frameId, ...entry.result }]
      : []
  ));
  return selectLinkedInConversationFrame(probes);
}
