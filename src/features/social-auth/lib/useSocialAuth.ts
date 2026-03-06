import { useCallback, useState, useEffect, type RefObject } from 'react';
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

  /**
   * 소셜 로그인 URL 처리
   */
  const handleSocialLogin = useCallback(
    async (url: string): Promise<void> => {
      if (!isSocialLoginUrl(url)) {
        return;
      }

      setState({ isAuthenticating: true, pendingProvider: null });

      try {
        const result = await openAuthSession(url);

        if (result.success && result.code) {
          // 인증 성공: WebView에서 app-callback URL 로드
          const callbackUrl = `${baseUrl}${APP_CALLBACK_PATH}?code=${result.code}`;
          console.log('[SocialAuth] Loading callback URL:', callbackUrl);

          webViewRef.current?.injectJavaScript(`
            window.location.href = '${callbackUrl}';
            true;
          `);
        } else {
          // 인증 실패/취소
          console.warn('[SocialAuth] Authentication failed:', result.error);
        }
      } catch (error) {
        console.error('[SocialAuth] Error:', error);
      } finally {
        setState({ isAuthenticating: false, pendingProvider: null });
      }
    },
    [webViewRef, baseUrl]
  );

  /**
   * 딥링크 리스너 (백업용 - openAuthSessionAsync가 자동 처리하지 못할 경우)
   */
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      console.log('[SocialAuth] Deep link received:', url);

      // recipio://auth/callback?code=xxx 형태
      if (url.includes('auth/callback')) {
        // 시스템 브라우저 닫기
        WebBrowser.dismissBrowser();

        const { queryParams } = Linking.parse(url);
        const code = queryParams?.code as string | undefined;

        if (code && webViewRef.current) {
          const callbackUrl = `${baseUrl}${APP_CALLBACK_PATH}?code=${code}`;
          console.log('[SocialAuth] Loading callback URL from deep link:', callbackUrl);

          webViewRef.current.injectJavaScript(`
            window.location.href = '${callbackUrl}';
            true;
          `);
        }
      }
    });

    return () => subscription.remove();
  }, [webViewRef, baseUrl]);

  return {
    handleSocialLogin,
    isAuthenticating: state.isAuthenticating,
    pendingProvider: state.pendingProvider,
  };
};
