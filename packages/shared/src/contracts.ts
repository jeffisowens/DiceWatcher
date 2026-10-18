import { z } from "zod";

export const DIE_FACES = {
  d6: 6
} as const;

export const dieKindSchema = z.enum(["d6"]);

export type DieKind = z.infer<typeof dieKindSchema>;

export const dieResultSchema = z
  .object({
    id: z.string(),
    kind: dieKindSchema,
    value: z.number().int(),
    confidence: z.number().min(0).max(1)
  })
  .refine((die) => die.value >= 1 && die.value <= DIE_FACES[die.kind], {
    message: "Die value is outside the faces of its kind.",
    path: ["value"]
  });

export type DieResult = z.infer<typeof dieResultSchema>;

export const externalRollPayloadSchema = z
  .object({
    sessionId: z.string(),
    userId: z.string().optional(),
    source: z.literal("camera-web"),
    dice: z.array(dieResultSchema).min(1),
    total: z.number().int(),
    imageTimestamp: z.string(),
    corrected: z.boolean()
  })
  .refine(
    (payload) =>
      payload.total === payload.dice.reduce((sum, die) => sum + die.value, 0),
    {
      message: "Total does not match the dice values.",
      path: ["total"]
    }
  );

export type ExternalRollPayload = z.infer<typeof externalRollPayloadSchema>;

export const DICEWATCHER_EXTERNAL_ROLL_MESSAGE_TYPE =
  "dicewatcher.external-roll";

export const externalRollMessageSchema = z.object({
  type: z.literal(DICEWATCHER_EXTERNAL_ROLL_MESSAGE_TYPE),
  payload: externalRollPayloadSchema
});

export type ExternalRollMessage = z.infer<typeof externalRollMessageSchema>;

export type LauncherSession = {
  sessionId: string;
  userId?: string;
  userLabel?: string;
  foundryOrigin?: string;
};

type ExternalRollInput = {
  sessionId: string;
  userId?: string;
  value: number;
  confidence?: number;
  corrected?: boolean;
};

export function createExternalRoll(
  input: ExternalRollInput
): ExternalRollPayload {
  return {
    sessionId: input.sessionId,
    userId: input.userId,
    source: "camera-web",
    dice: [
      {
        id: "die-1",
        kind: "d6",
        value: input.value,
        confidence: input.confidence ?? 1
      }
    ],
    total: input.value,
    imageTimestamp: new Date().toISOString(),
    corrected: input.corrected ?? false
  };
}

export function isExternalRollPayload(
  value: unknown
): value is ExternalRollPayload {
  return externalRollPayloadSchema.safeParse(value).success;
}

export function createExternalRollMessage(
  payload: ExternalRollPayload
): ExternalRollMessage {
  return {
    type: DICEWATCHER_EXTERNAL_ROLL_MESSAGE_TYPE,
    payload
  };
}

export function isExternalRollMessage(
  value: unknown
): value is ExternalRollMessage {
  return externalRollMessageSchema.safeParse(value).success;
}

export function buildLauncherQuery(session: LauncherSession): URLSearchParams {
  const params = new URLSearchParams();

  params.set("sessionId", session.sessionId);

  if (session.userId) {
    params.set("userId", session.userId);
  }

  if (session.userLabel) {
    params.set("userLabel", session.userLabel);
  }

  if (session.foundryOrigin) {
    params.set("foundryOrigin", session.foundryOrigin);
  }

  return params;
}

export function parseLauncherSession(
  searchParams: URLSearchParams
): LauncherSession {
  return {
    sessionId: searchParams.get("sessionId") ?? "demo-session",
    userId: searchParams.get("userId") ?? undefined,
    userLabel: searchParams.get("userLabel") ?? undefined,
    foundryOrigin: searchParams.get("foundryOrigin") ?? undefined
  };
}
