import { useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useBridge } from '@/features/bridge';
import { useNetworkStatus } from '@/shared/lib/network';
import { OfflineScreen } from '@/widgets/offline-screen';

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
  const { isOffline } = useNetworkStatus();
  const [showOffline, setShowOffline] = useState(false);

  // 네트워크 상태 변경 시 오프라인 화면 표시
  if (isOffline && !showOffline) {
    setShowOffline(true);
  }

  const handleRetry = () => {
    setShowOffline(false);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        {showOffline ? (
          <OfflineScreen onRetry={handleRetry} />
        ) : (
          <WebView
            ref={webViewRef}
            allowsLinkPreview={false}
            source={{ uri: 'https://capstone-frontend-9zya-git-feature-17-won-jins-projects.vercel.app/' }}
            style={styles.webview}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            allowsInlineMediaPlayback={true}
            mediaPlaybackRequiresUserAction={false}
            allowsBackForwardNavigationGestures={true}
            onMessage={onMessage}
            injectedJavaScript={INJECTED_JAVASCRIPT}
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
