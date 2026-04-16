/**
 * 공유 데이터(텍스트)에서 URL을 추출한다.
 * 유튜브 공유 시 "영상 제목\nhttps://youtu.be/xxx" 형태로 올 수 있으므로
 * 텍스트 전체에서 URL 패턴을 찾는다.
 */
export const parseShareUrl = (sharedText: string | undefined | null): string | null => {
  if (!sharedText) return null;

  const urlPattern = /https?:\/\/[^\s<>"')\]]+/;
  const match = sharedText.match(urlPattern);
  return match ? match[0] : null;
};

export const isYouTubeUrl = (url: string): boolean =>
  /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url);
