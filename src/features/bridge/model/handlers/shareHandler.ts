import { Share, Platform } from "react-native";
import type { BridgeMessage, SharePayload } from "@/shared/types";
import type { BridgeHandler } from "./types";

export const shareHandler: BridgeHandler<SharePayload> = {
  handle: async (message: BridgeMessage<SharePayload>): Promise<void> => {
    const { title, text, url } = message.payload ?? {};

    if (!title && !text && !url) {
      console.warn("[ShareHandler] Missing share content in payload");
      return;
    }

    const shareMessage = [text, url].filter(Boolean).join("\n");

    try {
      await Share.share(
        {
          title,
          message: shareMessage,
          ...(Platform.OS === "ios" && url ? { url } : {}),
        },
        {
          dialogTitle: title,
        }
      );
    } catch (error) {
      console.error("[ShareHandler] Share failed:", error);
    }
  },
};
