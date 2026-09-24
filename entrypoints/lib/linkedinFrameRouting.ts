export interface LinkedInFrameSignals {
  href: string;
  hasThreadView: boolean;
  messageListCount: number;
  composerCount: number;
  visibleMessageCount: number;
  // BUG-LINKEDIN-WRONG-FRAME (2026-09-23): LinkedIn keeps several messaging
  // iframes mounted at once - the thread you actually opened, plus every
  // minimized chat bubble docked at the bottom of any LinkedIn page. A
  // minimized bubble can carry its own thread view, message list, and
  // composer just like the real open thread, so it can tie or beat it on
  // content alone (confirmed live: Darrin's thread returned unrelated "Zoom
  // Join" content from a different mounted frame). `frameVisible` is true
  // when we cannot determine visibility at all (same-origin frameElement
  // unreachable, e.g. this probe running in the top frame, which has no
  // frameElement of its own) - only an AFFIRMATIVELY collapsed/hidden frame
  // element sets this false, so this never disqualifies anything the old
  // logic would have accepted when visibility genuinely can't be checked.
  frameVisible?: boolean;
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
  const score = hasMessagingSurface && signals.frameVisible !== false
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

  // BUG-LINKEDIN-WRONG-FRAME: window.frameElement is the <iframe> node as
  // seen by this frame's immediate parent document - reachable here because
  // the messaging iframe is same-origin (see entrypoints/content.ts's
  // isLinkedIn top-frame-guard exception). It is null for the top frame
  // itself (nothing embeds it), so `frameVisible` stays true (undetermined,
  // not disqualified) whenever this probe can't check - only an
  // affirmatively collapsed/hidden iframe (the shape every minimized chat
  // bubble takes when docked) sets it false.
  let frameVisible = true;
  try {
    const frameEl = (window as any).frameElement as HTMLIFrameElement | null;
    if (frameEl) {
      const rect = frameEl.getBoundingClientRect();
      const style = window.parent?.getComputedStyle ? window.parent.getComputedStyle(frameEl) : null;
      const collapsed = rect.width <= 1 || rect.height <= 1;
      const hidden = style ? (style.display === 'none' || style.visibility === 'hidden') : false;
      if (collapsed || hidden) frameVisible = false;
    }
  } catch {
    // Cross-origin or otherwise inaccessible - leave frameVisible true
    // (undetermined), never disqualify on a check we couldn't perform.
  }

  const score = hasMessagingSurface && frameVisible
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
    frameVisible,
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
