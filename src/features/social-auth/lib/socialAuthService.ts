import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { SOCIAL_LOGIN_PATTERNS, AUTH_REDIRECT_URL } from './constants';
import type { SocialProvider, SocialAuthResult } from '../model/types';

/**
 * URL이 소셜 로그인 요청인지 확인
 */
export const isSocialLoginUrl = (url: string): boolean => {
  return SOCIAL_LOGIN_PATTERNS.some(pattern => url.includes(pattern));
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
 * 시스템 브라우저에서 인증 세션 열기
 */
export const openAuthSession = async (url: string): Promise<SocialAuthResult> => {
  try {
    const authUrl = addPlatformParam(url);
    const provider = extractProvider(url);

    console.log('[SocialAuth] Opening auth session:', authUrl);

    const result = await WebBrowser.openAuthSessionAsync(
      authUrl,
      AUTH_REDIRECT_URL
    );

    console.log('[SocialAuth] Auth session result:', result);

    if (result.type === 'success' && result.url) {
      // 딥링크에서 code 추출
      const { queryParams } = Linking.parse(result.url);
      const code = queryParams?.code as string | undefined;

      if (code) {
        console.log('[SocialAuth] Code received:', code.substring(0, 10) + '...');
        return { success: true, code, provider: provider ?? undefined };
      }
      return { success: false, error: 'No authorization code received' };
    }

    if (result.type === 'dismiss' || result.type === 'cancel') {
      return { success: false, error: 'Authentication cancelled by user' };
    }

    return { success: false, error: 'Authentication failed' };
  } catch (error) {
    console.error('[SocialAuth] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
