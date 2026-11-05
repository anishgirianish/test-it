import { VirtualSizeCache } from './virtual-sizes';

/** Brute-force reference to compare the tree against. */
function reference(sizes: number[]) {
  const offsets = [0];
  for (const s of sizes) offsets.push(offsets[offsets.length - 1] + s);
  const indexAt = (px: number) => {
    if (px <= 0) return 0;
    let i = 0;
    while (i < sizes.length - 1 && offsets[i + 1] <= px) i++;
    return i;
  };
  return { offsets, total: offsets[sizes.length], indexAt };
}

describe('VirtualSizeCache', () => {
  it('uses index * size with a constant estimate and allocates no tree', () => {
    const c = new VirtualSizeCache(1_000_000, 36);
    expect(c.total()).toBe(36_000_000);
    expect(c.offset(250_000)).toBe(9_000_000);
    expect(c.indexAt(9_000_035)).toBe(250_000);
    expect(c.indexAt(9_000_036)).toBe(250_001);
    expect(c.indexAt(1e12)).toBe(999_999);
    expect(c.size(5)).toBe(36);
  });

  it('builds prefix sums from a per-item resolver', () => {
    const sizes = Array.from({ length: 1000 }, (_, i) => (i % 10 === 0 ? 44 : 36));
    const c = new VirtualSizeCache(sizes.length, (i) => sizes[i]);
    const ref = reference(sizes);
    expect(c.total()).toBe(ref.total);
    for (let i = 0; i <= sizes.length; i += 37) expect(c.offset(i)).toBe(ref.offsets[i]);
    for (let px = 0; px < ref.total; px += 101) expect(c.indexAt(px)).toBe(ref.indexAt(px));
    expect(c.indexAt(ref.total + 50)).toBe(sizes.length - 1);
  });

  it('refines estimates with measurements and reports the delta', () => {
    const c = new VirtualSizeCache(100, 36);
    expect(c.setMeasured(10, 80)).toBe(44);
    expect(c.setMeasured(10, 80)).toBe(0); // unchanged
    expect(c.setMeasured(20, 20)).toBe(-16);
    expect(c.measuredCount).toBe(2);
    expect(c.size(10)).toBe(80);
    expect(c.size(11)).toBe(36);
    expect(c.offset(10)).toBe(360);
    expect(c.offset(11)).toBe(440);
    expect(c.offset(21)).toBe(440 + 9 * 36 + 20);
    expect(c.total()).toBe(100 * 36 + 44 - 16);
    expect(c.indexAt(400)).toBe(10); // inside the tall row
    expect(c.indexAt(440)).toBe(11);

    c.clearMeasured();
    expect(c.total()).toBe(3600);
    expect(c.offset(11)).toBe(396);
  });

  it('matches a brute-force reference under random measurements', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const n = 5000;
    const sizes = Array.from({ length: n }, () => 24 + Math.floor(rnd() * 3) * 18);
    const c = new VirtualSizeCache(n, (i) => sizes[i]);
    for (let k = 0; k < 2000; k++) {
      const i = Math.floor(rnd() * n);
      const s = 10 + Math.floor(rnd() * 200);
      const expectedDelta = s - sizes[i];
      expect(c.setMeasured(i, s)).toBeCloseTo(expectedDelta, 6);
      sizes[i] = s;
    }
    const ref = reference(sizes);
    expect(c.total()).toBeCloseTo(ref.total, 6);
    for (let i = 0; i <= n; i += 97) expect(c.offset(i)).toBeCloseTo(ref.offsets[i], 6);
    for (let px = 0; px < ref.total; px += 331) expect(c.indexAt(px)).toBe(ref.indexAt(px));
  });

  it('carries measurements over to a rebuilt cache when the estimate is unchanged', () => {
    const expanded = new Set<number>();
    const estimate = (i: number) => (expanded.has(i) ? 36 + 120 : 36);
    const a = new VirtualSizeCache(100, estimate);
    a.setMeasured(5, 60);
    a.setMeasured(7, 90);

    expanded.add(7); // row 7 changes kind: its old measurement must not survive
    const b = new VirtualSizeCache(100, estimate, a);
    expect(b.size(5)).toBe(60);
    expect(b.size(7)).toBe(156);
    expect(b.measuredCount).toBe(1);
    expect(b.total()).toBe(98 * 36 + 60 + 156);

    const c = new VirtualSizeCache(101, estimate, b); // different count: nothing carried
    expect(c.measuredCount).toBe(0);

    const d = new VirtualSizeCache(100, 36, b); // constant estimate still carries matching rows
    expect(d.size(5)).toBe(60);
    expect(d.size(7)).toBe(36);
  });

  it('handles empty lists and zero-size items', () => {
    const empty = new VirtualSizeCache(0, 36);
    expect(empty.total()).toBe(0);
    expect(empty.indexAt(100)).toBe(0);
    expect(empty.setMeasured(0, 10)).toBe(0);

    const c = new VirtualSizeCache(3, (i) => (i === 1 ? 0 : 30));
    expect(c.offset(2)).toBe(30);
    expect(c.indexAt(30)).toBe(2); // the zero-height item is skipped
  });
});
