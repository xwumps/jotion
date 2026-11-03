import type { z } from 'zod';

/** Validiert Eingaben mit einem Zod-Schema. ZodError wird vom Filter in 422 übersetzt. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  return schema.parse(value ?? {});
}
