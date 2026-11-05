import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';

/**
 * Stands in for a third-party widget you do not control: it keeps internal
 * state (open/closed) and renders its popover inline with position: fixed,
 * the way many tooltip/menu libraries do.
 */
@Component({
  selector: 'app-info-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="chip" [class.chip--open]="open()" (click)="toggle($event)">
      {{ label() }} <span aria-hidden="true">{{ open() ? '▴' : '▾' }}</span>
    </button>
    @if (open()) {
      <div class="pop" role="tooltip" [style.top.px]="pos().top" [style.left.px]="pos().left" (click)="$event.stopPropagation()">
        <strong>{{ title() }}</strong>
        <div>{{ detail() }}</div>
      </div>
    }
  `,
  styles: `
    :host { display: inline-block; }
    .chip {
      padding: 2px 8px; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff;
      font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
      &:hover, &--open { background: #e0e7ff; border-color: #818cf8; }
    }
    .pop {
      position: fixed; z-index: 1000; min-width: 220px; padding: 8px 10px;
      border-radius: 6px; background: #0f172a; color: #fff; font-size: 12px; line-height: 1.5;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.35); white-space: normal;
    }
  `,
})
export class InfoChip {
  readonly label = input('Details');
  readonly title = input('');
  readonly detail = input('');

  readonly open = signal(false);
  readonly pos = signal({ top: 0, left: 0 });

  constructor() {
    const close = () => this.open.set(false);
    document.addEventListener('scroll', close, true);
    document.addEventListener('click', close);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('click', close);
    });
  }

  toggle(event: MouseEvent): void {
    event.stopPropagation();
    const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.pos.set({ top: r.bottom + 4, left: r.left });
    this.open.update((v) => !v);
  }
}
