import { useEffect } from 'react';
import { AppState } from 'react-native';
import { emitCookieSnapshot } from './emit';
import type { SendToWebViewFn } from '@/shared/lib/auth-diag';

const DEFAULT_INTERVAL_MS = 60_000;

const readIntervalMs = (): number => {
  const raw = process.env.EXPO_PUBLIC_COOKIE_DIAG_INTERVAL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
};

/**
 * 포그라운드 동안만 N초 간격으로 쿠키 스냅샷을 emit.
 * 백그라운드 시 timer 정지, foreground 복귀 시 재시작.
 *
 * AUTH_DIAG flag가 꺼져 있으면 emitCookieSnapshot 내부의 sendAuthDiag가
 * no-op이라 별도 분기는 두지 않음.
 */
export const useCookieSnapshotTimer = (send: SendToWebViewFn): void => {
  useEffect(() => {
    const intervalMs = readIntervalMs();
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer != null) return;
      timer = setInterval(() => {
        void emitCookieSnapshot(send, { trigger: 'periodic' });
      }, intervalMs);
    };

    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };

    if (AppState.currentState === 'active') start();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [send]);
};
