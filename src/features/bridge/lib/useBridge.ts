import { useCallback, useMemo, type RefObject } from "react";
import type { WebView, WebViewMessageEvent } from "react-native-webview";
import type { BridgeResponseType } from "@/shared/types";
import type { HandlerContext } from "../model/handlers";
import { messageRouter } from "../model";

interface UseBridgeOptions {
  webViewRef: RefObject<WebView | null>;
}

export const useBridge = ({ webViewRef }: UseBridgeOptions) => {
  const sendToWebView = useCallback(
    <T>(type: BridgeResponseType, payload: T) => {
      const message = JSON.stringify({ type, payload });
      const script = `
        (function() {
          window.dispatchEvent(new MessageEvent('message', { data: ${message} }));
        })();
        true;
      `;
      webViewRef.current?.injectJavaScript(script);
    },
    [webViewRef]
  );

  const context: HandlerContext = useMemo(
    () => ({
      webViewRef,
      sendToWebView,
    }),
    [webViewRef, sendToWebView]
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = messageRouter.parse(event.nativeEvent.data);

      if (!message) {
        console.log("[Bridge] Failed to parse:", event.nativeEvent.data);
        return;
      }

      // 웹뷰 콘솔 로그는 바로 출력 (디버깅용)
      if (message.type === "CONSOLE") {
        const { level, message: msg } = message.payload as { level: string; message: string };
        console.log(`[WebView:${level}]`, msg);
        return;
      }

      console.log("[Bridge] Message:", message.type, message.payload);
      messageRouter.route(message, context);
    },
    [context]
  );

  return { onMessage, sendToWebView };
};
