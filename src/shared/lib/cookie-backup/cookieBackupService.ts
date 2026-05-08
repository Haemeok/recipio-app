import { Platform } from 'react-native';
import CookieManager from '@preeternal/react-native-cookie-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  generateDiagId,
  sendAuthDiag,
  tokenFingerprint,
  type SendToWebViewFn,
} from '@/shared/lib/auth-diag';

const COOKIE_BACKUP_KEY = 'recipio_cookie_backup';
const BACKUP_DOMAIN = 'recipio.kr';

// Token 쿠키 식별 패턴 — cookie-diag/emit.ts:21과 일치 유지.
// 이 패턴에 매치되는 쿠키엔 restore() 시 secure/httpOnly/expires를 강제 주입한다.
const TOKEN_COOKIE_PATTERN = /token|session|auth/i;

const TOKEN_RESTORE_EXPIRY_DAYS = 90;

/**
 * Native CookieManagerModule.kt parseDate가 받는 포맷:
 *   yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ (ISO 8601 with timezone)
 * Date.toISOString()은 'Z'로 끝나는데 SimpleDateFormat의 ZZZZZ는
 * +00:00 형식만 받으므로 replace 한 단계 필요.
 */
const buildExpiryString = (daysFromNow: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().replace('Z', '+00:00');
};

type CookieEntry = {
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  secure?: boolean;
  httpOnly?: boolean;
};

type EmitOpts = { send?: SendToWebViewFn };

const summarizeCookies = async (
  cookies: Record<string, CookieEntry>
): Promise<
  Array<{
    name: string;
    fp: string;
    domain?: string;
    path?: string;
    expires?: string;
    sessionOnly: boolean;
    secure?: boolean;
    httpOnly?: boolean;
  }>
> => {
  const names = Object.keys(cookies);
  return Promise.all(
    names.map(async (name) => {
      const c = cookies[name];
      return {
        name,
        fp: await tokenFingerprint(c.value ?? ''),
        domain: c.domain,
        path: c.path,
        expires: c.expires || undefined,
        sessionOnly: !c.expires,
        secure: c.secure,
        httpOnly: c.httpOnly,
      };
    })
  );
};

/**
 * WebView 쿠키를 AsyncStorage에 백업/복원하는 서비스
 * Android 앱 업데이트 시 WebView 쿠키가 초기화되는 문제 대응
 *
 * 동작은 변경 금지 (운영 telemetry로 net-positive 입증).
 * 진단 emit만 옵션으로 추가 — `send` 미지정 시 emit 생략.
 */
export const cookieBackupService = {
  backup: async ({ send }: EmitOpts = {}): Promise<void> => {
    try {
      const cookies = await CookieManager.get(`https://${BACKUP_DOMAIN}`);

      if (!cookies || Object.keys(cookies).length === 0) {
        console.log('[CookieBackup] No cookies to backup');
        if (send) {
          sendAuthDiag(send, {
            phase: 'cookie-mutation:backup',
            source: 'app-rn-cookie-backup',
            diagId: generateDiagId(),
            meta: { result: 'no-cookies' },
          });
        }
        return;
      }

      // 토큰 쿠키가 없으면 backup skip — 이전에 토큰 포함된 좋은 backup을
      // GA-only 같은 무의미한 backup으로 덮어쓰지 않기 위함.
      const hasAuthToken =
        Object.prototype.hasOwnProperty.call(cookies, 'accessToken') ||
        Object.prototype.hasOwnProperty.call(cookies, 'refreshToken');
      if (!hasAuthToken) {
        console.log('[CookieBackup] No auth tokens — backup skipped (preserving previous)');
        if (send) {
          sendAuthDiag(send, {
            phase: 'cookie-mutation:backup',
            source: 'app-rn-cookie-backup',
            diagId: generateDiagId(),
            meta: { result: 'skipped-no-tokens', count: Object.keys(cookies).length },
          });
        }
        return;
      }

      if (send) {
        const summary = await summarizeCookies(cookies as Record<string, CookieEntry>);
        sendAuthDiag(send, {
          phase: 'cookie-mutation:backup',
          source: 'app-rn-cookie-backup',
          diagId: generateDiagId(),
          meta: { result: 'written', count: summary.length, cookies: summary },
        });
      }

      await AsyncStorage.setItem(COOKIE_BACKUP_KEY, JSON.stringify(cookies));
      console.log('[CookieBackup] Backed up', Object.keys(cookies).length, 'cookies');
    } catch (error) {
      console.warn('[CookieBackup] Backup failed:', error);
      if (send) {
        sendAuthDiag(send, {
          phase: 'cookie-mutation:backup',
          source: 'app-rn-cookie-backup',
          diagId: generateDiagId(),
          meta: { result: 'error', error: String(error) },
        });
      }
    }
  },

  /**
   * AsyncStorage에서 쿠키를 복원하여 WebView에 세팅
   * @returns 복원 성공 여부
   */
  restore: async ({ send }: EmitOpts = {}): Promise<boolean> => {
    try {
      const stored = await AsyncStorage.getItem(COOKIE_BACKUP_KEY);

      if (!stored) {
        console.log('[CookieBackup] No backup found');
        if (send) {
          sendAuthDiag(send, {
            phase: 'cookie-mutation:restore',
            source: 'app-rn-cookie-backup',
            diagId: generateDiagId(),
            meta: { result: 'no-backup' },
          });
        }
        return false;
      }

      const cookies = JSON.parse(stored) as Record<string, CookieEntry>;

      if (send) {
        const summary = await summarizeCookies(cookies);
        sendAuthDiag(send, {
          phase: 'cookie-mutation:restore',
          source: 'app-rn-cookie-backup',
          diagId: generateDiagId(),
          meta: { result: 'restoring', count: summary.length, cookies: summary },
        });
      }

      for (const [name, cookie] of Object.entries(cookies)) {
        const isToken = TOKEN_COOKIE_PATTERN.test(name);

        // Token 쿠키: native가 잃어버린 attribute 강제 보정.
        // 비-token 쿠키: backup 시점 값 그대로 (secure/httpOnly가 명시적 true인 경우만 살림).
        const cookieData = {
          name,
          value: cookie.value,
          domain: cookie.domain || `.${BACKUP_DOMAIN}`,
          path: cookie.path || '/',
          ...(cookie.expires
            ? { expires: cookie.expires }
            : isToken
              ? { expires: buildExpiryString(TOKEN_RESTORE_EXPIRY_DAYS) }
              : {}),
          secure: isToken ? true : cookie.secure === true,
          httpOnly: isToken ? true : cookie.httpOnly === true,
        };

        if (Platform.OS === 'ios') {
          // WKWebView jar(useWebKit:true) + HTTPCookieStorage 둘 다 set
          // — clearAllCookies와 대칭. 둘 중 한쪽만 set하면 reload 시 401, 다음
          // background→foreground 동기화 후에야 적용되는 race가 발생.
          await CookieManager.set(`https://${BACKUP_DOMAIN}`, cookieData, true);
          await CookieManager.set(`https://${BACKUP_DOMAIN}`, cookieData, false);
        } else {
          await CookieManager.set(`https://${BACKUP_DOMAIN}`, cookieData);
        }
      }

      console.log('[CookieBackup] Restored', Object.keys(cookies).length, 'cookies');
      return true;
    } catch (error) {
      console.warn('[CookieBackup] Restore failed:', error);
      if (send) {
        sendAuthDiag(send, {
          phase: 'cookie-mutation:restore',
          source: 'app-rn-cookie-backup',
          diagId: generateDiagId(),
          meta: { result: 'error', error: String(error) },
        });
      }
      return false;
    }
  },

  /**
   * 백업 데이터 삭제 (로그아웃 시)
   */
  clear: async (): Promise<void> => {
    try {
      await AsyncStorage.removeItem(COOKIE_BACKUP_KEY);
      console.log('[CookieBackup] Backup cleared');
    } catch (error) {
      console.warn('[CookieBackup] Clear failed:', error);
    }
  },
};
