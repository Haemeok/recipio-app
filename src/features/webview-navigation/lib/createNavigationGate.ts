import * as WebBrowser from 'expo-web-browser';
// ShouldStartLoadRequest is not re-exported from the react-native-webview
// barrel — import directly from the types sub-path.
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import {
  ALLOWED_EMBED_DOMAINS,
  INTERNAL_DOMAINS,
  OAUTH_DOMAINS,
} from '@/shared/config';
import { isSocialLoginUrl } from '@/features/social-auth';

import { isAdRedirect } from './isAdRedirect';

interface CreateNavigationGateDeps {
  handleSocialLogin: (url: string) => void;
}

// onShouldStartLoadWithRequest 핸들러를 만들어 반환.
// 의존성을 주입받기 위해 factory 패턴 사용.
//
// 처리 우선순위:
//   1. 광고 도메인으로의 비-사용자 navigation → silent drop (외부 브라우저 X, webview 머무름)
//   2. 광고 도메인 + 사용자 클릭 → 외부 브라우저 (정상 광고 클릭)
//   3. 소셜 로그인 URL → handleSocialLogin (시스템 브라우저)
//   4. 내부/about:/data: → webview 안에서 로드
//   5. OAuth 도메인 → webview 안에서 로드
//   6. 임베드 허용 도메인 (유튜브 등) → webview 안에서 로드
//   7. 그 외 → 인앱 브라우저로 외부 송출
export const createNavigationGate =
  ({ handleSocialLogin }: CreateNavigationGateDeps) =>
  (request: ShouldStartLoadRequest): boolean => {
    const { url, navigationType } = request;

    // 1 + 2: 광고 도메인 redirect 처리
    // navigationType !== 'click'은 스크립트가 일으킨 navigation을 의미.
    // AdSense unregistered 환경위반 redirect가 여기에 해당. silent drop으로
    // 흰화면 외부 점프 방지.
    if (isAdRedirect(url) && navigationType !== 'click') {
      return false;
    }

    // 3. 소셜 로그인
    if (isSocialLoginUrl(url)) {
      handleSocialLogin(url);
      return false;
    }

    // 4. 내부 URL
    const isInternal = INTERNAL_DOMAINS.some((domain) => url.includes(domain));
    if (isInternal || url.startsWith('about:') || url.startsWith('data:')) {
      return true;
    }

    // 5. OAuth 도메인
    if (OAUTH_DOMAINS.some((domain) => url.includes(domain))) {
      return true;
    }

    // 6. 임베드 허용 도메인
    if (ALLOWED_EMBED_DOMAINS.some((domain) => url.includes(domain))) {
      return true;
    }

    // 7. 그 외 → 외부 브라우저
    void WebBrowser.openBrowserAsync(url);
    return false;
  };
