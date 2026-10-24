import { ConflictException, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskEmail } from '../../infrastructure/mail/mail.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
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
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensure(this.config.get<BootstrapAdminConfig>('bootstrapAdmin'));
    await this.warnUnverifiedPlatformAdmins(this.config.get<string[]>('platform.adminEmails') ?? []);
  }

  /**
   * A7: un correo de `PLATFORM_ADMIN_EMAILS` sin cuenta verificada no da acceso a la consola de plataforma (quien lo
   * registre primero no se la apropia). Se avisa en cada arranque para que el operador cree o verifique la cuenta.
   * Devuelve los correos sin cuenta verificada.
   */
  async warnUnverifiedPlatformAdmins(emails: string[]): Promise<string[]> {
    if (!emails.length) return [];
    const verified = await this.prisma.user.findMany({
      where: { email: { in: emails }, emailVerifiedAt: { not: null } },
      select: { email: true },
    });
    const ok = new Set(verified.map((u) => u.email));
    const missing = emails.filter((e) => !ok.has(e));
    for (const email of missing) {
      this.logger.warn(
        `PLATFORM_ADMIN_EMAILS: ${maskEmail(email)} no tiene una cuenta con el correo verificado; no podrá entrar a ` +
          'la consola de plataforma hasta que la cuenta exista y verifique su correo',
      );
    }
    return missing;
  }

  /** Devuelve true si creó el usuario. */
  async ensure(cfg: BootstrapAdminConfig | undefined): Promise<boolean> {
    if (!cfg?.email || !cfg.password) return false;
    if (cfg.password.length < 12) {
      this.logger.error('BOOTSTRAP_ADMIN_PASSWORD debe tener al menos 12 caracteres; no se creó el usuario maestro');
      return false;
    }
    try {
      // El correo del usuario maestro lo fija el operador de la plataforma: nace verificado.
      await this.auth.createAccount(
        { email: cfg.email, password: cfg.password, name: cfg.name, workspaceName: cfg.workspaceName },
        { verified: true },
      );
      this.logger.log(`Usuario maestro creado (${cfg.email}) como OWNER del workspace "${cfg.workspaceName}"`);
      return true;
    } catch (err) {
      if (err instanceof ConflictException || (err as { code?: string }).code === 'P2002') return false;
      throw err;
    }
  }
}
