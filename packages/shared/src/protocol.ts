import { z } from "zod";
import { DIE_FACES, dieKindSchema } from "./contracts";

// Versioned messages between the Foundry module and the camera app (spec §5).

export const PROTOCOL_VERSION = 1;

const versionSchema = z.literal(PROTOCOL_VERSION);

export const rollRequestSchema = z.object({
  v: versionSchema,
  type: z.literal("roll-request"),
  requestId: z.string().min(1),
  dice: z
    .array(
      z.object({
        kind: dieKindSchema,
        count: z.number().int().min(1)
      })
    )
    .min(1)
});

export type RollRequest = z.infer<typeof rollRequestSchema>;

export const fulfilledDieSchema = z
  .object({
    kind: dieKindSchema,
    value: z.number().int(),
    confidence: z.number().min(0).max(1),
    corrected: z.boolean()
  })
  .refine((die) => die.value >= 1 && die.value <= DIE_FACES[die.kind], {
    message: "Die value is outside the faces of its kind.",
    path: ["value"]
  });

export const rollFulfillmentSchema = z.object({
  v: versionSchema,
  type: z.literal("roll-fulfillment"),
  requestId: z.string().min(1),
  dice: z.array(fulfilledDieSchema).min(1)
});

export type RollFulfillment = z.infer<typeof rollFulfillmentSchema>;

export const pairHelloSchema = z.object({
  v: versionSchema,
  type: z.literal("pair-hello"),
  secret: z.string().min(16),
  client: z.literal("camera-web")
});

export type PairHello = z.infer<typeof pairHelloSchema>;

export const pairAckSchema = z.object({
  v: versionSchema,
  type: z.literal("pair-ack"),
  userId: z.string().min(1),
  userName: z.string()
});

export type PairAck = z.infer<typeof pairAckSchema>;

// Foundry → camera: the request is no longer pending. "fulfilled" means the
// camera's dice were taken; "cancelled" means the player typed the results in
// Foundry or closed the resolver.
export const rollClosedSchema = z.object({
  v: versionSchema,
  type: z.literal("roll-closed"),
  requestId: z.string().min(1),
  outcome: z.enum(["fulfilled", "cancelled"])
});

export type RollClosed = z.infer<typeof rollClosedSchema>;

// Foundry → camera: a fulfillment was refused (e.g. dice did not match).
export const rollRejectedSchema = z.object({
  v: versionSchema,
  type: z.literal("roll-rejected"),
  requestId: z.string().min(1),
  reason: z.string()
});

export type RollRejected = z.infer<typeof rollRejectedSchema>;

export const protocolMessageSchema = z.discriminatedUnion("type", [
  rollRequestSchema,
  rollFulfillmentSchema,
  rollClosedSchema,
  rollRejectedSchema,
  pairHelloSchema,
  pairAckSchema
]);

export type ProtocolMessage = z.infer<typeof protocolMessageSchema>;

export function parseProtocolMessage(value: unknown): ProtocolMessage | null {
  const result = protocolMessageSchema.safeParse(value);

  return result.success ? result.data : null;
}

// True when the fulfillment answers the request exactly: same id, and the same
// number of dice of each kind.
export function fulfillmentMatchesRequest(
  request: RollRequest,
  fulfillment: RollFulfillment
): boolean {
  if (request.requestId !== fulfillment.requestId) {
    return false;
  }

  const expected = new Map<string, number>();

  for (const term of request.dice) {
    expected.set(term.kind, (expected.get(term.kind) ?? 0) + term.count);
  }

  for (const die of fulfillment.dice) {
    const remaining = expected.get(die.kind) ?? 0;

    if (remaining === 0) {
      return false;
    }

    expected.set(die.kind, remaining - 1);
  }

  return [...expected.values()].every((count) => count === 0);
}
