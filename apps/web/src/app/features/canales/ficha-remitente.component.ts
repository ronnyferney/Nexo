import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService, errorMessage } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import type { ContactoPerfil, OrganizacionPerfil } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';

/**
 * Ficha de contacto/organización del remitente de un correo (ADR 0018 Inc.4). Resuelve, a partir de la dirección de
 * correo, el perfil de la PERSONA (`/profiles/contactos/por-correo`) y de su ORGANIZACIÓN
 * (`/profiles/organizaciones/por-dominio`, con el dominio del correo). La ficha es CONTEXTO informativo: NO concede
 * permisos ni autoriza efectos. Si aún no existe perfil, ofrece un estado vacío con la acción opcional de registrarlo
 * usando el CRUD existente (solo con permiso de edición). Cuida los estados de carga, vacío y error.
 */
@Component({
  selector: 'nx-ficha-remitente',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, LoadingStateComponent, ErrorStateComponent, RelativeTimePipe],
  template: `
    <aside class="ficha card" aria-label="Ficha del contacto">
      <header class="ficha-head">
        <nx-icon name="user" [size]="16" />
        <h3>Ficha del contacto</h3>
      </header>
      <p class="correo" [title]="correo()"><nx-icon name="mail" [size]="13" />{{ correo() }}</p>
      <p class="aviso" role="note">Contexto informativo. No concede permisos ni autoriza acciones.</p>

      @if (loading()) {
        <nx-loading-state text="Resolviendo el perfil…" size="sm" />
      } @else if (error()) {
        <nx-error-state message="{{ error() }}" (retry)="load()" />
      } @else {
        <!-- Persona -->
        <section class="bloque">
          <h4><nx-icon name="user" [size]="14" />Persona</h4>
          @if (contacto(); as c) {
            <p class="nombre">{{ c.nombre }}</p>
            <dl class="datos">
              @if (c.idioma) {
                <div><dt>Idioma</dt><dd>{{ c.idioma }}</dd></div>
              }
              @if (c.tono) {
                <div><dt>Tono</dt><dd>{{ c.tono }}</dd></div>
              }
              <div><dt>Interacciones</dt><dd>{{ c.interaccionesCount }}</dd></div>
              <div>
                <dt>Última interacción</dt>
                <dd>{{ c.ultimaInteraccionEn ? (c.ultimaInteraccionEn | ago) : 'Sin registro' }}</dd>
              </div>
            </dl>
            @if (senales(c).length) {
              <div class="senales">
                <span class="senales-t">Señales</span>
                <ul>
                  @for (s of senales(c); track s) {
                    <li><span class="badge info">{{ s }}</span></li>
                  }
                </ul>
              </div>
            }
          } @else {
            <div class="vacio">
              <p class="muted">Aún no hay perfil de esta persona.</p>
              @if (canEdit()) {
                <button type="button" class="btn sm" [disabled]="creando() === 'contacto'" (click)="registrarContacto()">
                  <nx-icon name="plus" [size]="13" />Registrar contacto
                </button>
              }
            </div>
          }
        </section>

        <!-- Organización -->
        <section class="bloque">
          <h4><nx-icon name="building" [size]="14" />Organización</h4>
          @if (organizacion(); as o) {
            <p class="nombre">{{ o.nombre }}</p>
            <dl class="datos">
              @if (o.dominio) {
                <div><dt>Dominio</dt><dd>{{ o.dominio }}</dd></div>
              }
              @if (o.tipoSector) {
                <div><dt>Tipo / sector</dt><dd>{{ o.tipoSector }}</dd></div>
              }
              <div><dt>Contactos</dt><dd>{{ contactosCount(o) }}</dd></div>
            </dl>
          } @else {
            <div class="vacio">
              <p class="muted">
                @if (dominioCorreo()) {
                  Aún no hay perfil de la organización «{{ dominioCorreo() }}».
                } @else {
                  El correo no tiene un dominio reconocible.
                }
              </p>
              @if (canEdit() && dominioCorreo()) {
                <button type="button" class="btn sm" [disabled]="creando() === 'org'" (click)="registrarOrganizacion()">
                  <nx-icon name="plus" [size]="13" />Registrar organización
                </button>
              }
            </div>
          }
        </section>
      }
    </aside>
  `,
  styles: `
    .ficha { display: flex; flex-direction: column; gap: 12px; }
    .ficha-head { display: flex; align-items: center; gap: 8px; }
    .ficha-head h3 { margin: 0; font-size: 15px; }
    .correo { margin: 0; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; word-break: break-all; }
    .aviso { margin: 0; font-size: 11.5px; color: var(--muted); }
    .bloque { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px; }
    .bloque h4 { margin: 0; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
    .nombre { margin: 0; font-weight: 650; font-size: 14px; }
    .datos { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .datos > div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .datos dt { font-size: 11px; color: var(--muted); }
    .datos dd { margin: 0; font-size: 13px; }
    .senales { display: flex; flex-direction: column; gap: 5px; }
    .senales-t { font-size: 11px; color: var(--muted); }
    .senales ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 5px; }
    .vacio { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
    .muted { margin: 0; color: var(--muted); font-size: 12.5px; }
  `,
})
export class FichaRemitenteComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  /** Dirección de correo del remitente a resolver. */
  readonly correo = input.required<string>();
  /** El alta de perfiles solo se ofrece con permiso de edición (el servidor es el gate real). */
  readonly canEdit = input(false);

  protected readonly contacto = signal<ContactoPerfil | null>(null);
  protected readonly organizacion = signal<OrganizacionPerfil | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly creando = signal<'contacto' | 'org' | null>(null);

  /** Dominio derivado del correo (parte tras la `@`), en minúsculas; cadena vacía si no hay. */
  protected readonly dominioCorreo = computed(() => this.correo().trim().toLowerCase().split('@')[1] ?? '');

  constructor() {
    // Recarga la ficha cada vez que cambia el correo del remitente seleccionado.
    effect(() => {
      this.correo();
      void this.load();
    });
  }

  async load() {
    const correo = this.correo().trim().toLowerCase();
    const dominio = this.dominioCorreo();
    this.loading.set(true);
    this.error.set(null);
    this.contacto.set(null);
    this.organizacion.set(null);
    try {
      const [contacto, organizacion] = await Promise.all([
        this.resolver(() => this.api.contactoPorCorreo(correo)),
        dominio ? this.resolver(() => this.api.organizacionPorDominio(dominio)) : Promise.resolve(null),
      ]);
      this.contacto.set(contacto);
      // Se prefiere la organización resuelta por dominio (trae los contactos vinculados); si no, la del contacto.
      this.organizacion.set(organizacion ?? contacto?.organizacion ?? null);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /** Ejecuta una resolución tolerando el 404 (no existe perfil ⇒ `null`); cualquier otro error se propaga. */
  private async resolver<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 404) return null;
      throw e;
    }
  }

  /** Señales como lista de cadenas; defensivo ante formas inesperadas del JSON. */
  protected senales(c: ContactoPerfil): string[] {
    return Array.isArray(c.senales) ? c.senales.filter((s) => typeof s === 'string') : [];
  }

  protected contactosCount(o: OrganizacionPerfil): number {
    return o.contactos?.length ?? 0;
  }

  async registrarContacto() {
    if (!this.canEdit()) return;
    const correo = this.correo().trim().toLowerCase();
    this.creando.set('contacto');
    try {
      await this.api.crearContacto({ nombre: correo, correoPrincipal: correo, fuente: 'correo (buzón)' });
      this.toast.success('Contacto registrado');
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.creando.set(null);
    }
  }

  async registrarOrganizacion() {
    const dominio = this.dominioCorreo();
    if (!this.canEdit() || !dominio) return;
    this.creando.set('org');
    try {
      await this.api.crearOrganizacion({ nombre: dominio, dominio, fuente: 'correo (buzón)' });
      this.toast.success('Organización registrada');
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.creando.set(null);
    }
  }
}
