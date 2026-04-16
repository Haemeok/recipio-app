import { useEffect, useState } from 'react';
import { useShareIntentContext, ShareIntentProvider } from 'expo-share-intent';
import { parseShareUrl, isYouTubeUrl } from '../model/parseShareUrl';
import { buildShareTargetUrl } from '@/shared/config';

/**
 * OS 공유 인텐트에서 URL을 수신하여 WebView 타겟 URL을 반환한다.
 *
 * - 공유로 앱이 열린 경우: shareTargetUrl에 값이 있음
 * - 일반 실행인 경우: shareTargetUrl은 null
 * - 공유 처리 후 resetShareIntent()로 상태를 초기화
 */
export const useShareIntent = () => {
  const { shareIntent, resetShareIntent, isReady, hasShareIntent } = useShareIntentContext();
  const [shareTargetUrl, setShareTargetUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !hasShareIntent) return;

    // expo-share-intent는 text 필드에 공유된 텍스트를, webUrl 필드에 웹 URL을 담아준다
    const sharedText = shareIntent.text ?? shareIntent.webUrl;
    const url = parseShareUrl(sharedText);

    if (url && isYouTubeUrl(url)) {
      setShareTargetUrl(buildShareTargetUrl(url));
    }

    resetShareIntent();
  }, [shareIntent, isReady, hasShareIntent]);

  const clearShareTarget = () => {
    setShareTargetUrl(null);
  };

  return { shareTargetUrl, clearShareTarget };
};

export { ShareIntentProvider };
