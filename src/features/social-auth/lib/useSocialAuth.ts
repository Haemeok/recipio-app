import { useCallback, useState, useEffect, useRef, type RefObject } from 'react';
import { Platform } from 'react-native';
import type { WebView } from 'react-native-webview';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { isSocialLoginUrl, openAuthSession, openAuthBrowser } from './socialAuthService';
import { APP_CALLBACK_PATH } from './constants';
import type { SocialAuthState } from '../model/types';

const AUTH_TIMEOUT_MS = 120_000; // 2분

interface UseSocialAuthOptions {
  webViewRef: RefObject<WebView | null>;
  baseUrl: string;
}

export const useSocialAuth = ({ webViewRef, baseUrl }: UseSocialAuthOptions) => {
  const [state, setState] = useState<SocialAuthState>({
    isAuthenticating: false,
    pendingProvider: null,
  });

  const callbackHandledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAuthTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const loadCallbackUrl = useCallback(
    (code: string, source: string) => {
      if (callbackHandledRef.current) {
        console.log(`[SocialAuth] Callback already handled, ignoring from ${source}`);
        return;
      }
      callbackHandledRef.current = true;
      clearAuthTimeout();

      const callbackUrl = `${baseUrl}${APP_CALLBACK_PATH}?code=${code}`;
      console.log(`[SocialAuth] Loading callback URL from ${source}:`, callbackUrl);

      webViewRef.current?.injectJavaScript(`
        window.location.href = '${callbackUrl}';
        true;
      `);

      setState({ isAuthenticating: false, pendingProvider: null });
    },
    [webViewRef, baseUrl, clearAuthTimeout]
  );

  /**
   * 소셜 로그인 URL 처리
   * iOS: openAuthSessionAsync — ASWebAuthenticationSession이 recipio:// 리다이렉트를 내부 캡처
   * Android: openBrowserAsync — Chrome Custom Tab + 딥링크 리스너
   */
  const handleSocialLogin = useCallback(
    async (url: string): Promise<void> => {
      if (!isSocialLoginUrl(url)) {
        return;
      }

      callbackHandledRef.current = false;
      setState({ isAuthenticating: true, pendingProvider: null });

      if (Platform.OS === 'ios') {
        // iOS: openAuthSessionAsync가 결과를 직접 반환
        try {
          const result = await openAuthSession(url);

          if (result.success && result.code) {
            loadCallbackUrl(result.code, 'authSession');
          } else {
            console.warn('[SocialAuth] iOS auth failed:', result.error);
            setState({ isAuthenticating: false, pendingProvider: null });
          }
        } catch (error) {
          console.error('[SocialAuth] iOS auth error:', error);
          setState({ isAuthenticating: false, pendingProvider: null });
        }
      } else {
        // Android: openBrowserAsync + 딥링크 리스너
        clearAuthTimeout();
        timeoutRef.current = setTimeout(() => {
          if (!callbackHandledRef.current) {
            console.warn('[SocialAuth] Auth timeout - no callback received');
            setState({ isAuthenticating: false, pendingProvider: null });
          }
        }, AUTH_TIMEOUT_MS);

        try {
          await openAuthBrowser(url);
          if (!callbackHandledRef.current) {
            console.log('[SocialAuth] Browser closed without callback');
            clearAuthTimeout();
            setState({ isAuthenticating: false, pendingProvider: null });
          }
        } catch (error) {
          console.error('[SocialAuth] Android auth error:', error);
          clearAuthTimeout();
          setState({ isAuthenticating: false, pendingProvider: null });
        }
      }
    },
    [clearAuthTimeout, loadCallbackUrl]
  );

  /**
   * 딥링크 리스너 — 유일한 인증 콜백 수신 경로
   * recipio://auth/callback?code=... 를 수신하면 처리
   */
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      console.log('[SocialAuth] Deep link received:', url);

      if (url.includes('auth/callback')) {
        WebBrowser.dismissBrowser();

        const { queryParams } = Linking.parse(url);
        const code = queryParams?.code as string | undefined;

        if (code && webViewRef.current) {
          loadCallbackUrl(code, 'deepLink');
        } else {
          console.warn('[SocialAuth] Deep link received but no code found');
          setState({ isAuthenticating: false, pendingProvider: null });
        }
      }
    });

    return () => {
      subscription.remove();
      clearAuthTimeout();
    };
  }, [webViewRef, loadCallbackUrl, clearAuthTimeout]);

  return {
    handleSocialLogin,
    isAuthenticating: state.isAuthenticating,
    pendingProvider: state.pendingProvider,
  };
};
