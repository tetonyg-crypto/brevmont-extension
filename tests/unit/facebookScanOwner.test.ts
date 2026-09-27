import { describe, expect, it } from 'vitest';
import { createFacebookScanOwner, facebookScanRouteKey } from '../../entrypoints/lib/facebookScanOwner';

// 2026-09-27: Prospect Context for Mark Fulton was painted under Piotr's
// header. A scan of Mark was still in flight (content read + PARSE_LEAD)
// when the rep moved to Piotr, and nothing checked who owned the result.

const MARK = 'https://www.facebook.com/profile.php?id=1001';
const PIOTR = 'https://www.facebook.com/profile.php?id=2002';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('Facebook scan route identity', () => {
  it('distinguishes numeric profiles that share /profile.php', () => {
    expect(facebookScanRouteKey(MARK)).not.toBe(facebookScanRouteKey(PIOTR));
  });

  it('ignores query noise on the same profile', () => {
    expect(facebookScanRouteKey('https://www.facebook.com/mark.fulton?__tn__=R&ref=feed'))
      .toBe(facebookScanRouteKey('https://www.facebook.com/mark.fulton'));
  });

  it('is empty off Facebook so other platforms are untouched', () => {
    expect(facebookScanRouteKey('https://www.linkedin.com/in/someone/')).toBe('');
    expect(facebookScanRouteKey('https://x.com/someone')).toBe('');
  });
});

describe('D: scan Mark, immediately navigate to Piotr', () => {
  it('a late Mark result is discarded; only Piotr commits', async () => {
    const owner = createFacebookScanOwner();
    let liveUrl = MARK;
    const painted: string[] = [];
    const run = async (kind: 'auto' | 'manual', reply: Promise<{ name: string; url: string }>) => {
      const ticket = owner.begin(kind, liveUrl);
      const result = await reply;
      if (owner.canCommit(ticket, liveUrl, result.url)) painted.push(result.name);
      owner.finish(ticket);
    };

    const markReply = deferred<{ name: string; url: string }>();
    const markScan = run('manual', markReply.promise);

    liveUrl = PIOTR;
    owner.invalidate();
    const piotrReply = deferred<{ name: string; url: string }>();
    const piotrScan = run('manual', piotrReply.promise);

    piotrReply.resolve({ name: 'Piotr Proditus', url: PIOTR });
    markReply.resolve({ name: 'Mark Fulton', url: MARK });
    await Promise.all([markScan, piotrScan]);

    expect(painted).toEqual(['Piotr Proditus']);
  });

  it('a read that the content script took from the old page cannot commit on the new route', () => {
    const owner = createFacebookScanOwner();
    const ticket = owner.begin('manual', PIOTR);
    expect(owner.canCommit(ticket, PIOTR, MARK)).toBe(false);
    expect(owner.canCommit(ticket, PIOTR, PIOTR)).toBe(true);
  });

  it('a scan whose tab has already left its route cannot commit even without an explicit invalidate', () => {
    const owner = createFacebookScanOwner();
    const ticket = owner.begin('auto', MARK);
    expect(owner.canCommit(ticket, PIOTR)).toBe(false);
  });
});

describe('G: automatic scan A, then manual scan B', () => {
  it('B owns the result when the auto scan of A lands last', async () => {
    const owner = createFacebookScanOwner();
    let liveUrl = MARK;
    const autoA = owner.begin('auto', liveUrl);

    liveUrl = PIOTR;
    owner.invalidate();
    const manualB = owner.begin('manual', liveUrl);

    expect(owner.canCommit(manualB, liveUrl, PIOTR)).toBe(true);
    owner.finish(manualB);
    expect(owner.canCommit(autoA, liveUrl, MARK)).toBe(false);
  });

  it('on the same route, a manual scan outranks an auto scan already in flight and any auto started during it', () => {
    const owner = createFacebookScanOwner();
    const autoBefore = owner.begin('auto', PIOTR);
    const manual = owner.begin('manual', PIOTR);
    const autoDuring = owner.begin('auto', PIOTR);

    expect(owner.canCommit(autoBefore, PIOTR, PIOTR)).toBe(false);
    expect(owner.canCommit(autoDuring, PIOTR, PIOTR)).toBe(false);
    expect(owner.canCommit(manual, PIOTR, PIOTR)).toBe(true);

    owner.finish(manual);
    const autoAfter = owner.begin('auto', PIOTR);
    expect(owner.canCommit(autoAfter, PIOTR, PIOTR)).toBe(true);
    expect(owner.canCommit(autoBefore, PIOTR, PIOTR)).toBe(false);
  });

  it('a second manual scan supersedes the first', () => {
    const owner = createFacebookScanOwner();
    const first = owner.begin('manual', PIOTR);
    const second = owner.begin('manual', PIOTR);
    expect(owner.canCommit(first, PIOTR, PIOTR)).toBe(false);
    expect(owner.canCommit(second, PIOTR, PIOTR)).toBe(true);
  });
});

describe('Facebook feed pages are not treated as prospects', () => {
  it('home feed query churn produces no ownership key', () => {
    expect(facebookScanRouteKey('https://www.facebook.com/?sk=h_chr')).toBe('');
    expect(facebookScanRouteKey('https://www.facebook.com/groups/idahoconstruction')).toBe('');
  });
});
