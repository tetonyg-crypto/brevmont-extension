/**
 * Overdrive — draft-and-approve Messenger assistant.
 * Drafts a grounded reply into the composer and HOLDS it; the rep reviews
 * and taps Facebook's own send button. Nothing sends without a human tap.
 * Public exports.
 */

export { overdriveSend } from './overdriveSend';
export { overdriveAttachPhoto } from './overdriveAttachPhoto';
export {
  install as installOverdriveDetector,
  uninstall as uninstallOverdriveDetector,
  isInstalled as isOverdriveDetectorInstalled,
  overdriveDetectorAlarmTick,
} from './overdriveDetector';
// installSpikeHarness (window.__overdriveSpike DevTools debug hook) is NOT
// re-exported — its only caller was removed for store safety, so keeping it out
// of the barrel lets tree-shaking drop the spike harness from the shipped bundle.
export { scrapeFacebookProfile } from './linkFacebook';
export type { FacebookProfileScrape } from './linkFacebook';
export { qualifyThread } from './qualification';
export type { QualificationInput, QualificationResult } from './qualification';
export {
  readThreadState,
  writeThreadState,
  emptyState,
  isTerminal,
  shouldReply,
  recordReplyOutcome,
} from './stateMachine';
export type { LocalThreadState, ShouldReplyInput, ShouldReplyResult } from './stateMachine';
export {
  sleep,
  computePreSendJitterMs,
  computeTypingMs,
  buildSafetyDelay,
  inActiveHours,
  markRepInput,
  repRecentlyTyped,
  installRepInputWatcher,
} from './safetyEnvelope';
export type { SafetyDelay } from './safetyEnvelope';
export { orchestrateReply, isHeroStage } from './orchestrator';
export {
  installOverdriveController,
  refreshOverdriveSettings,
  overdriveControllerStatus,
} from './backgroundController';
export {
  scrapeActiveThread,
  armDetectorForwarding,
  markRepTyping,
} from './contentBridge';
export type {
  ThreadScrape,
  OrchestratorSettings,
  OrchestratorDeps,
  OrchestratorResult,
} from './orchestrator';
export {
  getOverdriveSettings,
  patchOverdriveSettings,
  postLinkFacebook,
  postUnlinkFacebook,
  postDisclosureAck,
  postRepPhoto,
  getThreadState,
  pauseThread,
  resumeThread,
  requestOverdriveReply,
  getOverdriveStateSeq,
} from './apiClient';
export type {
  OverdriveSettingsResponse,
  OverdriveThreadState,
  OverdriveReplyResponse,
} from './apiClient';
export type {
  OverdriveStage,
  OverdriveThreadContext,
  OverdriveSendResult,
  OverdriveAttachResult,
  DetectionSignal,
  DetectionCallback,
} from './types';
