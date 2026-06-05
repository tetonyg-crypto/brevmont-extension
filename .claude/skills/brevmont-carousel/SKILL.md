---
name: brevmont-carousel
description: >-
  Brevmont Carousel Protocol. Trigger whenever Yancy says "let's create a post",
  "make a carousel", "carousel poster", or asks for a Brevmont social slide deck.
  Builds pixel-identical on-brand carousel slides as PNGs via a Playwright render
  engine. Problem-first, branded CTA last. Do NOT hand back ChatGPT image prompts
  unless cartoon-illustration art is explicitly requested.
---

# Brevmont Carousel Protocol

## When to use
Trigger whenever Yancy says "let's create a post", "make a carousel",
"carousel poster", or asks for a Brevmont social slide deck. Build the slides
directly — render HTML to PNG via the render engine in this skill. Do NOT hand
back ChatGPT image prompts unless cartoon-illustration art is explicitly requested.

## Structure (non-negotiable)
A carousel is ONE swipeable set:
- Slide 1: the hook / problem in the reader's language
- Middle slides: pain deepens, concrete and specific
- Final slide: ALWAYS a branded Brevmont CTA card (rep-side or GM-side)

Never deliver problem slides and the CTA card separately. One set, always.

## Brand (locked hex)
- Charcoal bg #0F1419
- Deep teal #0D6E6E / bright teal #14A8A8 / label teal #15A8A8
- Bone text #F8F6F1 / body gray #9BA3AA / muted #7A828A
- Headline: serif ~84px, ONE word italic bright teal
- Eyebrow: Inter 700 ~26px, letter-spacing 7px, UPPERCASE teal
- Body: Inter 400 ~34px, line-height 1.5
- CTA block: teal gradient #0D6E6E->#14A8A8, radius 18px
- Footer: teal "B" logo + BREVMONT wordmark + LINK IN BIO ->
- No emojis, no exclamation points, no em-dashes, no neon, no glassmorphism

## Canvas
1080 x 1350, device_scale_factor 2, ~90px vertical / ~80px side padding.
Branded cards get a lower-center teal radial glow.

## Copy rules (locked)
- "generations" never "outputs" never "customer messages"
- GM dashboard is the PAID product. Never imply it is free. Free tier = 500
  generations/month, NO dashboard.
- Rep-Execution Layer positioning. Facebook/Messenger lead visibility = primary angle.
- No founder name on customer surfaces. Company voice (or founder voice from Yancy's
  personal account).
- Banned: revolutionary, unleash, supercharge, game-changing, synergy, leverage(verb),
  just checking in, circle back, touch base. No fabricated stats or testimonials.

## How to render
1. Write a slides JSON spec (see schema.json).
2. Run: python3 render.py slides.json /output/dir
3. View each PNG to verify, then present in order, slide 1 first.
4. Write the caption: hook -> concrete problem -> what Brevmont does ->
   "Free to start. No credit card. Link in bio."

### Render engine notes
- Default behavior matches a Mac Mini after `python3 -m playwright install chromium`.
- In sandboxed/CI environments you may set `BREVMONT_CHROMIUM_PATH` to an existing
  chromium binary; the engine falls back to it and launches with `--no-sandbox`.

## Files in this skill
- render.py — the render engine (HTML -> 1080x1350 PNG via Playwright)
- schema.json — the slide spec format
- templates/problem.html — problem/hook slide template
- templates/cta_rep.html — "Your reps are salespeople. Not prompt engineers." card
- templates/cta_gm.html — "Your reps do the work. Now you can see it." card
