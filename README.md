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
| `rowHeight` / `headerHeight` | `36` / `40` | Pixels. All rows share one height. |
| `height` | `'100%'` | CSS height of the host. |
| `buffer` | `16` | Rows rendered above and below the viewport. |
| `collapsedByDefault` | `false` | Initial group state. |
| `striped` | `true` | Zebra rows. |
| `trackBy` | identity | Used when `recycleRows` is false. |
| `recycleRows` | `true` | Reuse DOM rows while scrolling. Disable if cell templates hold per-row state. |
| `emptyMessage` | `'No rows to display'` | |

### Outputs

`rowClick`, `groupToggle`, `renderedRangeChange`, `sortChange` (from the `sort` model).

### Methods

`scrollToIndex(i)`, `scrollToTop()`, `expandAll()`, `collapseAll()`, `expandToLevel(n)`, `viewportElement`.

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

Requirements: every row the same height (`itemSize`), and `position: sticky` cells need
`border-collapse: separate` on the table.

`dtVirtualScroll` inputs: `itemSize`, `headerSize`, `buffer` (16), `maxDomHeight` (12M px),
`placeholderLine` (colour of the empty-row lines). Output: `rangeChange`. Exposed via
`#vs="dtVirtualScroll"`: `range()`, `scale()`, `scrollToIndex(i)`, `scrollToTop()`, `element`.

`*dtVirtualFor` context: `$implicit`, `index` (absolute), `count`, `first`, `last`, `even`, `odd`.
DOM rows are recycled by slot, so cell templates must not keep per-row state.

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

`src/app/virtual-scroll/virtual-layout.ts` holds the pure math; `virtual-scroll.directive.ts` the DOM.

1. On first render `dtVirtualScroll` wraps the container's existing children in three divs it creates:
   a sizer (sets the scroll height: `header + rows × itemSize`, capped at `maxDomHeight`),
   a zero-height `position: sticky; top: 0` layer pinned to the viewport top, and an absolutely
   positioned content block that holds your table. Your markup is moved, not changed.
2. On scroll the visible index range is derived from `scrollTop`; past the cap a scale factor maps DOM
   pixels to virtual pixels and the wheel is divided by the same factor so it feels normal.
3. The content block is offset by `start × itemSize − virtualTop` (a small negative number) so the
   first rendered row lands on the exact pixel the scroll position implies. `top` is used instead of
   `transform`, so `position: sticky` on the header and pinned columns keeps working.
4. Because the pinned layer is honoured by the compositor without the main thread, a fast scrollbar
   drag cannot scroll the rendered rows out of view: you see stale rows for a frame, never white.
5. `*dtVirtualFor` keeps one embedded view per slot and only rewrites the context, so scrolling
   rebinds text instead of creating DOM.
6. Change detection runs synchronously inside the scroll handler so the new window is painted in the
   same frame; a repeating gradient on the sizer draws placeholder row lines as a last resort.

Sorting and grouping in the data-table component are plain `computed` signals: data → sorted (group
keys first, then user sort) → group tree with aggregates → flattened list honouring collapsed state →
windowed by the directive.
