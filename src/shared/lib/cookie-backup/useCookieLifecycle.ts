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

// Android-only:
//   - 콜드 스타트에 백업된 쿠키를 WebView 쿠키 jar로 복원
//   - 백그라운드/inactive 전환 시 현재 쿠키를 백업
// iOS는 sharedCookiesEnabled로 NSHTTPCookieStorage가 영속 → 명시적 복원 불필요.
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

  // AppState change: 백그라운드 전환 시 백업
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        void cookieBackupService.backup({ send: sendToWebView });
      }
    });

    return () => subscription.remove();
  }, [sendToWebView]);

  return { cookiesRestored };
};
