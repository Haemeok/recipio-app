import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import type { BridgeMessage, NotificationPayload } from "@/shared/types";
import type { BridgeHandler, HandlerContext } from "./types";

export const notificationHandler: BridgeHandler<NotificationPayload> = {
  handle: async (
    message: BridgeMessage<NotificationPayload>,
    context?: HandlerContext
  ) => {
    if (!context) {
      console.warn("[NotificationHandler] No context provided");
      return;
    }

    const { action } = message.payload ?? {};
    console.log("[NotificationHandler] Action:", action);

    if (action === "REQUEST_PERMISSION") {
      console.log("[NotificationHandler] Requesting permission...");

      const { status: existingStatus } =
        await Notifications.getPermissionsAsync();

      // 이미 허용됨
      if (existingStatus === "granted") {
        console.log("[NotificationHandler] Already granted");
        context.sendToWebView("NOTIFICATION_STATUS", { status: "granted" });
        return;
      }

      // 이미 거부됨 → 설정 앱으로 이동
      if (existingStatus === "denied") {
        console.log("[NotificationHandler] Already denied, opening settings");
        await Linking.openSettings();
        context.sendToWebView("NOTIFICATION_STATUS", { status: "denied" });
        return;
      }

      // 아직 결정 안 함 → 권한 요청 팝업
      const { status } = await Notifications.requestPermissionsAsync();
      console.log("[NotificationHandler] Permission result:", status);

      context.sendToWebView("NOTIFICATION_STATUS", {
        status: status === "granted" ? "granted" : "denied",
      });
    }
  },
};
