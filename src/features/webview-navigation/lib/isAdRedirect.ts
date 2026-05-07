// AdSense (unregistered webview)에서 환경위반 감지 시 발생시키는 top-level
// navigation 식별. 도메인 패턴은 Google 광고 인프라 — DoubleClick(클릭 트래커),
// AdServices(어트리뷰션), TPC/Pagead(syndication) 4종을 잡으면 실제 발생하는
// redirect의 대부분을 커버한다.
const AD_REDIRECT_PATTERN =
  /googleads\.g\.doubleclick\.net|googleadservices\.com|tpc\.googlesyndication\.com|pagead2\.googlesyndication\.com/;

export const isAdRedirect = (url: string): boolean => AD_REDIRECT_PATTERN.test(url);
