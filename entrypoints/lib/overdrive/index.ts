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
export type {
  OverdriveStage,
  OverdriveThreadContext,
  OverdriveSendResult,
  OverdriveAttachResult,
  DetectionSignal,
  DetectionCallback,
} from './types';
