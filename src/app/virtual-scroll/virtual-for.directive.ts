import { Directive, effect, EmbeddedViewRef, inject, input, TemplateRef, untracked, ViewContainerRef } from '@angular/core';
import { DtVirtualScroll } from './virtual-scroll.directive';

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

  private readonly scroller = inject(DtVirtualScroll);
  private readonly vcr = inject(ViewContainerRef);
  private readonly template = inject<TemplateRef<DtVirtualForContext<T>>>(TemplateRef);

  /** Views by key; only used in `trackBy` mode. */
  private keyed = new Map<unknown, EmbeddedViewRef<DtVirtualForContext<T>>>();

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
    const next = new Map<unknown, EmbeddedViewRef<DtVirtualForContext<T>> | null>();

    // Keys wanted, in order. Duplicate keys get a fresh view rather than sharing one.
    const wanted: unknown[] = [];
    for (let index = start; index < end; index++) {
      let key = trackBy(index, items[index]);
      if (next.has(key)) key = { duplicate: key, index };
      next.set(key, previous.get(key) ?? null);
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
        view = vcr.createEmbeddedView(this.template, ctx, { index: slot });
      }
      placed.set(key, view);
    }
    while (vcr.length > wanted.length) vcr.remove(vcr.length - 1);
    this.keyed = placed;
  }
}
