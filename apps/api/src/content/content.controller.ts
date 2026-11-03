import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { docToJson } from '@jotion/editor/projection';
import {
  contentSearchQuerySchema,
  linkPreviewQuerySchema,
  type PageContentDto,
} from '@jotion/shared';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { parse } from '../common/validation';
import { DocStore } from '../collab/doc-store';
import { PermissionService } from '../permissions/permission.service';
import { DuplicateService } from './duplicate.service';
import { LinkPreviewService } from './link-preview.service';
import { SearchService } from './search.service';

@Controller()
export class ContentController {
  constructor(
    private readonly search: SearchService,
    private readonly preview: LinkPreviewService,
    private readonly duplicates: DuplicateService,
    private readonly perms: PermissionService,
    private readonly store: DocStore,
  ) {}

  @Get('workspaces/:id/search/content')
  contentSearch(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.search.search(u, id, parse(contentSearchQuerySchema, query));
  }

  @Get('workspaces/:id/mention-candidates')
  mentions(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Query('q') q?: string) {
    return this.search.mentionCandidates(u, id, typeof q === 'string' ? q : '');
  }

  @Get('workspaces/:id/link-preview')
  linkPreview(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.preview.preview(u, id, parse(linkPreviewQuerySchema, query).url);
  }

  @Post('pages/:id/duplicate')
  @HttpCode(201)
  duplicate(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.duplicates.duplicate(u, id);
  }

  /** Inhalt als ProseMirror-JSON (Druckansicht). Zählt nicht als Besuch. */
  @Get('pages/:id/content')
  async content(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
  ): Promise<PageContentDto> {
    await this.perms.requirePage(u.id, id, { includeTrashed: true });
    const doc = await this.store.loadDoc(id);
    try {
      return { pageId: id, doc: docToJson(doc) as PageContentDto['doc'] };
    } finally {
      doc.destroy();
    }
  }
}
