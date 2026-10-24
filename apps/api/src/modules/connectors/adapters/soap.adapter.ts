import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { HttpClientService } from '../../../common/http/http-client.service';
import { render, renderXml } from '../../../common/template/template.engine';
import type { ConnectorAdapter } from '../domain/connector-adapter';
import type {
  ConnectorRuntime,
  DiscoveredOperation,
  InvocationResult,
  OperationRuntime,
  SoapConfig,
  SoapOperationDef,
  TestResult,
} from '../domain/connector.types';
import { AuthResolverService } from './auth-resolver.service';

const ENVELOPE_NS = {
  '1.1': 'http://schemas.xmlsoap.org/soap/envelope/',
  '1.2': 'http://www.w3.org/2003/05/soap-envelope',
};

/** Nodo de un documento XML convertido por `fast-xml-parser` (atributos con prefijo `@_`). */
type XmlNode = Record<string, unknown>;

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: true });

/** Web services SOAP 1.1 / 1.2 con importación de operaciones desde WSDL. */
@Injectable()
export class SoapAdapter implements ConnectorAdapter {
  readonly type = 'SOAP' as const;

  constructor(
    private readonly http: HttpClientService,
    private readonly authResolver: AuthResolverService,
  ) {}

  async invoke(
    connector: ConnectorRuntime,
    operation: OperationRuntime,
    input: Record<string, unknown>,
  ): Promise<InvocationResult> {
    const ctx = { input, secrets: connector.secrets };
    const config = render<SoapConfig>(connector.config, { secrets: connector.secrets });
    const def = operation.definition as unknown as SoapOperationDef;
    const version = config.soapVersion ?? '1.1';
    const header = config.headerTemplate ? `<soap:Header>${renderXml(config.headerTemplate, ctx)}</soap:Header>` : '';
    const envelope =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<soap:Envelope xmlns:soap="${ENVELOPE_NS[version]}">${header}` +
      `<soap:Body>${renderXml(def.bodyTemplate, ctx)}</soap:Body></soap:Envelope>`;

    const auth = await this.authResolver.resolve(connector);
    const headers: Record<string, string> = { ...config.headers, ...auth.headers };
    if (version === '1.2') {
      headers['content-type'] = `application/soap+xml; charset=utf-8; action="${def.action}"`;
    } else {
      headers['content-type'] = 'text/xml; charset=utf-8';
      headers['soapaction'] = `"${def.action}"`;
    }

    const res = await this.http.request({ url: config.endpoint, method: 'POST', headers, body: envelope });
    const parsed = parser.parse(res.rawBody || '<empty/>') as XmlNode | undefined;
    const body = ((parsed?.Envelope as XmlNode | undefined)?.Body as XmlNode | undefined) ?? parsed;
    const fault = body?.Fault;
    return {
      ok: res.ok && !fault,
      status: res.status,
      data: fault ? { fault } : body,
      durationMs: res.durationMs,
    };
  }

  async test(connector: ConnectorRuntime): Promise<TestResult> {
    const config = render<SoapConfig>(connector.config, { secrets: connector.secrets });
    const url = config.wsdlUrl ?? config.endpoint;
    const res = await this.http.request({ url, method: 'GET' });
    return { ok: res.status < 500, message: `HTTP ${res.status} en ${res.durationMs} ms (${url})` };
  }

  async discover(connector: ConnectorRuntime): Promise<DiscoveredOperation[]> {
    const config = render<SoapConfig>(connector.config, { secrets: connector.secrets });
    if (!config.wsdlUrl) throw new Error('Configure "wsdlUrl" para descubrir operaciones');
    const res = await this.http.request({ url: config.wsdlUrl });
    return wsdlToOperations(res.rawBody);
  }
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Extrae operaciones y soapAction de los bindings de un WSDL 1.1. */
export function wsdlToOperations(wsdlXml: string): DiscoveredOperation[] {
  const doc = parser.parse(wsdlXml) as XmlNode | undefined;
  const defs = doc?.definitions as XmlNode | undefined;
  if (!defs) throw new Error('WSDL inválido: no se encontró <definitions>');
  const ns = (defs['@_targetNamespace'] as string | undefined) ?? '';
  const seen = new Set<string>();
  const ops: DiscoveredOperation[] = [];
  for (const binding of asArray(defs.binding as XmlNode | XmlNode[] | undefined)) {
    for (const op of asArray<Record<string, unknown>>(binding.operation as never)) {
      const name = String(op['@_name']);
      if (seen.has(name)) continue;
      seen.add(name);
      const soapOp = (op.operation ?? {}) as Record<string, string>;
      ops.push({
        key: name.replace(/[^a-zA-Z0-9_]/g, '_'),
        name,
        description: `Operación SOAP ${name}`,
        inputSchema: { type: 'object', properties: {}, additionalProperties: true },
        definition: {
          action: soapOp['@_soapAction'] ?? `${ns}${ns.endsWith('/') ? '' : '/'}${name}`,
          bodyTemplate: `<tns:${name} xmlns:tns="${ns}"><!-- <tns:Param>{{ input.param }}</tns:Param> --></tns:${name}>`,
        },
      });
    }
  }
  return ops;
}
