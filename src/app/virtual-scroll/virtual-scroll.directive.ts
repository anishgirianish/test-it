import {
  afterNextRender,
  ChangeDetectorRef,
  computed,
  DestroyRef,
  Directive,
  effect,
  ElementRef,
  inject,
  input,
  output,
  Renderer2,
  signal,
  untracked,
} from '@angular/core';
import { computeVirtualLayout, ScrollToIndexOptions, scrollTopForVirtual, VirtualLayout, virtualTopForIndex } from './virtual-layout';
import { SizeResolver, VirtualSizeCache } from './virtual-sizes';

export interface VirtualRange {
  start: number;
  end: number;
  total: number;
}

/** One measured item, as reported by `dtVirtualFor` (or by your own code). */
export interface MeasuredSize {
  index: number;
  size: number;
}

/** Chrome caps element heights at ~33.5M px, Firefox at ~17.9M px. */
const DEFAULT_MAX_DOM_HEIGHT = 12_000_000;
/** How long a scrollToIndex keeps correcting itself as nearby rows get measured. */
const PENDING_SCROLL_MS = 400;

/**
 * Turns an existing scroll container into a virtual scroller.
 * Put it on the element that scrolls; leave the table inside exactly as it is.
 * The table keeps owning its own sticky header / sticky columns CSS.
 *
 *   <div class="my-scroller" dtVirtualScroll [itemSize]="32" [headerSize]="36" #vs="dtVirtualScroll">
 *     <table class="my-table">
 *       <thead>…</thead>
 *       <tbody>
 *         <tr *dtVirtualFor="let row of rows; let i = index">…</tr>
 *       </tbody>
 *     </table>
 *   </div>
 *
 * Row heights
 * -----------
 * `itemSize` is the default estimate. `*dtVirtualFor` can supply a per-item
 * estimate (`itemSize: fn`) for rows of different types, and with `[measure]`
 * on, rendered rows are measured and the estimates refined. Offsets live in a
 * Fenwick tree (`VirtualSizeCache`): O(log n) lookups, O(log n) updates.
 * When a row above the viewport turns out taller or shorter than estimated,
 * the scroll position is corrected in the same frame so what you see does not
 * move.
 *
 * Painting
 * --------
 * On first render the directive wraps the container's children in
 *   sizer (sets the scroll height) › pinned (position: sticky, height 0) › content (absolute, offset)
 * The pinned layer is honoured by the compositor, so even a fast scrollbar
 * drag cannot move the rendered rows out of view; they go stale for a frame,
 * never blank.
 */
@Directive({
  selector: '[dtVirtualScroll]',
  exportAs: 'dtVirtualScroll',
  host: {
    '[style.--dtv-item-size.px]': 'itemSize()',
    '[style.--dtv-header-size.px]': 'headerSize()',
    '[style.--dtv-line]': 'placeholderLine()',
  },
})
export class DtVirtualScroll {
  /** Default (estimated) row height in px. Exact when every row really is this tall. */
  readonly itemSize = input(36);
  /** Height of the sticky header inside the table (0 if none). */
  readonly headerSize = input(0);
  /** Rows rendered above and below the visible window. */
  readonly buffer = input(16);
  readonly maxDomHeight = input(DEFAULT_MAX_DOM_HEIGHT);
  /** Colour of placeholder row lines shown where rows have not been painted yet. */
  readonly placeholderLine = input('rgba(0, 0, 0, 0.08)');
  /**
   * Measure rendered rows and refine the height estimates. Needed for wrapped
   * text, expandable rows, or any content whose height is unknown up front.
   */
  readonly measure = input(false);

  readonly rangeChange = output<VirtualRange>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Item count + per-item estimate. Set by `dtVirtualFor`, or by you via `setSource`. */
  private readonly source = signal<{ count: number; resolver: SizeResolver | null }>({ count: 0, resolver: null });
  /** Bumped whenever a measurement changed the cache. */
  private readonly sizeVersion = signal(0);

  readonly count = computed(() => this.source().count);
  readonly scrollTop = signal(0);
  /** Sub-pixel remainder of the last programmatic scroll, in virtual px. */
  private readonly adjust = signal(0);
  readonly viewportHeight = signal(0);
  readonly viewportWidth = signal(0);
  readonly contentWidth = signal(0);

  private sizer: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private readonly measurers = new Set<() => boolean>();
  /** A scroll request we keep honouring while measurements refine the target. */
  private pendingScroll: { index: number; options: ScrollToIndexOptions; until: number } | null = null;
  private lastProgrammaticTop = -1;
  private lastCache: VirtualSizeCache | null = null;

  /**
   * Height cache: estimates refined by measurements. Rebuilt whenever the
   * item list or the estimate changes; measurements carry over for items
   * whose estimate did not change (same count only).
   */
  readonly sizes = computed(() => {
    const { count, resolver } = this.source();
    const cache = new VirtualSizeCache(count, resolver ?? this.itemSize(), this.lastCache);
    this.lastCache = cache;
    return cache;
  });

  readonly layout = computed<VirtualLayout>(() => {
    this.sizeVersion();
    return computeVirtualLayout({
      sizes: this.sizes(),
      headerSize: this.headerSize(),
      viewportHeight: this.viewportHeight(),
      scrollTop: this.scrollTop(),
      buffer: this.buffer(),
      maxDomHeight: this.maxDomHeight(),
      adjust: this.adjust(),
    });
  });

  /** Rendered index window. */
  readonly range = computed<VirtualRange>(() => {
    const { start, end } = this.layout();
    return { start, end, total: this.count() };
  });

  /** Virtual px per DOM px; > 1 only for very long lists. */
  readonly scale = computed(() => this.layout().scale);

  /** Total content height in virtual px (sum of all row heights). */
  readonly totalSize = computed(() => {
    this.sizeVersion();
    return this.sizes().total();
  });

  constructor() {
    afterNextRender(() => this.attach());

    effect(() => {
      const range = this.range();
      untracked(() => this.rangeChange.emit(range));
    });

    // Push geometry to the wrapper elements we created.
    effect(() => {
      this.layout();
      this.contentWidth();
      untracked(() => this.pushGeometry());
    });
  }

  get element(): HTMLElement {
    return this.host.nativeElement;
  }

  // -------------------------------------------------------------- source

  /**
   * Tell the scroller how many items there are and, optionally, how tall each
   * is estimated to be. `dtVirtualFor` calls this for you.
   */
  setSource(count: number, resolver: SizeResolver | null = null): void {
    // Anchor the first visible item across the rebuild so the view does not move.
    const before = untracked(() => this.layout());
    const oldCache = untracked(() => this.sizes());
    const anchorIndex = before.first;
    const anchorIntra = before.virtualTop - oldCache.offset(anchorIndex);

    this.source.set({ count, resolver });

    if (!this.sizer || count === 0 || anchorIndex >= count || this.pendingScroll) return;
    const cache = untracked(() => this.sizes());
    const after = untracked(() => this.layout());
    const wanted = cache.offset(anchorIndex) + anchorIntra;
    if (Math.abs(wanted - after.virtualTop) >= 0.01) this.setScrollVirtual(wanted, after.scale);
  }

  /** Current size of item `index` (measured if known, otherwise the estimate). */
  sizeOf(index: number): number {
    return this.sizes().size(index);
  }

  /** Top of item `index` in virtual px. */
  offsetOf(index: number): number {
    return this.sizes().offset(index);
  }

  /** Item at a virtual pixel position. */
  indexAt(virtualPx: number): number {
    return this.sizes().indexAt(virtualPx);
  }

  // --------------------------------------------------------- measurement

  /**
   * Registers a function that measures rendered items and feeds them through
   * `applySizes`. Called synchronously after every scroll so corrections land
   * in the same frame. Returns an unregister function.
   */
  registerMeasurer(fn: () => boolean): () => void {
    this.measurers.add(fn);
    return () => this.measurers.delete(fn);
  }

  /**
   * Feeds measured heights into the cache. Returns true when anything changed.
   *
   * Scroll correction: the first visible item is used as an anchor. After the
   * cache is updated the scroll position is moved so that this item keeps its
   * exact on-screen position, whatever changed above it (and whatever the new
   * scrollbar scale is).
   */
  applySizes(entries: ReadonlyArray<MeasuredSize>): boolean {
    const cache = untracked(() => this.sizes());
    const before = untracked(() => this.layout());
    const anchorIndex = before.first;
    const anchorIntra = before.virtualTop - cache.offset(anchorIndex);
    const atBottom = this.isAtBottom(before);

    let changed = false;
    for (const { index, size } of entries) {
      if (cache.setMeasured(index, size) !== 0) changed = true;
    }
    if (!changed) return false;

    this.sizeVersion.update((v) => v + 1);
    const after = untracked(() => this.layout());

    if (this.pendingScroll && performance.now() > this.pendingScroll.until) this.pendingScroll = null;
    if (this.pendingScroll) {
      // A scrollToIndex is still settling: re-aim at the (now better known) target.
      const { index, options } = this.pendingScroll;
      this.setScrollVirtual(this.targetFor(index, options), after.scale);
    } else if (atBottom) {
      // The user is at the end of the list: keep showing the end.
      this.setScrollVirtual(this.maxVirtualTop(), after.scale);
    } else if (anchorIndex < cache.count) {
      const wanted = cache.offset(anchorIndex) + anchorIntra;
      if (Math.abs(wanted - after.virtualTop) >= 0.01) this.setScrollVirtual(wanted, after.scale);
    }
    this.pushGeometry();
    return true;
  }

  /** Whether the scroll position sits at the very end (within one DOM px). */
  private isAtBottom(layout: VirtualLayout): boolean {
    const el = this.element;
    const maxDomScroll = layout.sizerHeight - el.clientHeight;
    return maxDomScroll > 0 && el.scrollTop >= maxDomScroll - 1;
  }

  private maxVirtualTop(): number {
    const bodyView = Math.max(0, untracked(() => this.viewportHeight()) - untracked(() => this.headerSize()));
    return Math.max(0, untracked(() => this.sizes()).total() - bodyView);
  }

  // ----------------------------------------------------------- scrolling

  /** Scroll so that item `index` is at the top of the body area (or aligned as requested). */
  scrollToIndex(index: number, options: ScrollToIndexOptions = {}): void {
    const count = untracked(() => this.count());
    if (count === 0) return;
    const clamped = Math.max(0, Math.min(index, count - 1));
    // Keep re-aiming while the rows around the target are measured for the first time.
    this.pendingScroll = { index: clamped, options, until: performance.now() + PENDING_SCROLL_MS };
    this.setScrollVirtual(this.targetFor(clamped, options), untracked(() => this.layout()).scale);
  }

  /** Scroll to a virtual (content) pixel position. */
  scrollToOffset(virtualPx: number): void {
    this.pendingScroll = null;
    this.setScrollVirtual(Math.max(0, virtualPx), untracked(() => this.layout()).scale);
  }

  scrollToTop(): void {
    this.pendingScroll = null;
    this.setScrollVirtual(0, 1);
  }

  /** Virtual top that shows `index` as requested, given the current cache. */
  private targetFor(index: number, options: ScrollToIndexOptions): number {
    const cache = untracked(() => this.sizes());
    const bodyView = Math.max(0, untracked(() => this.viewportHeight()) - untracked(() => this.headerSize()));
    return virtualTopForIndex(cache, index, bodyView, options);
  }

  /**
   * Programmatic scroll to an exact virtual position. The browser snaps
   * `scrollTop` to whole pixels; the remainder goes into `adjust` so the
   * layout still lands exactly, even with a scaled scrollbar.
   */
  private setScrollVirtual(virtualTop: number, scale: number): void {
    const el = this.element;
    el.scrollTop = scrollTopForVirtual(virtualTop, scale);
    this.lastProgrammaticTop = el.scrollTop;
    this.adjust.set(0);
    this.scrollTop.set(el.scrollTop);
    // Compare against what the layout actually derives (it clamps to its own
    // maximum, which can differ from the browser's by a pixel) and keep the rest.
    const got = untracked(() => this.layout()).virtualTop;
    if (Math.abs(virtualTop - got) >= 0.001) this.adjust.set(virtualTop - got);
  }

  private pushGeometry(): void {
    const sizer = this.sizer;
    const content = this.content;
    if (!sizer || !content) return;
    const { sizerHeight, offset } = untracked(() => this.layout());
    const width = untracked(() => this.contentWidth());
    sizer.style.height = `${sizerHeight}px`;
    sizer.style.width = width ? `${width}px` : '';
    content.style.top = `${offset}px`;
  }

  private runMeasurers(): boolean {
    if (!untracked(() => this.measure())) return false;
    let changed = false;
    for (const fn of this.measurers) if (fn()) changed = true;
    return changed;
  }

  private attach(): void {
    const el = this.element;
    const r = this.renderer;

    // --- wrap existing children: host › sizer › pinned › content › (your table)
    const sizer = r.createElement('div') as HTMLElement;
    sizer.className = 'dtv-sizer';
    Object.assign(sizer.style, {
      position: 'relative',
      minWidth: '100%',
      backgroundImage:
        'repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--dtv-item-size) - 1px),' +
        ' var(--dtv-line) calc(var(--dtv-item-size) - 1px), var(--dtv-line) var(--dtv-item-size))',
      backgroundPosition: '0 var(--dtv-header-size)',
    } satisfies Partial<CSSStyleDeclaration>);

    const pinned = r.createElement('div') as HTMLElement;
    pinned.className = 'dtv-pinned';
    Object.assign(pinned.style, { position: 'sticky', top: '0', height: '0' });

    const content = r.createElement('div') as HTMLElement;
    content.className = 'dtv-content';
    Object.assign(content.style, { position: 'absolute', left: '0', minWidth: '100%', width: 'max-content' });

    while (el.firstChild) content.appendChild(el.firstChild);
    pinned.appendChild(content);
    sizer.appendChild(pinned);
    el.appendChild(sizer);
    this.sizer = sizer;
    this.content = content;

    const computed = getComputedStyle(el);
    if (computed.overflowY === 'visible') el.style.overflowY = 'auto';
    if (computed.position === 'static') el.style.position = 'relative';

    // --- scroll: render the new window in this frame, not after the scheduler
    const onScroll = () => {
      const top = el.scrollTop;
      if (top !== this.lastProgrammaticTop) {
        // The user took over: drop the programmatic sub-pixel remainder and any pending target.
        this.adjust.set(0);
        if (Math.abs(top - this.lastProgrammaticTop) > 1) this.pendingScroll = null;
      }
      this.scrollTop.set(top);
      this.cdr.detectChanges();
      // New rows are in the DOM: measure them now so a correction lands before paint.
      if (this.runMeasurers()) this.cdr.detectChanges();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    this.destroyRef.onDestroy(() => el.removeEventListener('scroll', onScroll));

    // --- wheel: with a scaled scrollbar a native tick would jump `scale` times too far
    const onWheel = (e: WheelEvent) => {
      const scale = untracked(() => this.layout().scale);
      if (scale <= 1 || e.ctrlKey || e.deltaY === 0) return;
      e.preventDefault();
      const px = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * this.itemSize() : e.deltaY;
      el.scrollTop += px / scale;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    this.destroyRef.onDestroy(() => el.removeEventListener('wheel', onWheel));

    // --- sizes
    const measure = () => {
      this.viewportHeight.set(el.clientHeight);
      this.viewportWidth.set(el.clientWidth);
      this.contentWidth.set(content.offsetWidth);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      ro.observe(content);
      this.destroyRef.onDestroy(() => ro.disconnect());
    }
    this.cdr.markForCheck();
  }
}
