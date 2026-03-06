import { Platform, Linking } from "react-native";
import * as StoreReview from "expo-store-review";
import type {
  BridgeMessage,
  ReviewResultPayload,
  ReviewErrorPayload,
} from "@/shared/types";
import type { BridgeHandler, HandlerContext } from "./types";

const IOS_STORE_URL =
  "https://apps.apple.com/app/apple-store/id6758214712?action=write-review";
const ANDROID_STORE_URL =
  "https://play.google.com/store/apps/details?id=kr.recipio.app&showAllReviews=true";

function getStoreUrl(): string {
  return Platform.OS === "ios" ? IOS_STORE_URL : ANDROID_STORE_URL;
}

export const reviewHandler: BridgeHandler = {
  handle: async (_message: BridgeMessage, context?: HandlerContext) => {
    if (!context) {
      console.warn("[ReviewHandler] No context provided");
      return;
    }

    try {
      const isAvailable = await StoreReview.isAvailableAsync();
      console.log("[ReviewHandler] isAvailable:", isAvailable);

      if (isAvailable) {
        await StoreReview.requestReview();
        console.log("[ReviewHandler] Native review requested");

        const payload: ReviewResultPayload = { method: "native" };
        context.sendToWebView("REVIEW_RESULT", payload);
      } else {
        const storeUrl = getStoreUrl();
        console.log("[ReviewHandler] Falling back to store URL:", storeUrl);

        await Linking.openURL(storeUrl);

        const payload: ReviewResultPayload = {
          method: "store_url",
          storeUrl,
        };
        context.sendToWebView("REVIEW_RESULT", payload);
      }
    } catch (error) {
      console.error("[ReviewHandler] Error:", error);

      const errorPayload: ReviewErrorPayload = {
        error: error instanceof Error ? error.message : "Unknown error",
        code: "REVIEW_FAILED",
      };
      context.sendToWebView("REVIEW_ERROR", errorPayload);
    }
  },
};
