import type { BridgeMessage } from "@/shared/types";
import type { BridgeHandler, HandlerContext } from "./types";
import { registerForPushNotifications } from "@/features/push-notification";

export const pushTokenHandler: BridgeHandler = {
  handle: async (_message: BridgeMessage, context?: HandlerContext) => {
    if (!context) {
      console.warn("[PushTokenHandler] No context provided");
      return;
    }

    const result = await registerForPushNotifications();

    if (result.success) {
      context.sendToWebView("PUSH_TOKEN", {
        token: result.token,
        platform: result.platform,
      });
      // 권한 승인됨 상태 전송
      context.sendToWebView("NOTIFICATION_STATUS", { status: "granted" });
    } else {
      context.sendToWebView("PUSH_TOKEN_ERROR", {
        error: result.error,
        code: result.code,
      });
      // 권한 거부 시 상태 전송
      if (result.code === "PERMISSION_DENIED") {
        context.sendToWebView("NOTIFICATION_STATUS", { status: "denied" });
      }
    }
  },
};
