import { Platform } from 'react-native';
import {
  generateDiagId,
  sendAuthDiag,
  type SendToWebViewFn,
} from '@/shared/lib/auth-diag';
import { captureNativeCookieSnapshot, type CookieDiagEntry } from './nativeCookieSnapshot';

const MAX_COOKIES_IN_PAYLOAD = 20;

type Trigger =
  | 'foreground-resume'
  | 'post-login'
  | 'post-app-callback'
  | 'cold-start-after-restore'
  | 'periodic'
  | 'pre-backup'
  | 'pre-restore';

const isTokenCookie = (name: string): boolean =>
  /token/i.test(name) || /session/i.test(name) || /auth/i.test(name);

/**
 * iOS의 WK/HTTP 두 jar에 같은 이름 쿠키 fp가 다르면 divergence — 별도 phase로 강조.
 */
const computeDivergence = (snap: CookieDiagEntry[]): string[] => {
  if (Platform.OS !== 'ios') return [];
  const byName = new Map<string, CookieDiagEntry[]>();
  for (const e of snap) {
    const list = byName.get(e.name) ?? [];
    list.push(e);
    byName.set(e.name, list);
  }
  const diverged: string[] = [];
  for (const [name, entries] of byName) {
    if (entries.length < 2) continue;
    const fps = new Set(entries.map((e) => e.fp));
    if (fps.size > 1) diverged.push(name);
  }
  return diverged;
};

export const emitCookieSnapshot = async (
  send: SendToWebViewFn,
  params: { trigger: Trigger; diagId?: string }
): Promise<void> => {
  const snapshot = await captureNativeCookieSnapshot();
  const diagId = params.diagId ?? generateDiagId();

  const sorted = [...snapshot].sort((a, b) => {
    const ax = isTokenCookie(a.name) ? 0 : 1;
    const bx = isTokenCookie(b.name) ? 0 : 1;
    return ax - bx;
  });
  const truncated = sorted.length > MAX_COOKIES_IN_PAYLOAD;
  const cookies = sorted.slice(0, MAX_COOKIES_IN_PAYLOAD);

  sendAuthDiag(send, {
    phase: `cookie-snapshot:${params.trigger}`,
    source: 'app-rn-cookie-diag',
    diagId,
    meta: {
      platform: Platform.OS,
      total: snapshot.length,
      truncated,
      cookies,
    },
  });

  const diverged = computeDivergence(snapshot);
  if (diverged.length > 0) {
    sendAuthDiag(send, {
      phase: 'cookie-jar-divergence',
      source: 'app-rn-cookie-diag',
      diagId,
      meta: { divergedNames: diverged },
    });
  }
};
