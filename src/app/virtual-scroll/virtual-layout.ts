/**
 * Pure math for a fixed-row-height virtual scroller. Kept free of Angular so
 * it can be unit-tested and reused (workers, other frameworks, SSR).
 */
export interface VirtualLayoutInput {
  /** Number of items in the list. */
  count: number;
  /** Height of one item in px. All items share it. */
  itemSize: number;
  /** Height of a header that sits inside the scroll area above the rows (0 if none). */
  headerSize: number;
  /** Visible height of the scroll container (clientHeight). */
  viewportHeight: number;
  /** Current scrollTop in DOM pixels. */
  scrollTop: number;
  /** Extra items rendered above and below the visible window. */
  buffer: number;
  /** Cap for the scrollable height; beyond it the scrollbar is scaled. */
  maxDomHeight: number;
}

export interface VirtualLayout {
  /** First rendered index (inclusive). */
  start: number;
  /** Last rendered index (exclusive). */
  end: number;
  /** Where the content block should sit relative to the viewport top (≤ 0). */
  offset: number;
  /** Height the sizer must have so the scrollbar is right. */
  sizerHeight: number;
  /** Virtual px per DOM px. 1 unless the list is taller than `maxDomHeight`. */
  scale: number;
}

export function computeVirtualLayout(i: VirtualLayoutInput): VirtualLayout {
  const count = Math.max(0, i.count);
  const itemSize = Math.max(1, i.itemSize);
  const headerSize = Math.max(0, i.headerSize);
  const bodyView = Math.max(0, i.viewportHeight - headerSize);

  const virtualTotal = count * itemSize;
  const domTotal = Math.min(virtualTotal, Math.max(bodyView, i.maxDomHeight));
  const maxDomScroll = Math.max(0, domTotal - bodyView);
  const maxVirtualScroll = Math.max(0, virtualTotal - bodyView);
  const scale = maxDomScroll > 0 ? maxVirtualScroll / maxDomScroll : 1;

  const domTop = Math.min(Math.max(0, i.scrollTop), maxDomScroll);
  const virtualTop = domTop * scale;
  const first = Math.min(count, Math.floor(virtualTop / itemSize));
  const visible = Math.ceil(bodyView / itemSize) + 1;
  const buffer = Math.max(0, i.buffer);

  const start = Math.max(0, first - buffer);
  const end = Math.min(count, first + visible + buffer);
  const offset = start * itemSize - virtualTop;

  return { start, end, offset, sizerHeight: headerSize + domTotal, scale };
}

/** DOM scrollTop that puts item `index` at the top of the body area. */
export function scrollTopForIndex(index: number, itemSize: number, scale: number): number {
  return (Math.max(0, index) * itemSize) / scale;
}
