import { ColumnDef, GROUP_ROW, isGroupRow } from './data-table.types';
import {
  buildComparator,
  buildGroups,
  collectGroupIds,
  defaultCompare,
  flattenGroups,
  formatValue,
  resolveSortSpecs,
} from './data-table.utils';

interface Row {
  id: number;
  team: string;
  city: string | null;
  score: number;
}

const rows: Row[] = [
  { id: 1, team: 'blue', city: 'Boston', score: 10 },
  { id: 2, team: 'red', city: 'Austin', score: 30 },
  { id: 3, team: 'blue', city: null, score: 5 },
  { id: 4, team: 'red', city: 'Austin', score: 20 },
  { id: 5, team: 'green', city: 'Denver', score: 40 },
];

const columns: ColumnDef<Row>[] = [
  { key: 'id', type: 'number' },
  { key: 'team' },
  { key: 'city' },
  { key: 'score', type: 'number', aggregate: 'sum' },
  { key: 'avg', valueGetter: (r) => r.score, aggregate: 'avg' },
  { key: 'n', valueGetter: (r) => r.score, aggregate: 'count' },
  { key: 'custom', aggregate: (rs) => rs.map((r) => r.id).join('+') },
];
const columnMap = new Map(columns.map((c) => [c.key, c]));

describe('defaultCompare', () => {
  it('orders numbers, strings, dates and puts nulls last', () => {
    expect(defaultCompare(1, 2)).toBeLessThan(0);
    expect(defaultCompare('b', 'a')).toBeGreaterThan(0);
    expect(defaultCompare('item10', 'item9')).toBeGreaterThan(0); // numeric collation
    expect(defaultCompare(new Date(2020, 0, 1), new Date(2021, 0, 1))).toBeLessThan(0);
    expect(defaultCompare(null, 0)).toBeGreaterThan(0);
    expect(defaultCompare(0, undefined)).toBeLessThan(0);
  });
});

describe('buildComparator', () => {
  it('returns null when there is nothing to sort by', () => {
    expect(buildComparator([])).toBeNull();
  });

  it('sorts by multiple keys with direction and keeps nulls last on desc', () => {
    const cmp = buildComparator(resolveSortSpecs(columnMap, [], [{ key: 'city', direction: 'desc' }, { key: 'score', direction: 'asc' }], true))!;
    const sorted = rows.slice().sort(cmp).map((r) => r.id);
    expect(sorted).toEqual([5, 1, 4, 2, 3]);
  });

  it('puts grouping keys ahead of the user sort and skips them when clientSort is off', () => {
    const specs = resolveSortSpecs(columnMap, ['team'], [{ key: 'score', direction: 'desc' }], false);
    expect(specs.map((s) => s.column.key)).toEqual(['team']);
    const withSort = resolveSortSpecs(columnMap, ['team'], [{ key: 'score', direction: 'desc' }, { key: 'team', direction: 'desc' }], true);
    expect(withSort.map((s) => `${s.column.key}:${s.direction}`)).toEqual(['team:desc', 'score:desc']);
  });
});

describe('buildGroups / flattenGroups', () => {
  const groupCols = [columnMap.get('team')!, columnMap.get('city')!];
  const sorted = rows.slice().sort(buildComparator(resolveSortSpecs(columnMap, ['team', 'city'], [], true))!);
  const tree = buildGroups(sorted, groupCols, columns);

  it('builds a two-level tree with aggregates', () => {
    expect(tree.map((g) => g.label)).toEqual(['blue', 'green', 'red']);
    const blue = tree[0];
    expect(blue.count).toBe(2);
    expect(blue.aggregates['score']).toBe(15);
    expect(blue.aggregates['avg']).toBe(7.5);
    expect(blue.aggregates['n']).toBe(2);
    expect(blue.aggregates['custom']).toBe('1+3');
    expect(blue.children!.map((g) => g.label)).toEqual(['Boston', '(blank)']);
    expect(isGroupRow(blue)).toBe(true);
    expect(blue[GROUP_ROW]).toBe(true);
  });

  it('flattens expanded groups and skips collapsed subtrees', () => {
    const all = flattenGroups(tree, sorted, () => true);
    expect(all.length).toBe(3 + 4 + rows.length); // 3 teams, 4 cities, 5 rows
    const collapsedBlue = flattenGroups(tree, sorted, (id) => !id.startsWith('/team=blue'));
    expect(collapsedBlue.length).toBe(all.length - 2 - 2);
    expect(isGroupRow(collapsedBlue[0])).toBe(true);
    expect(isGroupRow(collapsedBlue[1])).toBe(true);
    expect(collectGroupIds(tree)).toHaveLength(7);
  });
});

describe('formatValue', () => {
  it('uses type-aware defaults and custom formatters', () => {
    expect(formatValue(1234.5, { key: 'x', type: 'number' }, null)).toBe(new Intl.NumberFormat().format(1234.5));
    expect(formatValue(true, { key: 'x', type: 'boolean' }, null)).toBe('Yes');
    expect(formatValue(null, { key: 'x' }, null)).toBe('');
    expect(formatValue(3, { key: 'x', formatter: (v) => `#${v}` }, null)).toBe('#3');
  });
});
