# angular-data-table

A reusable, dependency-free Angular 22 data table built on a native `<table>`.
No Angular CDK, no Material. Standalone, signal-based, zoneless-ready, OnPush.

| Feature | How |
| --- | --- |
| Virtual scrolling | Two directives (`dtVirtualScroll`, `*dtVirtualFor`) usable on any existing table. Fixed row height, DOM rows recycled, scrollbar scaled past ~12M px so millions of rows work in every browser. |
| Sticky header + sticky columns | `position: sticky` on `th`/`td`; column widths are fixed so offsets need no measuring. Pin with `sticky: 'start' \| 'end'`. |
| Dynamic column content | `valueGetter`, `formatter`, `cellClass`, or an `<ng-template dtCell="key">`. Columns are a plain array: add, remove, reorder at runtime. |
| Row grouping | `[groupBy]="['sector','side']"`, multi-level, collapsible, with per-column aggregates (`sum`, `avg`, `min`, `max`, `count`, or a function). |
| Sorting | Click header to cycle asc → desc → off. Shift/Ctrl-click for multi-column. Type-aware compare, nulls last, custom comparators. Server mode via `[clientSort]="false"`. |

## Run the demo

```bash
npm install
npm start          # http://localhost:4200
npm test
```

The demo has two tabs: the data-table component (trade blotter, 1,000,000 rows by default, up to 5M) and a plain hand-written table made virtual with the two directives.

## Usage

```ts
import { DataTableComponent, DataTableCellDef, ColumnDef } from './data-table';

columns: ColumnDef<Trade>[] = [
  { key: 'id', header: '#', type: 'number', width: 90, sticky: 'start' },
  { key: 'symbol', header: 'Symbol', width: 110, sticky: 'start' },
  { key: 'qty', header: 'Qty', type: 'number', aggregate: 'sum' },
  { key: 'price', type: 'number', formatter: (v) => currency.format(v as number), aggregate: 'avg' },
  { key: 'avgCost', header: 'Avg cost', type: 'number', valueGetter: (r) => r.notional / r.qty },
  { key: 'actions', header: '', width: 100, sortable: false, sticky: 'end' },
];
```

```html
<dt-table
  [data]="rows()"
  [columns]="columns"
  [groupBy]="['sector', 'side']"
  [(sort)]="sort"
  [rowHeight]="36"
  [trackBy]="trackById"
  (rowClick)="select($event.row)"
  (renderedRangeChange)="range.set($event)"
  style="height: 600px"
>
  <!-- custom cell; [dtCellOf] only types `let-row` -->
  <ng-template dtCell="symbol" [dtCellOf]="rows()" let-row let-value="value">
    <strong>{{ row.symbol }}</strong>
  </ng-template>

  <!-- custom header -->
  <ng-template dtHeader="pnl" let-column let-sort="sort">{{ column.header }} (USD)</ng-template>

  <!-- group label for one level (omit the key to apply to all levels) -->
  <ng-template dtGroup="sector" let-group let-expanded="expanded">
    {{ group.label }} · {{ group.count }} rows
  </ng-template>
</dt-table>
```

### Inputs

| Input | Default | Notes |
| --- | --- | --- |
| `data` | required | `readonly T[]`. Pass a new array to update. |
| `columns` | required | `ColumnDef<T>[]`. Sticky-start columns are moved first, sticky-end last. |
| `groupBy` | `[]` | Column keys, outermost first. |
| `sort` | `[]` | Two-way bindable `SortState[]`. |
| `multiSort` | `true` | Shift/Ctrl/Cmd-click adds a sort key. |
| `clientSort` | `true` | `false` = emit `sort` only, you order the data. |
| `rowHeight` | `36` | Data row height in px, or a resolver `(row, index) => px` giving each row its own estimate. |
| `groupRowHeight` | `rowHeight` | Group rows can be taller or shorter than data rows. |
| `dynamicRowHeight` | `false` | Measure rendered rows; any row may then be any height (wrapped text, images, detail rows). |
| `detailRowHeight` | `120` | Estimate for a detail row until it is measured. |
| `expanded` | `new Set()` | Two-way bindable set of row keys (from `trackBy`) whose detail row is open. |
| `expandOnRowClick` | `false` | Toggle the detail row when the row is clicked. |
| `headerHeight` | `40` | Pixels. |
| `height` | `'100%'` | CSS height of the host. |
| `buffer` | `16` | Rows rendered above and below the viewport. |
| `collapsedByDefault` | `false` | Initial group state. |
| `striped` | `true` | Zebra rows. |
| `trackBy` | identity | Used when `recycleRows` is false. |
| `recycleRows` | `true` | Reuse DOM rows while scrolling. Disable if cell templates hold per-row state. |
| `emptyMessage` | `'No rows to display'` | |

### Outputs

`rowClick`, `groupToggle`, `rowExpand`, `renderedRangeChange`, `sortChange` and `expandedChange` (from the models).

### Methods

`scrollToIndex(i, { align?: 'start' | 'center' | 'end', offset? })`, `scrollToRow(predicate, options?)`, `scrollToTop()`,
`expandAll()`, `collapseAll()`, `expandToLevel(n)`, `isRowExpanded(row)`, `toggleRowExpanded(row)`, `setRowExpanded(row, bool)`,
`collapseAllRows()`, `viewportElement`.

Column flags that matter for heights: `wrap: true` lets a column's text wrap (needs `dynamicRowHeight`);
`expander: true` renders the expand/collapse caret for detail rows in that column.

### Variable row heights

Every row can have its own height. There are three layers, and you use as many as you need:

1. **Per-type heights, no measuring.** `rowHeight` is a number, `groupRowHeight` another. Rows are exactly that tall.
2. **Height resolver.** `[rowHeight]="(row) => row.notes ? 54 : 36"` gives each row an estimate up front.
   Without `dynamicRowHeight` this *is* the height (`<tr>` gets it as `height`, which for table rows is a minimum).
3. **Measured heights.** `[dynamicRowHeight]="true"`: rendered rows are measured and the estimate is replaced.
   Use it for `wrap: true` columns, detail rows, or cells hosting components whose height you don't know.

```html
<dt-table [data]="rows()" [columns]="columns" [rowHeight]="estimate" [groupRowHeight]="44"
          [dynamicRowHeight]="true" [trackBy]="byId" [(expanded)]="expanded">
  <!-- detail row under an expanded data row; any height, measured -->
  <ng-template dtDetail [dtDetailOf]="rows()" let-row let-index="index">
    <app-trade-details [trade]="row" />
  </ng-template>
</dt-table>
```

```ts
columns: ColumnDef<Trade>[] = [
  { key: 'id', width: 110, sticky: 'start', expander: true },   // caret lives here
  { key: 'notes', width: 260, wrap: true },                     // wraps; row grows
];
estimate = (row: Trade) => (row.notes.length > 120 ? 90 : row.notes.length > 50 ? 54 : 36);
```

How it stays accurate:

- **Height cache.** `VirtualSizeCache` holds an estimate per row (constant or from the resolver) and a
  measured size for every row that has been on screen. Measured wins.
- **Prefix sums.** Offsets are kept in a Fenwick tree: offset lookup, "which row is at pixel y" and a
  single measurement update are all O(log n). 8 bytes per row, allocated only once heights stop being
  uniform; a constant `rowHeight` with no measuring allocates nothing.
- **Measurement.** `*dtVirtualFor` reads each rendered view's height (a view may be a row plus its detail
  row; the heights are summed) synchronously after every scroll, after every render pass, and whenever a
  ResizeObserver reports a row resized (text re-wrapping, images loading, a component expanding).
- **Scroll position correction.** When a measurement changes the height of something above the first
  visible row, the scroll position is moved by the same amount in the same frame, so what you look at
  does not move. At the end of the list the bottom edge is anchored instead. A row expanding below the
  first visible row simply pushes the rest down, as you would expect.
- **Scroll to row.** `scrollToIndex` uses the cache, keeps re-aiming for a few hundred milliseconds while
  the rows around the target are measured for the first time, and supports `align: 'center' | 'end'`.
  The browser rounds `scrollTop` to whole pixels; with a scaled scrollbar (millions of rows) one DOM pixel
  is several content pixels, so the remainder is kept separately and landings are exact anyway.
- **Rebuilds.** When the row list changes (sort, group toggle, expand) measurements carry over for rows
  whose estimate did not change, and the first visible row is anchored across the rebuild.

Expansion state is keyed by `trackBy`, so it survives sorting, grouping and scrolling. The detail
panel is `position: sticky; left: 0` and sized to the viewport, so it stays in view while the table
scrolls horizontally.

### Theming

CSS custom properties on the host: `--dt-bg`, `--dt-border`, `--dt-header-bg`, `--dt-stripe-bg`,
`--dt-hover-bg`, `--dt-group-bg`, `--dt-accent`, `--dt-font`, `--dt-cell-padding`, `--dt-radius`.

## Make any existing table virtual

The scroller is two standalone directives in `src/app/virtual-scroll/`. They do not
depend on the data-table component, and the table keeps owning its own markup and CSS
(sticky header, pinned columns, zebra rows, whatever you already have).

1. Put `dtVirtualScroll` on the element that already scrolls.
2. Replace `@for` / `*ngFor` on the row with `*dtVirtualFor`.
3. Tell it the row height (and the header height if the header scrolls inside the container).

```html
<div class="my-scroller" dtVirtualScroll [itemSize]="32" [headerSize]="36" #vs="dtVirtualScroll">
  <table class="my-table">
    <thead><tr><th class="pin">#</th><th>Name</th></tr></thead>   <!-- your sticky CSS, unchanged -->
    <tbody>
      <tr *dtVirtualFor="let row of rows; let i = index; let odd = odd" [class.odd]="odd">
        <td class="pin">{{ row.id }}</td>
        <td>{{ row.name }}</td>
      </tr>
    </tbody>
  </table>
</div>
<button (click)="vs.scrollToIndex(123456)">Jump</button>
```

Requirement: `position: sticky` cells need `border-collapse: separate` on the table.

Rows of different heights: give `*dtVirtualFor` an estimate per item and let the scroller measure.

```html
<div dtVirtualScroll [itemSize]="32" [measure]="true">
  <table>
    <tbody>
      <tr *dtVirtualFor="let row of rows; itemSize: estimate; trackBy: byId">…</tr>
    </tbody>
  </table>
</div>
```

`dtVirtualScroll` inputs: `itemSize` (default estimate), `headerSize`, `buffer` (16), `measure` (false),
`maxDomHeight` (12M px), `placeholderLine` (colour of the empty-row lines). Output: `rangeChange`.
Exposed via `#vs="dtVirtualScroll"`: `range()`, `scale()`, `totalSize()`, `sizeOf(i)`, `offsetOf(i)`,
`indexAt(px)`, `scrollToIndex(i, { align, offset })`, `scrollToOffset(px)`, `scrollToTop()`, `element`.
If you don't use `*dtVirtualFor`, call `setSource(count, estimateFn)` and feed heights to `applySizes([...])`.

`*dtVirtualFor` inputs: `trackBy` (keyed rows, see below) and `itemSize` (`(item, index) => px`).
Context: `$implicit`, `index` (absolute), `count`, `first`, `last`, `even`, `odd`.
Without `trackBy` DOM rows are recycled by slot, so cell templates must not keep per-row state.

## Third-party components and overlays in cells

**Tooltips, menus, popovers.** Anything rendered to a body-level overlay container (Angular Material,
PrimeNG, ng-bootstrap, CDK overlay, Popper/Floating UI) just works. Overlays rendered *inline* in the
cell work too as long as they use `position: fixed`; the scroll container deliberately has no
`contain`, `transform` or `filter`, because any of those would become the containing block for fixed
elements and trap the overlay inside the scroller. Inline overlays using `position: absolute` will be
clipped by the cell's `overflow: hidden` (needed for text ellipsis); switch them to fixed or to a
body-level container. Overlay libraries close or reposition on scroll by listening to scroll events in
the capture phase, which the scroller does not interfere with.

**Components with internal state** (open/closed, focus, hover, form values, anything you did not write).
By default `*dtVirtualFor` recycles DOM rows by slot, so a component instance would be handed a
different row's data as you scroll and its state would appear on the wrong row. Pass a `trackBy` and
rows become keyed instead: a view belongs to one item while that item is in the window, and is
destroyed when it scrolls out, exactly like `*ngFor`.

```html
<tr *dtVirtualFor="let row of rows; trackBy: byId">
```

In the data-table component this is `[recycleRows]="false"` plus `[trackBy]="byId"`. The cost is
creating DOM for rows entering the window instead of rebinding text, which is still cheap at the
window sizes involved (tens of rows). The demo's "Details" column is a stateful component with a
fixed-position popover; toggle "Recycle rows" in the toolbar to compare both modes.

**Components taller than the row.** Rows are fixed height, so tall content is clipped. Set `rowHeight`
to fit your tallest cell component, or keep the tall content in an overlay as above.

## How the virtual scroller works

`virtual-sizes.ts` is the height cache (Fenwick tree), `virtual-layout.ts` the pure layout math,
`virtual-scroll.directive.ts` the DOM and scroll handling, `virtual-for.directive.ts` the row views and measuring.

1. On first render `dtVirtualScroll` wraps the container's existing children in three divs it creates:
   a sizer (sets the scroll height: `header + total row height`, capped at `maxDomHeight`),
   a zero-height `position: sticky; top: 0` layer pinned to the viewport top, and an absolutely
   positioned content block that holds your table. Your markup is moved, not changed.
2. On scroll the visible index range is derived from `scrollTop`; past the cap a scale factor maps DOM
   pixels to virtual pixels and the wheel is divided by the same factor so it feels normal.
3. The content block is offset by `offset(start) − virtualTop` (a small negative number) so the
   first rendered row lands on the exact pixel the scroll position implies. With uniform rows
   `offset(i)` is `i × itemSize`; otherwise it comes from the height cache. `top` is used instead of
   `transform`, so `position: sticky` on the header and pinned columns keeps working.
4. Because the pinned layer is honoured by the compositor without the main thread, a fast scrollbar
   drag cannot scroll the rendered rows out of view: you see stale rows for a frame, never white.
5. `*dtVirtualFor` keeps one embedded view per slot and only rewrites the context, so scrolling
   rebinds text instead of creating DOM.
6. Change detection runs synchronously inside the scroll handler so the new window is painted in the
   same frame; a repeating gradient on the sizer draws placeholder row lines as a last resort.
7. With `measure` on, the newly rendered rows are measured right after that change detection, still
   before paint, and any correction to the scroll position lands in the same frame.

Sorting and grouping in the data-table component are plain `computed` signals: data → sorted (group
keys first, then user sort) → group tree with aggregates → flattened list honouring collapsed state →
windowed by the directive.
