# App.tsx Decomposition + AdSense Silent-Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose 414-line `App.tsx` god-component into FSD-aligned slices following single-responsibility, and add a 5-line silent-drop fix to the navigation gate so AdSense's environment-violation top-level navigations no longer flash an external Google URL. Net result: smaller App.tsx (~50 lines), fix lands inside the new navigation feature.

**Architecture:** Pure helpers and hooks extract first to `shared/lib/` and `features/`, UI blocks become widgets, App.tsx becomes thin composition. Silent-drop logic lives inside `features/webview-navigation/` alongside the existing URL gate, so it's covered by the same code path and not a sprinkled if-statement.

**Tech Stack:** React Native 0.81.5, Expo 54 managed (dev client), `react-native-webview` 13.15.0, FSD (Feature-Sliced Design) per project CLAUDE.md.

**Related context:**
- Spec: `docs/superpowers/specs/2026-05-07-adsense-webview-integration-design.md` (REVISED — registerWebView path abandoned, see Task 14)
- Earlier plan: `docs/superpowers/plans/2026-05-07-adsense-webview-integration.md` (REVISED — supplanted by this plan)
- Background: invertase/react-native-google-mobile-ads@16.3.3 does NOT expose `registerWebView`. Pivoted to navigation-layer silent-drop.

---

## Testing Approach

This RN repo has no Jest infrastructure. Adding it just for this refactor is scope creep. Verification strategy:

- **`tsc --noEmit`** after each task
- **`eslint App.tsx <new-file>`** where applicable
- **Manual smoke test** at the end (full task list in Task 15)
- **Atomic commits** so any regression can be bisected and reverted cleanly

The decomposition is mostly mechanical (move code to a new file, import where it was). Type errors and missing imports are the primary failure modes — both caught by `tsc`. The silent-drop logic is the one place where logic actually changes; that's manually tested last.

---

## File Structure (All Files Affected)

| Path | Action | Responsibility |
|---|---|---|
| (revert) | revert commit `e9243c7` | Remove unused `react-native-google-mobile-ads` + `expo-tracking-transparency` deps + their app.json plugin entries |
| `src/shared/config/webview.ts` | **modify** | Add INTERNAL/OAUTH/ALLOWED_EMBED/EXTERNAL_AUTH domain constants + helpers |
| `src/shared/lib/console-bridge/index.ts` | **create** | Public API |
| `src/shared/lib/console-bridge/injectedScript.ts` | **create** | webview console.log → RN postMessage script |
| `src/features/webview-navigation/index.ts` | **create** | Public API |
| `src/features/webview-navigation/lib/isAdRedirect.ts` | **create** | Pure predicate: ad-domain redirect detection (silent-drop subject) |
| `src/features/webview-navigation/lib/createNavigationGate.ts` | **create** | Factory returning the navigation handler |
| `src/shared/lib/cookie-backup/useCookieLifecycle.ts` | **create** | Android cookie restore on mount + backup on background |
| `src/shared/lib/cookie-backup/index.ts` | **modify** | Re-export `useCookieLifecycle` |
| `src/shared/lib/auth-diag/useForegroundResumeDiag.ts` | **create** | AppState foreground listener emitting diag + snapshot |
| `src/shared/lib/auth-diag/index.ts` | **modify** | Re-export `useForegroundResumeDiag` |
| `src/features/android-back/index.ts` | **create** | Public API |
| `src/features/android-back/lib/useAndroidBackHandler.ts` | **create** | Back handler with double-press-to-exit |
| `src/features/webview-nav-state/index.ts` | **create** | Public API |
| `src/features/webview-nav-state/lib/useWebViewNavState.ts` | **create** | canGoBack + currentUrl + auth-phase diag |
| `src/widgets/debug-overlay/index.ts` | **create** | Public API |
| `src/widgets/debug-overlay/ui/DebugOverlay.tsx` | **create** | Dev refresh/cookie-clear/restore-test bar |
| `src/widgets/floating-back-bar/index.ts` | **create** | Public API |
| `src/widgets/floating-back-bar/ui/FloatingBackBar.tsx` | **create** | Android external-auth-page back button |
| `src/widgets/main-webview/index.ts` | **create** | Public API |
| `src/widgets/main-webview/ui/MainWebView.tsx` | **create** | The `<WebView>` with all props wired |
| `App.tsx` | **modify (drastically)** | Thin composition (~50 lines) |
| `docs/superpowers/specs/2026-05-07-adsense-webview-integration-design.md` | **modify** | Append REVISED note at top |
| `docs/superpowers/plans/2026-05-07-adsense-webview-integration.md` | **modify** | Append REVISED note at top |

---

## Task 1: Revert package install commit

**Files:**
- Revert: commit `e9243c7` (touched `package.json`, `package-lock.json`, `app.json`)

**Why first:** Clean slate before refactor. Both packages installed in that commit (`react-native-google-mobile-ads`, `expo-tracking-transparency`) are unused in the new approach. Their config plugin entries in `app.json` would inject useless native fields.

- [ ] **Step 1: Verify nothing else dirty**

Run:
```bash
git status --short
```
Expected output: only the pre-existing dirty files (`.claude/settings.local.json`, `token.md`). If any other M/A/D files exist, STOP and report.

- [ ] **Step 2: Revert the commit**

Run:
```bash
git revert e9243c7 --no-edit
```

Expected: a new commit titled `Revert "chore(deps): add react-native-google-mobile-ads + expo-tracking-transparency"` undoing the package additions and the two app.json plugin entries.

- [ ] **Step 3: Verify revert content**

Run:
```bash
git diff HEAD~1 HEAD --stat
git show HEAD --stat
```

Expected: `package.json`, `package-lock.json`, `app.json` modified; net change reverses the original install. `react-native-google-mobile-ads` and `expo-tracking-transparency` should NO LONGER appear in `package.json` dependencies.

Confirm:
```bash
grep -E "react-native-google-mobile-ads|expo-tracking-transparency" package.json
```
Expected: no output.

- [ ] **Step 4: Append Co-Authored-By trailer if missing**

Recent commits use this trailer:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

If the auto-generated revert message lacks it, amend immediately (this is a fresh commit; amending it once before any further work is acceptable):
```bash
git commit --amend --no-edit -m "$(cat <<'EOF'
Revert "chore(deps): add react-native-google-mobile-ads + expo-tracking-transparency"

This reverts commit e9243c759da4bc8c19ec3ee48bbcf7eb26e68ae4.

The original plan was to call MobileAds.registerWebView() to register
our WebView with the Google Mobile Ads SDK. Investigation revealed
react-native-google-mobile-ads@16.3.3 does not expose that method
(no PR/issue tracking it either). Pivoting to a navigation-layer
silent-drop in features/webview-navigation. These two packages are
no longer needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If the trailer is already present from automated tooling, skip this amend.

---

## Task 2: Move URL domain constants to `shared/config/webview.ts`

**Files:**
- Modify: `src/shared/config/webview.ts` (currently exports `WEBVIEW_BASE_URL`, `WEBVIEW_PATHS`, `buildShareTargetUrl`, `buildAppCallbackUrl`)
- Modify: `App.tsx` (lines 22-41 deletions + new imports)

**Why this slice:** All URL-related constants live in one config file. Drops the dead `feature17Url` (line 42, unused).

- [ ] **Step 1: Update `src/shared/config/webview.ts`**

Append to the existing file (do NOT replace the existing exports):

```ts
// 외부 OAuth 페이지 (네이티브 floating back bar 표시 대상)
// 네이버는 자체 뒤로가기 있으므로 제외.
export const EXTERNAL_AUTH_DOMAINS = ['accounts.kakao.com'] as const;

export const isExternalAuthPage = (url: string): boolean =>
  EXTERNAL_AUTH_DOMAINS.some((domain) => url.includes(domain));

// 내부 도메인 (WebView에서 그대로 로드)
export const INTERNAL_DOMAINS = ['capstone-frontend', 'vercel.app', 'recipio.kr'] as const;

// OAuth 로그인 과정 도메인 (WebView 안에서 처리)
export const OAUTH_DOMAINS = [
  'accounts.kakao.com',
  'kauth.kakao.com',
  'nid.naver.com',
  'accounts.google.com',
  'appleid.apple.com',
] as const;

// 임베딩 허용 도메인 (유튜브 등)
export const ALLOWED_EMBED_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'googlevideo.com',
  'ytimg.com',
] as const;
```

- [ ] **Step 2: Remove from App.tsx**

In `App.tsx`, delete lines 20-42 (the four `const ... DOMAINS` blocks, `isExternalAuthPage`, and `feature17Url`).

- [ ] **Step 3: Add imports to App.tsx**

Update the existing import from `@/shared/config`:

```ts
// before
import { WEBVIEW_BASE_URL } from '@/shared/config';

// after
import {
  WEBVIEW_BASE_URL,
  EXTERNAL_AUTH_DOMAINS,
  INTERNAL_DOMAINS,
  OAUTH_DOMAINS,
  ALLOWED_EMBED_DOMAINS,
  isExternalAuthPage,
} from '@/shared/config';
```

> Note: `EXTERNAL_AUTH_DOMAINS` is imported even though only `isExternalAuthPage` uses it externally. Importing both is a no-op — remove `EXTERNAL_AUTH_DOMAINS` if `tsc --noEmit` flags unused-import in this file.

- [ ] **Step 4: Verify `src/shared/config/index.ts` re-exports the new symbols**

Run:
```bash
grep -E "EXTERNAL_AUTH_DOMAINS|INTERNAL_DOMAINS|OAUTH_DOMAINS|ALLOWED_EMBED_DOMAINS|isExternalAuthPage" src/shared/config/index.ts
```

If the index file uses `export * from './webview'` then no change needed — confirm with `cat src/shared/config/index.ts`. If it uses named re-exports, add the new symbols to the re-export list.

- [ ] **Step 5: TypeScript check**

Run:
```bash
npx tsc --noEmit
```
Expected: PASS, no errors related to `App.tsx` or `shared/config/webview.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/shared/config/webview.ts src/shared/config/index.ts App.tsx
git commit -m "$(cat <<'EOF'
refactor(webview): hoist URL domain constants to shared/config

Move INTERNAL/OAUTH/ALLOWED_EMBED/EXTERNAL_AUTH domain lists and
isExternalAuthPage helper out of App.tsx into shared/config/webview
where the rest of WebView config lives. Drop dead feature17Url constant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Adjust the second `git add` for `index.ts` only if Step 4 required a change.)

---

## Task 3: Extract webview console bridge script

**Files:**
- Create: `src/shared/lib/console-bridge/injectedScript.ts`
- Create: `src/shared/lib/console-bridge/index.ts`
- Modify: `App.tsx` (lines 43-76 deletion + import)

- [ ] **Step 1: Create `src/shared/lib/console-bridge/injectedScript.ts`**

```ts
// WebView 안의 console.log/warn/error를 RN 측으로 postMessage 송신.
// useBridge가 onMessage에서 type === 'CONSOLE'을 받아 RN 콘솔에 재출력한다.
// 디버깅 전용. prod에서도 활성 상태로 두는 것은 의도 — auth/login 진단에 활용.
export const CONSOLE_BRIDGE_SCRIPT = `
  (function() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = function(...args) {
      originalLog.apply(console, args);
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'CONSOLE',
        payload: { level: 'log', message: args.map(a => String(a)).join(' ') }
      }));
    };

    console.warn = function(...args) {
      originalWarn.apply(console, args);
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'CONSOLE',
        payload: { level: 'warn', message: args.map(a => String(a)).join(' ') }
      }));
    };

    console.error = function(...args) {
      originalError.apply(console, args);
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'CONSOLE',
        payload: { level: 'error', message: args.map(a => String(a)).join(' ') }
      }));
    };

    true;
  })();
`;
```

- [ ] **Step 2: Create `src/shared/lib/console-bridge/index.ts`**

```ts
export { CONSOLE_BRIDGE_SCRIPT } from './injectedScript';
```

- [ ] **Step 3: Update `App.tsx`**

Delete lines 43-76 (the `INJECTED_JAVASCRIPT` constant).

Add import (after the existing `cookie-diag` import):

```ts
import { CONSOLE_BRIDGE_SCRIPT } from '@/shared/lib/console-bridge';
```

In the `<WebView>` JSX (line 356), change:
```tsx
injectedJavaScript={INJECTED_JAVASCRIPT}
```
to:
```tsx
injectedJavaScript={CONSOLE_BRIDGE_SCRIPT}
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/console-bridge App.tsx
git commit -m "$(cat <<'EOF'
refactor(console-bridge): extract injected console interceptor script

Move INJECTED_JAVASCRIPT out of App.tsx into shared/lib/console-bridge.
Pure constant module, no logic change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create `features/webview-navigation/` with silent-drop included

**Files:**
- Create: `src/features/webview-navigation/lib/isAdRedirect.ts`
- Create: `src/features/webview-navigation/lib/createNavigationGate.ts`
- Create: `src/features/webview-navigation/index.ts`
- Modify: `App.tsx` (replace lines 187-217 with hook usage + import)

**This task contains the actual silent-drop fix.** All other tasks are pure refactor.

- [ ] **Step 1: Create `src/features/webview-navigation/lib/isAdRedirect.ts`**

```ts
// AdSense (unregistered webview)에서 환경위반 감지 시 발생시키는 top-level
// navigation 식별. 도메인 패턴은 Google 광고 인프라 — DoubleClick(클릭 트래커),
// AdServices(어트리뷰션), TPC/Pagead(syndication) 4종을 잡으면 실제 발생하는
// redirect의 대부분을 커버한다.
const AD_REDIRECT_PATTERN =
  /googleads\.g\.doubleclick\.net|googleadservices\.com|tpc\.googlesyndication\.com|pagead2\.googlesyndication\.com/;

export const isAdRedirect = (url: string): boolean => AD_REDIRECT_PATTERN.test(url);
```

- [ ] **Step 2: Create `src/features/webview-navigation/lib/createNavigationGate.ts`**

```ts
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
//   1. 광고 도메인으로의 비-사용자 navigation → silent drop (외부 브라우저 X, webview 머무름)
//   2. 광고 도메인 + 사용자 클릭 → 외부 브라우저 (정상 광고 클릭)
//   3. 소셜 로그인 URL → handleSocialLogin (시스템 브라우저)
//   4. 내부/about:/data: → webview 안에서 로드
//   5. OAuth 도메인 → webview 안에서 로드
//   6. 임베드 허용 도메인 (유튜브 등) → webview 안에서 로드
//   7. 그 외 → 인앱 브라우저로 외부 송출
export const createNavigationGate =
  ({ handleSocialLogin }: CreateNavigationGateDeps) =>
  (request: ShouldStartLoadRequest): boolean => {
    const { url, navigationType } = request;

    // 1 + 2: 광고 도메인 redirect 처리
    // navigationType !== 'click'은 스크립트가 일으킨 navigation을 의미.
    // AdSense unregistered 환경위반 redirect가 여기에 해당. silent drop으로
    // 흰화면 외부 점프 방지.
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

- [ ] **Step 3: Create `src/features/webview-navigation/index.ts`**

```ts
export { createNavigationGate } from './lib/createNavigationGate';
export { isAdRedirect } from './lib/isAdRedirect';
```

- [ ] **Step 4: Update `App.tsx`**

Delete lines 187-217 (the `handleShouldStartLoadWithRequest` function).

Delete the `import * as WebBrowser from 'expo-web-browser';` line (no longer needed in App.tsx — it lives inside the gate now).

Delete `import { ..., isSocialLoginUrl } from '@/features/social-auth';` — keep only `useSocialAuth` (the hook). Adjusted import:

```ts
// before
import { useSocialAuth, isSocialLoginUrl } from '@/features/social-auth';

// after
import { useSocialAuth } from '@/features/social-auth';
```

Add new import (with the other feature imports):

```ts
import { createNavigationGate } from '@/features/webview-navigation';
```

Inside `AppContent`, after `useSocialAuth` destructure (~line 82-85), add:

```ts
const handleShouldStartLoadWithRequest = createNavigationGate({ handleSocialLogin });
```

In the `<WebView>` JSX, line 357 stays the same (the prop already references `handleShouldStartLoadWithRequest`):

```tsx
onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
```

> Note: `createNavigationGate` returns a new function on every render. That's acceptable for `onShouldStartLoadWithRequest` because react-native-webview reads it on each navigation, not via reference equality. If perf is ever an issue, wrap with `useCallback`.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: PASS. If `ShouldStartLoadRequest` type import path is wrong, adjust to `react-native-webview` actual export. Check with:
```bash
grep -rn "export.*ShouldStartLoadRequest" node_modules/react-native-webview/lib/typescript/ 2>/dev/null
```

If the type isn't exported under that path, fall back to using the existing `WebViewNavigation` type (which on iOS/recent Android does include `navigationType`):

```ts
import type { WebViewNavigation } from 'react-native-webview';
// ...
(request: WebViewNavigation): boolean => {
  // navigationType is on WebViewNavigation in current react-native-webview
```

- [ ] **Step 6: Commit**

```bash
git add src/features/webview-navigation App.tsx
git commit -m "$(cat <<'EOF'
feat(webview-navigation): extract gate + silent-drop AdSense redirects

Move handleShouldStartLoadWithRequest into features/webview-navigation
as createNavigationGate factory. Add isAdRedirect predicate covering
the four Google ad-domain patterns (DoubleClick, AdServices, TPC,
Pagead) that AdSense's unregistered-environment detection navigates
to. Script-triggered navigations to those domains return false
silently — no external browser open, no white-screen overlay. User
clicks on filled ads (navigationType === 'click') still flow through
the normal external-browser path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Extract `useCookieLifecycle` hook (Android cookie restore + backup)

**Files:**
- Create: `src/shared/lib/cookie-backup/useCookieLifecycle.ts`
- Modify: `src/shared/lib/cookie-backup/index.ts` (re-export)
- Modify: `App.tsx` (replace 2 effects with 1 hook call + state)

- [ ] **Step 1: Create `src/shared/lib/cookie-backup/useCookieLifecycle.ts`**

```ts
import { useEffect, useState } from 'react';
import { Platform, AppState } from 'react-native';

import { emitCookieSnapshot } from '@/shared/lib/cookie-diag';

import { cookieBackupService } from './cookieBackupService';

interface UseCookieLifecycleArgs {
  sendToWebView: (msg: unknown) => void;
}

interface UseCookieLifecycleResult {
  // Android: 콜드 스타트 시 쿠키 복원 완료 전까지 false. iOS는 항상 true.
  // 사용자가 WebView 마운트 타이밍을 이 플래그로 게이팅할 수 있다.
  cookiesRestored: boolean;
}

// Android-only:
//   - 콜드 스타트에 백업된 쿠키를 WKWebView 쿠키 jar로 복원
//   - 백그라운드/inactive 전환 시 현재 쿠키를 백업
// iOS는 sharedCookiesEnabled로 NSHTTPCookieStorage가 영속 → 명시적 복원 불필요.
export const useCookieLifecycle = ({
  sendToWebView,
}: UseCookieLifecycleArgs): UseCookieLifecycleResult => {
  const [cookiesRestored, setCookiesRestored] = useState(Platform.OS !== 'android');

  // 마운트 1회: Android 쿠키 복원
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    cookieBackupService.restore({ send: sendToWebView }).then((restored) => {
      setCookiesRestored(true);
      if (restored) {
        void emitCookieSnapshot(sendToWebView, {
          trigger: 'cold-start-after-restore',
        });
      }
    });
  }, [sendToWebView]);

  // AppState change: 백그라운드 전환 시 백업
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        void cookieBackupService.backup({ send: sendToWebView });
      }
    });

    return () => subscription.remove();
  }, [sendToWebView]);

  return { cookiesRestored };
};
```

- [ ] **Step 2: Update `src/shared/lib/cookie-backup/index.ts`**

Read current content first:
```bash
cat src/shared/lib/cookie-backup/index.ts
```

Then append:
```ts
export { useCookieLifecycle } from './useCookieLifecycle';
```

(If the file uses `export * from './...'` patterns, add `export * from './useCookieLifecycle';` instead. Match existing convention.)

- [ ] **Step 3: Update `App.tsx`**

Delete lines 117-144 (the `cookiesRestored` state declaration AND the two `useEffect` blocks for restore + backup).

Replace with a single hook call. Add this inside `AppContent`, near the other hook calls (~after `useShareIntent`):

```ts
const { cookiesRestored } = useCookieLifecycle({ sendToWebView });
```

Adjust import:

```ts
// before
import { cookieBackupService } from '@/shared/lib/cookie-backup';

// after
import { cookieBackupService, useCookieLifecycle } from '@/shared/lib/cookie-backup';
```

> Note: `cookieBackupService` is still used directly by the debug overlay (cookie clear / restore test buttons). Keep importing it.

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/cookie-backup App.tsx
git commit -m "$(cat <<'EOF'
refactor(cookie-backup): extract useCookieLifecycle hook

Encapsulate Android cookie restore-on-mount + backup-on-background
into a single hook returning cookiesRestored. Replaces 2 useEffects
+ 1 state in App.tsx with one hook call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Extract `useForegroundResumeDiag` hook

**Files:**
- Create: `src/shared/lib/auth-diag/useForegroundResumeDiag.ts`
- Modify: `src/shared/lib/auth-diag/index.ts` (re-export)
- Modify: `App.tsx` (replace 1 effect with 1 hook call)

- [ ] **Step 1: Create `src/shared/lib/auth-diag/useForegroundResumeDiag.ts`**

```ts
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { emitCookieSnapshot } from '@/shared/lib/cookie-diag';

import { sendAuthDiag, generateDiagId } from './index';

interface UseForegroundResumeDiagArgs {
  sendToWebView: (msg: unknown) => void;
}

// 앱이 background → active로 돌아올 때 진단 phase + 쿠키 스냅샷 1회 emit.
// 로그인 유실 트래킹용 (auth-diag 시스템의 일부).
export const useForegroundResumeDiag = ({
  sendToWebView,
}: UseForegroundResumeDiagArgs): void => {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const diagId = generateDiagId();
      sendAuthDiag(sendToWebView, {
        phase: 'foreground-resume',
        source: 'app-rn-appstate',
        diagId,
        meta: { platform: Platform.OS },
      });
      void emitCookieSnapshot(sendToWebView, {
        trigger: 'foreground-resume',
        diagId,
      });
    });

    return () => subscription.remove();
  }, [sendToWebView]);
};
```

> Note: `sendAuthDiag` and `generateDiagId` are imported from `./index` to avoid a circular path issue if they're defined elsewhere in the slice. If `cat src/shared/lib/auth-diag/index.ts` shows they're re-exports from a sibling file, import directly from that sibling instead. Whatever the existing pattern is — match it.

- [ ] **Step 2: Update `src/shared/lib/auth-diag/index.ts`**

Append:
```ts
export { useForegroundResumeDiag } from './useForegroundResumeDiag';
```
(Match existing re-export convention.)

- [ ] **Step 3: Update `App.tsx`**

Delete lines 146-165 (the foreground-resume `useEffect`).

Add hook call inside `AppContent` (near other hooks):

```ts
useForegroundResumeDiag({ sendToWebView });
```

Adjust import:

```ts
// before
import { generateDiagId, sendAuthDiag } from '@/shared/lib/auth-diag';

// after
import { generateDiagId, sendAuthDiag, useForegroundResumeDiag } from '@/shared/lib/auth-diag';
```

> Note: `generateDiagId` and `sendAuthDiag` are still used in the inline `onNavigationStateChange` (lines 321-354) — that's covered by Task 8. Keep them imported here for now.

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/auth-diag App.tsx
git commit -m "$(cat <<'EOF'
refactor(auth-diag): extract useForegroundResumeDiag hook

Move AppState foreground listener + diag/snapshot emit out of
App.tsx. One useEffect → one hook call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Extract `useAndroidBackHandler` hook

**Files:**
- Create: `src/features/android-back/lib/useAndroidBackHandler.ts`
- Create: `src/features/android-back/index.ts`
- Modify: `App.tsx` (replace 1 effect with 1 hook call)

- [ ] **Step 1: Create `src/features/android-back/lib/useAndroidBackHandler.ts`**

```ts
import { useEffect, useRef } from 'react';
import { BackHandler, ToastAndroid } from 'react-native';
import type { RefObject } from 'react';
import type WebView from 'react-native-webview';

interface UseAndroidBackHandlerArgs {
  webViewRef: RefObject<WebView | null>;
  canGoBack: boolean;
}

const DOUBLE_PRESS_INTERVAL_MS = 2000;

// Android 하드웨어 뒤로가기:
//   - WebView 히스토리에 뒤로 갈 페이지 있으면 goBack
//   - 없으면 첫 번째 누름엔 토스트, 2초 내 다시 누르면 앱 종료
// iOS는 하드웨어 백 버튼이 없어 호출되지 않음 (BackHandler가 no-op).
export const useAndroidBackHandler = ({
  webViewRef,
  canGoBack,
}: UseAndroidBackHandlerArgs): void => {
  const lastBackPressed = useRef(0);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      const now = Date.now();
      if (now - lastBackPressed.current < DOUBLE_PRESS_INTERVAL_MS) {
        BackHandler.exitApp();
        return true;
      }
      lastBackPressed.current = now;
      ToastAndroid.show('한 번 더 누르면 종료됩니다', ToastAndroid.SHORT);
      return true;
    });

    return () => subscription.remove();
  }, [canGoBack, webViewRef]);
};
```

- [ ] **Step 2: Create `src/features/android-back/index.ts`**

```ts
export { useAndroidBackHandler } from './lib/useAndroidBackHandler';
```

- [ ] **Step 3: Update `App.tsx`**

Delete lines 167-184 (the `BackHandler` `useEffect`).

Delete the unused state field — actually `lastBackPressed` ref moved into the hook, so the `useRef(0)` declaration in App.tsx (line 116) goes away too. Verify by searching App.tsx for `lastBackPressed` after the changes — should be 0 hits.

Add hook call inside `AppContent` (near other hooks):

```ts
useAndroidBackHandler({ webViewRef, canGoBack });
```

Add import:

```ts
import { useAndroidBackHandler } from '@/features/android-back';
```

Adjust the `react-native` import — `BackHandler`, `ToastAndroid` no longer used in App.tsx:

```ts
// before
import { StyleSheet, BackHandler, Platform, ToastAndroid, TouchableOpacity, Text, View, AppState } from 'react-native';

// after
import { StyleSheet, Platform, TouchableOpacity, Text, View, AppState } from 'react-native';
```

> Note: `AppState` is still used by other inline code that hasn't been extracted yet — no, wait. Tasks 5 and 6 already extracted both AppState listeners. So `AppState` is also unused in App.tsx after Task 7. Drop it from the import too:

```ts
// final
import { StyleSheet, Platform, TouchableOpacity, Text, View } from 'react-native';
```

Verify: `grep -n "BackHandler\|ToastAndroid\|AppState" App.tsx` — expected 0 hits.

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/android-back App.tsx
git commit -m "$(cat <<'EOF'
refactor(android-back): extract back handler with double-press exit

Move hardware back handler (WebView goBack with double-press-to-exit
fallback) into features/android-back/useAndroidBackHandler. Drops
unused BackHandler/ToastAndroid/AppState imports from App.tsx.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Extract `useWebViewNavState` hook

**Files:**
- Create: `src/features/webview-nav-state/lib/useWebViewNavState.ts`
- Create: `src/features/webview-nav-state/index.ts`
- Modify: `App.tsx` (replace inline `onNavigationStateChange` + 2 state fields)

- [ ] **Step 1: Create `src/features/webview-nav-state/lib/useWebViewNavState.ts`**

```ts
import { useState, useCallback } from 'react';
import type { WebViewNavigation } from 'react-native-webview';

import { WEBVIEW_BASE_URL } from '@/shared/config';
import { generateDiagId, sendAuthDiag } from '@/shared/lib/auth-diag';
import { emitCookieSnapshot } from '@/shared/lib/cookie-diag';

interface UseWebViewNavStateArgs {
  sendToWebView: (msg: unknown) => void;
}

interface UseWebViewNavStateResult {
  canGoBack: boolean;
  currentUrl: string;
  onNavigationStateChange: (navState: WebViewNavigation) => void;
}

// auth 관련 phase 식별 — URL 패턴으로 분류.
const detectAuthPhase = (url: string): string | null => {
  if (url.includes('/api/auth/app-callback')) return 'webview-nav-app-callback';
  if (url.includes('/api/auth/callback/')) return 'webview-nav-oauth-callback';
  if (url === WEBVIEW_BASE_URL || url === `${WEBVIEW_BASE_URL}/`) return 'webview-nav-main';
  return null;
};

// WebView navigation state 추적:
//   - canGoBack: Android 백 핸들러 + UI에서 사용
//   - currentUrl: floating back bar 표시 조건 등에서 사용
//   - auth phase가 식별되면 진단 emit + 로드 완료 시점에 쿠키 스냅샷
export const useWebViewNavState = ({
  sendToWebView,
}: UseWebViewNavStateArgs): UseWebViewNavStateResult => {
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');

  const onNavigationStateChange = useCallback(
    (navState: WebViewNavigation) => {
      setCanGoBack(navState.canGoBack);
      setCurrentUrl(navState.url);
      console.warn('LOADING URL: ' + navState.url);

      const authPhase = detectAuthPhase(navState.url);
      if (!authPhase) return;

      const diagId = generateDiagId();
      sendAuthDiag(sendToWebView, {
        phase: authPhase,
        source: 'app-rn-webview-nav',
        diagId,
        meta: { url: navState.url, loading: navState.loading },
      });

      // 로드 완료 후에만 스냅샷 (Set-Cookie 다 들어온 시점)
      if (navState.loading) return;
      if (
        authPhase !== 'webview-nav-app-callback' &&
        authPhase !== 'webview-nav-main'
      ) {
        return;
      }
      const trigger =
        authPhase === 'webview-nav-app-callback' ? 'post-app-callback' : 'post-login';
      void emitCookieSnapshot(sendToWebView, { trigger, diagId });
    },
    [sendToWebView],
  );

  return { canGoBack, currentUrl, onNavigationStateChange };
};
```

- [ ] **Step 2: Create `src/features/webview-nav-state/index.ts`**

```ts
export { useWebViewNavState } from './lib/useWebViewNavState';
```

- [ ] **Step 3: Update `App.tsx`**

Delete lines 114-115 (the `useState` for `canGoBack` and `currentUrl` — replaced by hook return).

Delete lines 321-354 (the inline `onNavigationStateChange` arrow function in JSX — ~33 lines).

Add hook call inside `AppContent`:

```ts
const { canGoBack, currentUrl, onNavigationStateChange } = useWebViewNavState({
  sendToWebView,
});
```

In the `<WebView>` JSX, replace the `onNavigationStateChange` prop:

```tsx
// before
onNavigationStateChange={(navState) => {
  // ... 33 lines of inline logic ...
}}

// after
onNavigationStateChange={onNavigationStateChange}
```

Add import:

```ts
import { useWebViewNavState } from '@/features/webview-nav-state';
```

Drop unused imports: after this task, `generateDiagId` and `sendAuthDiag` are no longer used in App.tsx. Update:

```ts
// before
import { generateDiagId, sendAuthDiag, useForegroundResumeDiag } from '@/shared/lib/auth-diag';

// after
import { useForegroundResumeDiag } from '@/shared/lib/auth-diag';
```

Also drop unused `emitCookieSnapshot` if no longer referenced:

```bash
grep -n "emitCookieSnapshot\|generateDiagId\|sendAuthDiag" App.tsx
```
Expected: 0 hits.

If 0 hits, simplify the cookie-diag import too:

```ts
// before
import { emitCookieSnapshot, useCookieSnapshotTimer } from '@/shared/lib/cookie-diag';

// after
import { useCookieSnapshotTimer } from '@/shared/lib/cookie-diag';
```

`useState` is also potentially unused now. Verify:
```bash
grep -n "useState" App.tsx
```

`showDebugRefresh` state is the only remaining `useState` for now. Keep `useState` in imports until Task 9.

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/webview-nav-state App.tsx
git commit -m "$(cat <<'EOF'
refactor(webview-nav-state): extract nav state + auth-phase diag hook

Move 33-line inline onNavigationStateChange (canGoBack/currentUrl
tracking + auth-phase detection + diag/snapshot emit) into
useWebViewNavState hook. Drops unused generateDiagId/sendAuthDiag/
emitCookieSnapshot imports from App.tsx.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Extract `DebugOverlay` widget

**Files:**
- Create: `src/widgets/debug-overlay/ui/DebugOverlay.tsx`
- Create: `src/widgets/debug-overlay/index.ts`
- Modify: `App.tsx` (replace JSX block + state + styles)

- [ ] **Step 1: Create `src/widgets/debug-overlay/ui/DebugOverlay.tsx`**

```tsx
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import CookieManager from '@preeternal/react-native-cookie-manager';

import { cookieBackupService } from '@/shared/lib/cookie-backup';

interface DebugOverlayProps {
  webViewRef: RefObject<WebView | null>;
  sendToWebView: (msg: unknown) => void;
}

const clearAllCookies = async () => {
  if (Platform.OS === 'ios') {
    // WKWebView가 보는 jar (useWebKit:true) + HTTPCookieStorage 둘 다 비워야 함
    await CookieManager.clearAll(true);
    await CookieManager.clearAll(false);
  } else {
    await CookieManager.clearAll();
  }
};

// __DEV__ 전용. 프로덕션 빌드에선 App.tsx에서 마운트하지 않는다.
// 새로고침/쿠키삭제/복원테스트 3개 버튼만 제공. 더 추가하지 말 것 — 디버그용.
export const DebugOverlay = ({ webViewRef, sendToWebView }: DebugOverlayProps) => {
  return (
    <View style={styles.bar}>
      <TouchableOpacity
        onPress={() => webViewRef.current?.reload()}
        style={styles.button}
      >
        <Text style={styles.text}>🔄 새로고침</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={async () => {
          await clearAllCookies();
          Alert.alert(
            '쿠키 삭제됨',
            'WebView 쿠키가 초기화되었습니다.\n새로고침하면 로그인이 풀려야 정상입니다.',
          );
          webViewRef.current?.reload();
        }}
        style={styles.button}
      >
        <Text style={[styles.text, { color: '#e74c3c' }]}>🍪 쿠키삭제</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={async () => {
          await clearAllCookies();
          Alert.alert(
            '쿠키 삭제 → 복원 테스트',
            '쿠키 초기화 후 백업에서 복원합니다.\n새로고침 후 로그인이 유지되면 성공!',
          );
          await cookieBackupService.restore({ send: sendToWebView });
          webViewRef.current?.reload();
        }}
        style={styles.button}
      >
        <Text style={[styles.text, { color: '#2ecc71' }]}>🔑 복원테스트</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  button: {
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  text: {
    fontSize: 14,
    color: '#666',
  },
});
```

- [ ] **Step 2: Create `src/widgets/debug-overlay/index.ts`**

```ts
export { DebugOverlay } from './ui/DebugOverlay';
```

- [ ] **Step 3: Update `App.tsx`**

Delete the `showDebugRefresh` state (currently line 111) — DebugOverlay's mount condition becomes `__DEV__` directly in App.tsx JSX.

Delete the entire `{showDebugRefresh && (<View>...</View>)}` JSX block (lines 265-306).

Delete the JSX block's `debugRefreshBar`, `debugRefreshButton`, `debugRefreshText` style entries from `styles` (lines 398-413).

Delete the unused imports — after this task, `Alert`, `CookieManager`, and `cookieBackupService` are no longer used in App.tsx (unless they're still in another part — verify):

```bash
grep -n "Alert\|CookieManager\|cookieBackupService" App.tsx
```
Expected: 0 hits if all the JSX block was removed correctly.

Update imports:
```ts
// before
import CookieManager from '@preeternal/react-native-cookie-manager';
// (remove this line entirely)

// before
import { cookieBackupService, useCookieLifecycle } from '@/shared/lib/cookie-backup';

// after
import { useCookieLifecycle } from '@/shared/lib/cookie-backup';
```

Also drop `Alert`:
```ts
// before
import { Alert } from 'react-native';
// (remove this line entirely; or merge into the main react-native import block — Alert wasn't there in current code, it's a separate line)
```

Add import for the new widget:

```ts
import { DebugOverlay } from '@/widgets/debug-overlay';
```

Add the conditional render inside the JSX, replacing the deleted block:

```tsx
{__DEV__ && <DebugOverlay webViewRef={webViewRef} sendToWebView={sendToWebView} />}
```

Drop the now-unused `useState` import if `showDebugRefresh` was the only useState left:

```bash
grep -n "useState" App.tsx
```
If the only hits are inside the imports block and one removed location, drop `useState`:

```ts
// before
import { useRef, useState, useEffect } from 'react';

// after
import { useRef, useEffect } from 'react';
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/debug-overlay App.tsx
git commit -m "$(cat <<'EOF'
refactor(debug-overlay): extract dev-only refresh/cookie buttons widget

Move ~40-line debug bar JSX (refresh, cookie clear, restore test
buttons) and its styles into widgets/debug-overlay. Mount with
__DEV__ guard at App.tsx top level. Drops Alert/CookieManager/
cookieBackupService imports from App.tsx.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Extract `FloatingBackBar` widget

**Files:**
- Create: `src/widgets/floating-back-bar/ui/FloatingBackBar.tsx`
- Create: `src/widgets/floating-back-bar/index.ts`
- Modify: `App.tsx` (replace JSX block + styles)

- [ ] **Step 1: Create `src/widgets/floating-back-bar/ui/FloatingBackBar.tsx`**

```tsx
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface FloatingBackBarProps {
  onPress: () => void;
}

// Android에서 외부 OAuth 페이지(예: 카카오 로그인) 위에 띄우는 뒤로가기 바.
// iOS는 swipe-back gesture가 있어 불필요.
export const FloatingBackBar = ({ onPress }: FloatingBackBarProps) => {
  return (
    <View style={styles.bar}>
      <TouchableOpacity onPress={onPress} style={styles.button}>
        <Text style={styles.text}>← 돌아가기</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
});
```

- [ ] **Step 2: Create `src/widgets/floating-back-bar/index.ts`**

```ts
export { FloatingBackBar } from './ui/FloatingBackBar';
```

- [ ] **Step 3: Update `App.tsx`**

Delete the existing JSX block (lines 255-264):
```tsx
{Platform.OS === 'android' && isExternalAuthPage(currentUrl) && (
  <View style={styles.floatingBackBar}>
    <TouchableOpacity ...>
      ...
    </TouchableOpacity>
  </View>
)}
```

Replace with:
```tsx
{Platform.OS === 'android' && isExternalAuthPage(currentUrl) && (
  <FloatingBackBar onPress={() => webViewRef.current?.goBack()} />
)}
```

Delete `floatingBackBar`, `floatingBackButton`, `floatingBackText` from `styles` in App.tsx (lines 384-397).

After this, `TouchableOpacity` and `Text` may no longer be used in App.tsx (the only remaining JSX is `View`/`SafeAreaView`/`StatusBar` and child widgets). Verify:
```bash
grep -n "TouchableOpacity\|Text\|<View\b" App.tsx
```

If `TouchableOpacity` and `Text` have 0 direct usages, drop them from `react-native` imports:

```ts
// before (after Task 7)
import { StyleSheet, Platform, TouchableOpacity, Text, View } from 'react-native';

// after
import { StyleSheet, Platform, View } from 'react-native';
```

Add import:
```ts
import { FloatingBackBar } from '@/widgets/floating-back-bar';
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/floating-back-bar App.tsx
git commit -m "$(cat <<'EOF'
refactor(floating-back-bar): extract Android external-auth back button

Small widget for the back button shown over external OAuth pages
on Android. iOS has swipe-back gesture so this widget is Android-only.
Drops TouchableOpacity/Text imports from App.tsx.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Extract `MainWebView` widget

**Files:**
- Create: `src/widgets/main-webview/ui/MainWebView.tsx`
- Create: `src/widgets/main-webview/index.ts`
- Modify: `App.tsx` (replace `<WebView>` JSX block)

- [ ] **Step 1: Create `src/widgets/main-webview/ui/MainWebView.tsx`**

```tsx
import { StyleSheet } from 'react-native';
import { forwardRef } from 'react';
import type { ForwardedRef } from 'react';
import { WebView } from 'react-native-webview';
import type {
  WebViewMessageEvent,
  WebViewNavigation,
  ShouldStartLoadRequest,
} from 'react-native-webview/lib/WebViewTypes';

import { WEBVIEW_BASE_URL } from '@/shared/config';
import { CONSOLE_BRIDGE_SCRIPT } from '@/shared/lib/console-bridge';

interface MainWebViewProps {
  onMessage: (event: WebViewMessageEvent) => void;
  onNavigationStateChange: (navState: WebViewNavigation) => void;
  onShouldStartLoadWithRequest: (request: ShouldStartLoadRequest) => boolean;
  onLoadEnd: () => void;
}

// recipio.kr을 로드하는 메인 WebView. 모든 props는 호출자(AppContent)가 주입한
// 핸들러. 이 컴포넌트는 ref forwarding과 webview prop 묶음만 담당.
export const MainWebView = forwardRef(
  (
    {
      onMessage,
      onNavigationStateChange,
      onShouldStartLoadWithRequest,
      onLoadEnd,
    }: MainWebViewProps,
    ref: ForwardedRef<WebView>,
  ) => {
    return (
      <WebView
        ref={ref}
        allowsLinkPreview={false}
        source={{ uri: WEBVIEW_BASE_URL }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsBackForwardNavigationGestures
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        injectedJavaScript={CONSOLE_BRIDGE_SCRIPT}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onLoadEnd={onLoadEnd}
      />
    );
  },
);

MainWebView.displayName = 'MainWebView';

const styles = StyleSheet.create({
  webview: {
    flex: 1,
  },
});
```

> Note on type imports: react-native-webview v13 typically exports `WebViewMessageEvent`, `WebViewNavigation`, and `ShouldStartLoadRequest` from its top-level package. If `lib/WebViewTypes` path doesn't resolve, switch to `import type { ... } from 'react-native-webview'`. Verify with `grep -E "export type|export interface" node_modules/react-native-webview/lib/typescript/index.d.ts` if needed.

- [ ] **Step 2: Create `src/widgets/main-webview/index.ts`**

```ts
export { MainWebView } from './ui/MainWebView';
```

- [ ] **Step 3: Update `App.tsx`**

Delete the entire `<WebView>` JSX (lines 307-359 currently — but after earlier tasks the line numbers may differ; identify the `<WebView ref={webViewRef}` block and remove it through to `/>`).

Delete `CONSOLE_BRIDGE_SCRIPT` import — moved to MainWebView:

```ts
// before
import { CONSOLE_BRIDGE_SCRIPT } from '@/shared/lib/console-bridge';
// (remove this line)
```

Delete the `WebView, WebViewNavigation` import from `react-native-webview` (we still need `WebView` as a type for `useRef<WebView>`):

```ts
// before
import { WebView, WebViewNavigation } from 'react-native-webview';

// after
import type WebView from 'react-native-webview';
```

(`WebView` type is used by `useRef<WebView>(null)`. The actual `<WebView>` component is now only used inside MainWebView.)

Delete the `webview` style from App.tsx `styles` — moved to MainWebView.

Add import for new widget:

```ts
import { MainWebView } from '@/widgets/main-webview';
```

Replace the JSX with:

```tsx
<MainWebView
  ref={webViewRef}
  onMessage={onMessage}
  onNavigationStateChange={onNavigationStateChange}
  onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
  onLoadEnd={handleWebViewLoadEnd}
/>
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/main-webview App.tsx
git commit -m "$(cat <<'EOF'
refactor(main-webview): extract WebView component with all props

Move the <WebView> JSX (~50 lines of props) into widgets/main-webview.
Forward ref to allow App.tsx to keep webViewRef. Inlines the
CONSOLE_BRIDGE_SCRIPT injectedJavaScript prop binding so App.tsx
no longer imports it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Final App.tsx cleanup

**Files:**
- Modify: `App.tsx` (consolidate, drop dead imports, keep what should remain)

After all extractions, AppContent should be ~50 lines. This task is the final pass.

- [ ] **Step 1: Read current App.tsx and verify imports are minimal**

```bash
cat App.tsx
```

Expected what should remain:
- React: `useRef`, `useEffect` (still needed for the share-intent effect)
- `react-native`: `StyleSheet`, `Platform`, `View`
- `react-native-safe-area-context`: `SafeAreaProvider`, `SafeAreaView`, `useSafeAreaInsets`
- `expo-status-bar`: `StatusBar`
- `react-native-webview`: `type WebView`
- Features/widgets/shared imports as established in Tasks 2-11
- `useShareIntent`, `ShareIntentProvider`, `useBridge`, `useSocialAuth`, `getNotificationStatus`, `useNetworkStatus`, `OfflineScreen`, `useCookieSnapshotTimer`

- [ ] **Step 2: Final structural cleanup of AppContent**

The remaining inline logic in AppContent should be:
1. Hook calls (in this order is fine):
   - `useSafeAreaInsets`
   - `useRef<WebView>(null)`
   - `useBridge` (returns onMessage, sendToWebView)
   - `useSocialAuth` (returns handleSocialLogin)
   - `useCookieSnapshotTimer` (effect-only)
   - `useShareIntent` (returns shareTargetUrl, clearShareTarget)
   - `useCookieLifecycle` (returns cookiesRestored)
   - `useForegroundResumeDiag` (effect-only)
   - `useAndroidBackHandler` (effect-only)
   - `useWebViewNavState` (returns canGoBack, currentUrl, onNavigationStateChange)
   - `useNetworkStatus` (returns isOffline, refresh)
2. The two refs: `isWebViewReadyRef`, `pendingShareUrlRef` (for share intent timing)
3. The share-intent `useEffect` (warm-share inject vs cold-start defer)
4. `handleShouldStartLoadWithRequest = createNavigationGate({ handleSocialLogin })`
5. `handleWebViewLoadEnd` async function
6. JSX

The share-intent effect and `handleWebViewLoadEnd` are tightly coupled to `webViewRef`/`isWebViewReadyRef`/`pendingShareUrlRef`. They could be extracted into another hook (`useShareIntentBridge`) but this introduces a 3-way ref-passing dependency that's noisier than helpful. **Keep these inline** — App.tsx has earned the right to hold the WebView lifecycle glue.

- [ ] **Step 3: Verify final App.tsx form**

The expected final shape (approximate):

```tsx
import { useRef, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Platform, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type WebView from 'react-native-webview';

import { useBridge } from '@/features/bridge';
import { useSocialAuth } from '@/features/social-auth';
import { getNotificationStatus } from '@/features/push-notification';
import { useNetworkStatus } from '@/shared/lib/network';
import { OfflineScreen } from '@/widgets/offline-screen';
import { useShareIntent, ShareIntentProvider } from '@/features/share-intent';
import { isExternalAuthPage } from '@/shared/config';
import { useCookieSnapshotTimer } from '@/shared/lib/cookie-diag';
import { useCookieLifecycle } from '@/shared/lib/cookie-backup';
import { useForegroundResumeDiag } from '@/shared/lib/auth-diag';
import { useAndroidBackHandler } from '@/features/android-back';
import { useWebViewNavState } from '@/features/webview-nav-state';
import { createNavigationGate } from '@/features/webview-navigation';
import { DebugOverlay } from '@/widgets/debug-overlay';
import { FloatingBackBar } from '@/widgets/floating-back-bar';
import { MainWebView } from '@/widgets/main-webview';

function AppContent() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const { onMessage, sendToWebView } = useBridge({ webViewRef });
  const { handleSocialLogin } = useSocialAuth({ webViewRef, sendToWebView });
  useCookieSnapshotTimer(sendToWebView);
  const { shareTargetUrl, clearShareTarget } = useShareIntent();
  const { cookiesRestored } = useCookieLifecycle({ sendToWebView });
  useForegroundResumeDiag({ sendToWebView });
  const { canGoBack, currentUrl, onNavigationStateChange } = useWebViewNavState({ sendToWebView });
  useAndroidBackHandler({ webViewRef, canGoBack });
  const { isOffline, refresh: refreshNetwork } = useNetworkStatus();

  // WebView 첫 로드 타이밍 추적 — cold-start 공유는 첫 로드 완료 후 주입.
  const isWebViewReadyRef = useRef(false);
  const pendingShareUrlRef = useRef<string | null>(null);

  // 공유 인텐트로 들어온 URL을 WebView에 반영
  useEffect(() => {
    if (!shareTargetUrl) return;
    if (isWebViewReadyRef.current && webViewRef.current) {
      webViewRef.current.injectJavaScript(
        `window.location.href = ${JSON.stringify(shareTargetUrl)}; true;`,
      );
    } else {
      pendingShareUrlRef.current = shareTargetUrl;
    }
    clearShareTarget();
  }, [shareTargetUrl, clearShareTarget]);

  const handleShouldStartLoadWithRequest = createNavigationGate({ handleSocialLogin });

  const handleWebViewLoadEnd = async () => {
    if (!isWebViewReadyRef.current) {
      isWebViewReadyRef.current = true;
      const pending = pendingShareUrlRef.current;
      if (pending) {
        pendingShareUrlRef.current = null;
        webViewRef.current?.injectJavaScript(
          `window.location.href = ${JSON.stringify(pending)}; true;`,
        );
      }
    }
    const status = await getNotificationStatus();
    const message = JSON.stringify({
      type: 'NOTIFICATION_STATUS',
      payload: { status },
    });
    webViewRef.current?.injectJavaScript(`
      window.dispatchEvent(new MessageEvent('message', { data: ${message} }));
      true;
    `);
  };

  return (
    <SafeAreaView
      style={[styles.container, Platform.OS === 'android' && { paddingBottom: insets.bottom }]}
      edges={['top']}
    >
      <StatusBar style="dark" />
      {!cookiesRestored ? null : isOffline ? (
        <OfflineScreen onRetry={refreshNetwork} />
      ) : (
        <>
          {Platform.OS === 'android' && isExternalAuthPage(currentUrl) && (
            <FloatingBackBar onPress={() => webViewRef.current?.goBack()} />
          )}
          {__DEV__ && <DebugOverlay webViewRef={webViewRef} sendToWebView={sendToWebView} />}
          <MainWebView
            ref={webViewRef}
            onMessage={onMessage}
            onNavigationStateChange={onNavigationStateChange}
            onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
            onLoadEnd={handleWebViewLoadEnd}
          />
        </>
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ShareIntentProvider>
        <AppContent />
      </ShareIntentProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
```

That's the target shape. Adjust the actual file to match — drop any leftover code that doesn't belong.

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: ESLint check**

```bash
npx eslint App.tsx
```
Expected: PASS, or only project-wide pre-existing warnings unrelated to this change.

- [ ] **Step 6: Verify line count**

```bash
wc -l App.tsx
```
Expected: ~80 lines or fewer. (Down from 414.)

- [ ] **Step 7: Commit**

```bash
git add App.tsx
git commit -m "$(cat <<'EOF'
refactor(App): final cleanup — composition only

App.tsx is now ~80 lines, composing hooks and widgets only. All
side-effect orchestration moved to hooks (cookie lifecycle,
foreground diag, back handler, nav state). All UI extracted to
widgets (debug overlay, floating back bar, main webview). Domain
constants and console bridge script live in shared/.

Net change: 414 → ~80 lines in App.tsx, with the rest distributed
across 9 new files in features/widgets/shared organized by FSD layer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Append REVISED notes to spec and earlier plan

**Files:**
- Modify: `docs/superpowers/specs/2026-05-07-adsense-webview-integration-design.md` (prepend note)
- Modify: `docs/superpowers/plans/2026-05-07-adsense-webview-integration.md` (prepend note)

**Why:** Earlier spec/plan documents are based on the assumption that `MobileAds.registerWebView()` is callable from RN. That assumption was wrong. Mark them as superseded.

- [ ] **Step 1: Prepend note to spec**

At the top of `docs/superpowers/specs/2026-05-07-adsense-webview-integration-design.md`, immediately after the H1 title and before the "**작성일**" line, insert:

```markdown
> **⚠️ REVISED 2026-05-07** — This design assumed `MobileAds.registerWebView()` is callable via the `react-native-google-mobile-ads` package. Investigation during execution revealed that method does **not exist** in invertase/react-native-google-mobile-ads@16.3.3 (the de-facto standard RN binding); no PR/issue tracks adding it. The registerWebView path is therefore **not viable** for this RN repo without writing a custom Expo Module to bridge the native call (deferred — not justified by current traffic).
>
> Pivoted approach: do **not** attempt SDK registration. Instead silent-drop AdSense's environment-violation top-level navigations at the WebView navigation layer (5-line addition in `features/webview-navigation`). White-screen + external-URL bug is fixed. AdSense still loads in the WebView via the existing web-side script; fill rate is lower than registered baseline, to be measured and supplemented by Korean ad networks (Kakao AdFit, Coupang Partners) — those are operational decisions outside this spec.
>
> See `docs/superpowers/plans/2026-05-07-app-tsx-decomposition-and-silent-drop.md` for the implementation that supersedes the original plan.

```

(Keep the existing content below this note. Do not delete it — historical context is valuable.)

- [ ] **Step 2: Prepend note to earlier plan**

At the top of `docs/superpowers/plans/2026-05-07-adsense-webview-integration.md`, immediately after the H1 title and the "For agentic workers" callout, insert:

```markdown
> **⚠️ SUPERSEDED 2026-05-07** — This plan assumed `MobileAds.registerWebView()` exists in `react-native-google-mobile-ads`. It does not (verified empirically against invertase/react-native-google-mobile-ads@16.3.3). The registration path is not viable without a custom native module. Tasks B2-B10 below are obsolete; B1 (package install) was reverted in commit `<revert-sha>`.
>
> See `docs/superpowers/plans/2026-05-07-app-tsx-decomposition-and-silent-drop.md` for the active implementation plan.

```

> Replace `<revert-sha>` with the actual SHA from Task 1's revert commit:
> ```bash
> git log --grep="^Revert" --format="%h" -1
> ```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-07-adsense-webview-integration-design.md docs/superpowers/plans/2026-05-07-adsense-webview-integration.md
git commit -m "$(cat <<'EOF'
docs(spec/plan): mark adsense webview registration approach as revised

Original design and plan assumed MobileAds.registerWebView() is
available in react-native-google-mobile-ads. It is not. Append
notes pointing readers to the silent-drop replacement plan that
actually shipped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Final lint + manual verification checklist

**Files:** none (verification only)

- [ ] **Step 1: Whole-tree TypeScript check**

```bash
npx tsc --noEmit
```
Expected: PASS, no errors anywhere in the project.

- [ ] **Step 2: Whole-tree lint**

```bash
npx eslint src App.tsx
```
Expected: PASS, or only pre-existing warnings unrelated to this work.

- [ ] **Step 3: Verify no stale references**

```bash
grep -rn "INJECTED_JAVASCRIPT\|feature17Url" src App.tsx
```
Expected: 0 hits.

```bash
grep -rn "react-native-google-mobile-ads\|expo-tracking-transparency" package.json app.json
```
Expected: 0 hits.

- [ ] **Step 4: Verify all new public APIs are reachable through index.ts**

```bash
ls -la src/features/webview-navigation src/features/android-back src/features/webview-nav-state src/widgets/debug-overlay src/widgets/floating-back-bar src/widgets/main-webview src/shared/lib/console-bridge
```
Expected: each directory has an `index.ts`.

```bash
grep -l "from '@/features/webview-navigation'\|from '@/features/android-back'\|from '@/features/webview-nav-state'\|from '@/widgets/debug-overlay'\|from '@/widgets/floating-back-bar'\|from '@/widgets/main-webview'\|from '@/shared/lib/console-bridge'" App.tsx
```
Expected: matches App.tsx (all imports go through `index.ts`).

- [ ] **Step 5: Read final App.tsx aloud**

```bash
cat App.tsx
```

Sanity-check it matches the target shape from Task 12 Step 3. Each line should have a clear purpose. If anything looks like dead weight, address it now.

- [ ] **Step 6: Manual on-device test (requires EAS dev build)**

Trigger a dev build:
```bash
eas build --profile development --platform all
```

Wait for build completion, install on iOS + Android test devices. Run through:

- [ ] App cold-starts, home screen renders
- [ ] Navigate to a recipe detail page that has AdSense slots
- [ ] **No white-screen overlay**, **no external Google URL** opening — this is the silent-drop fix's pass criterion
- [ ] Some ad slots may fill (whatever AdSense decides to serve in unregistered webview); empty slots fade out via the web's 3s timeout
- [ ] Tap a filled ad creative (if any) → external browser opens with the advertiser's landing page (existing ad-click flow unchanged)
- [ ] Login (Kakao/Naver/Google/Apple) — all four flows work (regression check on social auth navigation)
- [ ] Cookie persistence: kill app, reopen → still logged in (Android cookie restore via `useCookieLifecycle`)
- [ ] Share a YouTube link from another app to recipio (cold start) → recipe import flow opens
- [ ] Share a YouTube link while app is open (warm) → injects into existing WebView
- [ ] Foreground resume after backgrounding → AUTH_DIAG `foreground-resume` logged once
- [ ] Android hardware back: navigates back through WebView history; on home, double-press exits with toast in between
- [ ] External OAuth page (Kakao login) on Android → FloatingBackBar appears, tapping it goes back

If any check fails, the regression is in the corresponding extracted module — bisect by commit using `git bisect` if needed.

- [ ] **Step 7 (only if Step 6 passes): Final summary commit (optional)**

If you want a clean final state marker, no-op:
```bash
git commit --allow-empty -m "chore: app.tsx decomposition + adsense silent-drop verified on-device

Verified iOS + Android dev build:
- No white-screen + external URL on AdSense pages
- No regressions in: social auth, cookie persistence, share intent,
  foreground diag, Android back, floating back bar
- App.tsx down to ~80 lines from 414

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Skip this step if you prefer the verification status to live only in PR description / changelog.

---

## Self-Review

I checked this plan against the goal:

**1. Goal coverage:**
- ✅ App.tsx decomposed (Tasks 2-12)
- ✅ Silent-drop fix landed inside `features/webview-navigation` (Task 4)
- ✅ Earlier registration packages reverted (Task 1)
- ✅ Spec/plan retired with notes (Task 13)
- ✅ Verification (Task 14)

**2. Placeholder scan:** No "TBD"/"TODO"/"implement later". Each step has concrete code or commands.

**3. Type consistency:**
- `WebView` ref type is `RefObject<WebView | null>` consistently across `useAndroidBackHandler`, `DebugOverlay`, `MainWebView`
- `sendToWebView` typed as `(msg: unknown) => void` in `useCookieLifecycle`, `useForegroundResumeDiag`, `useWebViewNavState`, `DebugOverlay` (mismatch with whatever `useBridge` actually returns is the responsibility of those hooks' adoption — if `useBridge` returns a more specific type, that flows fine to the hooks via inference)
- `WebViewNavigation` and `ShouldStartLoadRequest` types come from `react-native-webview/lib/WebViewTypes` consistently; fallback to `react-native-webview` direct re-exports if path doesn't resolve (noted in tasks)

**4. FSD compliance:**
- New `features/`: `webview-navigation`, `android-back`, `webview-nav-state` — each is a focused user-facing concern
- New `widgets/`: `debug-overlay`, `floating-back-bar`, `main-webview` — each is an independent UI block
- New `shared/lib/`: `console-bridge`, plus hooks added to `cookie-backup` and `auth-diag` — pure infra, no business logic
- All slices have `index.ts` public API
- Domain constants in `shared/config/webview.ts` (already FSD-aligned)

**5. Risk acknowledged:**
- `ShouldStartLoadRequest` import path may differ in some react-native-webview versions — Task 4 Step 5 has a fallback recipe
- `cookieBackupService` and `useBridge` re-export shape is not visible from this plan — tasks check via `cat <index>` to match existing convention
- Manual on-device verification (Task 14 Step 6) is the irreplaceable check; tsc only catches type errors, not runtime behavior
