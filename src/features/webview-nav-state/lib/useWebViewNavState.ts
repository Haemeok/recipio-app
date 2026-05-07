import { useState, useCallback } from 'react';
import type { WebViewNavigation } from 'react-native-webview';

import { WEBVIEW_BASE_URL } from '@/shared/config';
import { generateDiagId, sendAuthDiag, type SendToWebViewFn } from '@/shared/lib/auth-diag';
import { emitCookieSnapshot } from '@/shared/lib/cookie-diag';

interface UseWebViewNavStateArgs {
  sendToWebView: SendToWebViewFn;
}

interface UseWebViewNavStateResult {
  canGoBack: boolean;
  currentUrl: string;
  onNavigationStateChange: (navState: WebViewNavigation) => void;
}

// auth 관련 phase 식별 — URL 패턴으로 분류.
const detectAuthPhase = (url: string): string | null => {
  if (url.includes('/api/auth/app-callback')) return 'webview-nav-app-callback';
  if (url.includes('/api/auth/callback/')) return 'webview-nav-oauth-callback';
  if (url === WEBVIEW_BASE_URL || url === `${WEBVIEW_BASE_URL}/`) return 'webview-nav-main';
  return null;
};

// WebView navigation state 추적:
//   - canGoBack: Android 백 핸들러 + UI에서 사용
//   - currentUrl: floating back bar 표시 조건 등에서 사용
//   - auth phase가 식별되면 진단 emit + 로드 완료 시점에 쿠키 스냅샷
export const useWebViewNavState = ({
  sendToWebView,
}: UseWebViewNavStateArgs): UseWebViewNavStateResult => {
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');

  const onNavigationStateChange = useCallback(
    (navState: WebViewNavigation) => {
      setCanGoBack(navState.canGoBack);
      setCurrentUrl(navState.url);
      console.warn('LOADING URL: ' + navState.url);

      const authPhase = detectAuthPhase(navState.url);
      if (!authPhase) return;

      const diagId = generateDiagId();
      sendAuthDiag(sendToWebView, {
        phase: authPhase,
        source: 'app-rn-webview-nav',
        diagId,
        meta: { url: navState.url, loading: navState.loading },
      });

      // 로드 완료 후에만 스냅샷 (Set-Cookie 다 들어온 시점)
      if (navState.loading) return;
      if (
        authPhase !== 'webview-nav-app-callback' &&
        authPhase !== 'webview-nav-main'
      ) {
        return;
      }
      const trigger =
        authPhase === 'webview-nav-app-callback' ? 'post-app-callback' : 'post-login';
      void emitCookieSnapshot(sendToWebView, { trigger, diagId });
    },
    [sendToWebView],
  );

  return { canGoBack, currentUrl, onNavigationStateChange };
};
