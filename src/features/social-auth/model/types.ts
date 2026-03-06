export type SocialProvider = 'google' | 'naver' | 'kakao' | 'apple';

export interface SocialAuthResult {
  success: boolean;
  code?: string;
  provider?: SocialProvider;
  error?: string;
}

export interface SocialAuthState {
  isAuthenticating: boolean;
  pendingProvider: SocialProvider | null;
}
