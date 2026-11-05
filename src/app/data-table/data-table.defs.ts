import { Directive, inject, input, TemplateRef } from '@angular/core';
import { CellContext, DetailContext, GroupContext, HeaderContext } from './data-table.types';

/**
 * Custom cell content for a column:
 *   <ng-template dtCell="price" let-row let-value="value" let-column="column">
 *
 * Bind `[dtCellOf]="rows"` to give `let-row` the element type of `rows`
 * inside the template (purely for type-checking, no runtime effect).
 */
@Directive({ selector: 'ng-template[dtCell]' })
export class DataTableCellDef<T = unknown> {
  readonly key = input.required<string>({ alias: 'dtCell' });
  readonly of = input<readonly T[] | undefined>(undefined, { alias: 'dtCellOf' });
  readonly template = inject<TemplateRef<CellContext<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(_dir: DataTableCellDef<T>, ctx: unknown): ctx is CellContext<T> {
    return true;
  }
}

/**
 * Custom header content for a column:
 *   <ng-template dtHeader="price" let-column let-sort="sort">
 */
@Directive({ selector: 'ng-template[dtHeader]' })
export class DataTableHeaderDef<T = unknown> {
  readonly key = input.required<string>({ alias: 'dtHeader' });
  readonly template = inject<TemplateRef<HeaderContext<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(_dir: DataTableHeaderDef<T>, ctx: unknown): ctx is HeaderContext<T> {
    return true;
  }
}

/**
 * Custom label for group rows. Pass a column key to target one grouping
 * level, or leave empty to apply to every group:
 *   <ng-template dtGroup let-group let-expanded="expanded">
 *   <ng-template dtGroup="sector" let-group>
 */
@Directive({ selector: 'ng-template[dtGroup]' })
export class DataTableGroupDef<T = unknown> {
  readonly key = input<string>('', { alias: 'dtGroup' });
  /** Type-only helper, see `dtCellOf`. */
  readonly of = input<readonly T[] | undefined>(undefined, { alias: 'dtGroupOf' });
  readonly template = inject<TemplateRef<GroupContext<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(_dir: DataTableGroupDef<T>, ctx: unknown): ctx is GroupContext<T> {
    return true;
  }
}

/**
 * Content of the detail row shown under an expanded data row. Its height is
 * free: the table measures it. Expansion is keyed by `trackBy`, so it survives
 * sorting, grouping and scrolling.
 *   <ng-template dtDetail [dtDetailOf]="rows" let-row let-index="index">
 */
@Directive({ selector: 'ng-template[dtDetail]' })
export class DataTableDetailDef<T = unknown> {
  /** Type-only helper, see `dtCellOf`. */
  readonly of = input<readonly T[] | undefined>(undefined, { alias: 'dtDetailOf' });
  readonly template = inject<TemplateRef<DetailContext<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(_dir: DataTableDetailDef<T>, ctx: unknown): ctx is DetailContext<T> {
    return true;
  }
}
