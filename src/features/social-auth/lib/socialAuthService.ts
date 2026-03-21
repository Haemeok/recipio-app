import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { SOCIAL_LOGIN_PATTERNS, SOCIAL_LOGIN_PATTERNS_IOS, AUTH_REDIRECT_URL } from './constants';
import type { SocialProvider, SocialAuthResult } from '../model/types';

/**
 * URL이 소셜 로그인 요청인지 확인
 * iOS: 모든 소셜 로그인을 외부 브라우저로 처리 (기존 방식, 잘 동작함)
 * Android: 구글/애플만 외부 브라우저, 카카오/네이버는 WebView 내 처리
 */
export const isSocialLoginUrl = (url: string): boolean => {
  const patterns = Platform.OS === 'ios' ? SOCIAL_LOGIN_PATTERNS_IOS : SOCIAL_LOGIN_PATTERNS;
  return patterns.some(pattern => url.includes(pattern));
};

/**
 * URL에서 소셜 프로바이더 추출
 */
export const extractProvider = (url: string): SocialProvider | null => {
  if (url.includes('/google')) return 'google';
  if (url.includes('/naver')) return 'naver';
  if (url.includes('/kakao')) return 'kakao';
  if (url.includes('/apple')) return 'apple';
  return null;
};

/**
 * URL에 platform=app 파라미터 추가
 */
export const addPlatformParam = (url: string): string => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}platform=app`;
};

/**
 * iOS: openAuthSessionAsync로 인증 세션 열기
 * - ASWebAuthenticationSession 사용
 * - recipio:// 딥링크 리다이렉트를 내부에서 직접 캡처
 * - 딥링크 스킴이 OS에 등록 안 돼있어도 동작 (개발환경 포함)
 */
export const openAuthSession = async (url: string): Promise<SocialAuthResult> => {
  const authUrl = addPlatformParam(url);
  console.log('[SocialAuth] Opening auth session (iOS):', authUrl);

  try {
    const result = await WebBrowser.openAuthSessionAsync(authUrl, AUTH_REDIRECT_URL);
    console.log('[SocialAuth] Auth session result:', result);

    if (result.type === 'success' && result.url) {
      const { queryParams } = Linking.parse(result.url);
      const code = queryParams?.code as string | undefined;

      if (code) {
        return { success: true, code, provider: extractProvider(url) ?? undefined };
      }
      return { success: false, error: 'No authorization code received' };
    }

    if (result.type === 'dismiss' || result.type === 'cancel') {
      return { success: false, error: 'Authentication cancelled by user' };
    }

    return { success: false, error: 'Authentication failed' };
  } catch (error) {
    console.error('[SocialAuth] Auth session error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Android: openBrowserAsync로 Chrome Custom Tab 열기
 * - browserPackage를 명시하지 않으면, 카카오톡/네이버 앱이 설치된 경우
 *   Chrome Custom Tab 대신 해당 앱으로 직접 열어버려서 redirect가 돌아오지 않는 문제가 있음.
 * - preferredBrowserPackage를 지정하면 반드시 Chrome(또는 기본 브라우저)에서 열림.
 *
 * @see https://github.com/expo/expo/issues/27500
 */
export const openAuthBrowser = async (url: string): Promise<void> => {
  const authUrl = addPlatformParam(url);
  console.log('[SocialAuth] Opening auth browser (Android):', authUrl);

  const { browserPackages, preferredBrowserPackage } =
    await WebBrowser.getCustomTabsSupportingBrowsersAsync();
  console.log('[SocialAuth] Available browsers:', browserPackages);
  console.log('[SocialAuth] Preferred browser:', preferredBrowserPackage);

  const chromePackage = browserPackages.find((pkg: string) => pkg.includes('chrome'));
  const browserToUse = chromePackage ?? preferredBrowserPackage;
  console.log('[SocialAuth] Using browser:', browserToUse);

  await WebBrowser.openBrowserAsync(authUrl, {
    browserPackage: browserToUse,
    showTitle: false,
    enableBarCollapsing: true,
  });
};
