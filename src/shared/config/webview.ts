export const WEBVIEW_BASE_URL = 'https://recipio.kr';

export const WEBVIEW_PATHS = {
  HOME: '/',
  YOUTUBE_IMPORT: '/recipes/new/youtube',
} as const;

export const buildShareTargetUrl = (sharedUrl: string): string => {
  const encoded = encodeURIComponent(sharedUrl);
  return `${WEBVIEW_BASE_URL}${WEBVIEW_PATHS.YOUTUBE_IMPORT}?url=${encoded}`;
};
