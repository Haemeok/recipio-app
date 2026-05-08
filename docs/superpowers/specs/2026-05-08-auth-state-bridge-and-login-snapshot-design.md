# Auth State Bridge + Login-time Snapshot 설계

**작성일**: 2026-05-08
**상태**: 합의됨, 구현 계획 작성 대기
**관련 repo**: `recipio-app` (RN, 본 repo) + `Capstone-frontend` (웹, sister repo at `C:/Users/user/Desktop/recipio/Capstone-frontend`)

## 배경

직전 plan(`2026-05-08-android-cookie-restore-attribute-override`)으로 안드 가설 B(httpOnly/expires 소실)는 차단됐다. 그러나 PHASE 1 검증 도중 로그에서 다음 시퀀스가 실시간 재현됐다:

```
[AUTH_DIAG] cookie-mutation:restore ... refreshToken: 5ce31d11
[Auth] 401-detected
[Auth] refresh-start
[Auth] refresh-no-session    ← 서버가 이 토큰 모름
[Auth] 401-retry-failed
LOADING URL: .../login
```

= **가설 C (Rotation + stale snapshot)** 발현. cold-start의 `restore()`이 AsyncStorage에 저장된 옛 refreshToken을 cookie jar에 복원했지만 서버는 이미 그 토큰을 회전(rotate)시켜 폐기한 상태. 첫 refresh 시도에서 `refresh-no-session` 응답 → 강제 로그아웃.

추가 코드 탐색 결과 근본 원인 확인:

1. **Capstone-frontend가 `AUTH_STATE_CHANGED` 메시지를 단 한 번도 송신하지 않음**. 송신 위치가 코드 전체에 0건. login/refresh/logout 셋 모두 RN에 통보 없음. RN의 `cookieBackupService.backup()`이 이벤트 의존이라 사실상 발화 안 됨.
2. RN의 `cookieBackupService.backup()` 발화 경로가 **AppState `background` 한 가지뿐**. 사용자가 홈 버튼 안 누르고 force-quit하면 AsyncStorage가 영영 갱신 안 됨.
3. 결과: refresh 회전이 발생할 때마다 cookie jar는 새 R2로 갱신되지만 AsyncStorage backup은 옛 R1을 유지 → cold-start에서 stale 토큰 복원 → 가설 C 발현.

부수적으로 옛 계정 토큰이 AsyncStorage에 잔존해 다음 cold-start 시 "유령 로그인" 발현 가능 (token.md §2 시나리오)도 동일한 backup 갱신 누락이 원인.

## 목표

- AsyncStorage backup이 cookie jar의 모든 변화를 즉시 거울처럼 따라가도록 만듦 — login/refresh/logout 시점마다 동기 backup
- 가설 C (rotation stale) + 유령 로그인 (옛 계정 잔존) 차단
- 단일 source of truth = WebView cookie jar. AsyncStorage는 그 jar의 정확한 거울일 뿐

## 비-목표

- 가설 A (AppState background race) 완전 차단 — 별도 plan (debounce 또는 secure-store 전환)
- expo-secure-store 마이그레이션 — token.md 권고 옵션 D, 본 plan 범위 밖
- token rotation 정책 자체 변경 (서버 작업)
- 백업 서비스 제거 — 운영 telemetry로 net-positive 확정, 유지 결정

## 결정 사항

| 항목 | 선택 | 근거 |
|---|---|---|
| 작업 분배 | Task A(웹) + Task B(RN) — 양쪽 동시 작업 | 어느 한쪽만 해도 backward-compatible (둘 다 추가만), 그러나 둘 다 해야 효과 maximal |
| Plan 구성 | 단일 plan, cross-repo 2 task | 의도가 통합돼있음. 머지/배포는 task 단위 독립 가능 |
| RN 측 backup 트리거 위치 | `useWebViewNavState`의 navigation phase 감지 (이미 존재) | snapshot emit 같은 위치에 backup 추가 — 코드 응집 |
| RN 측 backup 트리거 시점 | `webview-nav-app-callback` AND `webview-nav-main` 둘 다 로드 완료 시 | app-callback에서 1차(login 직후), main에서 2차(refresh redirect 안전망) |
| 웹 측 송신 채널 | `window.ReactNativeWebView?.postMessage(...)` | 기존 RN bridge 채널 재사용 |
| 웹 측 환경 감지 | `window.ReactNativeWebView` 존재 체크로 가드 | 일반 브라우저에선 no-op |
| 페이로드 형식 | `{type: 'AUTH_STATE_CHANGED', payload: {event: 'login'\|'refresh'\|'logout'}}` | 기존 RN authStateHandler가 이미 이 형식 기대 (`authStateHandler.ts`) |
| Test framework 도입 | 미도입 | 기존 결정 유지. PHASE 1 manual + Vercel 로그 분석 |

## 변경되는 파일

### Capstone-frontend (웹)
정확한 파일 위치는 plan 단계에서 코드 탐색 후 확정. 후보:
- **수정**: `src/app/api/auth/callback/{google,kakao,naver,apple}/route.ts` 또는 OAuth 완료 시 클라이언트가 재방문하는 페이지 — `event: 'login'` 송신
- **수정**: `src/shared/lib/auth/useAuthManager.ts` 또는 `src/shared/api/auth.ts:115-118`의 `tokenRefreshed` CustomEvent 핸들러 — `event: 'refresh'` 송신
- **수정**: `src/features/auth/model/hooks/useLogoutMutation.ts:32` 영역 — `event: 'logout'` 송신
- **신규**: `src/shared/lib/bridge/authStateBridge.ts` (헬퍼) — 환경 감지 + postMessage 한 곳에 응집

### recipio-app (RN)
- **수정**: `src/features/webview-nav-state/lib/useWebViewNavState.ts` — `cookie-snapshot` emit 위치에 `cookieBackupService.backup({ send })` 호출 추가

신규 파일 RN 측엔 없음. 의존성 추가 0.

## Task A — Capstone-frontend `AUTH_STATE_CHANGED` 송신 (3 events)

### A-1. 헬퍼 생성

`src/shared/lib/bridge/authStateBridge.ts` (신규):

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
 */
export const notifyAuthState = (event: AuthEvent): void => {
  if (typeof window === 'undefined') return;
  const bridge = window.ReactNativeWebView;
  if (!bridge) return;
  try {
    bridge.postMessage(JSON.stringify({
      type: 'AUTH_STATE_CHANGED',
      payload: { event },
    }));
  } catch (err) {
    console.warn('[authStateBridge] postMessage failed', err);
  }
};
```

### A-2. 송신 위치 3곳에 호출 추가

각 위치에서 `notifyAuthState('login' | 'refresh' | 'logout')` 호출. 정확한 줄은 plan 단계에서 코드 확인 후 명시.

- **login**: OAuth callback 성공 후 (서버가 Set-Cookie 완료 + 클라이언트가 토큰 cookie 인지한 시점). 일반적으로 callback route가 redirect하는 페이지의 mount 효과 또는 `tokenRefreshed`와 비슷한 클라 이벤트.
- **refresh**: `src/shared/api/auth.ts`의 refresh 성공 분기 또는 `tokenRefreshed` CustomEvent dispatch 직후.
- **logout**: `useLogoutMutation`의 onSuccess 또는 logoutAction 직후.

### A-3. (선택) 페이로드 enrichment 검토 — 본 plan 미포함

향후 가설 D(domain mismatch) 분석 위해 페이로드에 `cookies: [{name, expires, httpOnly, secure, domain}]` 추가하는 안이 token.md에 있음. 본 plan에선 단순 event-only 페이로드만 송신 — 이 작업이 먼저 안정화된 후 enrichment 작업으로 분리.

## Task B — recipio-app `useWebViewNavState`에 backup 트리거 추가

### 변경 파일
`src/features/webview-nav-state/lib/useWebViewNavState.ts:53-63` 영역.

### 현재 코드

```ts
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
```

### 변경 후

```ts
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
```

새 import 추가: `import { cookieBackupService } from '@/shared/lib/cookie-backup';`

### 동작 변화

- 로그인 직후 (`webview-nav-app-callback` 로드 완료): 1차 backup → 새 토큰 즉시 AsyncStorage 반영
- 메인 도달 (`webview-nav-main` 로드 완료): 2차 backup → app-callback이 redirect하면서 추가 Set-Cookie 떴을 가능성 흡수
- Web의 `AUTH_STATE_CHANGED` 이벤트가 와도 무관 — 양쪽 backup이 같은 cookie jar를 거울 복사하므로 idempotent
- `hasAuthToken` 가드(`cookieBackupService.ts:84-98`)가 빈/부분 토큰 backup 자동 skip

### Out of scope

- AppState `background` 경로의 backup() 호출(`useCookieLifecycle.ts:46`)은 그대로 유지 — 이중 안전망

## Test plan

### PHASE 1 — dev client 검증 (~30분, A 머지 전 B만으로 가능)

전제: `EXPO_PUBLIC_AUTH_DIAGNOSTIC_ENABLED=true`, Capstone-frontend Vercel preview에 `AUTH_DIAGNOSTIC_ENABLED=true`. Task B만 머지된 상태(A 미배포)에서 시작.

1. `npx expo start --clear --dev-client --tunnel` → dev client 연결
2. 카카오 신규 로그인 → 메인 화면 진입
3. Metro 로그에서 다음 시퀀스 확인:
   - `LOADING URL: ...api/auth/app-callback...`
   - `[AUTH_DIAG] webview-nav-app-callback` ... `loading:false`
   - `[AUTH_DIAG] cookie-snapshot:post-app-callback`
   - `[AUTH_DIAG] cookie-mutation:backup ... result:"written"` ✓ Task B 1차 발화
   - `LOADING URL: https://www.recipio.kr/`
   - `[AUTH_DIAG] webview-nav-main` ... `loading:false`
   - `[AUTH_DIAG] cookie-snapshot:post-login`
   - `[AUTH_DIAG] cookie-mutation:backup ... result:"written"` ✓ Task B 2차 발화

`cookie-mutation:backup` 2회가 같은 로그인 1회 안에 떠야 함. AppState background 안 거치고도. = Task B PASS.

### PHASE 1' — Task A 머지 후 추가 검증

Capstone-frontend도 머지·배포된 상태에서:

1. 카카오 로그인 → 추가로 `[Bridge] Message: AUTH_STATE_CHANGED {event:login}` + `[AuthStateHandler] login` 라인이 떠야 함. 그 직후 또 `cookie-mutation:backup` 발화 (B의 navigation 감지에 더해 web event 경로까지 — 총 3회까지 가능).
2. WebView 안에서 `/api/auth/refresh` 강제 호출 (chrome://inspect): `tokenRefreshed` CustomEvent → `notifyAuthState('refresh')` → `[AuthStateHandler] refresh` + `cookie-mutation:backup` 발화.
3. 로그아웃 액션: `notifyAuthState('logout')` → `[AuthStateHandler] logout` + `[CookieBackup] Backup cleared`.

### PHASE 1'' — 가설 C 재현 시도 (실패해야 PASS)

이전에 재현됐던 시나리오:
1. 로그인 → 백그라운드 → backup R1
2. token 회전 발생 → 새 R2가 cookie jar에 들어옴
3. force-quit → cold-start → restore가 stale R1 복원 → `refresh-no-session`

**A+B 머지 후엔 step 2의 회전 직후 (web의 `AUTH_STATE_CHANGED:refresh` 또는 RN의 navigation 감지)에서 backup이 R2로 갱신**돼야 한다. 따라서 step 3의 force-quit 후 cold-start 시 AsyncStorage에 R2가 있고 → `refresh-no-session` 안 떠야 함.

검증 방법:
1. 로그인
2. chrome://inspect 콘솔에서 `fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })` 강제 회전
3. Metro 로그에서 직후 `cookie-mutation:backup result:"written"` 확인 (= AsyncStorage가 R2로 갱신됨)
4. 단말 설정 → 앱 강제종료
5. 앱 재실행 → cold-start → restore → 로그인 유지 + `refresh-no-session` 안 뜸 → PASS

### Failure mode

- Task B의 `cookie-mutation:backup`이 navigation 시점에 안 발화 → `useWebViewNavState`의 import 또는 `Platform`/조건 분기 문제. import path 재확인.
- Task A의 `notifyAuthState`가 호출되지만 `[Bridge] Message: AUTH_STATE_CHANGED`가 안 뜸 → `window.ReactNativeWebView` 존재 가드 통과 못 한 것. 일반 브라우저에선 정상, RN dev client에선 떠야 함.
- 가설 C 재현이 여전히 됨 → 회전 시점과 backup 시점 사이에 타이밍 race가 더 있다는 뜻 → debounce 또는 secure-store 별도 plan 필요 (옵션 C/D).

## 영향도

| 항목 | 추정 |
|---|---|
| Capstone-frontend 코드 추가 | ~30라인 (헬퍼 + 3곳 호출) |
| recipio-app 코드 추가 | ~3라인 (import + backup 호출 1줄) |
| 신규 의존성 | 0 양쪽 다 |
| 빌드/번들 영향 | 무시 |
| 사용자 마이그레이션 | 없음 (backup 형식 변경 0) |
| 머지 순서 의존성 | 없음 — 둘 다 추가만, 어느 쪽 먼저 머지해도 무관 |
| 보안 | 개선 (옛 계정 토큰 잔존 차단으로 유령 로그인 방지) |

## 효과 추정

- 가설 C (rotation stale): **실질 차단**. AsyncStorage가 cookie jar 거울이 되므로 stale 토큰이 저장될 창이 거의 0
- 유령 로그인 (옛 계정 잔존): **실질 차단**. 새 로그인 직후 즉시 backup이 옛 계정 토큰을 덮어씀
- 가설 A (AppState race): 부분 완화. web/navigation 경로 backup이 정확한 시점에 발화하므로 AppState 경로의 race window가 의존하는 케이스가 줄어듦. 완전 차단은 별도 plan
- 정상 auth loss (서버 정책, TTL): 무관

직전 plan(Task 1+2)과 합쳐 안드 코드 결함성 로그인 풀림은 **이전 대비 ~99% 차단** 기대치. 정확한 비율은 PHASE 2 며칠 telemetry로 측정.
