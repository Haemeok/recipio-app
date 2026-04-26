export type HapticStyle =
  | "Light"
  | "Medium"
  | "Heavy"
  | "Success"
  | "Warning"
  | "Error";

export type BridgeMessageType =
  | "HAPTIC"
  | "NAVIGATION"
  | "SHARE"
  | "STORAGE"
  | "REQUEST_PUSH_TOKEN"
  | "PICK_IMAGE"
  | "TAKE_PHOTO"
  | "NOTIFICATION"
  | "REQUEST_REVIEW"
  | "AUTH_STATE_CHANGED"
  | "CONSOLE";

export type BridgeResponseType =
  | "PUSH_TOKEN"
  | "PUSH_TOKEN_ERROR"
  | "IMAGE_RESULT"
  | "IMAGE_ERROR"
  | "NOTIFICATION_STATUS"
  | "REVIEW_RESULT"
  | "REVIEW_ERROR"
  | "AUTH_DIAG";

export type BridgeMessage<T = unknown> = {
  type: BridgeMessageType;
  payload?: T;
};

export type HapticPayload = {
  style: HapticStyle;
};

export type SharePayload = {
  title?: string;
  text?: string;
  url?: string;
};

export type PushTokenPayload = {
  token: string;
  platform: "ios" | "android";
};

export type PushTokenErrorPayload = {
  error: string;
  code: "DEVICE_NOT_SUPPORTED" | "PERMISSION_DENIED" | "TOKEN_FETCH_FAILED";
};

export type ImagePickerPayload = {
  allowsEditing?: boolean;
  quality?: number;
};

export type ImageResultPayload = {
  uri: string;
  base64?: string;
  width: number;
  height: number;
  mimeType?: string;
};

export type ImageErrorPayload = {
  error: string;
  code: "PERMISSION_DENIED" | "CANCELLED" | "UNKNOWN_ERROR";
};

export type NotificationStatusPayload = {
  status: "granted" | "denied" | "not_determined";
};

export type NotificationPayload = {
  action: "REQUEST_PERMISSION";
};

export type ReviewResultPayload = {
  method: "native" | "store_url";
  storeUrl?: string;
};

export type ReviewErrorPayload = {
  error: string;
  code: "NOT_AVAILABLE" | "REVIEW_FAILED" | "UNKNOWN_ERROR";
};

export type AuthStatePayload = {
  event: "login" | "refresh" | "logout";
};

export type ConsolePayload = {
  level: "log" | "warn" | "error";
  message: string;
};

export type AuthDiagPayload = {
  phase: string;
  source: string;
  diagId: string;
  meta?: Record<string, unknown>;
};
