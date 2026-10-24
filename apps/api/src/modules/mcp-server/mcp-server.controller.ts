import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { McpServerService } from './mcp-server.service';

/**
 * Endpoint MCP (Streamable HTTP, modo sin estado): /api/mcp
 * Autenticación: `Authorization: Bearer nexo_...` (API key del workspace con alcance `mcp`, B3) o JWT de un EDITOR o
 * superior.
 * Las tools ejecutan flujos y agentes: exige el mismo rol que `POST /workflows/:id/run` (un VIEWER recibe 403).
 */
@ApiTags('mcp')
@ApiBearerAuth()
@MinRole('EDITOR')
@Controller('mcp')
export class McpServerController {
  constructor(private readonly mcp: McpServerService) {}

  @All()
  async handle(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Res() res: Response): Promise<void> {
    if (req.method !== 'POST') {
      res
        .status(405)
        .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Método no permitido (modo sin estado)' }, id: null });
      return;
    }
    const server = await this.mcp.build(auth.workspaceId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
