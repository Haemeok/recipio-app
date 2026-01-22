import type { RefObject } from "react";
import type { WebView } from "react-native-webview";
import type { BridgeMessage, BridgeResponseType } from "@/shared/types";

export interface HandlerContext {
  webViewRef: RefObject<WebView | null>;
  sendToWebView: <T>(type: BridgeResponseType, payload: T) => void;
}

export interface BridgeHandler<T = unknown> {
  handle(message: BridgeMessage<T>, context?: HandlerContext): Promise<void> | void;
}
