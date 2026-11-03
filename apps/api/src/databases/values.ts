import { Prisma } from '@jotion/db';
import type { StoredColumns } from '@jotion/query';

/** Typspalten als Prisma-Eingabe für property_values. */
export function storedValueData(
  rowId: string,
  propertyId: string,
  databaseId: string,
  cols: StoredColumns,
): Prisma.PropertyValueCreateManyInput {
  return {
    rowId,
    propertyId,
    databaseId,
    ...cols,
    vJson: cols.vJson === null ? Prisma.DbNull : (cols.vJson as Prisma.InputJsonValue),
  };
}
