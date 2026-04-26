# YouTube 공유 → 앱 수신 (Share Intent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 유튜브에서 공유 버튼 → Recipio 앱 선택 → 앱이 열리면서 `/recipes/new/youtube?url=...` WebView 페이지로 이동하여 input에 링크가 자동 입력되는 기능 구현

**Architecture:** `expo-share-intent` 라이브러리로 OS의 Share Intent를 수신하고, 공유된 URL을 파싱하여 WebView의 `source.uri`에 쿼리파라미터로 전달한다. 기존 FSD 구조를 따라 `features/share-intent/` 슬라이스로 구성한다.

**Tech Stack:** Expo 54, expo-share-intent, React Native WebView, TypeScript

---

## File Structure

```
src/
├── features/
│   └── share-intent/
│       ├── lib/
│       │   └── useShareIntent.ts    # (Create) 공유 인텐트 수신 훅
│       ├── model/
│       │   └── parseShareUrl.ts     # (Create) 공유 데이터에서 URL 추출
│       └── index.ts                 # (Create) Public API
├── shared/
│   └── config/
│       └── webview.ts               # (Create) WebView URL 상수
App.tsx                              # (Modify) 공유 URL로 WebView 초기 URL 분기
app.json                             # (Modify) Android intentFilters 추가
```

---

### Task 1: expo-share-intent 설치 및 app.json 설정

**Files:**
- Modify: `package.json` (자동 - npm install)
- Modify: `app.json:60-69` (plugins 배열에 추가 + android intentFilters)

- [ ] **Step 1: expo-share-intent 패키지 설치**

Run: `npx expo install expo-share-intent`
Expected: package.json에 expo-share-intent 추가됨

- [ ] **Step 2: app.json에 expo-share-intent 플러그인 등록**

`app.json`의 `plugins` 배열에 추가:

```json
"plugins": [
  "expo-web-browser",
  [
    "expo-notifications",
    {
      "color": "#ffffff"
    }
  ],
  "./plugins/withMaxSdkStoragePermission.js",
  [
    "expo-share-intent",
    {
      "iosActivationRules": {
        "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
        "NSExtensionActivationSupportsText": true
      },
      "androidIntentFilters": ["text/*"],
      "androidMultiIntentFilters": []
    }
  ]
]
```

> `iosActivationRules`는 iOS Share Extension이 URL과 텍스트를 수신할 수 있도록 설정한다. `androidIntentFilters`는 `text/*` MIME 타입의 Intent를 수신한다.

- [ ] **Step 3: 설정 확인을 위해 prebuild 실행**

Run: `npx expo prebuild --clean`
Expected: android/ios 폴더가 생성되고 에러 없음

- [ ] **Step 4: Commit**

```bash
git add package.json app.json
git commit -m "feat: add expo-share-intent package and configure intent filters"
```

---

### Task 2: WebView URL 상수 모듈 생성

**Files:**
- Create: `src/shared/config/webview.ts`
- Create: `src/shared/config/index.ts`

- [ ] **Step 1: WebView URL 상수 파일 생성**

Create `src/shared/config/webview.ts`:

```typescript
export const WEBVIEW_BASE_URL = 'https://www.recipio.kr';

export const WEBVIEW_PATHS = {
  HOME: '/',
  YOUTUBE_IMPORT: '/recipes/new/youtube',
} as const;

export const buildShareTargetUrl = (sharedUrl: string): string => {
  const encoded = encodeURIComponent(sharedUrl);
  return `${WEBVIEW_BASE_URL}${WEBVIEW_PATHS.YOUTUBE_IMPORT}?url=${encoded}`;
};
```

- [ ] **Step 2: config index.ts 생성**

Create `src/shared/config/index.ts`:

```typescript
export { WEBVIEW_BASE_URL, WEBVIEW_PATHS, buildShareTargetUrl } from './webview';
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/config/
git commit -m "feat: add webview URL constants and share target URL builder"
```

---

### Task 3: URL 파싱 유틸리티 구현

**Files:**
- Create: `src/features/share-intent/model/parseShareUrl.ts`

- [ ] **Step 1: parseShareUrl 구현**

Create `src/features/share-intent/model/parseShareUrl.ts`:

```typescript
/**
 * 공유 데이터(텍스트)에서 URL을 추출한다.
 * 유튜브 공유 시 "영상 제목\nhttps://youtu.be/xxx" 형태로 올 수 있으므로
 * 텍스트 전체에서 URL 패턴을 찾는다.
 */
export const parseShareUrl = (sharedText: string | undefined | null): string | null => {
  if (!sharedText) return null;

  const urlPattern = /https?:\/\/[^\s]+/;
  const match = sharedText.match(urlPattern);
  return match ? match[0] : null;
};
```

> 유튜브 공유 시 Android는 `"영상 제목 - https://youtu.be/xxx"`, iOS는 `"https://youtu.be/xxx"` 형태로 텍스트를 보낸다. 단순히 URL만 오는 게 아니라 제목이 같이 올 수 있으므로 정규식으로 URL을 추출한다.

- [ ] **Step 2: Commit**

```bash
git add src/features/share-intent/model/
git commit -m "feat: add URL parser for share intent text data"
```

---

### Task 4: useShareIntent 훅 구현

**Files:**
- Create: `src/features/share-intent/lib/useShareIntent.ts`
- Create: `src/features/share-intent/index.ts`

- [ ] **Step 1: useShareIntent 훅 구현**

Create `src/features/share-intent/lib/useShareIntent.ts`:

```typescript
import { useEffect, useState } from 'react';
import { useShareIntentContext, ShareIntentProvider } from 'expo-share-intent';
import { parseShareUrl } from '../model/parseShareUrl';
import { buildShareTargetUrl } from '@/shared/config';

/**
 * OS 공유 인텐트에서 URL을 수신하여 WebView 타겟 URL을 반환한다.
 *
 * - 공유로 앱이 열린 경우: shareTargetUrl에 값이 있음
 * - 일반 실행인 경우: shareTargetUrl은 null
 * - 공유 처리 후 resetShareIntent()로 상태를 초기화
 */
export const useShareIntent = () => {
  const { shareIntent, resetShareIntent, isReady } = useShareIntentContext();
  const [shareTargetUrl, setShareTargetUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !shareIntent) return;

    // expo-share-intent는 text 필드에 공유된 텍스트를 담아준다
    const sharedText = shareIntent.text ?? shareIntent.webUrl;
    const url = parseShareUrl(sharedText);

    if (url) {
      setShareTargetUrl(buildShareTargetUrl(url));
    }

    resetShareIntent();
  }, [shareIntent, isReady]);

  const clearShareTarget = () => {
    setShareTargetUrl(null);
  };

  return { shareTargetUrl, clearShareTarget };
};

export { ShareIntentProvider };
```

- [ ] **Step 2: Public API (index.ts) 생성**

Create `src/features/share-intent/index.ts`:

```typescript
export { useShareIntent, ShareIntentProvider } from './lib/useShareIntent';
```

- [ ] **Step 3: Commit**

```bash
git add src/features/share-intent/
git commit -m "feat: implement useShareIntent hook for receiving shared URLs"
```

---

### Task 5: App.tsx에 Share Intent 통합

**Files:**
- Modify: `App.tsx:1-275`

- [ ] **Step 1: App 컴포넌트에 ShareIntentProvider 래핑**

`App.tsx`에서 import 추가 (기존 import 아래):

```typescript
import { useShareIntent, ShareIntentProvider } from '@/features/share-intent';
import { WEBVIEW_BASE_URL } from '@/shared/config';
```

- [ ] **Step 2: AppContent에서 useShareIntent 사용**

`AppContent` 함수 내부, 기존 state 선언 아래에 추가:

```typescript
const { shareTargetUrl, clearShareTarget } = useShareIntent();
```

- [ ] **Step 3: WebView source.uri를 분기 처리**

`App.tsx`의 WebView 컴포넌트에서 `source={{ uri: mainUrl }}`을 변경:

```typescript
source={{ uri: shareTargetUrl ?? mainUrl }}
```

- [ ] **Step 4: onNavigationStateChange에서 공유 상태 초기화**

공유 URL로 이동 후 사용자가 다른 페이지로 이동하면 shareTargetUrl을 초기화해야 한다. `onNavigationStateChange` 콜백을 수정:

```typescript
onNavigationStateChange={(navState) => {
  setCanGoBack(navState.canGoBack);
  setCurrentUrl(navState.url);
  console.warn('LOADING URL: ' + navState.url);

  // 공유 URL로 이동 완료 후 상태 초기화
  if (shareTargetUrl && navState.url.includes('/recipes/new/youtube')) {
    clearShareTarget();
  }
}}
```

- [ ] **Step 5: mainUrl 상수를 WEBVIEW_BASE_URL로 교체**

`App.tsx` 상단의 `const mainUrl = 'https://recipio.kr/';`을 제거하고, WebView 및 소셜 로그인 등에서 `mainUrl`을 사용하는 곳을 `WEBVIEW_BASE_URL`로 교체:

```typescript
// 변경 전
const mainUrl = 'https://recipio.kr/';

// 변경 후: mainUrl 선언 제거, 아래처럼 교체
const { handleSocialLogin } = useSocialAuth({ webViewRef, baseUrl: WEBVIEW_BASE_URL });
```

그리고 `source` 부분:

```typescript
source={{ uri: shareTargetUrl ?? WEBVIEW_BASE_URL }}
```

> 주의: `WEBVIEW_BASE_URL`은 `https://www.recipio.kr`이고 기존 `mainUrl`은 `https://recipio.kr/`이다. 웹 서버에서 www 리다이렉트를 하는지 확인 필요. 만약 기존 도메인을 유지해야 한다면 `WEBVIEW_BASE_URL`을 `https://recipio.kr`로 맞출 것.

- [ ] **Step 6: App 컴포넌트에 ShareIntentProvider 추가**

`App()` 함수에서 `SafeAreaProvider` 안에 `ShareIntentProvider`로 감싸기:

```typescript
export default function App() {
  return (
    <SafeAreaProvider>
      <ShareIntentProvider>
        <AppContent />
      </ShareIntentProvider>
    </SafeAreaProvider>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add App.tsx
git commit -m "feat: integrate share intent with WebView URL routing"
```

---

### Task 6: 빌드 및 수동 테스트

**Files:** (없음 — 테스트 절차)

- [ ] **Step 1: Development 빌드 생성**

Run: `npx expo run:android` (또는 `eas build --profile development --platform android`)
Expected: 앱이 정상 빌드됨

> `expo-share-intent`는 네이티브 코드가 포함되므로 Expo Go에서는 동작하지 않는다. Development Build가 필요하다.

- [ ] **Step 2: 유튜브 공유 테스트 (Android)**

1. 유튜브 앱에서 아무 영상 열기
2. 공유 버튼 탭
3. 앱 목록에서 "레시피오" 선택
4. Expected: 앱이 열리면서 `https://www.recipio.kr/recipes/new/youtube?url=https%3A%2F%2Fyoutu.be%2F...` 로 WebView 로드

- [ ] **Step 3: 일반 실행 테스트**

1. 홈 화면에서 레시피오 앱 탭
2. Expected: 기존대로 `https://recipio.kr/` 메인 페이지 로드 (공유 URL 없음)

- [ ] **Step 4: iOS 테스트** (해당 시)

Run: `npx expo run:ios`
1. Safari에서 유튜브 영상 열기
2. 공유 → 레시피오 선택
3. Expected: 동일하게 WebView에 URL 파라미터 포함 로드

- [ ] **Step 5: 최종 Commit (필요 시 수정사항)**

```bash
git add -A
git commit -m "fix: address share intent integration issues from testing"
```

---

## Checklist

- [x] Android: Intent Filter로 공유 대상 등록
- [x] iOS: Share Extension으로 공유 대상 등록
- [x] 공유 데이터에서 URL 파싱
- [x] WebView에 쿼리파라미터로 URL 전달
- [x] 일반 실행 시 기존 동작 유지
- [x] FSD 구조 준수 (features/share-intent 슬라이스)
- [x] 상수 하드코딩 제거 (shared/config)
