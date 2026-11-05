import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  effect,
  input,
  linkedSignal,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DtVirtualFor, DtVirtualScroll } from '../virtual-scroll';
import { DataTableCellDef, DataTableGroupDef, DataTableHeaderDef } from './data-table.defs';
import {
  CellTemplate,
  ColumnDef,
  GroupRow,
  GroupTemplate,
  GroupToggleEvent,
  HeaderTemplate,
  isGroupRow,
  RenderedRange,
  RowClickEvent,
  SortState,
  TableRow,
} from './data-table.types';
import {
  buildComparator,
  buildGroups,
  collectGroupIds,
  flattenGroups,
  formatValue,
  getValue,
  resolveSortSpecs,
} from './data-table.utils';

const DEFAULT_COLUMN_WIDTH = 160;

interface ColumnMeta<T> {
  column: ColumnDef<T>;
  width: number;
  left: number | null;
  right: number | null;
  cellClass: string;
  headerClass: string;
  sortable: boolean;
}

@Component({
  selector: 'dt-table',
  imports: [NgTemplateOutlet, DtVirtualScroll, DtVirtualFor],
  templateUrl: './data-table.component.html',
  styleUrl: './data-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.height]': 'height()',
  },
})
export class DataTableComponent<T> {
  // ---------------------------------------------------------------- inputs
  readonly data = input.required<readonly T[]>();
  readonly columns = input.required<readonly ColumnDef<T>[]>();
  /** Keys of columns to group by, outermost first. */
  readonly groupBy = input<readonly string[]>([]);
  /** Two-way bindable. Emits on header clicks even when `clientSort` is off. */
  readonly sort = model<SortState[]>([]);
  readonly multiSort = input(true);
  /** Set to false for server-side sorting: the table emits `sort` but leaves data order alone. */
  readonly clientSort = input(true);
  readonly rowHeight = input(36);
  readonly headerHeight = input(40);
  /** CSS height of the component. The viewport fills it. */
  readonly height = input('100%');
  /** Extra rows rendered above and below the viewport. */
  readonly buffer = input(16);
  readonly collapsedByDefault = input(false);
  readonly indent = input(20);
  readonly striped = input(true);
  readonly trackBy = input<(row: T) => unknown>();
  /**
   * Reuse DOM rows while scrolling (fastest). Turn off when cells host
   * components with internal state (tooltips, menus, inputs, third-party
   * widgets): rows are then keyed by `trackBy` and travel with their data.
   */
  readonly recycleRows = input(true);
  readonly emptyMessage = input('No rows to display');

  // --------------------------------------------------------------- outputs
  readonly rowClick = output<RowClickEvent<T>>();
  readonly groupToggle = output<GroupToggleEvent<T>>();
  readonly renderedRangeChange = output<RenderedRange>();

  // --------------------------------------------------------------- content
  private readonly cellDefs = contentChildren(DataTableCellDef<T>);
  private readonly headerDefs = contentChildren(DataTableHeaderDef<T>);
  private readonly groupDefs = contentChildren(DataTableGroupDef<T>);

  private readonly cellTemplates = computed(
    () => new Map<string, CellTemplate<T>>(this.cellDefs().map((d) => [d.key(), d.template])),
  );
  private readonly headerTemplates = computed(
    () => new Map<string, HeaderTemplate<T>>(this.headerDefs().map((d) => [d.key(), d.template])),
  );
  private readonly groupTemplates = computed(
    () => new Map<string, GroupTemplate<T>>(this.groupDefs().map((d) => [d.key(), d.template])),
  );

  // ---------------------------------------------------------- scrolling
  private readonly viewport = viewChild.required(DtVirtualScroll);

  // --------------------------------------------------------- group state
  /** Baseline expansion; flips when expandAll()/collapseAll() are called. */
  private readonly defaultExpanded = linkedSignal(() => !this.collapsedByDefault());
  /** Group ids whose state differs from the baseline. */
  private readonly toggledGroups = signal<ReadonlySet<string>>(new Set());

  // ---------------------------------------------------------- columns
  private readonly columnMap = computed(() => new Map(this.columns().map((c) => [c.key, c])));

  /** Sticky-start columns first, sticky-end last, everything else in given order. */
  readonly columnMeta = computed<ColumnMeta<T>[]>(() => {
    const cols = this.columns();
    const start = cols.filter((c) => c.sticky === 'start');
    const end = cols.filter((c) => c.sticky === 'end');
    const middle = cols.filter((c) => !c.sticky);
    const ordered = [...start, ...middle, ...end];
    const widthOf = (c: ColumnDef<T>) => c.width ?? DEFAULT_COLUMN_WIDTH;

    const lefts = new Map<string, number>();
    let acc = 0;
    for (const c of start) {
      lefts.set(c.key, acc);
      acc += widthOf(c);
    }
    const rights = new Map<string, number>();
    acc = 0;
    for (let i = end.length - 1; i >= 0; i--) {
      rights.set(end[i].key, acc);
      acc += widthOf(end[i]);
    }

    return ordered.map((column, i) => {
      const align = column.align ?? (column.type === 'number' ? 'right' : 'left');
      const classes = [`dt-align-${align}`];
      if (column.sticky === 'start') {
        classes.push('dt-sticky', 'dt-sticky-start');
        if (i === start.length - 1) classes.push('dt-sticky-start-last');
      } else if (column.sticky === 'end') {
        classes.push('dt-sticky', 'dt-sticky-end');
        if (i === ordered.length - end.length) classes.push('dt-sticky-end-first');
      }
      const base = classes.join(' ');
      return {
        column,
        width: widthOf(column),
        left: lefts.get(column.key) ?? null,
        right: rights.get(column.key) ?? null,
        cellClass: typeof column.cellClass === 'string' ? `${base} ${column.cellClass}` : base,
        headerClass: column.headerClass ? `${base} ${column.headerClass}` : base,
        sortable: column.sortable !== false,
      };
    });
  });

  readonly totalWidth = computed(() => this.columnMeta().reduce((w, m) => w + m.width, 0));
  readonly columnCount = computed(() => this.columnMeta().length);

  /**
   * Group rows merge their leading cells into one label cell: all sticky-start
   * columns when there are any (so the label stays pinned), otherwise the
   * leading columns up to the first one that shows an aggregate.
   */
  readonly groupLabelSpan = computed(() => {
    const metas = this.columnMeta();
    const stickyStart = metas.filter((m) => m.column.sticky === 'start').length;
    if (stickyStart > 0) return stickyStart;
    let span = 0;
    while (span < metas.length && !metas[span].column.aggregate) span++;
    return Math.max(1, Math.min(span, metas.length));
  });

  readonly groupLabelMeta = computed<ColumnMeta<T>>(() => {
    const metas = this.columnMeta();
    const span = this.groupLabelSpan();
    const first = metas[0];
    const last = metas[span - 1];
    const sticky = first?.column.sticky === 'start';
    const classes = ['dt-align-left', 'dt-group-label-cell'];
    if (sticky) classes.push('dt-sticky', 'dt-sticky-start');
    if (sticky && last?.column.sticky === 'start' && (metas[span]?.column.sticky !== 'start')) {
      classes.push('dt-sticky-start-last');
    }
    return {
      column: first?.column ?? { key: '' },
      width: metas.slice(0, span).reduce((w, m) => w + m.width, 0),
      left: sticky ? 0 : null,
      right: null,
      cellClass: classes.join(' '),
      headerClass: '',
      sortable: false,
    };
  });

  // ------------------------------------------------------------- pipeline
  private readonly groupColumns = computed(() => {
    const map = this.columnMap();
    return this.groupBy().map((k) => map.get(k)).filter((c): c is ColumnDef<T> => !!c);
  });

  readonly groupDepth = computed(() => this.groupColumns().length);

  /** Data sorted by grouping keys then the active sort. Untouched when nothing to do. */
  private readonly sorted = computed<readonly T[]>(() => {
    const data = this.data();
    const specs = resolveSortSpecs(this.columnMap(), this.groupBy(), this.sort(), this.clientSort());
    const cmp = buildComparator(specs);
    if (!cmp) return data;
    return data.slice().sort(cmp);
  });

  private readonly groupTree = computed<readonly GroupRow<T>[] | null>(() => {
    const groupColumns = this.groupColumns();
    if (!groupColumns.length) return null;
    return buildGroups(this.sorted(), groupColumns, this.columns());
  });

  /** The flat list of rows the virtual scroller pages through. */
  readonly rows = computed<readonly TableRow<T>[]>(() => {
    const tree = this.groupTree();
    const sorted = this.sorted();
    if (!tree) return sorted;
    const toggled = this.toggledGroups();
    const base = this.defaultExpanded();
    return flattenGroups(tree, sorted, (id) => (toggled.has(id) ? !base : base));
  });

  constructor() {
    // A new grouping reshapes the whole list; the old scroll position is meaningless.
    let previousGroupBy: readonly string[] | undefined;
    effect(() => {
      const current = this.groupBy();
      const changed = previousGroupBy !== undefined && previousGroupBy.join('\u0000') !== current.join('\u0000');
      previousGroupBy = current;
      if (changed) untracked(() => this.scrollToTop());
    });
  }

  // ------------------------------------------------------------ public API
  get viewportElement(): HTMLElement {
    return this.viewport().element;
  }

  /** Scrolls so that the row at `index` (in the flattened list) is at the top. */
  scrollToIndex(index: number): void {
    this.viewport().scrollToIndex(index);
  }

  scrollToTop(): void {
    this.viewport().scrollToTop();
  }

  expandAll(): void {
    this.defaultExpanded.set(true);
    this.toggledGroups.set(new Set());
  }

  collapseAll(): void {
    this.defaultExpanded.set(false);
    this.toggledGroups.set(new Set());
  }

  /** Collapse everything except the top `levels` group levels. */
  expandToLevel(levels: number): void {
    const tree = this.groupTree();
    if (!tree) return;
    this.defaultExpanded.set(false);
    const ids: string[] = [];
    const walk = (nodes: readonly GroupRow<T>[]) => {
      for (const node of nodes) {
        if (node.level < levels) {
          ids.push(node.id);
          if (node.children) walk(node.children);
        }
      }
    };
    walk(tree);
    this.toggledGroups.set(new Set(ids));
  }

  isExpanded(group: GroupRow<T>): boolean {
    const base = this.defaultExpanded();
    return this.toggledGroups().has(group.id) ? !base : base;
  }

  toggleGroup(group: GroupRow<T>, event?: Event): void {
    event?.stopPropagation();
    const next = new Set(this.toggledGroups());
    if (next.has(group.id)) next.delete(group.id);
    else next.add(group.id);
    this.toggledGroups.set(next);
    this.groupToggle.emit({ group, expanded: this.isExpanded(group) });
  }

  // ------------------------------------------------------- template helpers
  readonly isGroup = isGroupRow;

  /** `trackBy` handed to `*dtVirtualFor`; undefined means slot recycling. */
  readonly rowTrackBy = computed<((index: number, row: TableRow<T>) => unknown) | undefined>(() => {
    if (this.recycleRows()) return undefined;
    const fn = this.trackBy();
    return (_index, row) => (isGroupRow(row) ? row.id : fn ? fn(row) : row);
  });

  sortFor(key: string): SortState | null {
    return this.sort().find((s) => s.key === key) ?? null;
  }

  sortIndex(key: string): number {
    return this.sort().findIndex((s) => s.key === key);
  }

  ariaSort(meta: ColumnMeta<T>): 'ascending' | 'descending' | 'none' | null {
    if (!meta.sortable) return null;
    const s = this.sortFor(meta.column.key);
    return s ? (s.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  }

  headerTemplate(key: string): HeaderTemplate<T> | null {
    return this.headerTemplates().get(key) ?? null;
  }

  cellTemplate(key: string): CellTemplate<T> | null {
    return this.cellTemplates().get(key) ?? null;
  }

  groupTemplate(key: string): GroupTemplate<T> | null {
    const map = this.groupTemplates();
    return map.get(key) ?? map.get('') ?? null;
  }

  cellValue(row: TableRow<T>, column: ColumnDef<T>): unknown {
    return getValue(row as T, column);
  }

  cellText(value: unknown, column: ColumnDef<T>, row: TableRow<T>): string {
    return formatValue(value, column, row as T);
  }

  cellClasses(meta: ColumnMeta<T>, row: TableRow<T>, value: unknown): string {
    const fn = meta.column.cellClass;
    if (typeof fn !== 'function') return meta.cellClass;
    const extra = fn(row as T, value);
    return extra ? `${meta.cellClass} ${extra}` : meta.cellClass;
  }

  aggregateText(group: GroupRow<T>, column: ColumnDef<T>): string {
    if (!column.aggregate) return '';
    const value = group.aggregates[column.key];
    if (column.aggregate === 'count') return value == null ? '' : String(value);
    return formatValue(value, column, null);
  }

  onHeaderClick(meta: ColumnMeta<T>, event: MouseEvent): void {
    if (!meta.sortable) return;
    const key = meta.column.key;
    const current = this.sort();
    const existing = current.find((s) => s.key === key);
    const nextDirection = !existing ? 'asc' : existing.direction === 'asc' ? 'desc' : null;
    const additive = this.multiSort() && (event.shiftKey || event.ctrlKey || event.metaKey);

    let next: SortState[];
    if (additive) {
      if (!nextDirection) next = current.filter((s) => s.key !== key);
      else if (existing) next = current.map((s) => (s.key === key ? { key, direction: nextDirection } : s));
      else next = [...current, { key, direction: nextDirection }];
    } else {
      next = nextDirection ? [{ key, direction: nextDirection }] : [];
    }
    this.sort.set(next);
  }

  onRowClick(row: TableRow<T>, index: number, event: MouseEvent): void {
    if (isGroupRow(row)) {
      this.toggleGroup(row);
      return;
    }
    this.rowClick.emit({ row, index, event });
  }
}
