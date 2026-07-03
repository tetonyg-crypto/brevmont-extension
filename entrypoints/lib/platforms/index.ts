/**
 * Universal Capture — public exports.
 */

export type {
  PlatformId,
  SurfaceKind,
  InjectKind,
  ThreadContext,
  CustomerCandidate,
  DealContext,
  InjectResult,
  AdapterCapabilities,
  PlatformAdapter,
} from './types';

export {
  verifyInject,
  pickCleanName,
  extractVehicleHint,
  findGenericComposer,
  stableKeyFromPath,
} from './shared';

export { platformIdFromUrl, resolveAdapter, resetAdapterCache } from './registry';
