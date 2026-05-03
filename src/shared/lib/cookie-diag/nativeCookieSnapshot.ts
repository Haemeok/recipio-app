import CookieManager from '@preeternal/react-native-cookie-manager';
import { Platform } from 'react-native';
import { tokenFingerprint } from '@/shared/lib/auth-diag';

const TARGET_DOMAIN = 'recipio.kr';
const TARGET_URL = `https://${TARGET_DOMAIN}`;

export type CookieJarSource = 'wkwebview' | 'httpcookiestorage' | 'android-default';

export type CookieDiagEntry = {
  name: string;
  fp: string;
  domain?: string;
  path?: string;
  expires?: string;
  sessionOnly: boolean;
  secure?: boolean;
  httpOnly?: boolean;
  sourceJar: CookieJarSource;
};

type RawCookieEntry = {
  value?: string;
  domain?: string;
  path?: string;
  expires?: string;
  secure?: boolean;
  httpOnly?: boolean;
};

const toEntries = async (
  raw: Record<string, RawCookieEntry> | null | undefined,
  source: CookieJarSource
): Promise<CookieDiagEntry[]> => {
  if (!raw) return [];
  const names = Object.keys(raw);
  return Promise.all(
    names.map(async (name) => {
      const c = raw[name] ?? {};
      return {
        name,
        fp: await tokenFingerprint(c.value ?? ''),
        domain: c.domain,
        path: c.path,
        expires: c.expires || undefined,
        sessionOnly: !c.expires,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sourceJar: source,
      };
    })
  );
};

/**
 * iOS는 두 jar(WKWebView vs HTTPCookieStorage)를 모두 캡처.
 * Android는 단일 jar.
 * 실패는 swallow — 진단이 앱 동작을 막으면 안 됨.
 */
export const captureNativeCookieSnapshot = async (): Promise<CookieDiagEntry[]> => {
  try {
    if (Platform.OS === 'ios') {
      const [wk, http] = await Promise.all([
        CookieManager.get(TARGET_URL, true).catch(() => null),
        CookieManager.get(TARGET_URL, false).catch(() => null),
      ]);
      const wkEntries = await toEntries(wk as Record<string, RawCookieEntry> | null, 'wkwebview');
      const httpEntries = await toEntries(http as Record<string, RawCookieEntry> | null, 'httpcookiestorage');
      return [...wkEntries, ...httpEntries];
    }
    const cookies = await CookieManager.get(TARGET_URL).catch(() => null);
    return toEntries(cookies as Record<string, RawCookieEntry> | null, 'android-default');
  } catch (err) {
    console.warn('[cookie-diag] snapshot failed:', err);
    return [];
  }
};
