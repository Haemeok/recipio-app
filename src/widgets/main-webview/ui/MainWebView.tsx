import { StyleSheet } from 'react-native';
import { forwardRef } from 'react';
import type { ForwardedRef } from 'react';
import { WebView } from 'react-native-webview';
import type {
  WebViewMessageEvent,
  WebViewNavigation,
} from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { WEBVIEW_BASE_URL } from '@/shared/config';
import { CONSOLE_BRIDGE_SCRIPT } from '@/shared/lib/console-bridge';

interface MainWebViewProps {
  onMessage: (event: WebViewMessageEvent) => void;
  onNavigationStateChange: (navState: WebViewNavigation) => void;
  onShouldStartLoadWithRequest: (request: ShouldStartLoadRequest) => boolean;
  onLoadEnd: () => void;
}

// recipio.kr을 로드하는 메인 WebView. 모든 props는 호출자(AppContent)가 주입한
// 핸들러. 이 컴포넌트는 ref forwarding과 webview prop 묶음만 담당.
export const MainWebView = forwardRef(
  (
    {
      onMessage,
      onNavigationStateChange,
      onShouldStartLoadWithRequest,
      onLoadEnd,
    }: MainWebViewProps,
    ref: ForwardedRef<WebView>,
  ) => {
    return (
      <WebView
        ref={ref}
        allowsLinkPreview={false}
        source={{ uri: WEBVIEW_BASE_URL }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsBackForwardNavigationGestures
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        injectedJavaScript={CONSOLE_BRIDGE_SCRIPT}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onLoadEnd={onLoadEnd}
      />
    );
  },
);

MainWebView.displayName = 'MainWebView';

const styles = StyleSheet.create({
  webview: {
    flex: 1,
  },
});
