// Android: 구글/애플만 외부 브라우저 (카카오/네이버는 WebView 내 처리 — 앱 전환 문제 방지)
// 구글은 WebView 내 OAuth를 차단하므로 외부 브라우저 필수
export const SOCIAL_LOGIN_PATTERNS = [
  '/api/auth/login/google',
  '/api/auth/login/apple',
] as const;

// iOS: 모든 소셜 로그인을 외부 브라우저로 처리 (기존 방식, 문제 없음)
export const SOCIAL_LOGIN_PATTERNS_IOS = [
  '/api/auth/login/google',
  '/api/auth/login/naver',
  '/api/auth/login/kakao',
  '/api/auth/login/apple',
] as const;

// 딥링크 스킴 (app.json의 scheme과 일치해야 함)
export const AUTH_REDIRECT_URL = 'recipio://auth/callback';

// 앱 콜백 URL (WebView에서 로드할 경로)
export const APP_CALLBACK_PATH = 'api/auth/app-callback';
