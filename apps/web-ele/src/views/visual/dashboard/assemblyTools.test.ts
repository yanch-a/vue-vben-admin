import { describe, expect, it } from 'vitest';

import {
  defaultWidgetSize,
  finiteNumber,
  normalizeScreenWidgets,
  normalizeWidgetLayout,
} from './assemblyTools';

describe('finiteNumber', () => {
  it('keeps finite numbers and rejects Event/null/NaN', () => {
    expect(finiteNumber(12, 40)).toBe(12);
    expect(finiteNumber('18', 40)).toBe(18);
    expect(finiteNumber(null, 40)).toBe(40);
    expect(finiteNumber(undefined, 40)).toBe(40);
    expect(finiteNumber(Number.NaN, 40)).toBe(40);
    expect(finiteNumber({ clientX: 1 } as unknown, 40)).toBe(40);
  });
});

describe('normalizeWidgetLayout', () => {
  it('fills missing x/y/w/h with type defaults', () => {
    const widget = normalizeWidgetLayout({
      chartSpec: { chartType: 'text', yFields: [] },
    } as any);
    expect(widget.x).toBe(40);
    expect(widget.y).toBe(24);
    expect(widget.w).toBe(defaultWidgetSize('text').w);
    expect(widget.h).toBe(defaultWidgetSize('text').h);
  });

  it('ignores MouseEvent-like x from Vue click handlers', () => {
    const widget = normalizeWidgetLayout(
      {
        chartSpec: { chartType: 'clock', yFields: [] },
        x: 40,
        y: 24,
        w: 320,
        h: 64,
      } as any,
      { x: { clientX: 9 } as unknown, y: undefined },
    );
    expect(widget.x).toBe(40);
    expect(widget.y).toBe(24);
    expect(Number.isFinite(widget.w)).toBe(true);
    expect(Number.isFinite(widget.h)).toBe(true);
  });

  it('normalizes a whole screen on load', () => {
    const list = normalizeScreenWidgets([
      { chartSpec: { chartType: 'bar', yFields: [] }, x: null, w: undefined } as any,
      { chartSpec: { chartType: 'image', yFields: [] }, y: Number.NaN } as any,
    ]);
    expect(list).toHaveLength(2);
    for (const item of list) {
      expect(Number.isFinite(item.x)).toBe(true);
      expect(Number.isFinite(item.y)).toBe(true);
      expect(Number.isFinite(item.w)).toBe(true);
      expect(Number.isFinite(item.h)).toBe(true);
    }
    expect(list[1]!.w).toBe(defaultWidgetSize('image').w);
  });
});
