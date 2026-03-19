export type DieKind = "d6";

export type DieResult = {
  id: string;
  kind: DieKind;
  value: number;
  confidence: number;
};

export type ExternalRollPayload = {
  sessionId: string;
  userId?: string;
  source: "camera-web";
  dice: DieResult[];
  total: number;
  imageTimestamp: string;
  corrected: boolean;
};

export const DICEWATCHER_EXTERNAL_ROLL_MESSAGE_TYPE =
  "dicewatcher.external-roll";

export type ExternalRollMessage = {
  type: typeof DICEWATCHER_EXTERNAL_ROLL_MESSAGE_TYPE;
  payload: ExternalRollPayload;
};

export type LauncherSession = {
  sessionId: string;
  userId?: string;
  userLabel?: string;
  foundryOrigin?: string;
};

type MockRollInput = {
  sessionId: string;
  userId?: string;
  value: number;
};

export function createMockExternalRoll(input: MockRollInput): ExternalRollPayload {
  return {
    sessionId: input.sessionId,
    userId: input.userId,
    source: "camera-web",
    dice: [
      {
        id: "die-1",
        kind: "d6",
        value: input.value,
        confidence: 1
      }
    ],
    total: input.value,
    imageTimestamp: new Date().toISOString(),
    corrected: false
  };
}

export function isExternalRollPayload(value: unknown): value is ExternalRollPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ExternalRollPayload>;

  return (
    typeof candidate.sessionId === "string" &&
    (candidate.userId === undefined || typeof candidate.userId === "string") &&
    candidate.source === "camera-web" &&
    typeof candidate.total === "number" &&
    typeof candidate.imageTimestamp === "string" &&
    typeof candidate.corrected === "boolean" &&
    Array.isArray(candidate.dice) &&
    candidate.dice.every((die) => {
      if (typeof die !== "object" || die === null) {
        return false;
      }

      const typedDie = die as Partial<DieResult>;

      return (
        typeof typedDie.id === "string" &&
        typedDie.kind === "d6" &&
        typeof typedDie.value === "number" &&
        typeof typedDie.confidence === "number"
      );
    })
  );
}

export function createExternalRollMessage(
  payload: ExternalRollPayload
): ExternalRollMessage {
  return {
    type: DICEWATCHER_EXTERNAL_ROLL_MESSAGE_TYPE,
    payload
  };
}

export function isExternalRollMessage(value: unknown): value is ExternalRollMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ExternalRollMessage>;

  return (
    candidate.type === DICEWATCHER_EXTERNAL_ROLL_MESSAGE_TYPE &&
    isExternalRollPayload(candidate.payload)
  );
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
