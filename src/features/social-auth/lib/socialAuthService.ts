import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { SOCIAL_LOGIN_PATTERNS, SOCIAL_LOGIN_PATTERNS_IOS } from './constants';
import type { SocialProvider } from '../model/types';

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
 * 시스템 브라우저에서 인증 페이지 열기
 *
 * Android에서 browserPackage를 명시하지 않으면, 카카오톡/네이버 앱이 설치된 경우
 * Chrome Custom Tab 대신 해당 앱으로 직접 열어버려서 redirect가 돌아오지 않는 문제가 있음.
 * preferredBrowserPackage를 지정하면 반드시 Chrome(또는 기본 브라우저)에서 열림.
 *
 * @see https://github.com/expo/expo/issues/27500
 */
export const openAuthBrowser = async (url: string): Promise<void> => {
  const authUrl = addPlatformParam(url);
  console.log('[SocialAuth] Opening auth browser:', authUrl);

  if (Platform.OS === 'android') {
    const { browserPackages, preferredBrowserPackage } =
      await WebBrowser.getCustomTabsSupportingBrowsersAsync();
    console.log('[SocialAuth] Available browsers:', browserPackages);
    console.log('[SocialAuth] Preferred browser:', preferredBrowserPackage);

    // Chrome을 우선 사용, 없으면 preferred 브라우저 사용
    const chromePackage = browserPackages.find((pkg: string) => pkg.includes('chrome'));
    const browserToUse = chromePackage ?? preferredBrowserPackage;
    console.log('[SocialAuth] Using browser:', browserToUse);

    await WebBrowser.openBrowserAsync(authUrl, {
      browserPackage: browserToUse,
      showTitle: false,
      enableBarCollapsing: true,
    });
  } else {
    await WebBrowser.openBrowserAsync(authUrl, {
      showTitle: false,
      enableBarCollapsing: true,
    });
  }
};
