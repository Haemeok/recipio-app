import { useRef, useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, BackHandler, Platform, ToastAndroid, TouchableOpacity, Text, View, AppState } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { useBridge } from '@/features/bridge';
import { useSocialAuth, isSocialLoginUrl } from '@/features/social-auth';
import { getNotificationStatus } from '@/features/push-notification';
import { useNetworkStatus } from '@/shared/lib/network';
import { OfflineScreen } from '@/widgets/offline-screen';
import CookieManager from '@preeternal/react-native-cookie-manager';
import { cookieBackupService } from '@/shared/lib/cookie-backup';
import { Alert } from 'react-native';
import { useShareIntent, ShareIntentProvider } from '@/features/share-intent';
import { WEBVIEW_BASE_URL } from '@/shared/config';
import { generateDiagId, sendAuthDiag } from '@/shared/lib/auth-diag';

// 외부 OAuth 로그인 페이지 감지 (뒤로가기 버튼 표시용)
// 뒤로가기 버튼 표시할 OAuth 페이지 (네이버는 자체 뒤로가기 있으므로 제외)
const EXTERNAL_AUTH_DOMAINS = ['accounts.kakao.com'];

const isExternalAuthPage = (url: string): boolean => {
  return EXTERNAL_AUTH_DOMAINS.some(domain => url.includes(domain));
};

// 내부 도메인 (WebView에서 처리할 URL)
const INTERNAL_DOMAINS = ['capstone-frontend', 'vercel.app', 'recipio.kr'];

// OAuth 로그인 과정에서 WebView 안에서 처리해야 하는 도메인
const OAUTH_DOMAINS = ['accounts.kakao.com', 'kauth.kakao.com', 'nid.naver.com', 'accounts.google.com', 'appleid.apple.com'];

// 임베딩 허용 도메인 (WebView 내에서 로드)
const ALLOWED_EMBED_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'googlevideo.com',
  'ytimg.com',
];
const feature17Url = 'https://capstone-frontend-9zya-git-feature-17-won-jins-projects.vercel.app/';
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

function AppContent() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const { onMessage, sendToWebView } = useBridge({ webViewRef });
  const { handleSocialLogin } = useSocialAuth({
    webViewRef,
    sendToWebView,
  });
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
  const [showDebugRefresh, setShowDebugRefresh] = useState(__DEV__);

  // Android 뒤로가기: WebView 히스토리 back 처리, 첫 페이지에서는 두 번 누르면 앱 종료
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');
  const lastBackPressed = useRef(0);
  const [cookiesRestored, setCookiesRestored] = useState(Platform.OS !== 'android');

  // Android: 앱 시작 시 백업된 쿠키 복원 (WebView 로드 전에 실행)
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    cookieBackupService.restore().then(() => {
      setCookiesRestored(true);
    });
  }, []);

  // Android: 앱이 백그라운드로 갈 때 쿠키 백업
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        cookieBackupService.backup();
      }
    });

    return () => subscription.remove();
  }, []);

  // 진단: foreground 복귀 시 WebView 쿠키 상태 스냅샷
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sendAuthDiag(sendToWebView, {
          phase: 'foreground-resume',
          source: 'app-rn-appstate',
          diagId: generateDiagId(),
          meta: { platform: Platform.OS },
        });
      }
    });

    return () => subscription.remove();
  }, [sendToWebView]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      const now = Date.now();
      if (now - lastBackPressed.current < 2000) {
        BackHandler.exitApp();
        return true;
      }
      lastBackPressed.current = now;
      ToastAndroid.show('한 번 더 누르면 종료됩니다', ToastAndroid.SHORT);
      return true;
    });

    return () => backHandler.remove();
  }, [canGoBack]);

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

    // 3. OAuth 로그인 도메인은 WebView에서 로드
    const isOAuth = OAUTH_DOMAINS.some(domain => url.includes(domain));
    if (isOAuth) {
      return true;
    }

    // 4. 임베딩 허용 도메인 (유튜브 등)은 WebView에서 로드
    const isAllowedEmbed = ALLOWED_EMBED_DOMAINS.some(domain => url.includes(domain));
    if (isAllowedEmbed) {
      return true;
    }

    // 5. 그 외 외부 URL은 인앱 브라우저로 열기
    WebBrowser.openBrowserAsync(url);
    return false;
  };

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
          <View style={styles.floatingBackBar}>
            <TouchableOpacity
              onPress={() => webViewRef.current?.goBack()}
              style={styles.floatingBackButton}
            >
              <Text style={styles.floatingBackText}>← 돌아가기</Text>
            </TouchableOpacity>
          </View>
        )}
        {showDebugRefresh && (
          <View style={styles.debugRefreshBar}>
            <TouchableOpacity
              onPress={() => webViewRef.current?.reload()}
              style={styles.debugRefreshButton}
            >
              <Text style={styles.debugRefreshText}>🔄 새로고침</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                await CookieManager.clearAll();
                Alert.alert('쿠키 삭제됨', 'WebView 쿠키가 초기화되었습니다.\n새로고침하면 로그인이 풀려야 정상입니다.');
                webViewRef.current?.reload();
              }}
              style={styles.debugRefreshButton}
            >
              <Text style={[styles.debugRefreshText, { color: '#e74c3c' }]}>🍪 쿠키삭제</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                await CookieManager.clearAll();
                Alert.alert('쿠키 삭제 → 복원 테스트', '쿠키 초기화 후 백업에서 복원합니다.\n새로고침 후 로그인이 유지되면 성공!');
                await cookieBackupService.restore();
                webViewRef.current?.reload();
              }}
              style={styles.debugRefreshButton}
            >
              <Text style={[styles.debugRefreshText, { color: '#2ecc71' }]}>🔑 복원테스트</Text>
            </TouchableOpacity>
          </View>
        )}
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
          onNavigationStateChange={(navState) => {
            setCanGoBack(navState.canGoBack);
            setCurrentUrl(navState.url);
            console.warn('LOADING URL: ' + navState.url);

            // 진단: auth 관련 네비게이션 phase 식별
            const url = navState.url;
            let authPhase: string | null = null;
            if (url.includes('/api/auth/app-callback')) {
              authPhase = 'webview-nav-app-callback';
            } else if (url.includes('/api/auth/callback/')) {
              authPhase = 'webview-nav-oauth-callback';
            } else if (url === WEBVIEW_BASE_URL || url === `${WEBVIEW_BASE_URL}/`) {
              authPhase = 'webview-nav-main';
            }
            if (authPhase) {
              sendAuthDiag(sendToWebView, {
                phase: authPhase,
                source: 'app-rn-webview-nav',
                diagId: generateDiagId(),
                meta: { url, loading: navState.loading },
              });
            }
          }}
          onMessage={onMessage}
          injectedJavaScript={INJECTED_JAVASCRIPT}
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
  floatingBackBar: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  floatingBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  floatingBackText: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  debugRefreshBar: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    gap: 12,
  },
  debugRefreshButton: {
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  debugRefreshText: {
    fontSize: 14,
    color: '#666',
  },
});
