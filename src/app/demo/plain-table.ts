import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { DtVirtualFor, DtVirtualScroll, VirtualRange } from '../virtual-scroll';

interface Person {
  id: number;
  name: string;
  email: string;
  city: string;
  score: number;
}

const FIRST = ['Ada', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Alan', 'Frances'];
const LAST = ['Lovelace', 'Hopper', 'Torvalds', 'Hamilton', 'Ritchie', 'Liskov', 'Thompson', 'Perlman', 'Turing', 'Allen'];
const CITY = ['Boston', 'Austin', 'Denver', 'Seattle', 'Chicago', 'Miami', 'Portland', 'Atlanta'];

/**
 * A completely ordinary scrolling <table>, made virtual by adding two attributes:
 * `dtVirtualScroll` on the existing scroll container and `*dtVirtualFor` on the
 * existing <tr>. Markup and CSS (sticky header, pinned column) are untouched.
 */
@Component({
  selector: 'app-plain-table-demo',
  imports: [DtVirtualScroll, DtVirtualFor, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="hint">
      Plain scrolling <code>&lt;table&gt;</code> with its own CSS, {{ people().length | number }} rows.
      Only two attributes were added: <code>dtVirtualScroll</code> on the existing scroll div and
      <code>*dtVirtualFor</code> on the existing <code>&lt;tr&gt;</code>.
      Rendering {{ range().start | number }}–{{ range().end | number }}.
      <button type="button" (click)="vs.scrollToIndex(123456)">Jump to 123,456</button>
    </p>

    <div class="plain-viewport" dtVirtualScroll [itemSize]="32" [headerSize]="36" #vs="dtVirtualScroll" (rangeChange)="range.set($event)">
      <table class="plain">
        <thead>
          <tr>
            <th class="pin">#</th>
            <th>Name</th>
            <th>Email</th>
            <th>City</th>
            <th class="num">Score</th>
          </tr>
        </thead>
        <tbody>
          <tr *dtVirtualFor="let p of people(); let odd = odd" [class.odd]="odd">
            <td class="pin">{{ p.id }}</td>
            <td>{{ p.name }}</td>
            <td>{{ p.email }}</td>
            <td>{{ p.city }}</td>
            <td class="num">{{ p.score }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; min-height: 0; height: 100%; }
    .hint { margin: 0; color: #475569; font-size: 13px; }
    .hint button { margin-left: 8px; }
    .plain-viewport { flex: 1; min-height: 0; overflow: auto; border: 1px solid #cbd5e1; background: #fff; }
    table.plain { border-collapse: separate; border-spacing: 0; width: 1100px; table-layout: fixed; font: 13px system-ui, sans-serif; }
    th, td { padding: 0 10px; height: 32px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid #e2e8f0; background: #fff; }
    th { height: 36px; position: sticky; top: 0; z-index: 2; background: #0f172a; color: #fff; text-align: left; }
    .pin { position: sticky; left: 0; z-index: 1; width: 90px; box-shadow: 1px 0 0 #cbd5e1; }
    th.pin { z-index: 3; }
    tr.odd td { background: #f8fafc; }
    .num { text-align: right; width: 80px; }
    tr:hover td { background: #fef9c3; }
  `,
})
export class PlainTableDemo {
  readonly range = signal<VirtualRange>({ start: 0, end: 0, total: 0 });
  readonly count = signal(300_000);

  readonly people = computed<Person[]>(() => {
    const n = this.count();
    const out: Person[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const first = FIRST[i % FIRST.length];
      const last = LAST[(i * 7) % LAST.length];
      out[i] = {
        id: i + 1,
        name: `${first} ${last}`,
        email: `${first}.${last}${i}@example.com`.toLowerCase(),
        city: CITY[(i * 13) % CITY.length],
        score: (i * 37) % 1000,
      };
    }
    return out;
  });
}
