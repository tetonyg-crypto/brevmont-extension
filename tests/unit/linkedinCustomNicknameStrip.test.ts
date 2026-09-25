import { describe, expect, it } from 'vitest';
import { stripLinkedInMessageChrome } from '../../entrypoints/lib/platforms/linkedin';

// Founder runtime defect 2026-09-25: LinkedIn's saved custom-nickname feature
// renders "(Nickname)" directly after a connection's real name in bubble
// lockup text ("Tony Valladolid (Bad Ass) sent the following message at
// 7:39 PM"). personName/header_text is always the real name only, so the old
// strip removed just "Tony Valladolid" and left "(Bad Ass)" orphaned in
// place -- it surfaced live, mid-sentence, in the extension's "Replying to"
// preview: "sent the following message at (Bad Ass) Good meeting Yancy...".
describe('stripLinkedInMessageChrome custom-nickname strip (2026-09-25)', () => {
  it('removes a custom-nickname parenthetical attached to the person name', () => {
    const text = 'Tony Valladolid (Bad Ass) sent the following message at 7:39 PM View Tony’s profile Tony Valladolid (Bad Ass) 7:39 PM Good meeting Yancy, my email is tony@thefoodmaestro.com';
    const result = stripLinkedInMessageChrome(text, 'Tony Valladolid');
    expect(result).not.toContain('Bad Ass');
    expect(result).toContain('Good meeting Yancy, my email is tony@thefoodmaestro.com');
  });

  it('still strips the plain name with no nickname present (regression guard)', () => {
    const text = 'Gerardo Abinadi Flores sent the following message at 9:57 AM View Gerardo Abinadi’s profile Gerardo Abinadi Flores 9:57 AM We sell knives';
    const result = stripLinkedInMessageChrome(text, 'Gerardo Abinadi Flores');
    expect(result).toBe('sent the following message at We sell knives');
  });

  it('does not eat parenthetical content that is part of the actual message body', () => {
    const text = 'Tony Valladolid sent the following message at 7:39 PM Good meeting Yancy (see you soon)';
    const result = stripLinkedInMessageChrome(text, 'Tony Valladolid');
    expect(result).toContain('(see you soon)');
  });
});
