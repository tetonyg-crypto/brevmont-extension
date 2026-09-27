import { describe, expect, it } from 'vitest';
import {
  canonicalProfileUrl,
  coalesceLeadRows,
  findStrongIdentityMatch,
  sortActiveLeadRows,
} from '../../lib/leadIdentity';

describe('lead inbox identity', () => {
  it('canonicalizes social profile URLs across query strings and trailing slashes', () => {
    expect(canonicalProfileUrl('https://www.linkedin.com/in/timothy/?trk=abc'))
      .toBe('linkedin.com/in/timothy');
    expect(canonicalProfileUrl('https://facebook.com/profile.php?id=123&ref=bookmarks'))
      .toBe('facebook.com/profile.php?id=123');
    expect(canonicalProfileUrl('https://facebook.com/profile.php?id=456'))
      .not.toBe('facebook.com/profile.php?id=123');
  });

  it('keeps the remote ID while merging a local copy of the same profile', () => {
    const remote = {
      id: 'server-id', customer_name: 'Yancy Garcia', source_platform: 'instagram',
      metadata: { profile_url: 'https://instagram.com/cardogvlogs/' },
      captured_at: '2026-09-26T20:00:00.000Z',
    };
    const local = {
      id: 'local-id', customer_name: 'Yancy Garcia', source_platform: 'instagram',
      metadata: { profile_url: 'https://www.instagram.com/cardogvlogs/?hl=en', username: 'cardogvlogs' },
      captured_at: Date.parse('2026-09-26T20:05:00.000Z'), updated_at: Date.parse('2026-09-26T20:05:00.000Z'),
      local_only: false,
    };
    const result = coalesceLeadRows([remote], [local]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('server-id');
    expect(result[0].metadata.username).toBe('cardogvlogs');
    expect(result[0].duplicate_ids).toEqual(expect.arrayContaining(['server-id', 'local-id']));
  });

  it('collapses legacy radar duplicates with different key namespaces', () => {
    const base = {
      customer_name: 'Bri', vehicle_interest: '2024 Honda Accord Hybrid',
      source_platform: 'facebook_marketplace', captured_at: '2026-09-26T22:00:00.000Z',
    };
    const result = coalesceLeadRows(
      [{ ...base, id: 'a', metadata: { overdrive_conversation_key: 't:123' } }],
      [{ ...base, id: 'b', metadata: { overdrive_conversation_key: 'msg:123' } }],
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('does not weakly merge same-name leads with conflicting contacts', () => {
    const base = {
      customer_name: 'Alex', vehicle_interest: '2024 Ford F-150', source_platform: 'facebook_marketplace',
      captured_at: '2026-09-26T22:00:00.000Z',
    };
    expect(coalesceLeadRows(
      [{ ...base, id: 'a', phone: '5551112222' }],
      [{ ...base, id: 'b', phone: '5559998888' }],
    )).toHaveLength(2);
  });

  it('puts a just-captured lead first, then uses heat and newest activity', () => {
    const now = Date.parse('2026-09-26T23:00:00.000Z');
    const result = sortActiveLeadRows([
      { id: 'hot-old', heat_score: 80, last_activity_at: '2026-09-26T20:00:00.000Z' },
      { id: 'new', heat_score: 30, last_activity_at: '2026-09-26T22:58:00.000Z' },
      { id: 'warm-old', heat_score: 50, last_activity_at: '2026-09-26T21:00:00.000Z' },
    ], now);
    expect(result.map((lead) => lead.id)).toEqual(['new', 'hot-old', 'warm-old']);
  });

  it('finds a local match only from strong identity', () => {
    const existing = { id: 'same', metadata: { thread_fingerprint: 'msg:123' } };
    expect(findStrongIdentityMatch([existing], { metadata: { conversation_key: 'msg:123' } })).toBe(existing);
    expect(findStrongIdentityMatch([existing], { customer_name: 'Same Name' })).toBeNull();
  });

  it('coalesces exact IDs even when no other identity is available', () => {
    expect(coalesceLeadRows(
      [{ id: 'shared', customer_name: 'Remote' }],
      [{ id: 'shared', customer_name: 'Local' }],
    )).toHaveLength(1);
  });
});
