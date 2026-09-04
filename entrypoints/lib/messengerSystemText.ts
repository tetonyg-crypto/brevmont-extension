export function normalizeMessengerSystemText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isMessengerSystemCardText(value: unknown): boolean {
  const text = normalizeMessengerSystemText(value);
  if (!text) return true;

  const lower = text.toLowerCase();
  if (lower.includes('you can now rate each other')) return true;
  if (lower.includes('people may rate one another based on their interactions or transactions')) return true;
  if (lower.includes('rate ') && lower.includes('people may rate one another')) return true;
  if (/^(?:.+\s+)?is typing\.?$/i.test(text)) return true;
  if (/^(?:marketplace|sold\s*[-–].*|see details|more options)$/i.test(text)) return true;
  if (/^marketplace\s+sold\s*[-–].*\b(?:see details|more options)\b/i.test(text)) return true;

  // Marketplace listing-activity lines are NOT customer messages and must never
  // be read as the buyer's name ("Robert changed the price for 2021 Ford ...",
  // "Robert marked the listing as sold", "Robert sold 2021 Ford Ranger").
  if (/\bchanged the price\b/i.test(text)) return true;
  if (/\bmarked (?:the|this) listing as sold\b/i.test(text)) return true;
  if (/\bmarked the listing\b/i.test(text)) return true;
  if (/\bupdated the listing\b/i.test(text)) return true;
  if (/^.{1,48}\bsold\b\s+(?:the\s+)?(?:listing\b|(?:19|20)\d{2}\b)/i.test(text)) return true;
  if (/\blisting as sold\b/i.test(text)) return true;

  return false;
}

export function cleanMessengerMessageText(value: unknown): string {
  return normalizeMessengerSystemText(value)
    .replace(/\b(?:[A-Z][\w'’-]{1,30}(?:\s+[A-Z][\w'’-]{1,30}){0,2}\s+)?is typing\.?\b/gi, ' ')
    .replace(/\b(?:message sent|delivered|seen|read|sending)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
