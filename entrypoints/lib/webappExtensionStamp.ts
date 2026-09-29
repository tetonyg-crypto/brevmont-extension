const EXTENSION_ID_RE = /^[a-p]{32}$/;

export const EXTENSION_IDS_ATTRIBUTE = 'data-brevmont-extension-ids';

export function parseStampedExtensionIds(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(new Set(
    value
      .split(',')
      .map((id) => id.trim())
      .filter((id) => EXTENSION_ID_RE.test(id)),
  ));
}

export function registerWebappExtensionStamp(
  root: Pick<Element, 'getAttribute' | 'setAttribute'>,
  extensionId: string,
  version = '',
): string[] {
  const legacyId = root.getAttribute('data-brevmont-extension-id') || '';
  const ids = Array.from(new Set([
    ...parseStampedExtensionIds(root.getAttribute(EXTENSION_IDS_ATTRIBUTE)),
    ...(EXTENSION_ID_RE.test(legacyId) ? [legacyId] : []),
    ...(EXTENSION_ID_RE.test(extensionId) ? [extensionId] : []),
  ]));

  root.setAttribute('data-brevmont-extension', '1');
  if (!legacyId && EXTENSION_ID_RE.test(extensionId)) {
    root.setAttribute('data-brevmont-extension-id', extensionId);
  }
  if (!root.getAttribute('data-brevmont-extension-version') && version) {
    root.setAttribute('data-brevmont-extension-version', version);
  }
  root.setAttribute(EXTENSION_IDS_ATTRIBUTE, ids.join(','));
  return ids;
}
