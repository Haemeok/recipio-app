import { useRef, useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, BackHandler } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { useBridge } from '@/features/bridge';
import { useSocialAuth, isSocialLoginUrl } from '@/features/social-auth';
import { getNotificationStatus } from '@/features/push-notification';
import { useNetworkStatus } from '@/shared/lib/network';
import { OfflineScreen } from '@/widgets/offline-screen';

// 내부 도메인 (WebView에서 처리할 URL)
const INTERNAL_DOMAINS = ['capstone-frontend', 'vercel.app', 'recipio.kr'];

// 임베딩 허용 도메인 (WebView 내에서 로드)
const ALLOWED_EMBED_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'googlevideo.com',
  'ytimg.com',
];
const feature17Url = 'https://capstone-frontend-9zya-git-feature-17-won-jins-projects.vercel.app/';
const mainUrl = 'https://recipio.kr/';
// 웹뷰 console.log를 네이티브로 전달하는 스크립트 (디버깅용)
const INJECTED_JAVASCRIPT = `
  (function() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = function(...args) {
      originalLog.apply(console, args);
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'CONSOLE',
        payload: { level: 'log', message: args.map(a => String(a)).join(' ') }
      }));
    };

    console.warn = function(...args) {
      originalWarn.apply(console, args);
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'CONSOLE',
        payload: { level: 'warn', message: args.map(a => String(a)).join(' ') }
      }));
    };

    console.error = function(...args) {
      originalError.apply(console, args);
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'CONSOLE',
        payload: { level: 'error', message: args.map(a => String(a)).join(' ') }
      }));
    };

    true;
  })();
`;

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const { onMessage } = useBridge({ webViewRef });
  const { handleSocialLogin } = useSocialAuth({ webViewRef, baseUrl: mainUrl });
  const { isOffline } = useNetworkStatus();
  const [showOffline, setShowOffline] = useState(false);

  // Android 뒤로가기: WebView 히스토리 back 처리, 첫 페이지에서는 앱 종료 차단
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true; // WebView 뒤로가기 처리
      }
      return true; // 첫 페이지에서는 앱 종료 차단
    });

    return () => backHandler.remove();
  }, [canGoBack]);

  // 네트워크 상태 변경 시 오프라인 화면 표시
  if (isOffline && !showOffline) {
    setShowOffline(true);
  }

  const handleRetry = () => {
    setShowOffline(false);
  };

  // URL 로드 요청 처리
  const handleShouldStartLoadWithRequest = (request: WebViewNavigation): boolean => {
    const { url } = request;

    // 1. 소셜 로그인 URL → 시스템 브라우저로 처리
    if (isSocialLoginUrl(url)) {
      handleSocialLogin(url);
      return false;
    }

    // 2. 내부 URL은 WebView에서 로드
    const isInternal = INTERNAL_DOMAINS.some(domain => url.includes(domain));
    if (isInternal || url.startsWith('about:') || url.startsWith('data:')) {
      return true;
    }

    // 3. 임베딩 허용 도메인 (유튜브 등)은 WebView에서 로드
    const isAllowedEmbed = ALLOWED_EMBED_DOMAINS.some(domain => url.includes(domain));
    if (isAllowedEmbed) {
      return true;
    }

    // 4. 그 외 외부 URL은 인앱 브라우저로 열기
    WebBrowser.openBrowserAsync(url);
    return false;
  };

  // WebView 로드 완료 시 알림 권한 상태 전송
  const handleWebViewLoadEnd = async () => {
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
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        {showOffline ? (
          <OfflineScreen onRetry={handleRetry} />
        ) : (
          <WebView
            ref={webViewRef}
            allowsLinkPreview={false}
            source={{ uri: mainUrl }}
            cacheEnabled={false}
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
            onNavigationStateChange={(navState) => {
              setCanGoBack(navState.canGoBack);
              console.warn('LOADING URL: ' + navState.url);
            }}
            onMessage={onMessage}
            injectedJavaScript={INJECTED_JAVASCRIPT}
            onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
            onLoadEnd={handleWebViewLoadEnd}
          />
        )}
      </SafeAreaView>
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
