// 소셜 로그인 URL 패턴 (백엔드 API 경로)
export const SOCIAL_LOGIN_PATTERNS = [
  '/api/auth/login/google',
  '/api/auth/login/naver',
  '/api/auth/login/kakao',
  '/api/auth/login/apple',
] as const;

// 딥링크 스킴 (app.json의 scheme과 일치해야 함)
export const AUTH_REDIRECT_URL = 'recipio://auth/callback';

// 앱 콜백 URL (WebView에서 로드할 경로)
export const APP_CALLBACK_PATH = 'api/auth/app-callback';
