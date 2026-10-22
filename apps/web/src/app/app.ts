import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastService } from './core/toast.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <div class="toasts">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast {{ t.kind }}" (click)="toast.dismiss(t.id)">{{ t.text }}</div>
      }
    </div>
  `,
  styles: `
    .toasts { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 1000; max-width: 420px; }
    .toast { padding: 12px 16px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); cursor: pointer; border-left: 4px solid var(--info); }
    .toast.success { border-left-color: var(--success); }
    .toast.error { border-left-color: var(--danger); }
  `,
})
export class App {
  protected readonly toast = inject(ToastService);
}
