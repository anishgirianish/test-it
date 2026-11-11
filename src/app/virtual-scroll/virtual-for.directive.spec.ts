import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DtVirtualFor } from './virtual-for.directive';
import { DtVirtualScroll } from './virtual-scroll.directive';

interface Item {
  id: number;
  kind: 'group' | 'data';
  account: string;
}

@Component({
  imports: [DtVirtualScroll, DtVirtualFor],
  template: `
    <div dtVirtualScroll [itemSize]="40" #vs="dtVirtualScroll">
      <table>
        <tbody>
          <tr *dtVirtualFor="let item of items(); trackBy: track(); cacheSize: cacheSize(); cacheBy: cacheBy()">
            <td>{{ item.kind }} {{ item.id }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
})
class Host {
  readonly items = signal<Item[]>(
    Array.from({ length: 2000 }, (_, id) => ({ id, kind: id % 50 === 0 ? 'group' : 'data', account: 'A' + Math.floor(id / 500) })),
  );
  readonly track = signal<(index: number, item: Item) => unknown>((_i, item) => item.id);
  readonly cacheSize = signal(0);
  readonly cacheBy = signal<((item: Item) => unknown) | undefined>(undefined);
  readonly vs = viewChild.required<DtVirtualScroll>('vs');
}

describe('DtVirtualFor row reuse', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const rows = (): HTMLElement[] => [...fixture.nativeElement.querySelectorAll('tr')];

  /** Scrolls `count` rows further and reports which DOM rows are new and whether the right items are shown. */
  function scrollRows(count: number): { created: number; kept: number; correct: boolean } {
    const before = new Set(rows());
    const vs = host.vs();
    vs.scrollTop.set(vs.scrollTop() + count * 40);
    fixture.detectChanges();
    const after = rows();
    const { start } = vs.range();
    const items = host.items();
    return {
      created: after.filter((tr) => !before.has(tr)).length,
      kept: after.filter((tr) => before.has(tr)).length,
      correct: after.every((tr, i) => tr.textContent!.trim() === `${items[start + i].kind} ${items[start + i].id}`),
    };
  }

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
    host.vs().viewportHeight.set(400);
    host.vs().scrollTop.set(4000);
    fixture.detectChanges();
  });

  it('creates a row for every item that enters when there is no cache', () => {
    const step = scrollRows(3);
    expect(step.created).toBe(3);
    expect(step.correct).toBe(true);
  });

  it('reuses the views of rows that left when cacheSize is set', () => {
    host.cacheSize.set(20);
    fixture.detectChanges();
    scrollRows(3); // fills the cache with the three rows that left
    const step = scrollRows(3);
    expect(step.created).toBe(0);
    expect(step.correct).toBe(true);
  });

  it('shows the right items after a jump that replaces the whole window', () => {
    host.cacheSize.set(100);
    fixture.detectChanges();
    const count = rows().length;
    const step = scrollRows(500);
    expect(step.correct).toBe(true);
    expect(rows().length).toBe(count);
    // every row that was dropped is available for the rows that came in
    expect(step.created).toBe(0);
  });

  it('never keeps more views than cacheSize', () => {
    host.cacheSize.set(2);
    fixture.detectChanges();
    scrollRows(10); // ten rows leave, two are kept
    const step = scrollRows(10);
    expect(step.created).toBe(8);
    expect(step.correct).toBe(true);
  });

  it('only reuses a view for an item with the same cache key', () => {
    host.cacheSize.set(100);
    host.cacheBy.set((item) => item.kind);
    fixture.detectChanges();
    // Move far enough that group rows (every 50th item) leave and enter, twice.
    scrollRows(60);
    const before = new Map(rows().map((tr) => [tr, tr.textContent!.trim().split(' ')[0]]));
    const step = scrollRows(60);
    expect(step.correct).toBe(true);
    for (const tr of rows()) {
      const kindBefore = before.get(tr);
      if (kindBefore) expect(tr.textContent!.trim().split(' ')[0]).toBe(kindBefore);
    }
  });

  it('still gives duplicate keys their own rows', () => {
    host.track.set((_i, item) => item.account);
    host.cacheSize.set(100);
    fixture.detectChanges();
    const step = scrollRows(3);
    expect(step.correct).toBe(true);
  });
});
