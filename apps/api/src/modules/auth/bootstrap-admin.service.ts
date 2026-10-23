import { ConflictException, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

interface BootstrapAdminConfig {
  email: string | null;
  password: string | null;
  name: string;
  workspaceName: string;
}

/**
 * Usuario maestro del primer arranque: si `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD` están definidos y el
 * usuario no existe, lo crea como OWNER de un workspace inicial. Si ya existe no hace nada (nunca cambia su
 * contraseña), así que es seguro en cada arranque y con varias réplicas. La contraseña llega desde Secrets Manager.
 */
@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapAdminService.name);

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensure(this.config.get<BootstrapAdminConfig>('bootstrapAdmin'));
  }

  /** Devuelve true si creó el usuario. */
  async ensure(cfg: BootstrapAdminConfig | undefined): Promise<boolean> {
    if (!cfg?.email || !cfg.password) return false;
    if (cfg.password.length < 12) {
      this.logger.error('BOOTSTRAP_ADMIN_PASSWORD debe tener al menos 12 caracteres; no se creó el usuario maestro');
      return false;
    }
    try {
      await this.auth.register({
        email: cfg.email,
        password: cfg.password,
        name: cfg.name,
        workspaceName: cfg.workspaceName,
      });
      this.logger.log(`Usuario maestro creado (${cfg.email}) como OWNER del workspace "${cfg.workspaceName}"`);
      return true;
    } catch (err) {
      if (err instanceof ConflictException || (err as { code?: string }).code === 'P2002') return false;
      throw err;
    }
  }
}
