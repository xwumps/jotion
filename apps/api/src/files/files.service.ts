import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { MAX_IMAGE_UPLOAD_BYTES, type FileDto, type UploadedFileDto } from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import sharp, { type FormatEnum, type Metadata } from 'sharp';
import type { Readable } from 'node:stream';
import { SERVER_ENV } from '../config/config.module';
import { AppError, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../permissions/permission.service';
import { readFile } from 'node:fs/promises';
import { LocalStorageDriver } from './storage';
import { looksLikeRasterImage, sniff } from './sniff';

const IMAGE_FORMATS: Partial<Record<keyof FormatEnum, { mime: string; ext: string }>> = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
  gif: { mime: 'image/gif', ext: 'gif' },
};
const MAX_PIXELS = 40_000_000;

@Injectable()
export class FilesService {
  readonly storage: LocalStorageDriver;
  readonly maxUploadBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    @Inject(SERVER_ENV) env: ServerEnv,
  ) {
    this.storage = new LocalStorageDriver(env.JOTION_FILES_DIR);
    this.maxUploadBytes = env.JOTION_MAX_UPLOAD_MB * 1024 * 1024;
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

  /**
   * Allgemeiner Upload (Phase 3): Bilder werden wie bisher neu kodiert, alles andere am Inhalt
   * (Magic Bytes) erkannt. HTML, SVG und unbekannte Formate werden als Binärdatei gespeichert und
   * nur als Download ausgeliefert.
   */
  async uploadAny(
    user: AuthUser,
    workspaceId: string,
    source: Readable,
    originalName?: string,
  ): Promise<UploadedFileDto> {
    await this.perms.requireMember(user.id, workspaceId);
    let temp: Awaited<ReturnType<LocalStorageDriver['writeTemp']>>;
    try {
      temp = await this.storage.writeTemp(source, this.maxUploadBytes);
    } catch (err) {
      if (/limit|too large/i.test(String((err as Error)?.message)))
        throw new AppError('payload_too_large', 'Datei ist zu groß');
      throw err;
    }
    if (temp.tooLarge || (source as Readable & { truncated?: boolean }).truncated) {
      await this.storage.discardTemp(temp.tmp);
      throw new AppError(
        'payload_too_large',
        `Datei ist größer als ${Math.round(this.maxUploadBytes / 1024 / 1024)} MB`,
      );
    }
    if (temp.size === 0) {
      await this.storage.discardTemp(temp.tmp);
      throw new AppError('bad_request', 'Leere Datei');
    }
    const name = originalName?.slice(0, 255) ?? null;
    if (looksLikeRasterImage(temp.head) && temp.size <= MAX_IMAGE_UPLOAD_BYTES) {
      const data = await readFile(temp.tmp);
      await this.storage.discardTemp(temp.tmp);
      const img = await this.uploadImage(user, workspaceId, data, originalName);
      return { ...img, kind: 'image', name };
    }
    const type = sniff(temp.head, originalName);
    try {
      const file = await this.prisma.client.$transaction(async (tx) => {
        const f = await tx.file.create({
          data: {
            workspaceId,
            storageKey: `pending-${crypto.randomUUID()}`,
            mime: type.mime,
            size: temp.size,
            sha256: temp.sha256,
            originalName: name,
            uploadedById: user.id,
          },
        });
        const storageKey = `${workspaceId}/${f.id}.${type.ext}`;
        await this.storage.adoptTemp(temp.tmp, storageKey);
        return tx.file.update({ where: { id: f.id }, data: { storageKey } });
      });
      return { ...toDto(file), kind: type.kind, name };
    } catch (err) {
      await this.storage.discardTemp(temp.tmp);
      throw err;
    }
  }

  async open(
    user: AuthUser,
    fileId: string,
    range?: { start: number; end: number },
  ): Promise<{ stream: Readable; mime: string; size: number; name: string | null }> {
    const file = await this.prisma.client.file.findUnique({ where: { id: fileId } });
    if (!file) throw notFound('Datei');
    await this.perms.requireMember(user.id, file.workspaceId).catch(() => {
      throw notFound('Datei');
    });
    return {
      stream: await this.storage.get(file.storageKey, range),
      mime: file.mime,
      size: file.size,
      name: file.originalName,
    };
  }

  /** Metadaten ohne Inhalt (für Range-Anfragen) */
  async meta(user: AuthUser, fileId: string): Promise<{ size: number; mime: string }> {
    const file = await this.prisma.client.file.findUnique({ where: { id: fileId } });
    if (!file) throw notFound('Datei');
    await this.perms.requireMember(user.id, file.workspaceId).catch(() => {
      throw notFound('Datei');
    });
    return { size: file.size, mime: file.mime };
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
