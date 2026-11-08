import { Injectable } from '@nestjs/common';
import { PAGE_TITLE_MAX, type DuplicateResultDto, type PageIcon } from '@jotion/shared';
import { AppError } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { PermissionService } from '../permissions/permission.service';
import { PageCopier } from '../templates/page-copier';

/**
 * Seite duplizieren, samt aller Unterseiten (nicht im Papierkorb), Inhalt und Datenbanken
 * (Schema, Ansichten, Zeilen, Relationen; seit Phase 9 über den PageCopier).
 * Die Kopie liegt direkt hinter dem Original. Rechte: Das Original muss sichtbar, die
 * Elternseite bearbeitbar sein.
 */
@Injectable()
export class DuplicateService {
  constructor(
    private readonly perms: PermissionService,
    private readonly copier: PageCopier,
  ) {}

  async duplicate(user: AuthUser, pageId: string): Promise<DuplicateResultDto> {
    const { page } = await this.perms.requireEditablePage(user.id, pageId);
    if (page.parentId) await this.perms.requireEditablePage(user.id, page.parentId);
    if (page.kind === 'DATABASE_ROW' || page.kind === 'ROW_TEMPLATE')
      throw new AppError('bad_request', 'Zeilen werden in der Datenbank dupliziert');
    const suffix = user.locale === 'en' ? ' (Copy)' : ' (Kopie)';
    const res = await this.copier.copy(
      user,
      page.id,
      {
        workspaceId: page.workspaceId,
        parentId: page.parentId,
        scope: page.scope,
        ownerId: page.scope === 'PRIVATE' ? page.ownerId : user.id,
        afterId: page.id,
      },
      { title: `${page.title}${suffix}`.slice(0, PAGE_TITLE_MAX) },
    );
    return {
      id: res.root.id,
      title: res.root.title,
      icon: (res.root.icon as PageIcon | null) ?? null,
      pages: res.pages,
    };
  }
}
