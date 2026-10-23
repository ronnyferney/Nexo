import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import {
  CreateDocumentDto,
  CreateKnowledgeBaseDto,
  SearchKnowledgeDto,
  UpdateKnowledgeBaseDto,
  UploadDocumentDto,
} from './dto/knowledge.dto';
import { KnowledgeService, MAX_FILE_BYTES } from './knowledge.service';

@ApiTags('knowledge')
@ApiBearerAuth()
@Controller('knowledge-bases')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.knowledge.list(a.workspaceId);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateKnowledgeBaseDto) {
    return this.knowledge.create(a.workspaceId, dto);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.knowledge.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateKnowledgeBaseDto) {
    return this.knowledge.update(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.knowledge.remove(a.workspaceId, id);
  }

  @Get(':id/documents')
  documents(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.knowledge.documents(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post(':id/documents')
  addDocument(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateDocumentDto) {
    return this.knowledge.addDocument(a.workspaceId, id, dto);
  }

  /** Multipart: campo `file` (.txt .md .csv .json .html, máx. 5 MB) y `title` opcional. */
  @MinRole('EDITOR')
  @Post(':id/documents/upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' }, title: { type: 'string' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  upload(
    @CurrentAuth() a: AuthContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.knowledge.upload(a.workspaceId, id, file, dto.title);
  }

  @MinRole('EDITOR')
  @Delete(':id/documents/:docId')
  removeDocument(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('docId') docId: string) {
    return this.knowledge.removeDocument(a.workspaceId, id, docId);
  }

  @HttpCode(200)
  @Post(':id/search')
  async search(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SearchKnowledgeDto) {
    await this.knowledge.get(a.workspaceId, id);
    return this.knowledge.search(a.workspaceId, [id], dto.query, dto.limit);
  }
}
