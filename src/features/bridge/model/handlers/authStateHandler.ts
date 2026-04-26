import { cookieBackupService } from '@/shared/lib/cookie-backup';
import type { AuthStatePayload, BridgeMessage } from '@/shared/types';
import type { BridgeHandler } from './types';

/**
 * 웹에서 인증 상태 변경 알림을 받아 쿠키를 백업/삭제
 *
 * 웹 프론트엔드에서 보내는 메시지:
 * { type: 'AUTH_STATE_CHANGED', payload: { event: 'login' | 'refresh' | 'logout' } }
 *
 * 참고: WebView 쿠키 자체는 웹 측에서 관리. 여기선 AsyncStorage 백업만 갱신/삭제.
 */
export const authStateHandler: BridgeHandler<AuthStatePayload> = {
  handle: async (message: BridgeMessage<AuthStatePayload>) => {
    const event = message.payload?.event;

    if (!event) {
      console.warn('[AuthStateHandler] Missing event in payload');
      return;
    }

    switch (event) {
      case 'login':
      case 'refresh':
        console.log(`[AuthStateHandler] ${event} — backing up cookies`);
        await cookieBackupService.backup();
        break;

      case 'logout':
        console.log('[AuthStateHandler] logout — clearing backup');
        await cookieBackupService.clear();
        break;

      default:
        console.warn('[AuthStateHandler] Unknown event:', event);
    }
  },
};
