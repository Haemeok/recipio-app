# WebView Ad/Iframe Navigation Gate Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WebView 안에서 AdSense/iframe 로드가 외부 브라우저로 빠져 흰 화면이 뜨는 현상을 없애고, 광고 스크립트가 정상 작동하면서도 광고 클릭은 외부로 나가게 한다.

**Architecture:** `onShouldStartLoadWithRequest` 핸들러(`createNavigationGate`)에 **`request.isTopFrame === false`이면 항상 통과** 가드를 최상단에 추가한다. iframe 로드는 main 페이지를 바꾸지 않으므로 WebView가 그 안에서 처리하게 두면 흰 화면도 갇힘도 발생하지 않는다. main frame 분기 로직은 기존 그대로 유지.

**Tech Stack:** React Native 0.81, Expo SDK 54, react-native-webview 13.15.0, TypeScript 5.9.

**전제 조건 — 이 변경이 효력을 보려면:**
- 웹 측에서 `NEXT_PUBLIC_ADSENSE_TEST_USER_ID` 가 본인 user.id 로 설정되어 있고 production 재배포된 상태.
- 또는 `NEXT_PUBLIC_ADSENSE_TEST_USER_ID` 를 비워서 모든 사용자에게 광고가 노출되는 상태(이 fix의 최종 검증).
- 앱 측 dev build (`npm run ios` 또는 `npm run android`) 가능한 환경.

---

## File Structure

| 파일 | 책임 | 변경 종류 |
|---|---|---|
| `src/features/webview-navigation/lib/createNavigationGate.ts` | navigation 라우팅 의사결정 (iframe vs main, ad vs internal vs external) | **수정** — isTopFrame 가드 추가 |
| `src/features/webview-navigation/lib/isAdRedirect.ts` | 구글 광고 인프라 도메인 패턴 매칭 | **수정** — 도메인 패턴 확장 (방어용) |
| `src/features/webview-navigation/lib/isAdRedirect.test.ts` | 정규식 단위 테스트 (선택) | **신규 (선택)** — 테스트 인프라 미존재. 스킵 권장 |
| `App.tsx` | WebView 마운트 + 핸들러 와이어업 | **변경 없음** — 기존 props 그대로 |

테스트 인프라가 현재 프로젝트에 없습니다 (`package.json`에 jest/vitest 없음, `*.test.*` 파일 없음). 이번 fix를 위해 jest 셋업하는 건 YAGNI — 사용자가 dev build로 직접 검증한다고 명시했으므로 manual verification flow로 갑니다.

---

## Task 1: createNavigationGate에 isTopFrame 가드 추가

**Files:**
- Modify: `src/features/webview-navigation/lib/createNavigationGate.ts`

이게 이번 fix의 핵심. iframe 로드는 main 페이지를 바꾸지 않으므로 도메인 무관하게 통과시킨다. 그러면 광고 iframe (`googleads.g.doubleclick.net` 등)이 페이지 안에서 정상 마운트되고, 흰 화면 외부 점프가 발생하지 않는다.

- [ ] **Step 1: 현재 파일 읽기 (sanity check)**

Read: `src/features/webview-navigation/lib/createNavigationGate.ts`
Expected: 30-68 라인의 priority 1~7 구조 확인. priority 1이 `isAdRedirect && navigationType !== 'click'`로 시작하는 게 맞음.

- [ ] **Step 2: isTopFrame 가드를 priority 0로 추가**

`createNavigationGate.ts` 의 returned 함수 본문에서, 기존 priority 1 위에 새 priority 0 분기를 추가한다.

```typescript
import * as WebBrowser from 'expo-web-browser';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import {
  ALLOWED_EMBED_DOMAINS,
  INTERNAL_DOMAINS,
  OAUTH_DOMAINS,
} from '@/shared/config';
import { isSocialLoginUrl } from '@/features/social-auth';

import { isAdRedirect } from './isAdRedirect';

interface CreateNavigationGateDeps {
  handleSocialLogin: (url: string) => void;
}

// onShouldStartLoadWithRequest 핸들러를 만들어 반환.
// 의존성을 주입받기 위해 factory 패턴 사용.
//
// 처리 우선순위:
//   0. sub-frame (iframe) 로드 → 무조건 통과 (main 페이지는 안 바뀜)
//      → 광고 iframe, 유튜브 임베드 등이 도메인 검사 없이 안전하게 로드됨
//   1. 광고 도메인으로의 비-사용자 main frame navigation → silent drop
//      (외부 브라우저 X, webview 머무름) — top.location 같은 hijack 방어
//   2. 광고 도메인 + 사용자 클릭 (main frame) → 외부 브라우저 (정상 광고 클릭)
//   3. 소셜 로그인 URL → handleSocialLogin (시스템 브라우저)
//   4. 내부/about:/data: → webview 안에서 로드
//   5. OAuth 도메인 → webview 안에서 로드
//   6. 임베드 허용 도메인 (유튜브 등) → webview 안에서 로드
//   7. 그 외 → 인앱 브라우저로 외부 송출
export const createNavigationGate =
  ({ handleSocialLogin }: CreateNavigationGateDeps) =>
  (request: ShouldStartLoadRequest): boolean => {
    const { url, navigationType, isTopFrame } = request;

    // 0. sub-frame 로드는 무조건 통과.
    // iframe은 main 페이지 URL을 바꾸지 않으므로 어떤 도메인이든 WebView 안에서
    // 처리하면 안전. AdSense 광고 iframe, 유튜브 임베드, 광고 트래커 iframe 등이
    // 모두 여기로 빠져 흰 화면 외부 점프가 발생하지 않는다.
    if (!isTopFrame) {
      return true;
    }

    // 1 + 2: 광고 도메인 redirect 처리 (main frame only — sub-frame은 위에서 통과)
    // navigationType !== 'click'은 스크립트가 일으킨 navigation을 의미.
    // AdSense 환경위반 redirect나 측정 스크립트의 top.location hijack이 여기에
    // 해당. silent drop으로 흰화면 외부 점프 방지.
    if (isAdRedirect(url) && navigationType !== 'click') {
      return false;
    }

    // 3. 소셜 로그인
    if (isSocialLoginUrl(url)) {
      handleSocialLogin(url);
      return false;
    }

    // 4. 내부 URL
    const isInternal = INTERNAL_DOMAINS.some((domain) => url.includes(domain));
    if (isInternal || url.startsWith('about:') || url.startsWith('data:')) {
      return true;
    }

    // 5. OAuth 도메인
    if (OAUTH_DOMAINS.some((domain) => url.includes(domain))) {
      return true;
    }

    // 6. 임베드 허용 도메인
    if (ALLOWED_EMBED_DOMAINS.some((domain) => url.includes(domain))) {
      return true;
    }

    // 7. 그 외 → 외부 브라우저
    void WebBrowser.openBrowserAsync(url);
    return false;
  };
```

핵심 변경:
- 함수 첫 줄에서 `isTopFrame`을 destructure.
- priority 0: `if (!isTopFrame) return true;` 가드.
- priority 1 주석에 "main frame only" 명시.

다른 라인은 변경 없음 (priority 3~7 동일).

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건. `isTopFrame` 은 `ShouldStartLoadRequest` 의 필드 (react-native-webview 13.15.0 의 `lib/WebViewTypes.d.ts` 에 정의됨)이므로 타입 OK.

만약 에러가 나면 import 누락 가능성. `ShouldStartLoadRequest`는 이미 import되어 있어야 함.

- [ ] **Step 4: 정신차림 체크 — 코드 다시 한 번 읽고 priority 순서 확인**

Read: `src/features/webview-navigation/lib/createNavigationGate.ts`
Expected:
- priority 0 가 함수 첫 분기.
- priority 1 (isAdRedirect) 다음에 위치.
- priority 7 (WebBrowser.openBrowserAsync) 가 마지막.
- destructure에 `isTopFrame` 포함.

---

## Task 2: isAdRedirect 정규식 확장 (방어용)

**Files:**
- Modify: `src/features/webview-navigation/lib/isAdRedirect.ts`

Task 1만으로도 흰 화면은 거의 사라지지만, 만약 AdSense가 main frame을 통째로 광고 도메인으로 보내려는 케이스(드물지만 있음)가 발생하면 silent drop이 작동해야 함. 현재 정규식은 4개 도메인만 잡아서 누수가 있을 수 있다. 알려진 Google 광고 인프라를 추가로 등록한다.

- [ ] **Step 1: 정규식 확장**

`src/features/webview-navigation/lib/isAdRedirect.ts` 전체를 다음으로 교체:

```typescript
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
```

핵심 변경:
- `URL` 파싱으로 hostname 추출 후 매칭 → 쿼리스트링이나 path에 광고 도메인 문자열이 포함된 경우 (예: 우리 페이지에서 `?redirect=doubleclick.net`) 오탐 방지.
- 도메인 추가: `2mdn.net`, `googletagservices.com`, `googletagmanager.com`.
- 서브도메인 catch-all: `googlesyndication.com` 의 모든 서브를 잡음 (현재는 pagead2/tpc만).
- `(?:^|\.)` 와 `(?:\/|$)` boundary로 부분 매칭 방지.

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건.

- [ ] **Step 3: 정규식 동작 사고실험**

다음 URL들이 어떻게 처리되는지 머릿속으로 한 번 돌려보고 의도와 일치하는지 확인:

| URL | 기대 | 검증 |
|---|---|---|
| `https://googleads.g.doubleclick.net/pagead/...` | true | hostname=`googleads.g.doubleclick.net`, `.googleads.g.doubleclick.net/` 가 `(?:^\|\.)doubleclick\.net(?:\/\|$)` 매칭 ✓ |
| `https://pagead2.googlesyndication.com/...` | true | hostname=`pagead2.googlesyndication.com`, `.googlesyndication.com/` 매칭 ✓ |
| `https://2mdn.net/creative.jpg` | true | hostname=`2mdn.net`, `.2mdn.net/` 매칭 ✓ |
| `https://recipio.kr/?ref=doubleclick.net` | false | hostname=`recipio.kr`, 매칭 없음 ✓ |
| `about:blank` | false | URL 파싱 성공, hostname=`""`, 매칭 없음 ✓ |
| `data:text/html,...` | false | URL 파싱 성공, hostname=`""`, 매칭 없음 ✓ |

만약 한 케이스라도 의도와 다르면 정규식 다시 검토.

---

## Task 3: 개발 빌드 + 시나리오별 수동 검증

**Files:** (변경 없음 — 검증 단계)

테스트 인프라가 없으므로 dev build로 시나리오별 동작을 직접 확인한다. 각 시나리오는 **observable한 outcome**으로 검증.

**선결 조건:**
- 웹 측 `NEXT_PUBLIC_ADSENSE_TEST_USER_ID` 가 본인 user.id 로 설정되어 있고 prod 재배포 완료. (또는 testid 비워서 전체 노출 모드.)
- iOS 시뮬레이터/실기기 또는 Android 에뮬레이터/실기기 준비.

- [ ] **Step 1: dev 빌드 시작**

iOS:
```bash
npm run ios
```

Android:
```bash
npm run android
```

Expected: Metro bundler 시작 + 시뮬레이터 또는 기기에 앱 설치 완료. 콘솔에 컴파일 에러 0건.

- [ ] **Step 2: 시나리오 A — 앱 시작 시 흰 화면 안 뜨는지 확인 (가장 중요)**

1. 본인 계정(테스트 유저)으로 로그인된 상태에서 앱 cold start.
2. 홈 → 레시피 상세 진입.
3. 광고가 노출될 시점에 흰 화면이나 외부 브라우저가 뜨는지 관찰.

Expected:
- 흰 화면 외부 브라우저 띄움 0건.
- 레시피 페이지 그대로 머뭄.
- in-article 광고 슬롯에 광고가 그려지거나 (모바일 hidden 정책으로) 비어있음.
- bottom anchor 광고가 정상 노출됨.

만약 여전히 흰 화면이 뜬다면:
- Metro 콘솔의 `[CONSOLE]` 출력 확인 (CONSOLE_BRIDGE_SCRIPT 가 web JS console을 RN으로 forward).
- 어떤 URL이 외부로 빠지는지 추적. createNavigationGate에 임시 `console.log(url, isTopFrame, navigationType)` 박아서 확인.

- [ ] **Step 3: 시나리오 B — 검색 페이지 in-feed 광고 정상 노출 확인**

1. 검색 페이지 진입.
2. 8개 카드 단위로 광고 슬롯이 끼어드는지 관찰.
3. 무한 스크롤로 56개 이상까지 내려가도 (7번째 광고 자리부터는 슬롯 부족으로 자리 비움) 흰 화면 발생 없는지.

Expected:
- 흰 화면 0건.
- 광고 슬롯 1~6번째에 서로 다른 광고 노출 (또는 모바일 정책으로 비어있음 — 현재 InFeedAdSlot 은 모바일 hidden 안 함).
- 7번째 광고 자리(56번째 카드 이후)는 자연스럽게 그냥 카드만 이어짐.

- [ ] **Step 4: 시나리오 C — 유튜브 임베드 정상 동작 확인 (regression check)**

1. 유튜브 비디오가 임베드된 레시피 상세 진입.
2. 비디오 iframe이 정상 로드되는지 확인.

Expected:
- YouTube 임베드가 페이지 안에서 정상 재생 가능.
- 외부 브라우저 띄움 없음.

이 시나리오는 `ALLOWED_EMBED_DOMAINS` 분기가 main-frame 전용으로만 작동해도 sub-frame iframe은 priority 0에서 통과하므로 정상이어야 함. regression이 없는지 확인하는 단계.

- [ ] **Step 5: 시나리오 D — 외부 링크 클릭 시 시스템/인앱 브라우저로 빠지는지 확인 (regression check)**

1. 레시피 상세 → 본문 안 외부 링크(블로그 등) 클릭.
2. 인앱 브라우저(`WebBrowser.openBrowserAsync`)가 열리는지 확인.

Expected:
- 사용자 클릭으로 외부 도메인 main-frame navigation 시 인앱 브라우저로 정상 송출.
- WebView는 레시피 페이지 그대로 유지.

- [ ] **Step 6: 시나리오 E — 광고 클릭 시 외부로 빠지는지 (옵션, 광고 노출 환경에서만)**

1. 레시피 상세 → in-article 광고 클릭.
2. 시스템/인앱 브라우저로 광고주 페이지가 열리는지 확인.

Expected:
- 광고 클릭은 main-frame navigation을 일으키므로 priority 7(WebBrowser.openBrowserAsync) 또는 priority 2(광고 도메인 + click navigationType)에 의해 외부로 빠짐.
- WebView는 레시피 페이지 그대로 유지.

- [ ] **Step 7: 양 플랫폼 검증**

iOS와 Android 모두에서 시나리오 A~E 반복.

iOS-specific 주의:
- WKWebView는 `isTopFrame` 를 최신 RN WebView (10.x+) 부터 정확히 보고함. 13.15.0이라 OK.

Android-specific 주의:
- `setSupportMultipleWindows`가 false (기본값) 이라 `window.open` 호출 시 별도 창 생성 안 함, 같은 창에서 navigation으로 처리됨. 그게 main-frame navigation으로 잡혀 우리 gate를 통과.

만약 한쪽 플랫폼에서만 흰 화면이 보이면 그 플랫폼의 `request.isTopFrame` 값이 의도와 다를 수 있음. createNavigationGate에 디버그 로그 박아서 추적.

---

## Task 4: 커밋

**Files:** (커밋 메타)

- [ ] **Step 1: git status로 변경 사항 확인**

Run: `git -C "C:/Users/user/Desktop/recipio-app" status --short`
Expected:
```
 M src/features/webview-navigation/lib/createNavigationGate.ts
 M src/features/webview-navigation/lib/isAdRedirect.ts
```

- [ ] **Step 2: 변경 staging + 커밋**

```bash
git -C "C:/Users/user/Desktop/recipio-app" add src/features/webview-navigation/lib/createNavigationGate.ts src/features/webview-navigation/lib/isAdRedirect.ts
git -C "C:/Users/user/Desktop/recipio-app" commit -m "$(cat <<'EOF'
fix(webview): allow sub-frame loads to pass through navigation gate

AdSense ad iframes (and any other iframe loads) were hitting the external
browser fallback at priority 7 of createNavigationGate, causing white pages
to open at app start once the test user gate let ads through. The gate
treated iframe loads the same as main-frame navigations.

Add a priority 0 guard that returns true whenever request.isTopFrame is
false. Iframes do not change the main page URL, so letting WebView handle
them in-place is safe and matches the behavior we want for ad iframes,
youtube embeds, and any other sub-frame content.

Also expand isAdRedirect to cover doubleclick.net (parent), 2mdn.net,
googletagservices.com, and googletagmanager.com, and parse hostname via
URL constructor to avoid false positives from query strings.
EOF
)"
```

- [ ] **Step 3: 커밋 메시지 검토**

Run: `git -C "C:/Users/user/Desktop/recipio-app" log -1 --stat`
Expected:
- 두 파일이 수정된 것으로 표시.
- 메시지에 동기와 변경 요약이 명확.

---

## Self-Review (이미 수행됨)

**Spec coverage:**
- 흰 화면 발생 원인 (iframe 로드가 외부로 빠짐) → Task 1에서 isTopFrame 가드로 해결.
- 광고 클릭은 외부로 빠져야 함 → 기존 priority 7 로직 그대로 유지, regression 시나리오 D/E 로 검증.
- main-frame ad redirect 방어 → Task 1의 priority 1 (기존 로직) + Task 2의 정규식 확장으로 강화.
- 갇힘 방지 → priority 0이 iframe만 통과시키고 main-frame 외부 도메인은 priority 7에서 외부로 송출.

**Placeholder scan:** "TBD", "TODO", "implement later" 등 없음. 모든 step에 실행 가능한 코드/명령 포함.

**Type consistency:** `request.isTopFrame`, `request.navigationType`, `request.url` 모두 `ShouldStartLoadRequest` (`react-native-webview/lib/WebViewTypes`) 의 정의된 필드. 13.15.0 에서 검증됨.

**테스트 부재 결정:** 테스트 인프라 없음, 사용자가 manual verification 명시 → TDD 스킵 합당. 시나리오 A~E가 회귀 검증 대체.

---

## 추가 — 이 fix가 안 될 경우의 fallback 분석

만약 검증에서 흰 화면이 여전히 발생하면 다음 후보를 순서대로 점검:

1. **`isTopFrame` 값이 거꾸로 보고됨** — 어떤 RN WebView 빌드에서 sub-frame인데 isTopFrame=true 로 오는 케이스. 확률 낮지만 발생 시 `mainDocumentURL !== url` 체크로 보강 가능.
2. **`onOpenWindow` 미설정으로 인한 popup 누수** — 광고가 `window.open` 호출 시 default 동작. 필요하면 `MainWebView.tsx` 에 `onOpenWindow={({ nativeEvent }) => WebBrowser.openBrowserAsync(nativeEvent.targetUrl)}` 추가.
3. **`setSupportMultipleWindows` (Android)** — 기본 false. 켜야 할 케이스가 있다면 별도 분석 필요.

이 후보들은 본 plan에 포함하지 않음 — Task 1+2 만으로 해결되는지 먼저 확인 후 필요 시 follow-up plan 작성.
