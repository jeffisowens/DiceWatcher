import { z } from "zod";

export const DIE_FACES = {
  d6: 6
} as const;

export const dieKindSchema = z.enum(["d6"]);

export type DieKind = z.infer<typeof dieKindSchema>;

export function isDieKind(value: unknown): value is DieKind {
  return dieKindSchema.safeParse(value).success;
}
