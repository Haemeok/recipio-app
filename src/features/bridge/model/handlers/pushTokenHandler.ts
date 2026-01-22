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
    } else {
      context.sendToWebView("PUSH_TOKEN_ERROR", {
        error: result.error,
        code: result.code,
      });
    }
  },
};
