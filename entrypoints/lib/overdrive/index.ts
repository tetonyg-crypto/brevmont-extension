/**
 * Overdrive — rep-facing autonomous Messenger responder.
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
export { installSpikeHarness } from './spikeHarness';
export { scrapeFacebookProfile } from './linkFacebook';
export type { FacebookProfileScrape } from './linkFacebook';
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
