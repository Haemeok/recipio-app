import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { emitCookieSnapshot } from '@/shared/lib/cookie-diag';

import { generateDiagId, sendAuthDiag, type SendToWebViewFn } from './index';

interface UseForegroundResumeDiagArgs {
  sendToWebView: SendToWebViewFn;
}

// 앱이 background → active로 돌아올 때 진단 phase + 쿠키 스냅샷 1회 emit.
// 로그인 유실 트래킹용 (auth-diag 시스템의 일부).
export const useForegroundResumeDiag = ({
  sendToWebView,
}: UseForegroundResumeDiagArgs): void => {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const diagId = generateDiagId();
      sendAuthDiag(sendToWebView, {
        phase: 'foreground-resume',
        source: 'app-rn-appstate',
        diagId,
        meta: { platform: Platform.OS },
      });
      void emitCookieSnapshot(sendToWebView, {
        trigger: 'foreground-resume',
        diagId,
      });
    });

    return () => subscription.remove();
  }, [sendToWebView]);
};
