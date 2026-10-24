import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { ConnectorsService } from './connectors.service';
import {
  CreateConnectorDto,
  CreateOperationDto,
  DiscoverConnectorDto,
  InvokeOperationDto,
  SetAllowedSecretsDto,
  UpdateConnectorDto,
  UpdateOperationDto,
} from './dto/connector.dto';

@ApiTags('connectors')
@ApiBearerAuth()
@Controller('connectors')
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.connectors.list(a.workspaceId);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.connectors.detail(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateConnectorDto) {
    return this.connectors.create(a, dto);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateConnectorDto) {
    return this.connectors.update(a, id, dto);
  }

  /** Secretos de la bóveda que el conector puede resolver (A4): solo un ADMIN los fija. */
  @MinRole('ADMIN')
  @Put(':id/allowed-secrets')
  setAllowedSecrets(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SetAllowedSecretsDto) {
    return this.connectors.setAllowedSecrets(a.workspaceId, id, dto.names);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.connectors.remove(a.workspaceId, id);
  }

  // Provoca llamadas salientes con las credenciales del conector: no basta con poder leerlo.
  @MinRole('EDITOR')
  @HttpCode(200)
  @Post(':id/test')
  test(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.connectors.test(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post(':id/discover')
  discover(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: DiscoverConnectorDto) {
    return this.connectors.discover(a.workspaceId, id, dto);
  }

  @Get(':id/schema')
  schema(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.connectors.schema(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post(':id/operations')
  createOp(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateOperationDto) {
    return this.connectors.createOperation(a, id, dto);
  }

  @MinRole('EDITOR')
  @Patch(':id/operations/:opId')
  updateOp(
    @CurrentAuth() a: AuthContext,
    @Param('id') id: string,
    @Param('opId') opId: string,
    @Body() dto: UpdateOperationDto,
  ) {
    return this.connectors.updateOperation(a, id, opId, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id/operations/:opId')
  removeOp(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('opId') opId: string) {
    return this.connectors.removeOperation(a.workspaceId, id, opId);
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post(':id/operations/:opId/invoke')
  invoke(@CurrentAuth() a: AuthContext, @Param('opId') opId: string, @Body() dto: InvokeOperationDto) {
    return this.connectors.invokeById(a.workspaceId, opId, dto.input ?? {});
  }
}
