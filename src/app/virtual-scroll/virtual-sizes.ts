/**
 * Height bookkeeping for a variable-size virtual list. No Angular in here.
 *
 * Every item has an *estimate* (one constant, or a resolver that may return a
 * different value per item, e.g. group row vs data row). Rendered items can
 * then be *measured*; the measured value overrides the estimate.
 *
 * Offsets are prefix sums. They are kept in a Fenwick (binary indexed) tree so
 * that a single measurement updates in O(log n), an offset lookup is O(log n)
 * and finding the item at a pixel position is O(log n). Compared with a plain
 * prefix-sum array (O(n) per update) this stays flat at millions of rows.
 *
 * Memory: 8 bytes per item, but only once the tree is needed. With a constant
 * estimate and no measurements yet, offsets are `index * size` and nothing is
 * allocated at all.
 */
export type SizeResolver = (index: number) => number;

/** Read-only view of item sizes, as the layout math sees it. */
export interface SizeSource {
  readonly count: number;
  /** Sum of all item sizes. */
  total(): number;
  /** Distance from the top of the list to the top of item `index`. */
  offset(index: number): number;
  /** Current (measured or estimated) size of item `index`. */
  size(index: number): number;
  /** Index of the item that contains the pixel `px`, clamped to the list. */
  indexAt(px: number): number;
}

export class VirtualSizeCache implements SizeSource {
  readonly count: number;

  private readonly constant: number;
  private readonly resolve: SizeResolver | null;
  /** Fenwick tree over the current sizes, 1-based. Null while `constant` still holds for every item. */
  private tree: Float64Array | null = null;
  private sum = 0;
  private readonly highBit: number;
  private readonly measured = new Map<number, number>();
  /** Estimate each measured item had when it was measured; used to decide what carries over. */
  private readonly measuredEstimate = new Map<number, number>();

  /**
   * @param carryFrom Previous cache to inherit measurements from. Only used
   *   when the item count is unchanged; an item keeps its measured size if its
   *   estimate is the same as before (a changed estimate means the item's
   *   content changed, e.g. it was expanded, so the old measurement is stale).
   */
  constructor(count: number, estimate: number | SizeResolver, carryFrom: VirtualSizeCache | null = null) {
    this.count = Math.max(0, Math.floor(count));
    this.highBit = this.count > 0 ? 1 << (31 - Math.clz32(this.count)) : 0;
    if (typeof estimate === 'function') {
      this.constant = 0;
      this.resolve = estimate;
    } else {
      this.constant = Math.max(0, estimate);
      this.resolve = null;
    }
    if (carryFrom && carryFrom.count === this.count) {
      for (const [i, px] of carryFrom.measured) {
        const estimate = this.estimate(i);
        if (carryFrom.measuredEstimate.get(i) === estimate) {
          this.measured.set(i, px);
          this.measuredEstimate.set(i, estimate);
        }
      }
    }
    if (this.resolve || this.measured.size) this.build();
    else this.sum = this.count * this.constant;
  }

  /** How many items currently carry a measured size. */
  get measuredCount(): number {
    return this.measured.size;
  }

  estimate(index: number): number {
    if (!this.resolve) return this.constant;
    const v = this.resolve(index);
    return v > 0 ? v : 0;
  }

  size(index: number): number {
    return this.measured.get(index) ?? this.estimate(index);
  }

  total(): number {
    return this.sum;
  }

  offset(index: number): number {
    const i = Math.min(Math.max(0, index), this.count);
    return this.tree ? this.prefix(i) : i * this.constant;
  }

  indexAt(px: number): number {
    const n = this.count;
    if (n === 0 || px <= 0) return 0;
    if (!this.tree) {
      if (this.constant <= 0) return 0;
      return Math.min(n - 1, Math.floor(px / this.constant));
    }
    // Descend the tree: the largest position whose cumulative size is <= px.
    const tree = this.tree;
    let pos = 0;
    let rem = px;
    for (let k = this.highBit; k > 0; k >>= 1) {
      const next = pos + k;
      if (next <= n && tree[next] <= rem) {
        pos = next;
        rem -= tree[next];
      }
    }
    return Math.min(pos, n - 1);
  }

  /**
   * Records a measured size. Returns the change in total height (0 when the
   * value was already known), so callers can correct the scroll position.
   */
  setMeasured(index: number, px: number): number {
    if (index < 0 || index >= this.count) return 0;
    const next = px > 0 ? px : 0;
    const delta = next - this.size(index);
    if (Math.abs(delta) < 0.01) return 0;
    if (!this.tree) this.build();
    if (!this.measured.has(index)) this.measuredEstimate.set(index, this.estimate(index));
    this.measured.set(index, next);
    this.add(index, delta);
    return delta;
  }

  /** Forget every measurement; estimates apply again. */
  clearMeasured(): void {
    if (!this.measured.size) return;
    this.measured.clear();
    this.measuredEstimate.clear();
    if (this.resolve) this.build();
    else {
      this.tree = null;
      this.sum = this.count * this.constant;
    }
  }

  // ------------------------------------------------------------ Fenwick

  /** O(n) construction from the current sizes. */
  private build(): void {
    const n = this.count;
    const tree = new Float64Array(n + 1);
    let sum = 0;
    for (let i = 1; i <= n; i++) {
      const s = this.size(i - 1);
      sum += s;
      tree[i] += s;
      const parent = i + (i & -i);
      if (parent <= n) tree[parent] += tree[i];
    }
    this.tree = tree;
    this.sum = sum;
  }

  private add(index: number, delta: number): void {
    const tree = this.tree!;
    const n = this.count;
    for (let j = index + 1; j <= n; j += j & -j) tree[j] += delta;
    this.sum += delta;
  }

  /** Sum of the first `i` sizes. */
  private prefix(i: number): number {
    const tree = this.tree!;
    let s = 0;
    for (let j = i; j > 0; j -= j & -j) s += tree[j];
    return s;
  }
}
