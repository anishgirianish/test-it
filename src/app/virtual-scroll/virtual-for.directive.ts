import {
  afterEveryRender,
  DestroyRef,
  Directive,
  effect,
  EmbeddedViewRef,
  inject,
  input,
  TemplateRef,
  untracked,
  ViewContainerRef,
} from '@angular/core';
import { MeasuredSize, DtVirtualScroll } from './virtual-scroll.directive';

export interface DtVirtualForContext<T> {
  $implicit: T;
  dtVirtualForOf: readonly T[];
  /** Absolute index in the full list. */
  index: number;
  count: number;
  first: boolean;
  last: boolean;
  even: boolean;
  odd: boolean;
}

export type DtVirtualForTrackBy<T> = (index: number, item: T) => unknown;
/** Estimated height of one item in px. Called for every item when the list changes, so keep it cheap. */
export type DtVirtualForItemSize<T> = (item: T, index: number) => number;

/**
 * Drop-in replacement for `*ngFor` / `@for` that renders only the window the
 * enclosing `dtVirtualScroll` asks for:
 *
 *   <tr *dtVirtualFor="let row of rows; let i = index">
 *
 * Without `trackBy`, DOM rows are recycled by slot (like `track $index`): the
 * cheapest option, but a row's component instances are reused for other data
 * as you scroll, so cell content must be stateless.
 *
 * With `trackBy`, a view belongs to one item for as long as that item is in
 * the window, exactly like `*ngFor`. Use this when cells host components you
 * do not control (tooltips, menus, inputs, anything with internal state):
 *
 *   <tr *dtVirtualFor="let row of rows; trackBy: byId">
 *
 * Row heights: `itemSize: fn` gives each item its own estimate (group rows vs
 * data rows, expanded rows, …). When the scroller has `[measure]` on, every
 * rendered item is measured after render and whenever it resizes (wrapped
 * text, images, expanding content), and the scroller's height cache is
 * refined. A view may have several root elements (e.g. a row plus a detail
 * row); their heights are summed.
 *
 *   <ng-container *dtVirtualFor="let row of rows; itemSize: estimateHeight">
 */
@Directive({ selector: '[dtVirtualFor][dtVirtualForOf]' })
export class DtVirtualFor<T> {
  readonly items = input.required<readonly T[]>({ alias: 'dtVirtualForOf' });
  readonly trackBy = input<DtVirtualForTrackBy<T> | undefined>(undefined, { alias: 'dtVirtualForTrackBy' });
  readonly itemSize = input<DtVirtualForItemSize<T> | number | null | undefined>(undefined, {
    alias: 'dtVirtualForItemSize',
  });

  /**
   * `trackBy` mode only: how many views whose item left the window are kept
   * for reuse instead of being destroyed. 0 (default) = destroy them.
   *
   * With a cache, an item entering the window takes a kept view and only gets
   * a new context, so components inside a row are created once and afterwards
   * just receive new inputs. Rows that stay in the window are not touched.
   * Use it when rows contain components that are expensive to create.
   * Components in a reused view keep their internal state, so anything open
   * (a popover, an editor) should close when its inputs change.
   *
   *   <tr *dtVirtualFor="let row of rows; trackBy: byId; cacheSize: 40">
   */
  readonly cacheSize = input(0, { alias: 'dtVirtualForCacheSize' });
  /**
   * A kept view is only reused for an item with the same cache key. Give the
   * row type here when rows of different types have different markup (group
   * rows vs data rows), so a view is never rebuilt inside to fit another type.
   */
  readonly cacheBy = input<((item: T) => unknown) | undefined>(undefined, { alias: 'dtVirtualForCacheBy' });

  private readonly scroller = inject(DtVirtualScroll);
  private readonly vcr = inject(ViewContainerRef);
  private readonly template = inject<TemplateRef<DtVirtualForContext<T>>>(TemplateRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Views by key; only used in `trackBy` mode. */
  private keyed = new Map<unknown, EmbeddedViewRef<DtVirtualForContext<T>>>();
  /** Detached views kept for reuse, by cache key; only used with `cacheSize`. */
  private readonly cache = new Map<unknown, EmbeddedViewRef<DtVirtualForContext<T>>[]>();
  private cached = 0;
  private readonly cacheKeys = new WeakMap<EmbeddedViewRef<DtVirtualForContext<T>>, unknown>();
  private resizeObserver: ResizeObserver | null = null;
  private observed = new Set<Element>();

  constructor() {
    effect(() => {
      const items = this.items();
      const size = this.itemSize();
      const resolver =
        typeof size === 'function' ? (i: number) => size(items[i], i) : typeof size === 'number' ? () => size : null;
      this.scroller.setSource(items.length, resolver);
    });

    effect(() => {
      const items = this.items();
      const { start, end } = this.scroller.layout();
      const trackBy = this.trackBy();
      this.cacheSize();
      this.cacheBy();
      untracked(() => (trackBy ? this.renderKeyed(items, start, end, trackBy) : this.renderSlots(items, start, end)));
    });

    // Measure after every render pass (data changes, expansion, first paint …).
    // Scroll-driven renders are measured synchronously by the scroller itself.
    afterEveryRender({ read: () => this.measure() });
    this.destroyRef.onDestroy(this.scroller.registerMeasurer(() => this.measure()));
    this.destroyRef.onDestroy(() => this.resizeObserver?.disconnect());
    this.destroyRef.onDestroy(() => this.clearCache());
  }

  static ngTemplateContextGuard<T>(_dir: DtVirtualFor<T>, ctx: unknown): ctx is DtVirtualForContext<T> {
    return true;
  }

  /**
   * Reads the height of every rendered item and hands it to the scroller.
   * Returns true when the height cache changed. No-op unless the scroller
   * has `[measure]` on.
   */
  measure(): boolean {
    if (!untracked(() => this.scroller.measure())) return false;
    const vcr = this.vcr;
    const entries: MeasuredSize[] = [];
    const current = new Set<Element>();
    for (let i = 0; i < vcr.length; i++) {
      const view = vcr.get(i) as EmbeddedViewRef<DtVirtualForContext<T>>;
      let size = 0;
      for (const node of view.rootNodes as Node[]) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as Element;
        size += el.getBoundingClientRect().height;
        current.add(el);
      }
      entries.push({ index: view.context.index, size });
    }
    this.observe(current);
    return this.scroller.applySizes(entries);
  }

  /** Keep a ResizeObserver on exactly the elements currently rendered. */
  private observe(current: Set<Element>): void {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = (this.resizeObserver ??= new ResizeObserver(() => this.measure()));
    for (const el of this.observed) if (!current.has(el)) ro.unobserve(el);
    for (const el of current) if (!this.observed.has(el)) ro.observe(el);
    this.observed = current;
  }

  private context(items: readonly T[], index: number): DtVirtualForContext<T> {
    const count = items.length;
    return {
      $implicit: items[index],
      dtVirtualForOf: items,
      index,
      count,
      first: index === 0,
      last: index === count - 1,
      even: index % 2 === 0,
      odd: index % 2 === 1,
    };
  }

  /** Slot mode: view i always shows window item i; only the context changes. */
  private renderSlots(items: readonly T[], start: number, end: number): void {
    if (this.keyed.size) {
      this.vcr.clear();
      this.keyed.clear();
    }
    this.clearCache();
    const needed = Math.max(0, end - start);
    const vcr = this.vcr;
    while (vcr.length > needed) vcr.remove(vcr.length - 1);

    for (let slot = 0; slot < needed; slot++) {
      const ctx = this.context(items, start + slot);
      if (slot < vcr.length) {
        const view = vcr.get(slot) as EmbeddedViewRef<DtVirtualForContext<T>>;
        Object.assign(view.context, ctx);
        view.markForCheck();
      } else {
        vcr.createEmbeddedView(this.template, ctx);
      }
    }
  }

  /** Keyed mode: a view follows its item; items leaving the window are destroyed. */
  private renderKeyed(items: readonly T[], start: number, end: number, trackBy: DtVirtualForTrackBy<T>): void {
    const vcr = this.vcr;
    const previous = this.keyed;
    const next = new Map<unknown, EmbeddedViewRef<DtVirtualForContext<T>> | null>();

    // Keys wanted, in order. Duplicate keys get a fresh view rather than sharing one.
    const wanted: unknown[] = [];
    for (let index = start; index < end; index++) {
      let key = trackBy(index, items[index]);
      if (next.has(key)) key = { duplicate: key, index };
      next.set(key, previous.get(key) ?? null);
      wanted.push(key);
    }

    // Views whose item left the window: keep them for reuse, or destroy them.
    // This runs before placing, so a row entering in this same pass can take
    // the view of a row that is leaving.
    const cacheSize = Math.max(0, this.cacheSize());
    const cacheBy = cacheSize > 0 ? this.cacheBy() : undefined;
    if (cacheSize === 0) this.clearCache();
    for (const [key, view] of previous) {
      if (!next.has(key)) this.release(view, cacheSize);
    }

    // Place, reuse or create, in window order.
    const placed = new Map<unknown, EmbeddedViewRef<DtVirtualForContext<T>>>();
    for (let slot = 0; slot < wanted.length; slot++) {
      const key = wanted[slot];
      const ctx = this.context(items, start + slot);
      let view = next.get(key) ?? null;
      if (view) {
        if (vcr.indexOf(view) !== slot) vcr.move(view, slot);
        Object.assign(view.context, ctx);
        view.markForCheck();
      } else {
        const cacheKey = cacheBy ? cacheBy(items[start + slot]) : undefined;
        view = cacheSize > 0 ? (this.cache.get(cacheKey)?.pop() ?? null) : null;
        if (view) {
          this.cached--;
          Object.assign(view.context, ctx);
          vcr.insert(view, slot);
          view.markForCheck();
        } else {
          view = vcr.createEmbeddedView(this.template, ctx, { index: slot });
          this.cacheKeys.set(view, cacheKey);
        }
      }
      placed.set(key, view);
    }
    while (vcr.length > wanted.length) vcr.remove(vcr.length - 1);
    this.keyed = placed;
  }

  /** Takes a view out of the container: into the cache when there is room, otherwise destroyed. */
  private release(view: EmbeddedViewRef<DtVirtualForContext<T>>, cacheSize: number): void {
    const at = this.vcr.indexOf(view);
    if (at === -1) {
      view.destroy();
    } else if (this.cached < cacheSize) {
      this.vcr.detach(at);
      const cacheKey = this.cacheKeys.get(view);
      const kept = this.cache.get(cacheKey);
      if (kept) kept.push(view);
      else this.cache.set(cacheKey, [view]);
      this.cached++;
    } else {
      this.vcr.remove(at);
    }
  }

  private clearCache(): void {
    if (this.cached === 0) return;
    for (const views of this.cache.values()) for (const view of views) view.destroy();
    this.cache.clear();
    this.cached = 0;
  }
}
