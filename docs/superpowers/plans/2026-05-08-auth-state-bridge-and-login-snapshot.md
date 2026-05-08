# Auth State Bridge + Login-time Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capstone-frontend가 RN으로 `AUTH_STATE_CHANGED` 3 events(login/refresh/logout)를 송신하고, recipio-app이 navigation 감지로 자체 backup도 발화하게 만들어 AsyncStorage가 cookie jar의 정확한 거울이 되도록 한다.

**Architecture:** Cross-repo 작업, 단일 plan. Task 1은 Capstone-frontend(웹)에 typed bridge 헬퍼 생성 + 3 call sites 추가. Task 2는 recipio-app(RN) `useWebViewNavState`에 backup 호출 1줄 추가. 두 task는 추가만(backward-compatible)이라 머지 순서 무관.

**Tech Stack:** TypeScript. Capstone-frontend는 Next.js + React Query + zustand (web). recipio-app은 RN 0.81 + react-native-webview. 의존성 추가 0. 테스트 프레임워크 미도입(spec 결정) — 검증은 `tsc --noEmit` + PHASE 1 manual + Vercel/Metro 로그 분석.

**Spec:** `docs/superpowers/specs/2026-05-08-auth-state-bridge-and-login-snapshot-design.md`

**Branch policy:** 양 repo 모두 현재 브랜치에서 그대로 작업. 워크트리/체크아웃 금지 (CLAUDE.md 규칙).

**Repo paths (절대 경로):**
- recipio-app: `C:/Users/user/Desktop/recipio-app`
- Capstone-frontend: `C:/Users/user/Desktop/recipio/Capstone-frontend`

**Cross-repo bash 규칙:** 다른 디렉터리에서 명령 실행 시 `git -C "<path>"` 같은 네이티브 플래그 우선. 절대 `cd "<path>" && <cmd>` 접두사 쓰지 말 것.

---

## Preconditions (Plan 시작 전 정리)

`recipio-app` working tree에 본 plan과 무관한 미commit 변경이 있을 수 있음:

1. `App.tsx`의 임시 `[verify-httponly]` 라인 (이전 plan의 PHASE 1 검증용, 검증 끝나면 삭제 예정이었음). **본 plan 검증엔 필요 없으므로 제거 권장.** 단 user가 의도적으로 남겨뒀을 수 있으니 implementer는 제거 여부를 user에게 확인 후 진행할 것.
2. `src/features/bridge/lib/useBridge.ts`, `src/features/bridge/model/handlers/hapticHandler.ts`의 HAPTIC 로그 정리 — user의 별도 작업으로 추정. **본 plan과 무관하니 손대지 말 것.**

Capstone-frontend도 비슷하게 별도 미commit 변경이 있을 수 있음. 본 plan 변경 파일과 겹치지 않으면 무시.

---

## File Structure

| Repo | File | Action | Responsibility |
|---|---|---|---|
| Capstone-frontend | `src/shared/lib/bridge/authStateBridge.ts` | Create | RN으로 AUTH_STATE_CHANGED 송신하는 typed 헬퍼 |
| Capstone-frontend | `src/entities/user/model/hooks.ts` | Modify | `useMyInfoQuery` useEffect에서 login 통보 |
| Capstone-frontend | `src/shared/lib/auth/useAuthManager.ts` | Modify | `handleTokenRefresh`에서 refresh 통보 |
| Capstone-frontend | `src/features/auth/model/hooks/useLogoutMutation.ts` | Modify | `onSuccess`에서 logout 통보 |
| recipio-app | `src/features/webview-nav-state/lib/useWebViewNavState.ts` | Modify | navigation 시점에 cookieBackupService.backup() 호출 추가 |

---

## Task 1: Capstone-frontend `AUTH_STATE_CHANGED` 송신 (헬퍼 + 3 call sites)

**Working directory:** `C:/Users/user/Desktop/recipio/Capstone-frontend`
**모든 git 명령**: `git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" <cmd>`
**모든 npm/tsc 명령**: `npm --prefix "C:/Users/user/Desktop/recipio/Capstone-frontend" <cmd>` 또는 `npx --prefix ...` (현재 cwd recipio-app이므로)

**Files:**
- Create: `src/shared/lib/bridge/authStateBridge.ts`
- Modify: `src/entities/user/model/hooks.ts:55-62` (useMyInfoQuery의 useEffect)
- Modify: `src/shared/lib/auth/useAuthManager.ts:33-40` (handleTokenRefresh)
- Modify: `src/features/auth/model/hooks/useLogoutMutation.ts:30-42` (mutation onSuccess)

이 task는 single commit. 헬퍼 + 3 call sites가 모두 같은 feature라 unused-export 회색지대 회피.

- [ ] **Step 1: 헬퍼 파일 생성**

`C:/Users/user/Desktop/recipio/Capstone-frontend/src/shared/lib/bridge/authStateBridge.ts` 신규 파일:

```ts
type AuthEvent = 'login' | 'refresh' | 'logout';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (data: string) => void };
  }
}

/**
 * RN WebView가 띄운 페이지에서만 동작. 일반 브라우저에선 no-op.
 * recipio-app의 authStateHandler가 backup/clear를 트리거.
 *
 * 호출 시점:
 * - 'login': useMyInfoQuery가 myInfo 200 받아 setUser 직후 (= 클라이언트가 로그인 인지)
 * - 'refresh': handleTokenRefresh의 invalidateQueries 직후 (= /api/auth/refresh 200 후)
 * - 'logout': useLogoutMutation의 onSuccess에서 logoutAction 직후
 */
export const notifyAuthState = (event: AuthEvent): void => {
  if (typeof window === 'undefined') return;
  const bridge = window.ReactNativeWebView;
  if (!bridge) return;
  try {
    bridge.postMessage(
      JSON.stringify({
        type: 'AUTH_STATE_CHANGED',
        payload: { event },
      })
    );
  } catch (err) {
    console.warn('[authStateBridge] postMessage failed', err);
  }
};
```

- [ ] **Step 2: login 통보 추가**

`C:/Users/user/Desktop/recipio/Capstone-frontend/src/entities/user/model/hooks.ts` 의 `useMyInfoQuery` useEffect 안 (대략 line 55-62 영역):

**기존 코드 (참고용):**
```typescript
  useEffect(() => {
    if (userData) {
      setUser(userData);
    } else if (isError) {
      setUser(null);
    }
  }, [userData, isError, setUser]);
```

**변경 후:**
```typescript
  useEffect(() => {
    if (userData) {
      setUser(userData);
      notifyAuthState('login');
    } else if (isError) {
      setUser(null);
    }
  }, [userData, isError, setUser]);
```

import 추가 (파일 상단 import 블록에):
```typescript
import { notifyAuthState } from '@/shared/lib/bridge/authStateBridge';
```

(import alias `@/`는 Capstone-frontend의 tsconfig에 정의돼있을 것 — 파일 상단 기존 import들과 동일 형식 사용)

- [ ] **Step 3: refresh 통보 추가**

`C:/Users/user/Desktop/recipio/Capstone-frontend/src/shared/lib/auth/useAuthManager.ts` 의 `handleTokenRefresh` 안 (대략 line 33-40 영역):

**기존 코드 (참고용):**
```typescript
  const handleTokenRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["myInfo"] });
    pingDebugCookie(
      "after-token-refresh",
      generateClientDiagId(),
      "web-token-refreshed"
    );
  };
```

**변경 후:**
```typescript
  const handleTokenRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["myInfo"] });
    notifyAuthState('refresh');
    pingDebugCookie(
      "after-token-refresh",
      generateClientDiagId(),
      "web-token-refreshed"
    );
  };
```

import 추가 (파일 상단 import 블록에):
```typescript
import { notifyAuthState } from '@/shared/lib/bridge/authStateBridge';
```

- [ ] **Step 4: logout 통보 추가**

`C:/Users/user/Desktop/recipio/Capstone-frontend/src/features/auth/model/hooks/useLogoutMutation.ts` 의 mutation `onSuccess` 안 (대략 line 30-42 영역):

**기존 코드 (참고용):**
```typescript
    onSuccess: () => {
      useUserStore.setState({ isLoggingOut: false });
      logoutAction();
      queryClient.invalidateQueries({ queryKey: ["myInfo"] });

      if (typeof window !== "undefined") {
        const currentPath = window.location.pathname;
        const userIdMatch = currentPath.match(/^\/users\/([^/]+)$/);

        if (userIdMatch) {
          window.location.replace("/users/guestUser");
        }
      }
    },
```

**변경 후:**
```typescript
    onSuccess: () => {
      useUserStore.setState({ isLoggingOut: false });
      logoutAction();
      notifyAuthState('logout');
      queryClient.invalidateQueries({ queryKey: ["myInfo"] });

      if (typeof window !== "undefined") {
        const currentPath = window.location.pathname;
        const userIdMatch = currentPath.match(/^\/users\/([^/]+)$/);

        if (userIdMatch) {
          window.location.replace("/users/guestUser");
        }
      }
    },
```

import 추가 (파일 상단 import 블록에):
```typescript
import { notifyAuthState } from '@/shared/lib/bridge/authStateBridge';
```

- [ ] **Step 5: TypeScript 컴파일 통과 확인**

Run (현재 cwd recipio-app이지만 명령은 Capstone-frontend 디렉터리에 적용):
```bash
npx --prefix "C:/Users/user/Desktop/recipio/Capstone-frontend" tsc --noEmit -p "C:/Users/user/Desktop/recipio/Capstone-frontend"
```

또는 더 간단한 방법으로 Capstone-frontend의 자체 typecheck 스크립트가 있다면 그걸 사용 (보통 `npm run typecheck` 또는 `npm run build`).

`npm --prefix "C:/Users/user/Desktop/recipio/Capstone-frontend" run typecheck` 시도하고, 그 스크립트 없으면 위 tsc 명령 fallback.

Expected: 에러 0건. 새 파일/import 모두 정상 인식.

- [ ] **Step 6: ESLint 통과 확인 (있으면)**

```bash
npm --prefix "C:/Users/user/Desktop/recipio/Capstone-frontend" run lint -- src/shared/lib/bridge/authStateBridge.ts src/entities/user/model/hooks.ts src/shared/lib/auth/useAuthManager.ts src/features/auth/model/hooks/useLogoutMutation.ts
```

Expected: 에러/경고 0건. lint 스크립트 없으면 N/A로 진행.

- [ ] **Step 7: Diff 검토**

```bash
git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" diff
```

Expected:
- 1개 신규 파일 (`authStateBridge.ts`)
- 3개 수정 파일에 각각 import 1줄 추가 + 호출 1줄 추가
- 그 외 변경 0

- [ ] **Step 8: Commit (Capstone-frontend repo에서)**

```bash
git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" add \
  src/shared/lib/bridge/authStateBridge.ts \
  src/entities/user/model/hooks.ts \
  src/shared/lib/auth/useAuthManager.ts \
  src/features/auth/model/hooks/useLogoutMutation.ts

git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" commit -m "$(cat <<'EOF'
feat(bridge): notify RN of auth state changes

RN WebView 환경에서 login/refresh/logout 시점마다 AUTH_STATE_CHANGED
postMessage 송신. recipio-app의 cookieBackupService.backup() 또는
clear()를 정확한 시점에 트리거.

이전엔 RN side가 AppState background 이벤트 한 가지에만 의존해
backup이 갱신됐기 때문에 token rotation 회전 후 force-quit 시
AsyncStorage가 stale token을 유지 → cold-start에서 refresh-no-session.

- authStateBridge.ts: 환경 가드 + postMessage 응집 헬퍼
- useMyInfoQuery: setUser 직후 notifyAuthState('login')
- handleTokenRefresh: invalidateQueries 직후 notifyAuthState('refresh')
- useLogoutMutation.onSuccess: logoutAction 직후 notifyAuthState('logout')

일반 브라우저 환경에선 window.ReactNativeWebView 가드로 no-op.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: recipio-app `useWebViewNavState`에 backup 트리거 추가

**Working directory:** `C:/Users/user/Desktop/recipio-app` (현재 cwd)

**Files:**
- Modify: `src/features/webview-nav-state/lib/useWebViewNavState.ts:1-69` 영역 (import 1줄 + 본문 1줄)

이 task는 web의 AUTH_STATE_CHANGED 이벤트와 독립된 안전망. navigation이 app-callback 또는 main URL에 도달하고 로드 완료된 시점에 자체적으로 backup 발화.

- [ ] **Step 1: import 추가 및 backup 호출 추가**

`src/features/webview-nav-state/lib/useWebViewNavState.ts` 수정.

**기존 import 블록 (line 1-6):**
```typescript
import { useState, useCallback } from 'react';
import type { WebViewNavigation } from 'react-native-webview';

import { WEBVIEW_BASE_URL } from '@/shared/config';
import { generateDiagId, sendAuthDiag, type SendToWebViewFn } from '@/shared/lib/auth-diag';
import { emitCookieSnapshot } from '@/shared/lib/cookie-diag';
```

**import 블록 변경 후 (line 6 다음에 1줄 추가):**
```typescript
import { useState, useCallback } from 'react';
import type { WebViewNavigation } from 'react-native-webview';

import { WEBVIEW_BASE_URL } from '@/shared/config';
import { generateDiagId, sendAuthDiag, type SendToWebViewFn } from '@/shared/lib/auth-diag';
import { emitCookieSnapshot } from '@/shared/lib/cookie-diag';
import { cookieBackupService } from '@/shared/lib/cookie-backup';
```

**기존 본문 (line 53-63 영역):**
```typescript
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
```

**본문 변경 후 (`emitCookieSnapshot` 호출 직후 backup 호출 1줄 추가):**
```typescript
      // 로드 완료 후에만 스냅샷 + backup (Set-Cookie 다 들어온 시점)
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
      // AsyncStorage가 cookie jar의 거울이 되도록 즉시 backup.
      // web의 AUTH_STATE_CHANGED 이벤트가 오지 않아도 navigation 감지로 발화 — 안전망.
      void cookieBackupService.backup({ send: sendToWebView });
    },
```

기존 주석("로드 완료 후에만 스냅샷 (Set-Cookie 다 들어온 시점)")은 "로드 완료 후에만 스냅샷 + backup (Set-Cookie 다 들어온 시점)"으로 1단어만 보강.

- [ ] **Step 2: TypeScript 컴파일 통과 확인**

```bash
npx tsc --noEmit
```

Expected: 에러 0건.

- [ ] **Step 3: ESLint 통과 확인 (옵션)**

```bash
npx eslint src/features/webview-nav-state/lib/useWebViewNavState.ts
```

Expected: 에러/경고 0건. recipio-app엔 ESLint config 없으므로 exit 2로 N/A 처리.

- [ ] **Step 4: Diff 검토**

```bash
git diff src/features/webview-nav-state/lib/useWebViewNavState.ts
```

Expected: 정확히 (a) import 1줄 추가 (cookieBackupService) (b) 주석 1단어 보강 (c) `cookieBackupService.backup({ send: sendToWebView })` 1줄 추가. 그 외 변경 없음.

- [ ] **Step 5: Commit**

```bash
git add src/features/webview-nav-state/lib/useWebViewNavState.ts
git commit -m "$(cat <<'EOF'
feat(webview-nav): trigger cookie backup on auth navigation phases

webview-nav-app-callback과 webview-nav-main 로드 완료 시점에
cookieBackupService.backup() 자체 발화. web의 AUTH_STATE_CHANGED
이벤트가 오지 않아도 navigation 감지로 AsyncStorage 갱신.

기존 backup 발화 경로:
- AppState background (useCookieLifecycle:46) — race window 큼
- AUTH_STATE_CHANGED login/refresh (authStateHandler:29) — web 의존

새 경로 추가로 AsyncStorage가 cookie jar의 거울이 되는 빈도 증가 →
가설 C(rotation stale)와 유령 로그인 시나리오 차단.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: PHASE 1 dev client manual 검증 (코드 변경 없음)

**Files:** 없음 (manual verification만)

전제: `EXPO_PUBLIC_AUTH_DIAGNOSTIC_ENABLED=true` `.env`, Capstone-frontend Vercel preview에 `AUTH_DIAGNOSTIC_ENABLED=true` redeploy 완료. **Capstone-frontend 변경(Task 1)도 preview 배포돼있어야 PHASE 1' 검증 가능**. 단 PHASE 1(B만 검증)은 Task 1 미배포 상태에서도 가능.

### PHASE 1 — Task 2 단독 검증 (Task 1 배포 안 된 상태)

이 단계는 RN-only 변경이 동작하는지 확인. Capstone-frontend는 아직 preview 미배포여도 OK.

- [ ] **Step 1: Metro 재시작**

```bash
npx expo start --clear --dev-client --tunnel
```

dev client 단말 연결.

- [ ] **Step 2: Vercel 로그 follow**

별도 터미널:
```bash
vercel logs <preview-url> --follow | grep "\[AUTH_DIAG\]"
```

- [ ] **Step 3: 카카오 신규 로그인**

앱 데이터 삭제 또는 로그아웃 → 카카오 로그인 → 메인 진입.

- [ ] **Step 4: Metro 로그에서 cookie-mutation:backup 2회 발화 확인**

다음 시퀀스가 떠야 함:

```
LOADING URL: ...api/auth/app-callback...
[AUTH_DIAG] {"phase":"webview-nav-app-callback",..., "loading":true}
[AUTH_DIAG] {"phase":"webview-nav-app-callback",..., "loading":false}
[AUTH_DIAG] {"phase":"cookie-snapshot:post-app-callback",...}
[CookieBackup] Backed up N cookies
[AUTH_DIAG] {"phase":"cookie-mutation:backup","source":"app-rn-cookie-backup",...,"meta":{"result":"written",...}}    ← 1차 ✓

LOADING URL: https://www.recipio.kr/...
[AUTH_DIAG] {"phase":"webview-nav-main",..., "loading":false}
[AUTH_DIAG] {"phase":"cookie-snapshot:post-login",...}
[CookieBackup] Backed up N cookies
[AUTH_DIAG] {"phase":"cookie-mutation:backup","source":"app-rn-cookie-backup",...,"meta":{"result":"written",...}}    ← 2차 ✓
```

PASS 조건: 같은 로그인 1회 안에 `cookie-mutation:backup result:"written"`이 **최소 2회** 발화. AppState background 안 거치고도. 이게 Task 2 동작 증명.

FAIL 시: import path 또는 조건 분기 문제. `useWebViewNavState.ts:55-66` 영역 재확인.

### PHASE 1' — Task 1 배포 후 추가 검증 (선택, 더 robust)

Capstone-frontend가 preview 배포된 후 다음도 확인:

- [ ] **Step 5: AUTH_STATE_CHANGED login event 송신 확인**

카카오 로그인 후 Metro 로그에:

```
[Bridge] Message: AUTH_STATE_CHANGED {event: 'login'}
[AuthStateHandler] login — backing up cookies
[AUTH_DIAG] {"phase":"cookie-mutation:backup",...,"meta":{"result":"written",...}}    ← 3차 ✓
```

PASS 조건: 위 3줄 시퀀스가 보이면 Task 1의 login 송신 동작.

- [ ] **Step 6: AUTH_STATE_CHANGED refresh event 송신 확인**

WebView 안에서 chrome://inspect로 콘솔 접속 후:
```javascript
fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).then(r => r.status)
```

Metro 로그에:
```
[WebView:log] [Auth] refresh-success
[Bridge] Message: AUTH_STATE_CHANGED {event: 'refresh'}
[AuthStateHandler] refresh — backing up cookies
[AUTH_DIAG] {"phase":"cookie-mutation:backup",...,"meta":{"result":"written",...}}
```

PASS 조건: refresh-success 직후 AUTH_STATE_CHANGED:refresh 떠야 함.

- [ ] **Step 7: AUTH_STATE_CHANGED logout event 송신 확인**

앱에서 로그아웃 액션:
```
[Bridge] Message: AUTH_STATE_CHANGED {event: 'logout'}
[AuthStateHandler] logout — clearing backup
[CookieBackup] Backup cleared
```

PASS 조건: logout 액션 직후 위 시퀀스.

### PHASE 1'' — 가설 C 재현 시도 (실패해야 PASS)

Task 1+2 모두 머지·배포된 상태에서:

- [ ] **Step 8: 회전 후 force-quit cold-start 시나리오**

1. 카카오 로그인 (R1 발급)
2. chrome://inspect 콘솔: `fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })` 실행 → 서버가 R1→R2 회전
3. Metro 로그에서 직후 `cookie-mutation:backup result:"written"` 확인 (= AsyncStorage가 R2로 갱신됐다는 증거)
4. 단말 설정 → 앱 → "Recipio (Dev)" → 강제종료
5. 앱 다시 실행 → cold-start
6. Metro 로그 관찰

PASS 조건:
- `cookie-mutation:restore` 메타에서 refreshToken fp가 step 2 이후 새 R2와 같음 (step 1의 R1이 아님)
- `[Auth] refresh-no-session` **안 뜸**
- 메인 화면 정상 진입

FAIL 시: backup 갱신이 회전 시점에 안 됐다는 뜻 — Task 1과 Task 2 둘 다 발화 누락. 어느 쪽이 누락인지 로그로 확인 후 fix.

- [ ] **Step 9: 결과 정리**

위 PHASE 1 모두 PASS면 사용자한테 보고. PHASE 1' / 1''은 Task 1 배포 일정에 따라 추후 진행 가능.

```
Task 1 (Capstone-frontend) 머지·배포: ✓/✗
Task 2 (recipio-app) 머지: ✓
PHASE 1 — Task 2 단독 검증: 결과
PHASE 1' — Task 1 송신 검증: 결과
PHASE 1'' — 가설 C 재현 차단: 결과
```

이걸로 Task 1+2의 PHASE 1 끝. PHASE 2(EAS preview build, 며칠 telemetry)는 별도 사이클.

---

## Self-Review Checklist (실행 전 plan 자체 검증)

- ✅ **Spec coverage**:
  - 변경 1 (Capstone-frontend AUTH_STATE_CHANGED 송신 3 events) → Task 1
  - 변경 2 (recipio-app navigation backup 트리거) → Task 2
  - Test plan PHASE 1/1'/1'' → Task 3
  - Out of scope (가설 A debounce, secure-store) → 명시 제외
- ✅ **Placeholder 없음**:
  - 모든 step에 exact 코드/명령/expected
  - "Capstone-frontend 후보"는 spec에서 plan 단계 명시 약속됐고, plan에서 explore agent로 정확한 file:line 식별 완료
- ✅ **Type 일관성**:
  - `notifyAuthState(event: AuthEvent)` 시그니처 Task 1 Step 1에서 정의, Steps 2-4에서 일관 사용
  - `cookieBackupService.backup({ send })` 시그니처 기존 `EmitOpts` 그대로 (이전 plan의 변경)
  - `Window.ReactNativeWebView` global 타입 declare 1번만 (Step 1)
- ✅ **No 워크트리/체크아웃**: 양 repo 모두 현재 브랜치 그대로
- ✅ **Cross-repo bash 규칙 준수**: 모든 Capstone-frontend 명령에 `git -C` / `npm --prefix` 사용

---

## 영향도 요약

- 코드 라인 변경: ~30라인 (Capstone-frontend) + ~3라인 (recipio-app)
- 신규 파일: 1개 (Capstone-frontend `authStateBridge.ts`)
- 신규 의존성: 0
- 빌드/번들 영향: Capstone-frontend bundle에 ~500B 추가, RN 무관
- 사용자 마이그레이션: 없음
- 머지 순서 의존성: 없음 — 양쪽 추가만, 어느 쪽 먼저 머지해도 backward-compatible
- 보안: 개선 (옛 계정 토큰 잔존 차단)
- 효과: 가설 C + 유령 로그인 차단. 안드 코드 결함성 풀림 이전 대비 ~99% 차단 기대치
