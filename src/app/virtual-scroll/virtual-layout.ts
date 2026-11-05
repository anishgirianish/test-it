import { SizeSource } from './virtual-sizes';

/**
 * Pure math for the virtual scroller. Sizes come from a `SizeSource`
 * (see `VirtualSizeCache`), so rows may all share one height or each have
 * their own; the layout does not care.
 */
export interface VirtualLayoutInput {
  sizes: SizeSource;
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
  /** First index that is at least partly visible. */
  first: number;
  /** Where the content block should sit relative to the viewport top (≤ 0). */
  offset: number;
  /** Height the sizer must have so the scrollbar is right. */
  sizerHeight: number;
  /** Virtual px per DOM px. 1 unless the list is taller than `maxDomHeight`. */
  scale: number;
  /** Scroll position in virtual (content) pixels. */
  virtualTop: number;
}

export function computeVirtualLayout(i: VirtualLayoutInput): VirtualLayout {
  const sizes = i.sizes;
  const count = sizes.count;
  const headerSize = Math.max(0, i.headerSize);
  const bodyView = Math.max(0, i.viewportHeight - headerSize);

  const virtualTotal = sizes.total();
  const domTotal = Math.min(virtualTotal, Math.max(bodyView, i.maxDomHeight));
  const maxDomScroll = Math.max(0, domTotal - bodyView);
  const maxVirtualScroll = Math.max(0, virtualTotal - bodyView);
  const scale = maxDomScroll > 0 ? maxVirtualScroll / maxDomScroll : 1;

  const domTop = Math.min(Math.max(0, i.scrollTop), maxDomScroll);
  const virtualTop = domTop * scale;
  const buffer = Math.max(0, i.buffer);

  if (count === 0) {
    return { start: 0, end: 0, first: 0, offset: 0, sizerHeight: headerSize + domTotal, scale, virtualTop };
  }

  const first = sizes.indexAt(virtualTop);
  const lastVisible = sizes.indexAt(virtualTop + bodyView);
  const start = Math.max(0, first - buffer);
  const end = Math.min(count, lastVisible + 1 + buffer);
  const offset = sizes.offset(start) - virtualTop;

  return { start, end, first, offset, sizerHeight: headerSize + domTotal, scale, virtualTop };
}

export type ScrollAlign = 'start' | 'center' | 'end';

export interface ScrollToIndexOptions {
  /** Where the item should end up in the body area. Default `'start'`. */
  align?: ScrollAlign;
  /** Extra virtual pixels added after alignment (e.g. to clear a sticky group row). */
  offset?: number;
}

/** Virtual (content) pixel position that shows item `index` as requested. */
export function virtualTopForIndex(
  sizes: SizeSource,
  index: number,
  bodyView: number,
  options: ScrollToIndexOptions = {},
): number {
  const i = Math.max(0, Math.min(index, sizes.count - 1));
  let top = sizes.offset(i) + (options.offset ?? 0);
  const align = options.align ?? 'start';
  if (align === 'center') top -= (bodyView - sizes.size(i)) / 2;
  else if (align === 'end') top -= bodyView - sizes.size(i);
  const max = Math.max(0, sizes.total() - bodyView);
  return Math.min(Math.max(0, top), max);
}

/** DOM scrollTop for a virtual pixel position. */
export function scrollTopForVirtual(virtualTop: number, scale: number): number {
  return virtualTop / scale;
}
