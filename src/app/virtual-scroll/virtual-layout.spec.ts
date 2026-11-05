import { computeVirtualLayout, scrollTopForIndex } from './virtual-layout';

const base = { itemSize: 36, headerSize: 40, viewportHeight: 640, buffer: 4, maxDomHeight: 12_000_000 };

describe('computeVirtualLayout', () => {
  it('renders the first window with no offset at scrollTop 0', () => {
    const l = computeVirtualLayout({ ...base, count: 1000, scrollTop: 0 });
    expect(l.start).toBe(0);
    expect(l.end).toBe(Math.ceil(600 / 36) + 1 + 4);
    expect(l.offset).toBe(0);
    expect(l.scale).toBe(1);
    expect(l.sizerHeight).toBe(40 + 1000 * 36);
  });

  it('positions the window so the first visible row lands on the right pixel', () => {
    const l = computeVirtualLayout({ ...base, count: 1000, scrollTop: 1000 });
    const first = Math.floor(1000 / 36); // 27
    expect(l.start).toBe(first - 4);
    // row `first` sits at offset + (first - start) * itemSize == -(1000 % 36)
    expect(l.offset + (first - l.start) * 36).toBe(-(1000 % 36));
  });

  it('clamps at the end and never renders past count', () => {
    const l = computeVirtualLayout({ ...base, count: 50, scrollTop: 99_999 });
    expect(l.end).toBe(50);
    expect(l.start).toBeGreaterThanOrEqual(0);
    const rowsBelowTop = (l.end - l.start) * 36 + l.offset;
    expect(rowsBelowTop).toBeGreaterThanOrEqual(600); // still covers the body
  });

  it('handles an empty list', () => {
    const l = computeVirtualLayout({ ...base, count: 0, scrollTop: 0 });
    expect(l).toEqual({ start: 0, end: 0, offset: 0, sizerHeight: 40, scale: 1 });
  });

  it('scales the scrollbar once the list exceeds maxDomHeight', () => {
    const count = 1_000_000; // 36M virtual px > 12M cap
    const top = computeVirtualLayout({ ...base, count, scrollTop: 0 });
    expect(top.sizerHeight).toBe(40 + 12_000_000);
    expect(top.scale).toBeGreaterThan(2.9);

    const bottom = computeVirtualLayout({ ...base, count, scrollTop: 12_000_040 - 640 });
    expect(bottom.end).toBe(count);
    const lastRowBottom = bottom.offset + (bottom.end - bottom.start) * 36;
    expect(Math.round(lastRowBottom)).toBe(600); // last row ends exactly at the body bottom

    const idx = 250_000;
    const l = computeVirtualLayout({ ...base, count, scrollTop: scrollTopForIndex(idx, 36, top.scale) });
    expect(l.start).toBeLessThanOrEqual(idx);
    expect(l.end).toBeGreaterThan(idx);
    expect(Math.abs(l.offset + (idx - l.start) * 36)).toBeLessThan(1); // lands at the top
  });
});
