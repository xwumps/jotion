import { Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { notFound } from './errors';

const uuidSchema = z.uuid();

/** Prüft UUID-Pfadparameter (alle Versionen inkl. v7). Ungültige IDs gelten als "nicht gefunden". */
@Injectable()
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!uuidSchema.safeParse(value).success) throw notFound();
    return value.toLowerCase();
  }
}

export const UUID = new UuidPipe();
