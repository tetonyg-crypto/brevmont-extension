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
import sys, json, os, tempfile
from playwright.sync_api import sync_playwright

SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
TPL = os.path.join(SKILL_DIR, "templates")

TEMPLATE_MAP = {
    "problem": "problem.html",
    "cta_rep": "cta_rep.html",
    "cta_gm":  "cta_gm.html",
}


def fill(template, slide):
    html = open(os.path.join(TPL, template)).read()
    # italic teal word injection into headline
    headline = slide.get("headline", "")
    iw = slide.get("italic_word")
    if iw and iw in headline:
        headline = headline.replace(iw, f'<span class="it">{iw}</span>', 1)
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
        for i, slide in enumerate(slides, 1):
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
