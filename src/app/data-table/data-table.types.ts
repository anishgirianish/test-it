import { TemplateRef } from '@angular/core';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

export type ColumnType = 'string' | 'number' | 'date' | 'boolean';
export type ColumnAlign = 'left' | 'center' | 'right';
export type StickyPosition = 'start' | 'end';
export type AggregateKind = 'sum' | 'avg' | 'min' | 'max' | 'count';

/**
 * Describes one column. Columns are plain data so they can be created,
 * reordered, hidden, or replaced at runtime: the table reacts to a new
 * `columns` array.
 */
export interface ColumnDef<T = unknown> {
  /** Unique id. Doubles as the property path when `valueGetter` is omitted. */
  key: string;
  header?: string;
  type?: ColumnType;
  /** Pixel width. Fixed widths let sticky offsets be computed without measuring. */
  width?: number;
  sticky?: StickyPosition;
  /** Defaults to true. */
  sortable?: boolean;
  align?: ColumnAlign;
  /** Computed / derived content. Receives the raw row. */
  valueGetter?: (row: T) => unknown;
  /** Formats a value for the default cell renderer and for aggregates. */
  formatter?: (value: unknown, row: T | null) => string;
  /** Custom ordering. Defaults to a type-aware compare with nulls last. */
  comparator?: (a: unknown, b: unknown, rowA: T, rowB: T) => number;
  /** Shown in group rows for this column. */
  aggregate?: AggregateKind | ((rows: readonly T[]) => unknown);
  cellClass?: string | ((row: T, value: unknown) => string | null | undefined);
  headerClass?: string;
  /**
   * Let cell text wrap onto several lines instead of clipping with an
   * ellipsis. Rows then grow with their content; turn on `dynamicRowHeight`
   * so the table measures them.
   */
  wrap?: boolean;
  /** Render the expand/collapse control for detail rows in this column. */
  expander?: boolean;
}

/**
 * Estimated height of a data row before it is rendered. Return different
 * values for different row kinds (e.g. rows with notes vs without). With
 * `dynamicRowHeight` the estimate is replaced by the measured height once the
 * row has been on screen.
 */
export type RowHeightResolver<T> = (row: T, index: number) => number;

export const GROUP_ROW: unique symbol = Symbol('dt-group-row');

/** A synthetic row inserted above each group of data rows. */
export interface GroupRow<T = unknown> {
  readonly [GROUP_ROW]: true;
  readonly id: string;
  /** Column key the group was built from. */
  readonly key: string;
  readonly value: unknown;
  readonly label: string;
  readonly level: number;
  /** Half-open index range into the sorted data this group covers. */
  readonly start: number;
  readonly end: number;
  readonly count: number;
  readonly children: readonly GroupRow<T>[] | null;
  readonly aggregates: Readonly<Record<string, unknown>>;
}

/** What the table actually renders: user rows interleaved with group rows. */
export type TableRow<T> = T | GroupRow<T>;

export function isGroupRow<T>(row: TableRow<T>): row is GroupRow<T> {
  return typeof row === 'object' && row !== null && (row as Partial<GroupRow<T>>)[GROUP_ROW] === true;
}

export interface CellContext<T> {
  $implicit: T;
  value: unknown;
  column: ColumnDef<T>;
  /** Absolute index within the flattened, sorted, grouped row list. */
  index: number;
  /** Whether this row's detail row is open. */
  expanded: boolean;
}

/** Context of a `dtDetail` template, rendered in an extra row under an expanded data row. */
export interface DetailContext<T> {
  $implicit: T;
  index: number;
}

export interface HeaderContext<T> {
  $implicit: ColumnDef<T>;
  sort: SortState | null;
  sortIndex: number;
}

export interface GroupContext<T> {
  $implicit: GroupRow<T>;
  expanded: boolean;
  column: ColumnDef<T>;
}

export interface RowClickEvent<T> {
  row: T;
  index: number;
  event: MouseEvent;
}

export interface GroupToggleEvent<T> {
  group: GroupRow<T>;
  expanded: boolean;
}

export interface RowExpandEvent<T> {
  row: T;
  expanded: boolean;
}

export type { VirtualRange as RenderedRange } from '../virtual-scroll/virtual-scroll.directive';

export type CellTemplate<T> = TemplateRef<CellContext<T>>;
export type HeaderTemplate<T> = TemplateRef<HeaderContext<T>>;
export type GroupTemplate<T> = TemplateRef<GroupContext<T>>;
export type DetailTemplate<T> = TemplateRef<DetailContext<T>>;
