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
        await CookieManager.set(`https://${BACKUP_DOMAIN}`, {
          name,
          value: cookie.value,
          domain: cookie.domain || `.${BACKUP_DOMAIN}`,
          path: cookie.path || '/',
          ...(cookie.expires && { expires: cookie.expires }),
          secure: cookie.secure ?? true,
          httpOnly: cookie.httpOnly ?? false,
        });
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
