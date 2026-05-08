// AdSense (unregistered webview)에서 환경위반 감지 시 발생시키는 top-level
// navigation 식별. Google 광고 인프라 도메인을 모두 커버해서 main frame
// hijack 시도를 silent drop 시킨다.
//
// 도메인 분류:
// - DoubleClick 클릭 트래커: googleads.g.doubleclick.net, doubleclick.net
// - AdServices 어트리뷰션: googleadservices.com
// - Syndication CDN: pagead2.googlesyndication.com, tpc.googlesyndication.com,
//                    googlesyndication.com (catch-all sub)
// - Google Ad Manager: securepubads.g.doubleclick.net (DFP/GAM)
// - DoubleClick CDN: 2mdn.net (광고 크리에이티브 호스팅)
// - 측정 픽셀: googletagservices.com, googletagmanager.com (간혹 광고 흐름 포함)
const AD_REDIRECT_PATTERN =
  /(?:^|\.)(?:doubleclick\.net|googleadservices\.com|googlesyndication\.com|2mdn\.net|googletagservices\.com|googletagmanager\.com)(?:\/|$)/;

export const isAdRedirect = (url: string): boolean => {
  try {
    const hostname = new URL(url).hostname;
    return AD_REDIRECT_PATTERN.test(`.${hostname}/`);
  } catch {
    // URL 파싱 실패 (about:, data: 등) — 광고 redirect 아님
    return false;
  }
};
