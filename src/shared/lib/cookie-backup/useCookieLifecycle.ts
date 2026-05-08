import { useEffect, useState } from 'react';
import { Platform, AppState } from 'react-native';

import { type SendToWebViewFn } from '@/shared/lib/auth-diag';
import { emitCookieSnapshot } from '@/shared/lib/cookie-diag';

import { cookieBackupService } from './cookieBackupService';

interface UseCookieLifecycleArgs {
  sendToWebView: SendToWebViewFn;
}

interface UseCookieLifecycleResult {
  // Android: 콜드 스타트 시 쿠키 복원 완료 전까지 false. iOS는 항상 true.
  // 사용자가 WebView 마운트 타이밍을 이 플래그로 게이팅할 수 있다.
  cookiesRestored: boolean;
}

// Restore (cold start): Android만. iOS는 NSHTTPCookieStorage가 영속이라
//   콜드스타트에 backup으로 덮어쓰면 stale 쿠키로 회귀할 위험.
// Backup (background/inactive): iOS + Android 둘 다.
//   iOS도 토큰 쿠키가 자연 손실되는 사례가 관측되어 안전망으로 backup 유지.
export const useCookieLifecycle = ({
  sendToWebView,
}: UseCookieLifecycleArgs): UseCookieLifecycleResult => {
  const [cookiesRestored, setCookiesRestored] = useState(Platform.OS !== 'android');

  // 마운트 1회: Android 쿠키 복원
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    cookieBackupService.restore({ send: sendToWebView }).then((restored) => {
      setCookiesRestored(true);
      if (restored) {
        void emitCookieSnapshot(sendToWebView, {
          trigger: 'cold-start-after-restore',
        });
      }
    });
  }, [sendToWebView]);

  // AppState change: 백그라운드 전환 시 백업 (iOS + Android)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        void cookieBackupService.backup({ send: sendToWebView, trigger: 'appstate-background' });
      }
    });

    return () => subscription.remove();
  }, [sendToWebView]);

  return { cookiesRestored };
};
