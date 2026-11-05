import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal, viewChild } from '@angular/core';
import {
  ColumnDef,
  DataTableCellDef,
  DataTableComponent,
  DataTableGroupDef,
  DataTableHeaderDef,
  RenderedRange,
  RowClickEvent,
  SortState,
} from './data-table';
import { InfoChip } from './demo/info-chip';
import { PlainTableDemo } from './demo/plain-table';
import { generateTrades, Trade } from './demo/trades';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

type GroupKey = 'sector' | 'region' | 'side' | 'status' | 'trader';

@Component({
  selector: 'app-root',
  imports: [DecimalPipe, DataTableComponent, DataTableCellDef, DataTableHeaderDef, DataTableGroupDef, PlainTableDemo, InfoChip],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly table = viewChild.required<DataTableComponent<Trade>>('table');

  readonly view = signal<'blotter' | 'plain'>('blotter');
  readonly rowCountOptions = [100_000, 500_000, 1_000_000, 2_000_000, 5_000_000];
  readonly rowCount = signal(1_000_000);

  private readonly dataset = computed(() => {
    const t0 = performance.now();
    const rows = generateTrades(this.rowCount());
    return { rows, ms: Math.round(performance.now() - t0) };
  });
  readonly data = computed(() => this.dataset().rows);
  readonly generateMs = computed(() => this.dataset().ms);

  readonly trackById = (row: Trade): number => row.id;

  readonly stickyEnabled = signal(true);
  readonly showExtraColumns = signal(false);
  readonly showActions = signal(true);
  readonly striped = signal(true);
  readonly multiSort = signal(true);
  readonly recycleRows = signal(false);
  readonly rowHeight = signal(36);

  readonly groupOptions: GroupKey[] = ['sector', 'region', 'side', 'status', 'trader'];
  readonly groupBy = signal<GroupKey[]>([]);

  readonly sort = signal<SortState[]>([]);
  readonly range = signal<RenderedRange>({ start: 0, end: 0, total: 0 });
  readonly selected = signal<Trade | null>(null);
  readonly scrollTarget = signal(250_000);
  readonly log = signal<string[]>([]);

  readonly columns = computed<ColumnDef<Trade>[]>(() => {
    const sticky = this.stickyEnabled();
    const cols: ColumnDef<Trade>[] = [
      { key: 'id', header: '#', type: 'number', width: 90, sticky: sticky ? 'start' : undefined },
      { key: 'symbol', header: 'Symbol', width: 110, sticky: sticky ? 'start' : undefined },
      { key: 'name', header: 'Name', width: 200 },
      { key: 'sector', header: 'Sector', width: 130 },
      { key: 'region', header: 'Region', width: 110 },
      { key: 'side', header: 'Side', width: 90, align: 'center' },
      { key: 'qty', header: 'Qty', type: 'number', width: 110, aggregate: 'sum' },
      {
        key: 'price',
        header: 'Price',
        type: 'number',
        width: 120,
        formatter: (v) => (typeof v === 'number' ? currency.format(v) : ''),
        aggregate: 'avg',
      },
      {
        key: 'notional',
        header: 'Notional',
        type: 'number',
        width: 140,
        formatter: (v) => (typeof v === 'number' ? currency.format(v) : ''),
        aggregate: 'sum',
      },
      {
        key: 'pnl',
        header: 'P&L',
        type: 'number',
        width: 130,
        aggregate: 'sum',
        formatter: (v) => (typeof v === 'number' ? currency.format(v) : ''),
        cellClass: (_row, v) => (typeof v === 'number' ? (v < 0 ? 'neg' : v > 0 ? 'pos' : null) : null),
      },
      { key: 'status', header: 'Status', width: 120 },
      { key: 'details', header: 'Details', width: 110, sortable: false },
      { key: 'fillPct', header: 'Fill', type: 'number', width: 140, aggregate: 'avg' },
      { key: 'tradeDate', header: 'Trade date', type: 'date', width: 130 },
      { key: 'trader', header: 'Trader', width: 130, aggregate: 'count' },
      { key: 'account', header: 'Account', width: 150 },
    ];

    if (this.showExtraColumns()) {
      cols.push(
        {
          key: 'avgCost',
          header: 'Avg cost / share',
          type: 'number',
          width: 150,
          valueGetter: (r) => (r.qty ? r.notional / r.qty : null),
          formatter: (v) => (typeof v === 'number' ? currency.format(v) : ''),
        },
        {
          key: 'pnlBps',
          header: 'P&L (bps)',
          type: 'number',
          width: 120,
          valueGetter: (r) => (r.notional ? (r.pnl / r.notional) * 10_000 : null),
          formatter: (v) => (typeof v === 'number' ? v.toFixed(1) : ''),
          aggregate: (rows) => {
            let pnl = 0;
            let notional = 0;
            for (const r of rows) {
              pnl += r.pnl;
              notional += r.notional;
            }
            return notional ? (pnl / notional) * 10_000 : null;
          },
        },
        {
          key: 'age',
          header: 'Age (days)',
          type: 'number',
          width: 120,
          valueGetter: (r) => Math.floor((Date.UTC(2026, 10, 4) - r.tradeDate) / 86_400_000),
        },
      );
    }

    if (this.showActions()) {
      cols.push({ key: 'actions', header: '', width: 110, sortable: false, align: 'center', sticky: sticky ? 'end' : undefined });
    }
    return cols;
  });

  readonly sortSummary = computed(() =>
    this.sort().length ? this.sort().map((s) => `${s.key} ${s.direction}`).join(', ') : 'none',
  );

  compact(n: unknown): string {
    return typeof n === 'number' ? compact.format(n) : '';
  }

  toggleGroup(key: GroupKey): void {
    const current = this.groupBy();
    this.groupBy.set(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  }

  setRowCount(value: string): void {
    this.selected.set(null);
    this.rowCount.set(Number(value));
  }

  onRowClick(e: RowClickEvent<Trade>): void {
    this.selected.set(e.row);
  }

  onRange(r: RenderedRange): void {
    this.range.set(r);
  }

  scrollTo(): void {
    this.table().scrollToIndex(this.scrollTarget());
  }

  expandAll(): void {
    this.table().expandAll();
  }

  collapseAll(): void {
    this.table().collapseAll();
  }

  action(kind: string, row: Trade, event: Event): void {
    event.stopPropagation();
    this.log.update((l) => [`${kind} #${row.id} ${row.symbol}`, ...l].slice(0, 5));
  }
}
