export const WEBVIEW_BASE_URL = 'https://recipio.kr';

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
