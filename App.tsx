import { useRef, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Platform, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useBridge } from '@/features/bridge';
import { useSocialAuth } from '@/features/social-auth';
import { createNavigationGate } from '@/features/webview-navigation';
import { getNotificationStatus } from '@/features/push-notification';
import { useNetworkStatus } from '@/shared/lib/network';
import { OfflineScreen } from '@/widgets/offline-screen';
import { DebugOverlay } from '@/widgets/debug-overlay';
import { FloatingBackBar } from '@/widgets/floating-back-bar';
import { useCookieLifecycle } from '@/shared/lib/cookie-backup';
import { useShareIntent, ShareIntentProvider } from '@/features/share-intent';
import {
  WEBVIEW_BASE_URL,
  isExternalAuthPage,
} from '@/shared/config';
import { useForegroundResumeDiag } from '@/shared/lib/auth-diag';
import { useCookieSnapshotTimer } from '@/shared/lib/cookie-diag';
import { useWebViewNavState } from '@/features/webview-nav-state';
import { CONSOLE_BRIDGE_SCRIPT } from '@/shared/lib/console-bridge';
import { useAndroidBackHandler } from '@/features/android-back';

function AppContent() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const { onMessage, sendToWebView } = useBridge({ webViewRef });
  const { handleSocialLogin } = useSocialAuth({
    webViewRef,
    sendToWebView,
  });
  useCookieSnapshotTimer(sendToWebView);
  const { shareTargetUrl, clearShareTarget } = useShareIntent();

  // WebView 첫 로드 완료 여부. cold-start 공유는 WebView가 아직 준비 전이라
  // injectJavaScript가 소실되므로 준비되면 꺼내 쓸 수 있도록 ref에 대기시킨다.
  const isWebViewReadyRef = useRef(false);
  const pendingShareUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shareTargetUrl) return;

    if (isWebViewReadyRef.current && webViewRef.current) {
      // Warm share: 이미 떠 있는 WebView에 주입
      webViewRef.current.injectJavaScript(
        `window.location.href = ${JSON.stringify(shareTargetUrl)}; true;`
      );
    } else {
      // Cold start: 첫 로드 완료 시점에 주입하도록 대기
      pendingShareUrlRef.current = shareTargetUrl;
    }

    clearShareTarget();
  }, [shareTargetUrl, clearShareTarget]);

  const { isOffline, refresh: refreshNetwork } = useNetworkStatus();

  const { cookiesRestored } = useCookieLifecycle({ sendToWebView });

  const { canGoBack, currentUrl, onNavigationStateChange } = useWebViewNavState({ sendToWebView });

  useForegroundResumeDiag({ sendToWebView });
  useAndroidBackHandler({ webViewRef, canGoBack });

  // URL 로드 요청 처리 — createNavigationGate factory로 생성
  const handleShouldStartLoadWithRequest = createNavigationGate({ handleSocialLogin });

  // WebView 로드 완료 시 알림 권한 상태 전송 + cold-start 공유 URL 대기분 처리
  const handleWebViewLoadEnd = async () => {
    if (!isWebViewReadyRef.current) {
      isWebViewReadyRef.current = true;
      const pending = pendingShareUrlRef.current;
      if (pending) {
        pendingShareUrlRef.current = null;
        webViewRef.current?.injectJavaScript(
          `window.location.href = ${JSON.stringify(pending)}; true;`
        );
      }
    }

    const status = await getNotificationStatus();

    const message = JSON.stringify({
      type: 'NOTIFICATION_STATUS',
      payload: { status }
    });

    webViewRef.current?.injectJavaScript(`
      window.dispatchEvent(new MessageEvent('message', { data: ${message} }));
      true;
    `);
  };

  return (
    <SafeAreaView
      style={[styles.container, Platform.OS === 'android' && { paddingBottom: insets.bottom }]}
      edges={['top']}
    >
      <StatusBar style="dark" />
      {!cookiesRestored ? null : isOffline ? (
        <OfflineScreen onRetry={refreshNetwork} />
      ) : (
        <>
        {Platform.OS === 'android' && isExternalAuthPage(currentUrl) && (
          <FloatingBackBar onPress={() => webViewRef.current?.goBack()} />
        )}
        {__DEV__ && <DebugOverlay webViewRef={webViewRef} sendToWebView={sendToWebView} />}
        <WebView
          ref={webViewRef}
          allowsLinkPreview={false}
          source={{ uri: WEBVIEW_BASE_URL }}
          style={styles.webview}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          allowsBackForwardNavigationGestures={true}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          onNavigationStateChange={onNavigationStateChange}
          onMessage={onMessage}
          injectedJavaScript={CONSOLE_BRIDGE_SCRIPT}
          onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
          onLoadEnd={handleWebViewLoadEnd}
        />
        </>
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ShareIntentProvider>
        <AppContent />
      </ShareIntentProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  webview: {
    flex: 1,
  },

});
