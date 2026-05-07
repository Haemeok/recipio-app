import { useEffect, useRef } from 'react';
import { BackHandler, ToastAndroid } from 'react-native';
import type { RefObject } from 'react';
import type WebView from 'react-native-webview';

interface UseAndroidBackHandlerArgs {
  webViewRef: RefObject<WebView | null>;
  canGoBack: boolean;
}

const DOUBLE_PRESS_INTERVAL_MS = 2000;

// Android 하드웨어 뒤로가기:
//   - WebView 히스토리에 뒤로 갈 페이지 있으면 goBack
//   - 없으면 첫 번째 누름엔 토스트, 2초 내 다시 누르면 앱 종료
// iOS는 하드웨어 백 버튼이 없어 호출되지 않음 (BackHandler가 no-op).
export const useAndroidBackHandler = ({
  webViewRef,
  canGoBack,
}: UseAndroidBackHandlerArgs): void => {
  const lastBackPressed = useRef(0);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      const now = Date.now();
      if (now - lastBackPressed.current < DOUBLE_PRESS_INTERVAL_MS) {
        BackHandler.exitApp();
        return true;
      }
      lastBackPressed.current = now;
      ToastAndroid.show('한 번 더 누르면 종료됩니다', ToastAndroid.SHORT);
      return true;
    });

    return () => subscription.remove();
  }, [canGoBack, webViewRef]);
};
