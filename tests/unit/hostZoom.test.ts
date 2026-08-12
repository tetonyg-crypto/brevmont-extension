import { describe, expect, it } from 'vitest';
import { applyIndependentZoom, readHostZoom } from '../../entrypoints/lib/hostZoom';

describe('hostZoom', () => {
  it('returns 1 when the host is not zoomed', () => {
    expect(readHostZoom(document)).toBe(1);
  });

  it('counters host CSS zoom on an overlay', () => {
    const host = document.createElement('div');
    const original = document.defaultView?.getComputedStyle;
    if (document.defaultView) {
      document.defaultView.getComputedStyle = ((el: Element) => {
        if (el === document.documentElement) return { zoom: '1.25' } as CSSStyleDeclaration;
        return original?.call(document.defaultView, el) as CSSStyleDeclaration;
      }) as typeof getComputedStyle;
    }
    expect(readHostZoom(document)).toBe(1.25);
    applyIndependentZoom(host, document);
    expect(host.style.zoom).toBe('0.8');
    if (document.defaultView && original) document.defaultView.getComputedStyle = original;
  });
});
