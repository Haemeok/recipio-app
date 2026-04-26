import { useCallback, useState, useEffect, useRef, type RefObject } from 'react';
import { Platform } from 'react-native';
import type { WebView } from 'react-native-webview';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { isSocialLoginUrl, openAuthSession, openAuthBrowser } from './socialAuthService';
import type { SocialAuthState } from '../model/types';
import { buildAppCallbackUrl } from '@/shared/config';
import { generateDiagId, sendAuthDiag, type SendToWebViewFn } from '@/shared/lib/auth-diag';

const AUTH_TIMEOUT_MS = 120_000; // 2분

interface UseSocialAuthOptions {
  webViewRef: RefObject<WebView | null>;
  sendToWebView: SendToWebViewFn;
}

export const useSocialAuth = ({ webViewRef, sendToWebView }: UseSocialAuthOptions) => {
  const [state, setState] = useState<SocialAuthState>({
    isAuthenticating: false,
    pendingProvider: null,
  });

  const callbackHandledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagIdRef = useRef<string | null>(null);

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

      const diagId = diagIdRef.current ?? generateDiagId();
      const callbackUrl = buildAppCallbackUrl(code, diagId);
      console.log(`[SocialAuth] Loading callback URL from ${source}:`, callbackUrl);

      sendAuthDiag(sendToWebView, {
        phase: 'app-callback-load',
        source: 'app-rn-social-auth',
        diagId,
        meta: { trigger: source },
      });

      webViewRef.current?.injectJavaScript(`
        window.location.href = '${callbackUrl}';
        true;
      `);

      setState({ isAuthenticating: false, pendingProvider: null });
    },
    [webViewRef, clearAuthTimeout, sendToWebView]
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
      diagIdRef.current = generateDiagId();
      setState({ isAuthenticating: true, pendingProvider: null });

      sendAuthDiag(sendToWebView, {
        phase: 'social-login-start',
        source: 'app-rn-social-auth',
        diagId: diagIdRef.current,
        meta: { platform: Platform.OS },
      });

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
    [clearAuthTimeout, loadCallbackUrl, sendToWebView]
  );

  /**
   * 딥링크 리스너 — 유일한 인증 콜백 수신 경로
   * recipio://auth/callback?code=... 를 수신하면 처리
   */
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      console.log('[SocialAuth] Deep link received:', url);

      if (url.includes('auth/callback')) {
        const diagId = diagIdRef.current ?? generateDiagId();
        if (!diagIdRef.current) {
          diagIdRef.current = diagId;
        }

        sendAuthDiag(sendToWebView, {
          phase: 'deep-link-received',
          source: 'app-rn-social-auth',
          diagId,
          meta: { hasAuthCallback: true },
        });

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
  }, [webViewRef, loadCallbackUrl, clearAuthTimeout, sendToWebView]);

  return {
    handleSocialLogin,
    isAuthenticating: state.isAuthenticating,
    pendingProvider: state.pendingProvider,
  };
};
