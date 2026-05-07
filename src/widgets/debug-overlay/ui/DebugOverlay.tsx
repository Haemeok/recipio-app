import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import CookieManager from '@preeternal/react-native-cookie-manager';

import { cookieBackupService } from '@/shared/lib/cookie-backup';
import type { SendToWebViewFn } from '@/shared/lib/auth-diag';

interface DebugOverlayProps {
  webViewRef: RefObject<WebView | null>;
  sendToWebView: SendToWebViewFn;
}

const clearAllCookies = async (): Promise<void> => {
  if (Platform.OS === 'ios') {
    // WKWebView가 보는 jar (useWebKit:true) + HTTPCookieStorage 둘 다 비워야 함
    await CookieManager.clearAll(true);
    await CookieManager.clearAll(false);
  } else {
    await CookieManager.clearAll();
  }
};

// __DEV__ 전용. 프로덕션 빌드에선 App.tsx에서 마운트하지 않는다.
// 새로고침/쿠키삭제/복원테스트 3개 버튼만 제공. 디버그용.
export const DebugOverlay = ({ webViewRef, sendToWebView }: DebugOverlayProps) => {
  return (
    <View style={styles.bar}>
      <TouchableOpacity
        onPress={() => webViewRef.current?.reload()}
        style={styles.button}
      >
        <Text style={styles.text}>🔄 새로고침</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={async () => {
          await clearAllCookies();
          Alert.alert(
            '쿠키 삭제됨',
            'WebView 쿠키가 초기화되었습니다.\n새로고침하면 로그인이 풀려야 정상입니다.',
          );
          webViewRef.current?.reload();
        }}
        style={styles.button}
      >
        <Text style={[styles.text, { color: '#e74c3c' }]}>🍪 쿠키삭제</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={async () => {
          await clearAllCookies();
          Alert.alert(
            '쿠키 삭제 → 복원 테스트',
            '쿠키 초기화 후 백업에서 복원합니다.\n새로고침 후 로그인이 유지되면 성공!',
          );
          await cookieBackupService.restore({ send: sendToWebView });
          webViewRef.current?.reload();
        }}
        style={styles.button}
      >
        <Text style={[styles.text, { color: '#2ecc71' }]}>🔑 복원테스트</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  button: {
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  text: {
    fontSize: 14,
    color: '#666',
  },
});
