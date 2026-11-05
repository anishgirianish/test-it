import {
  AggregateKind,
  ColumnDef,
  GROUP_ROW,
  GroupRow,
  SortDirection,
  SortState,
  TableRow,
} from './data-table.types';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const numberFormat = new Intl.NumberFormat();
const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' });

export function getValue<T>(row: T, column: ColumnDef<T>): unknown {
  if (column.valueGetter) return column.valueGetter(row);
  return (row as Record<string, unknown> | null | undefined)?.[column.key];
}

/** Type-aware compare. `null`/`undefined` always sort last regardless of direction. */
export function defaultCompare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'boolean' && typeof b === 'boolean') return a ? 1 : -1;
  if (typeof a === 'string' && typeof b === 'string') return collator.compare(a, b);
  return collator.compare(String(a), String(b));
}

export interface SortSpec<T> {
  column: ColumnDef<T>;
  direction: SortDirection;
}

/**
 * Builds one comparator for a chain of sort specs. Returns null when there is
 * nothing to sort by so callers can skip the copy.
 */
export function buildComparator<T>(specs: readonly SortSpec<T>[]): ((a: T, b: T) => number) | null {
  if (!specs.length) return null;
  const entries = specs.map(({ column, direction }) => ({
    column,
    sign: direction === 'desc' ? -1 : 1,
    cmp: column.comparator,
  }));
  return (a, b) => {
    for (const { column, sign, cmp } of entries) {
      const va = getValue(a, column);
      const vb = getValue(b, column);
      let result: number;
      if (cmp) {
        result = cmp(va, vb, a, b) * sign;
      } else if (va == null || vb == null) {
        // nulls last in both directions
        result = va == null && vb == null ? 0 : va == null ? 1 : -1;
      } else {
        result = defaultCompare(va, vb) * sign;
      }
      if (result !== 0) return result;
    }
    return 0;
  };
}

/** Sort specs = grouping columns first (so groups are contiguous), then the user's sort. */
export function resolveSortSpecs<T>(
  columns: ReadonlyMap<string, ColumnDef<T>>,
  groupBy: readonly string[],
  sort: readonly SortState[],
  applyUserSort: boolean,
): SortSpec<T>[] {
  const specs: SortSpec<T>[] = [];
  const seen = new Set<string>();
  for (const key of groupBy) {
    const column = columns.get(key);
    if (!column || seen.has(key)) continue;
    seen.add(key);
    const userSort = sort.find((s) => s.key === key);
    specs.push({ column, direction: userSort?.direction ?? 'asc' });
  }
  if (applyUserSort) {
    for (const s of sort) {
      const column = columns.get(s.key);
      if (!column || seen.has(s.key)) continue;
      seen.add(s.key);
      specs.push({ column, direction: s.direction });
    }
  }
  return specs;
}

export function formatValue<T>(value: unknown, column: ColumnDef<T>, row: T | null): string {
  if (column.formatter) return column.formatter(value, row);
  if (value == null) return '';
  if (value instanceof Date) return dateFormat.format(value);
  switch (column.type) {
    case 'number':
      return typeof value === 'number' ? numberFormat.format(value) : String(value);
    case 'date': {
      const d = value instanceof Date ? value : new Date(value as string | number);
      return isNaN(d.getTime()) ? String(value) : dateFormat.format(d);
    }
    case 'boolean':
      return value ? 'Yes' : 'No';
    default:
      return typeof value === 'number' ? numberFormat.format(value) : String(value);
  }
}

function sameGroupValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return false;
}

function groupLabel<T>(value: unknown, column: ColumnDef<T>): string {
  if (value == null || value === '') return '(blank)';
  return formatValue(value, column, null);
}

function aggregateRange<T>(
  sorted: readonly T[],
  start: number,
  end: number,
  column: ColumnDef<T>,
  kind: AggregateKind,
): unknown {
  if (kind === 'count') return end - start;
  let sum = 0;
  let n = 0;
  let min: number | undefined;
  let max: number | undefined;
  for (let i = start; i < end; i++) {
    const v = getValue(sorted[i], column);
    const num = typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Number(v);
    if (v == null || Number.isNaN(num)) continue;
    n++;
    sum += num;
    if (min === undefined || num < min) min = num;
    if (max === undefined || num > max) max = num;
  }
  switch (kind) {
    case 'sum':
      return sum;
    case 'avg':
      return n ? sum / n : null;
    case 'min':
      return min ?? null;
    case 'max':
      return max ?? null;
  }
}

export function computeAggregates<T>(
  sorted: readonly T[],
  start: number,
  end: number,
  columns: readonly ColumnDef<T>[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let slice: T[] | null = null;
  for (const column of columns) {
    const agg = column.aggregate;
    if (!agg) continue;
    if (typeof agg === 'function') {
      slice ??= sorted.slice(start, end);
      out[column.key] = agg(slice);
    } else {
      out[column.key] = aggregateRange(sorted, start, end, column, agg);
    }
  }
  return out;
}

/**
 * Builds the group tree from data that is already sorted by the grouping
 * columns. One linear pass per level: equal adjacent values form a group.
 */
export function buildGroups<T>(
  sorted: readonly T[],
  groupColumns: readonly ColumnDef<T>[],
  allColumns: readonly ColumnDef<T>[],
  level = 0,
  start = 0,
  end = sorted.length,
  parentId = '',
): GroupRow<T>[] {
  const column = groupColumns[level];
  const out: GroupRow<T>[] = [];
  let i = start;
  while (i < end) {
    const value = getValue(sorted[i], column);
    let j = i + 1;
    while (j < end && sameGroupValue(getValue(sorted[j], column), value)) j++;
    const id = `${parentId}/${column.key}=${String(value)}`;
    out.push({
      [GROUP_ROW]: true,
      id,
      key: column.key,
      value,
      label: groupLabel(value, column),
      level,
      start: i,
      end: j,
      count: j - i,
      children:
        level + 1 < groupColumns.length
          ? buildGroups(sorted, groupColumns, allColumns, level + 1, i, j, id)
          : null,
      aggregates: computeAggregates(sorted, i, j, allColumns),
    });
    i = j;
  }
  return out;
}

/** Flattens the tree into the render list, skipping collapsed subtrees. */
export function flattenGroups<T>(
  nodes: readonly GroupRow<T>[],
  sorted: readonly T[],
  isExpanded: (id: string) => boolean,
  out: TableRow<T>[] = [],
): TableRow<T>[] {
  for (const node of nodes) {
    out.push(node);
    if (!isExpanded(node.id)) continue;
    if (node.children) {
      flattenGroups(node.children, sorted, isExpanded, out);
    } else {
      for (let k = node.start; k < node.end; k++) out.push(sorted[k]);
    }
  }
  return out;
}

export function collectGroupIds<T>(nodes: readonly GroupRow<T>[], out: string[] = []): string[] {
  for (const node of nodes) {
    out.push(node.id);
    if (node.children) collectGroupIds(node.children, out);
  }
  return out;
}
