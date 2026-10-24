import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Correo saliente por SMTP (`SMTP_URL`, `MAIL_FROM`), opcional. Sin configuración, `enabled` es false y la consola
 * muestra los enlaces para entregarlos por un canal propio. Los registros nunca incluyen el cuerpo (lleva enlaces
 * con tokens de un solo uso) ni el destinatario completo.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string | null;

  constructor(config: ConfigService) {
    const mail = config.get<{ smtpUrl: string | null; from: string | null }>('mail');
    this.from = mail?.from ?? null;
    this.transport = mail?.smtpUrl && this.from ? createTransport(mail.smtpUrl) : null;
  }

  get enabled(): boolean {
    return !!this.transport;
  }

  /** Envía un correo de texto. Devuelve false (sin lanzar) si no hay SMTP o el envío falla. */
  async send(message: MailMessage): Promise<boolean> {
    if (!this.transport || !this.from) return false;
    try {
      await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
      return true;
    } catch (err) {
      this.logger.warn(`No se pudo enviar el correo a ${maskEmail(message.to)}: ${(err as Error).message}`);
      return false;
    }
  }

  onModuleDestroy(): void {
    this.transport?.close();
  }
}

/** `ana.gomez@empresa.com` → `a***@empresa.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
