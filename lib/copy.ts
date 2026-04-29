/**
 * Tool: lib/copy.ts
 * Purpose: Single source of truth for every user-facing string in the
 *          extension. Eliminates the "robotic copy" friction (Lab Note
 *          2026-04-29: rep complained that the wizard sounded like a form
 *          generator wrote it). One file, one tone, founder-edited once.
 * Inputs:  Component code reading copy by key
 * Outputs: Strongly-typed strings + helpers
 * Dependencies: none
 * Last Updated: 2026-04-29
 * Changelog:
 *   - 2026-04-29: Initial creation. Mirrors brevmont-admin/src/lib/copy.ts.
 *   - 2026-04-29: Added `support` section with Atlas-Approved Copy V1
 *     strings (third-person plural, no founder name in voice). Source of
 *     truth: brevmont-vault/copy/atlas-approved-copy-v1.md §1.
 *
 * BRAND VOICE RULES:
 *   * Direct. Founder talking, not marketing.
 *   * No exclamation points except "thanks!" sign-offs (max one per screen).
 *   * No emojis.
 *   * No em-dashes (use a comma or a period).
 *   * No "leverage", "synergy", "unlock", "robust", "seamless".
 *   * Concrete > abstract. "Sign in with Google" beats "Authenticate".
 *   * Show, don't promise. "Generates in 30 seconds" beats "Lightning fast".
 *
 * Voice approval is locked to founder. Atlas may propose copy via a comment
 * tagged `{ATLAS_PROPOSED: ...}`; founder reviews + clears before merging.
 */

export const copy = {
  // ---------------------------------------------------------------------------
  // Onboarding wizard (entrypoints/onboarding)
  // ---------------------------------------------------------------------------
  onboarding: {
    title: 'Set up Brevmont',
    subtitle: "Four short questions. Two minutes. Then you're inside VinSolutions writing pitches.",

    // Step 1 — identity
    step1: {
      heading: 'Who are you?',
      hint: 'So Brevmont knows whose voice to mimic when it writes for you.',
      firstNameLabel: 'First name',
      lastNameLabel: 'Last name',
      jobTitleLabel: 'Job title',
      jobTitleOther: 'Tell us your title',
      yearsExperienceLabel: 'How long have you been selling cars?',
    },

    // Step 2 — dealership + auth
    step2: {
      heading: "Which dealership are you with?",
      hint: 'We use this to match the deals you generate to your shop.',
      nameLabel: 'Dealership name',
      cityLabel: 'City',
      stateLabel: 'State',
      authToggleHint: 'How were you set up?',
      authManagerLabel: 'I have the dealership license key',
      authRepLabel: 'My manager invited me',
      licenseLabel: 'License key',
      licenseHint: 'Looks like BRVMT-XXXXXXXX. Your manager has it.',
      licenseFoundOk: 'License recognised. You are activated.',
      licenseInvalid: 'That key did not match. Double-check with your manager.',
      repTokenLabel: 'Rep token',
      repTokenHint: 'Starts with BRVMT-REP-. Get it from the email your manager sent or from the dashboard.',
      repTokenFoundOk: 'Token verified. You are activated.',
      repTokenInvalid: 'Token did not match. Ask your manager to resend the invite.',
      crmLabel: 'Which CRM are you using?',
      docFeeLabel: 'Doc fee',
      docFeeHint: 'Optional. Helps Brevmont quote out-the-door price more accurately.',
      taxRateLabel: 'Tax rate',
      taxRateHint: 'Optional. Same reason.',
      avgNewPriceLabel: 'Average new vehicle price',
      avgUsedPriceLabel: 'Average used vehicle price',
      saltRoadsLabel: 'Salt on the roads in winter?',
      saltRoadsHint: 'Affects how Brevmont talks about undercoating and 4WD.',
    },

    // Step 3 — voice
    step3: {
      heading: 'How do you talk to customers?',
      hint: "Brevmont copies your tone, not a template. Show us your real voice.",
      toneLabel: 'Pick the closest match',
      emojiLabel: 'Emojis in texts?',
      textSigLabel: 'Your text signature',
      textSigPlaceholder: 'e.g. — Mike at Stone\'s',
      emailSignoffLabel: 'Email sign-off',
      emailSignoffPlaceholder: "e.g. Talk soon,",
      languagesLabel: 'Languages you sell in',
      languagesHintSpanishOn: 'Brevmont will switch to Spanish based on the lead\'s name and history.',
      philosophyLabel: 'In one line: how do you treat customers?',
      philosophyPlaceholder: "e.g. Like neighbours. I'm here for the next ten years, not the next ten minutes.",
    },

    // Step 4 — market
    step4: {
      heading: 'Who walks through your door?',
      hint: 'Brevmont calibrates objection handling to your actual customer base.',
      customerTypesLabel: 'Most common customer types (pick any)',
      objectionsLabel: 'Objections you hear most',
      marketTypeLabel: 'What\'s the market like?',
      customerNoteLabel: 'Anything else worth knowing?',
      customerNotePlaceholder: 'e.g. We do a lot of trade-ins from neighbouring states. Many customers drive 2+ hours to get here.',
    },

    // Buttons
    buttons: {
      next: 'Continue',
      previous: 'Back',
      finish: 'Activate Brevmont',
      openDashboard: 'Open my dashboard',
      retry: 'Try again',
      cancel: 'Cancel',
    },

    // Completion screen
    complete: {
      heading: "You're in.",
      body: 'Brevmont is configured for your dealership. Open VinSolutions and click any lead. The Brevmont panel appears on the right.',
    },

    // Error states
    errors: {
      networkError: 'No network. Check your connection and try again.',
      validationFailed: 'Could not verify. Try again in a moment.',
      missingFields: 'A few fields are still empty.',
      installTokenInvalid: 'This install link expired or was already used. Ask your manager to resend it.',
    },
  },

  // ---------------------------------------------------------------------------
  // Popup
  // ---------------------------------------------------------------------------
  popup: {
    notActivated: 'Not activated yet. Open VinSolutions to start, or click below.',
    setupCta: 'Run setup',
    activatedHeading: 'Brevmont is on.',
    activatedBody: 'Open VinSolutions and click any lead. The Brevmont panel appears on the right.',
    revokedHeading: 'Access revoked.',
    revokedBody: 'Your Brevmont license is no longer active. Reach out to your manager or text the founder.',
    contactFounder: 'Text the founder direct',
    openDashboard: 'Open dashboard',
    runSetup: 'Run setup',
  },

  // ---------------------------------------------------------------------------
  // Support modal (Atlas-Approved Copy V1, §1)
  // Mirrored verbatim in brevmont-admin/src/lib/copy.ts.
  // ---------------------------------------------------------------------------
  support: {
    headline: 'Send us a message.',
    subhead:
      'We will attach your current screen, version, and recent activity automatically. You only need to describe the issue.',
    bodyPlaceholder: 'Describe what is happening or what you expected.',
    subjectPlaceholder: 'Short summary (optional)',

    sendIdle: 'Send message',
    sendSending: 'Sending',
    sendSent: 'Message received',

    successFull:
      'Your message has been received. We respond to every inquiry directly. Urgent issues are addressed within hours. Other requests within one business day.',

    errorSubmit:
      'The message did not send. Please try again. If the problem continues, contact us at founder@brevmont.com or 307-690-0291.',
    errorScreenshot:
      'The screenshot could not be attached. Your message was sent successfully.',
  },

  // ---------------------------------------------------------------------------
  // Generic
  // ---------------------------------------------------------------------------
  generic: {
    loading: 'Loading...',
    saving: 'Saving...',
    saved: 'Saved.',
    retry: 'Try again',
    close: 'Close',
  },
} as const;

export type CopyShape = typeof copy;

/**
 * Lookup a string by dot-path. Falls back to the path itself in dev so
 * missing keys are obvious.
 */
export function t(path: string): string {
  const parts = path.split('.');
  let cur: unknown = copy;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return path;
    }
  }
  return typeof cur === 'string' ? cur : path;
}
