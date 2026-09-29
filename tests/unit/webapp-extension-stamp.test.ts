import { describe, expect, it } from 'vitest';
import {
  EXTENSION_IDS_ATTRIBUTE,
  parseStampedExtensionIds,
  registerWebappExtensionStamp,
} from '../../entrypoints/lib/webappExtensionStamp';

class FakeRoot {
  private readonly attrs = new Map<string, string>();

  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
}

const STORE_ID = 'onbnhkpggamfbnjdaelgimgimcchamah';
const UNPACKED_ID = 'abcdefghijklmnopabcdefghijklmnop';

describe('web app extension runtime stamps', () => {
  it('preserves every active runtime id instead of letting the last install win', () => {
    const root = new FakeRoot();
    registerWebappExtensionStamp(root, STORE_ID, '1.16.92');
    registerWebappExtensionStamp(root, UNPACKED_ID, '1.16.112');

    expect(parseStampedExtensionIds(root.getAttribute(EXTENSION_IDS_ATTRIBUTE))).toEqual([
      STORE_ID,
      UNPACKED_ID,
    ]);
    expect(root.getAttribute('data-brevmont-extension-id')).toBe(STORE_ID);
    expect(root.getAttribute('data-brevmont-extension-version')).toBe('1.16.92');
  });

  it('deduplicates ids and ignores malformed DOM values', () => {
    expect(parseStampedExtensionIds(`bad,${STORE_ID},${STORE_ID},xyz`)).toEqual([STORE_ID]);
  });
});
