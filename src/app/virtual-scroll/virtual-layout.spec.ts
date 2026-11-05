import { computeVirtualLayout, scrollTopForVirtual, virtualTopForIndex } from './virtual-layout';
import { VirtualSizeCache } from './virtual-sizes';

const base = { headerSize: 40, viewportHeight: 640, buffer: 4, maxDomHeight: 12_000_000 };
const fixed = (count: number, size = 36) => new VirtualSizeCache(count, size);

describe('computeVirtualLayout', () => {
  it('renders the first window with no offset at scrollTop 0', () => {
    const l = computeVirtualLayout({ ...base, sizes: fixed(1000), scrollTop: 0 });
    expect(l.start).toBe(0);
    expect(l.first).toBe(0);
    expect(l.end).toBe(Math.floor(600 / 36) + 1 + 4);
    expect(l.offset).toBe(0);
    expect(l.scale).toBe(1);
    expect(l.sizerHeight).toBe(40 + 1000 * 36);
  });

  it('positions the window so the first visible row lands on the right pixel', () => {
    const l = computeVirtualLayout({ ...base, sizes: fixed(1000), scrollTop: 1000 });
    const first = Math.floor(1000 / 36); // 27
    expect(l.first).toBe(first);
    expect(l.start).toBe(first - 4);
    // row `first` sits at offset + (first - start) * itemSize == -(1000 % 36)
    expect(l.offset + (first - l.start) * 36).toBe(-(1000 % 36));
  });

  it('clamps at the end and never renders past count', () => {
    const l = computeVirtualLayout({ ...base, sizes: fixed(50), scrollTop: 99_999 });
    expect(l.end).toBe(50);
    expect(l.start).toBeGreaterThanOrEqual(0);
    const rowsBelowTop = (l.end - l.start) * 36 + l.offset;
    expect(rowsBelowTop).toBeGreaterThanOrEqual(600); // still covers the body
  });

  it('handles an empty list', () => {
    const l = computeVirtualLayout({ ...base, sizes: fixed(0), scrollTop: 0 });
    expect(l).toEqual({ start: 0, end: 0, first: 0, offset: 0, sizerHeight: 40, scale: 1, virtualTop: 0 });
  });

  it('scales the scrollbar once the list exceeds maxDomHeight', () => {
    const count = 1_000_000; // 36M virtual px > 12M cap
    const sizes = fixed(count);
    const top = computeVirtualLayout({ ...base, sizes, scrollTop: 0 });
    expect(top.sizerHeight).toBe(40 + 12_000_000);
    expect(top.scale).toBeGreaterThan(2.9);

    const bottom = computeVirtualLayout({ ...base, sizes, scrollTop: 12_000_040 - 640 });
    expect(bottom.end).toBe(count);
    const lastRowBottom = bottom.offset + (bottom.end - bottom.start) * 36;
    expect(Math.round(lastRowBottom)).toBe(600); // last row ends exactly at the body bottom

    const idx = 250_000;
    const scrollTop = scrollTopForVirtual(virtualTopForIndex(sizes, idx, 600), top.scale);
    const l = computeVirtualLayout({ ...base, sizes, scrollTop });
    expect(l.start).toBeLessThanOrEqual(idx);
    expect(l.end).toBeGreaterThan(idx);
    expect(Math.abs(l.offset + (idx - l.start) * 36)).toBeLessThan(1); // lands at the top
  });

  it('applies the sub-pixel adjust to the virtual position', () => {
    const sizes = fixed(1_000_000);
    const scale = computeVirtualLayout({ ...base, sizes, scrollTop: 0 }).scale;
    const wantVirtual = 250_000 * 36; // not representable as whole DOM px once scaled
    const domTop = Math.floor(wantVirtual / scale);
    const adjust = wantVirtual - domTop * scale;
    const l = computeVirtualLayout({ ...base, sizes, scrollTop: domTop, adjust });
    expect(l.virtualTop).toBeCloseTo(wantVirtual, 6);
    expect(l.offset + (250_000 - l.start) * 36).toBeCloseTo(0, 6);
    expect(computeVirtualLayout({ ...base, sizes, scrollTop: 0, adjust: -5 }).virtualTop).toBe(0);
  });

  it('covers the body with variable row heights', () => {
    const heights = Array.from({ length: 500 }, (_, i) => (i % 7 === 0 ? 120 : i % 3 === 0 ? 54 : 36));
    const sizes = new VirtualSizeCache(heights.length, (i) => heights[i]);
    for (const scrollTop of [0, 333, 1234, 5000, 9999, 20_000]) {
      const l = computeVirtualLayout({ ...base, sizes, scrollTop, buffer: 0 });
      const virtualTop = Math.min(scrollTop, sizes.total() - 600);
      // first visible row straddles the top edge …
      expect(sizes.offset(l.first)).toBeLessThanOrEqual(virtualTop);
      expect(sizes.offset(l.first + 1)).toBeGreaterThan(virtualTop);
      // … and the window reaches the bottom edge
      expect(sizes.offset(l.end)).toBeGreaterThanOrEqual(virtualTop + 600);
      expect(l.offset).toBe(sizes.offset(l.start) - virtualTop);
    }
  });

  it('aligns scroll targets start / center / end', () => {
    const sizes = new VirtualSizeCache(100, (i) => (i === 50 ? 100 : 36));
    expect(virtualTopForIndex(sizes, 50, 600)).toBe(50 * 36);
    expect(virtualTopForIndex(sizes, 50, 600, { align: 'end' })).toBe(50 * 36 - (600 - 100));
    expect(virtualTopForIndex(sizes, 50, 600, { align: 'center' })).toBe(50 * 36 - (600 - 100) / 2);
    expect(virtualTopForIndex(sizes, 99, 600)).toBe(sizes.total() - 600); // clamped to max scroll
    expect(virtualTopForIndex(sizes, 0, 600, { align: 'end' })).toBe(0);
  });
});
