import CookieManager from '@preeternal/react-native-cookie-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

const COOKIE_BACKUP_KEY = 'recipio_cookie_backup';
const BACKUP_DOMAIN = 'recipio.kr';

/**
 * WebView 쿠키를 AsyncStorage에 백업/복원하는 서비스
 * Android 앱 업데이트 시 WebView 쿠키가 초기화되는 문제 대응
 */
export const cookieBackupService = {
  /**
   * recipio.kr 쿠키를 AsyncStorage에 백업
   */
  backup: async (): Promise<void> => {
    try {
      const cookies = await CookieManager.get(`https://${BACKUP_DOMAIN}`);

      if (!cookies || Object.keys(cookies).length === 0) {
        console.log('[CookieBackup] No cookies to backup');
        return;
      }

      await AsyncStorage.setItem(COOKIE_BACKUP_KEY, JSON.stringify(cookies));
      console.log('[CookieBackup] Backed up', Object.keys(cookies).length, 'cookies');
    } catch (error) {
      console.warn('[CookieBackup] Backup failed:', error);
    }
  },

  /**
   * AsyncStorage에서 쿠키를 복원하여 WebView에 세팅
   * @returns 복원 성공 여부
   */
  restore: async (): Promise<boolean> => {
    try {
      const stored = await AsyncStorage.getItem(COOKIE_BACKUP_KEY);

      if (!stored) {
        console.log('[CookieBackup] No backup found');
        return false;
      }

      const cookies = JSON.parse(stored) as Record<string, CookieEntry>;

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

type CookieEntry = {
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  secure?: boolean;
  httpOnly?: boolean;
};
