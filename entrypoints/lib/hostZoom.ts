/**
 * Facebook (and Chrome page zoom) scales injected overlays with the host
 * document. The side panel is a separate document and should stay at 1x.
 * Counter host CSS zoom / visualViewport.scale so inventory UI stays readable.
 */

export function readHostZoom(doc: Document = document): number {
  const cssZoom = parseFloat(doc.defaultView?.getComputedStyle(doc.documentElement).zoom || "1");
  if (Number.isFinite(cssZoom) && cssZoom > 0 && Math.abs(cssZoom - 1) > 0.01) return cssZoom;
  const scale = doc.defaultView?.visualViewport?.scale;
  if (typeof scale === "number" && scale > 0 && Math.abs(scale - 1) > 0.01) return scale;
  return 1;
}

/** Un-zoom a position:fixed overlay so it stays 1x on a zoomed Facebook page. */
export function applyIndependentZoom(el: HTMLElement, doc: Document = document): void {
  const zoom = readHostZoom(doc);
  el.style.zoom = String(1 / zoom);
  el.style.transform = "none";
}

export function lockDocumentZoom(doc: Document = document): void {
  const apply = () => {
    doc.documentElement.style.zoom = "1";
    if (doc.body) {
      doc.body.style.zoom = "1";
      doc.body.style.transform = "none";
    }
  };
  apply();
  const view = doc.defaultView;
  view?.visualViewport?.addEventListener("resize", apply);
  view?.visualViewport?.addEventListener("scroll", apply);
  view?.addEventListener("resize", apply);
}
