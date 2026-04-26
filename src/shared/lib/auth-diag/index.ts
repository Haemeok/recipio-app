import type { AuthDiagPayload, BridgeResponseType } from "@/shared/types";

const DIAG_PREFIX = "[AUTH_DIAG]";

export const isAuthDiagEnabled = (): boolean =>
  process.env.EXPO_PUBLIC_AUTH_DIAGNOSTIC_ENABLED === "true";

export const generateDiagId = (): string => {
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16);
  return rand.padStart(8, "0");
};

export type SendToWebViewFn = <T>(
  type: BridgeResponseType,
  payload: T
) => void;

export const sendAuthDiag = (
  sendToWebView: SendToWebViewFn,
  params: {
    phase: string;
    source?: string;
    diagId: string;
    meta?: Record<string, unknown>;
  }
): void => {
  if (!isAuthDiagEnabled()) return;

  const payload: AuthDiagPayload = {
    phase: params.phase,
    source: params.source ?? "app-rn",
    diagId: params.diagId,
    meta: params.meta,
  };

  console.log(DIAG_PREFIX, JSON.stringify(payload));
  sendToWebView("AUTH_DIAG", payload);
};
