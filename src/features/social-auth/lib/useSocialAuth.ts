import { useCallback, useState, useEffect, useRef, type RefObject } from 'react';
import type { WebView } from 'react-native-webview';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { isSocialLoginUrl, openAuthSession } from './socialAuthService';
import { APP_CALLBACK_PATH } from './constants';
import type { SocialAuthState } from '../model/types';

interface UseSocialAuthOptions {
  webViewRef: RefObject<WebView | null>;
  baseUrl: string;
}

export const useSocialAuth = ({ webViewRef, baseUrl }: UseSocialAuthOptions) => {
  const [state, setState] = useState<SocialAuthState>({
    isAuthenticating: false,
    pendingProvider: null,
  });

  // 콜백 이중 실행 방지 플래그
  const callbackHandledRef = useRef(false);

  const loadCallbackUrl = useCallback(
    (code: string, source: string) => {
      if (callbackHandledRef.current) {
        console.log(`[SocialAuth] Callback already handled, ignoring from ${source}`);
        return;
      }
      callbackHandledRef.current = true;

      const callbackUrl = `${baseUrl}${APP_CALLBACK_PATH}?code=${code}`;
      console.log(`[SocialAuth] Loading callback URL from ${source}:`, callbackUrl);

      webViewRef.current?.injectJavaScript(`
        window.location.href = '${callbackUrl}';
        true;
      `);
    },
    [webViewRef, baseUrl]
  );

  /**
   * 소셜 로그인 URL 처리
   */
  const handleSocialLogin = useCallback(
    async (url: string): Promise<void> => {
      if (!isSocialLoginUrl(url)) {
        return;
      }

      callbackHandledRef.current = false;
      setState({ isAuthenticating: true, pendingProvider: null });

      try {
        const result = await openAuthSession(url);

        if (result.success && result.code) {
          loadCallbackUrl(result.code, 'authSession');
        } else {
          console.warn('[SocialAuth] Authentication failed:', result.error);
        }
      } catch (error) {
        console.error('[SocialAuth] Error:', error);
      } finally {
        setState({ isAuthenticating: false, pendingProvider: null });
      }
    },
    [loadCallbackUrl]
  );

  /**
   * 딥링크 리스너 (백업용 - openAuthSessionAsync가 자동 처리하지 못할 경우)
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
        }
      }
    });

    return () => subscription.remove();
  }, [webViewRef, loadCallbackUrl]);

  return {
    handleSocialLogin,
    isAuthenticating: state.isAuthenticating,
    pendingProvider: state.pendingProvider,
  };
};
