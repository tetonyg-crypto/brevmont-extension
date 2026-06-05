#!/usr/bin/env python3
"""Brevmont Carousel render engine.

Reads a slides JSON spec, fills the matching HTML template per slide,
screenshots each at 1080x1350 @2x, writes slide_1.png .. slide_N.png.

Usage:
    python3 render.py slides.json /output/dir

Environment:
    BREVMONT_CHROMIUM_PATH  Optional path to an existing chromium binary.
                            Use in sandboxed/CI environments where
                            `playwright install chromium` cannot download.
                            Default (Mac Mini) uses the bundled chromium.
"""
import sys, json, os, re, tempfile
from playwright.sync_api import sync_playwright

SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
TPL = os.path.join(SKILL_DIR, "templates")

TEMPLATE_MAP = {
    "problem": "problem.html",
    "cta_rep": "cta_rep.html",
    "cta_gm":  "cta_gm.html",
}

# Locked copy for the branded CTA cards. The card markup is token-driven, so a
# slide spec may override any field; when a field is omitted the locked default
# below is used. This keeps the cards pixel-identical by default while still
# letting a spec tweak copy when explicitly asked.
DEFAULTS = {
    "cta_rep": {
        "eyebrow": "STOP PROMPTING. START SELLING.",
        "headline": "Your reps are salespeople. Not prompt engineers.",
        "italic_word": "salespeople",
        "body": "Brevmont turns one sentence into a follow-up, email, and CRM "
                "note. The rep reviews it and hits send. Done.",
        "checks": ["Text message", "Email", "CRM note"],
        "cta_big": "Free to start. No credit card.",
        "cta_sub": "Chrome extension for reps. Dashboard for managers.",
    },
    "cta_gm": {
        "eyebrow": "SEE YOUR WHOLE FLOOR",
        "headline": "Your reps do the work. Now you can see it.",
        "italic_word": "see",
        "body": "Brevmont captures every follow-up, text, and CRM note the "
                "moment it happens. The dashboard shows who is working their "
                "leads, who is coasting, and which deals are about to leak. In "
                "real time.",
        "checks": ["Real-time activity", "Captured convos", "Leak alerts"],
        "cta_big": "See the dashboard in action",
        "cta_sub": "Built for managers who want the full picture.",
    },
}


def italicize(headline, italic_word):
    """Wrap one word in the teal-italic span. Supports two syntaxes:
    an explicit `italic_word`, or `*word*` markers inside the headline."""
    # *word* marker syntax wins if present
    if "*" in headline:
        return re.sub(r"\*([^*]+)\*", r'<span class="it">\1</span>', headline, count=1)
    if italic_word and italic_word in headline:
        return headline.replace(italic_word, f'<span class="it">{italic_word}</span>', 1)
    return headline


def fill(template, slide):
    html = open(os.path.join(TPL, template)).read()
    headline = italicize(slide.get("headline", ""), slide.get("italic_word"))
    html = html.replace("{{EYEBROW}}", slide.get("eyebrow", ""))
    html = html.replace("{{HEADLINE}}", headline)
    html = html.replace("{{BODY}}", slide.get("body", ""))
    checks = slide.get("checks", [])
    checks_html = "".join(
        f'<div class="chk"><span class="dot">&#10003;</span>{c}</div>' for c in checks
    )
    html = html.replace("{{CHECKS}}", checks_html)
    html = html.replace("{{CTA_BIG}}", slide.get("cta_big", ""))
    html = html.replace("{{CTA_SUB}}", slide.get("cta_sub", ""))
    return html


def resolve(slide):
    """Merge a slide over its type's locked defaults. A present, truthy field in
    the spec overrides the default; otherwise the locked value is kept."""
    base = dict(DEFAULTS.get(slide.get("type"), {}))
    for k, v in slide.items():
        if v not in (None, "", []):
            base[k] = v
    base["type"] = slide["type"]
    return base


def launch(p):
    exec_path = os.environ.get("BREVMONT_CHROMIUM_PATH")
    if exec_path:
        return p.chromium.launch(executable_path=exec_path, args=["--no-sandbox"])
    return p.chromium.launch()


def main():
    if len(sys.argv) < 3:
        print("usage: python3 render.py slides.json /output/dir")
        sys.exit(1)
    spec = json.load(open(sys.argv[1]))
    outdir = sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    slides = spec["carousel"]["slides"]
    with sync_playwright() as p:
        b = launch(p)
        for i, raw in enumerate(slides, 1):
            slide = resolve(raw)
            tpl = TEMPLATE_MAP[slide["type"]]
            html = fill(tpl, slide)
            f = tempfile.NamedTemporaryFile("w", suffix=".html", delete=False)
            f.write(html); f.close()
            pg = b.new_page(viewport={"width": 1080, "height": 1350}, device_scale_factor=2)
            pg.goto("file://" + f.name)
            pg.wait_for_timeout(1000)
            out = os.path.join(outdir, f"slide_{i}.png")
            pg.locator("#slide").screenshot(path=out)
            pg.close()
            os.unlink(f.name)
            print("rendered", out)
        b.close()
    print("CAPTION:\n" + spec["carousel"].get("caption", ""))


if __name__ == "__main__":
    main()
