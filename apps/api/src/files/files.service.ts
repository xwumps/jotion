import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { MAX_IMAGE_UPLOAD_BYTES, type FileDto } from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import sharp, { type FormatEnum, type Metadata } from 'sharp';
import type { Readable } from 'node:stream';
import { SERVER_ENV } from '../config/config.module';
import { AppError, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../permissions/permission.service';
import { LocalStorageDriver, type StorageDriver } from './storage';

const IMAGE_FORMATS: Partial<Record<keyof FormatEnum, { mime: string; ext: string }>> = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
  gif: { mime: 'image/gif', ext: 'gif' },
};
const MAX_PIXELS = 40_000_000;

@Injectable()
export class FilesService {
  readonly storage: StorageDriver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    @Inject(SERVER_ENV) env: ServerEnv,
  ) {
    this.storage = new LocalStorageDriver(env.JOTION_FILES_DIR);
  }

  /**
   * Bild-Upload: Format wird am Inhalt erkannt (nicht an Endung oder Content-Type),
   * dann neu kodiert. Das entfernt Metadaten (EXIF, GPS) und eingebettete Fremddaten.
   */
  async uploadImage(
    user: AuthUser,
    workspaceId: string,
    data: Buffer,
    originalName?: string,
  ): Promise<FileDto> {
    await this.perms.requireMember(user.id, workspaceId);
    if (data.length > MAX_IMAGE_UPLOAD_BYTES)
      throw new AppError('payload_too_large', 'Bild ist größer als 10 MB');

    let meta: Metadata;
    try {
      meta = await sharp(data, { limitInputPixels: MAX_PIXELS }).metadata();
    } catch {
      throw new AppError('unsupported_media_type', 'Keine gültige Bilddatei');
    }
    const format = meta.format as keyof FormatEnum | undefined;
    const fmt = format ? IMAGE_FORMATS[format] : undefined;
    if (!fmt || !format)
      throw new AppError('unsupported_media_type', 'Erlaubt sind JPEG, PNG, WebP und GIF');

    const animated = format === 'gif' || format === 'webp';
    const { data: clean, info } = await sharp(data, { limitInputPixels: MAX_PIXELS, animated })
      .rotate() // EXIF-Orientierung anwenden, bevor Metadaten entfallen
      .toFormat(format)
      .toBuffer({ resolveWithObject: true });

    const file = await this.prisma.client.$transaction(async (tx) => {
      const f = await tx.file.create({
        data: {
          workspaceId,
          storageKey: `pending-${crypto.randomUUID()}`,
          mime: fmt.mime,
          size: clean.length,
          sha256: createHash('sha256').update(clean).digest('hex'),
          width: info.width,
          height: info.pageHeight ?? info.height,
          originalName: originalName?.slice(0, 255) ?? null,
          uploadedById: user.id,
        },
      });
      const storageKey = `${workspaceId}/${f.id}.${fmt.ext}`;
      await this.storage.put(storageKey, clean);
      return tx.file.update({ where: { id: f.id }, data: { storageKey } });
    });
    return toDto(file);
  }

  async open(
    user: AuthUser,
    fileId: string,
  ): Promise<{ stream: Readable; mime: string; size: number }> {
    const file = await this.prisma.client.file.findUnique({ where: { id: fileId } });
    if (!file) throw notFound('Datei');
    await this.perms.requireMember(user.id, file.workspaceId).catch(() => {
      throw notFound('Datei');
    });
    return { stream: await this.storage.get(file.storageKey), mime: file.mime, size: file.size };
  }
}

function toDto(f: {
  id: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}): FileDto {
  return {
    id: f.id,
    mime: f.mime,
    size: f.size,
    width: f.width,
    height: f.height,
    url: `/api/files/${f.id}`,
  };
}
