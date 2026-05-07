export const WEBVIEW_BASE_URL =
  'https://capstone-frontend-9zya-git-feature-17-won-jins-projects.vercel.app';

export const WEBVIEW_PATHS = {
  HOME: '/',
  YOUTUBE_IMPORT: '/recipes/new/youtube',
  APP_CALLBACK: '/api/auth/app-callback',
} as const;

export const buildShareTargetUrl = (sharedUrl: string): string => {
  const url = new URL(WEBVIEW_PATHS.YOUTUBE_IMPORT, WEBVIEW_BASE_URL);
  url.searchParams.set('url', sharedUrl);
  return url.toString();
};

export const buildAppCallbackUrl = (code: string, diagId: string): string => {
  const url = new URL(WEBVIEW_PATHS.APP_CALLBACK, WEBVIEW_BASE_URL);
  url.searchParams.set('code', code);
  url.searchParams.set('diagId', diagId);
  return url.toString();
};

if (__DEV__) {
  try {
    const sample = buildAppCallbackUrl('test-code', 'test-diag');
    const parsed = new URL(sample);
    if (!parsed.pathname.endsWith('/api/auth/app-callback')) {
      console.warn(
        '[webview] buildAppCallbackUrl pathname 비정상:',
        parsed.pathname,
        '(expected to end with /api/auth/app-callback)'
      );
    }
  } catch (e) {
    console.warn('[webview] buildAppCallbackUrl 파싱 실패:', e);
  }
}

// 외부 OAuth 페이지 (네이티브 floating back bar 표시 대상)
// 네이버는 자체 뒤로가기 있으므로 제외.
export const EXTERNAL_AUTH_DOMAINS = ['accounts.kakao.com'] as const;

export const isExternalAuthPage = (url: string): boolean =>
  EXTERNAL_AUTH_DOMAINS.some((domain) => url.includes(domain));

// 내부 도메인 (WebView에서 그대로 로드)
export const INTERNAL_DOMAINS = ['capstone-frontend', 'vercel.app', 'recipio.kr'] as const;

// OAuth 로그인 과정 도메인 (WebView 안에서 처리)
export const OAUTH_DOMAINS = [
  'accounts.kakao.com',
  'kauth.kakao.com',
  'nid.naver.com',
  'accounts.google.com',
  'appleid.apple.com',
] as const;

// 임베딩 허용 도메인 (유튜브 등)
export const ALLOWED_EMBED_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'googlevideo.com',
  'ytimg.com',
] as const;
