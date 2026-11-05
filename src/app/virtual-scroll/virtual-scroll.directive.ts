import {
  afterNextRender,
  ChangeDetectorRef,
  computed,
  DestroyRef,
  Directive,
  effect,
  ElementRef,
  EmbeddedViewRef,
  inject,
  input,
  output,
  Renderer2,
  signal,
  TemplateRef,
  untracked,
  ViewContainerRef,
} from '@angular/core';
import { computeVirtualLayout, scrollTopForIndex, VirtualLayout } from './virtual-layout';

export interface VirtualRange {
  start: number;
  end: number;
  total: number;
}

/** Chrome caps element heights at ~33.5M px, Firefox at ~17.9M px. */
const DEFAULT_MAX_DOM_HEIGHT = 12_000_000;

/**
 * Turns an existing scroll container into a fixed-row-height virtual scroller.
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
  /** Height of one row in px. Every row must use it. */
  readonly itemSize = input(36);
  /** Height of the sticky header inside the table (0 if none). */
  readonly headerSize = input(0);
  /** Rows rendered above and below the visible window. */
  readonly buffer = input(16);
  readonly maxDomHeight = input(DEFAULT_MAX_DOM_HEIGHT);
  /** Colour of placeholder row lines shown where rows have not been painted yet. */
  readonly placeholderLine = input('rgba(0, 0, 0, 0.08)');

  readonly rangeChange = output<VirtualRange>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Set by `dtVirtualFor`. You only set it yourself when not using that directive. */
  readonly count = signal(0);
  readonly scrollTop = signal(0);
  readonly viewportHeight = signal(0);
  readonly contentWidth = signal(0);

  private sizer: HTMLElement | null = null;
  private content: HTMLElement | null = null;

  readonly layout = computed<VirtualLayout>(() =>
    computeVirtualLayout({
      count: this.count(),
      itemSize: this.itemSize(),
      headerSize: this.headerSize(),
      viewportHeight: this.viewportHeight(),
      scrollTop: this.scrollTop(),
      buffer: this.buffer(),
      maxDomHeight: this.maxDomHeight(),
    }),
  );

  /** Rendered index window. */
  readonly range = computed<VirtualRange>(() => {
    const { start, end } = this.layout();
    return { start, end, total: this.count() };
  });

  /** Virtual px per DOM px; > 1 only for very long lists. */
  readonly scale = computed(() => this.layout().scale);

  constructor() {
    afterNextRender(() => this.attach());

    effect(() => {
      const range = this.range();
      untracked(() => this.rangeChange.emit(range));
    });

    // Push geometry to the wrapper elements we created.
    effect(() => {
      const { sizerHeight, offset } = this.layout();
      const width = this.contentWidth();
      const sizer = this.sizer;
      const content = this.content;
      if (!sizer || !content) return;
      untracked(() => {
        sizer.style.height = `${sizerHeight}px`;
        sizer.style.width = width ? `${width}px` : '';
        content.style.top = `${offset}px`;
      });
    });
  }

  get element(): HTMLElement {
    return this.host.nativeElement;
  }

  /** Scroll so that item `index` is at the top of the body area. */
  scrollToIndex(index: number): void {
    const clamped = Math.max(0, Math.min(index, this.count() - 1));
    this.element.scrollTop = scrollTopForIndex(clamped, this.itemSize(), this.layout().scale);
  }

  scrollToTop(): void {
    this.element.scrollTop = 0;
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
      this.scrollTop.set(el.scrollTop);
      this.cdr.detectChanges();
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
 */
@Directive({ selector: '[dtVirtualFor][dtVirtualForOf]' })
export class DtVirtualFor<T> {
  readonly items = input.required<readonly T[]>({ alias: 'dtVirtualForOf' });
  readonly trackBy = input<DtVirtualForTrackBy<T> | undefined>(undefined, { alias: 'dtVirtualForTrackBy' });

  /** Views by key; only used in `trackBy` mode. */
  private keyed = new Map<unknown, EmbeddedViewRef<DtVirtualForContext<T>>>();

  private readonly scroller = inject(DtVirtualScroll);
  private readonly vcr = inject(ViewContainerRef);
  private readonly template = inject<TemplateRef<DtVirtualForContext<T>>>(TemplateRef);

  constructor() {
    effect(() => this.scroller.count.set(this.items().length));

    effect(() => {
      const items = this.items();
      const { start, end } = this.scroller.layout();
      const trackBy = this.trackBy();
      untracked(() => (trackBy ? this.renderKeyed(items, start, end, trackBy) : this.renderSlots(items, start, end)));
    });
  }

  static ngTemplateContextGuard<T>(_dir: DtVirtualFor<T>, ctx: unknown): ctx is DtVirtualForContext<T> {
    return true;
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
    const next = new Map<unknown, EmbeddedViewRef<DtVirtualForContext<T>>>();

    // Keys wanted, in order. Duplicate keys get a fresh view rather than sharing one.
    const wanted: unknown[] = [];
    for (let index = start; index < end; index++) {
      let key = trackBy(index, items[index]);
      if (next.has(key)) key = { duplicate: key, index };
      next.set(key, previous.get(key) ?? null!);
      wanted.push(key);
    }

    // Drop views whose item left the window.
    for (const [key, view] of previous) {
      if (!next.has(key)) {
        const at = vcr.indexOf(view);
        if (at !== -1) vcr.remove(at);
        else view.destroy();
      }
    }

    // Place or create, in window order.
    for (let slot = 0; slot < wanted.length; slot++) {
      const key = wanted[slot];
      const ctx = this.context(items, start + slot);
      let view = next.get(key);
      if (view) {
        if (vcr.indexOf(view) !== slot) vcr.move(view, slot);
        Object.assign(view.context, ctx);
        view.markForCheck();
      } else {
        view = vcr.createEmbeddedView(this.template, ctx, { index: slot });
        next.set(key, view);
      }
    }
    while (vcr.length > wanted.length) vcr.remove(vcr.length - 1);
    this.keyed = next;
  }
}
