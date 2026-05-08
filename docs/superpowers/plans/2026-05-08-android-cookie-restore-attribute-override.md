# Android Cookie Restore Attribute Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `cookieBackupService.restore()`이 안드 native API 한계로 인해 token 쿠키를 session-only / non-secure / non-httpOnly로 다운그레이드하는 회귀를 차단하고, `authStateHandler`가 web-driven backup 시 AUTH_DIAG emit하도록 배선한다.

**Architecture:** restore() 루프 안에서 token 쿠키(`/token|session|auth/i`) 를 식별해 native가 잃어버린 attribute(secure/httpOnly/expires)를 강제 보정한다. authStateHandler는 `HandlerContext.sendToWebView`를 backup() 으로 threading.

**Tech Stack:** TypeScript, React Native 0.81, `@preeternal/react-native-cookie-manager` 6.3.1, AsyncStorage. 의존성 추가 없음. 테스트 프레임워크 미도입(spec 결정) — 검증은 `tsc --noEmit` + `eslint` + PHASE 1 dev client manual.

**Spec:** `docs/superpowers/specs/2026-05-08-android-cookie-restore-attribute-override-design.md`

**Branch policy:** 현재 브랜치(`master`)에서 그대로 작업. 워크트리/체크아웃 금지 (CLAUDE.md 규칙).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/shared/lib/cookie-backup/cookieBackupService.ts` | Modify | restore() 루프에 token 쿠키 attribute 강제 보정 + 헬퍼/상수 추가 |
| `src/features/bridge/model/handlers/authStateHandler.ts` | Modify | handle 시그니처에 context 추가, backup({ send })로 threading |

신규 파일 없음. 기존 두 파일만 수정.

---

## Task 1: cookieBackupService.restore() attribute 보정 (상수+헬퍼+루프 한 번에)

**Files:**
- Modify: `src/shared/lib/cookie-backup/cookieBackupService.ts`
  - 11-12번째 줄 직후에 상수/헬퍼 추가
  - 158-176번째 줄 영역 (restore 루프 본문) 교체

이 task가 본 plan의 핵심. Token 쿠키엔 `secure: true` / `httpOnly: true` / 90일 forward-dated `expires`를 강제. 비-token 쿠키엔 `=== true` 명시 비교로 함정 ① (`false ?? true === false`) 자연 해소. 상수와 사용 코드를 한 commit으로 묶어 unused-vars 회색지대 회피.

- [ ] **Step 1: 모듈 상단에 상수/헬퍼 추가**

`src/shared/lib/cookie-backup/cookieBackupService.ts` 의 11-12번째 줄 (`const BACKUP_DOMAIN = 'recipio.kr';` 직후)에 다음 코드를 삽입:

```ts
// Token 쿠키 식별 패턴 — cookie-diag/emit.ts:21과 일치 유지.
// 이 패턴에 매치되는 쿠키엔 restore() 시 secure/httpOnly/expires를 강제 주입한다.
const TOKEN_COOKIE_PATTERN = /token|session|auth/i;

const TOKEN_RESTORE_EXPIRY_DAYS = 90;

/**
 * Native CookieManagerModule.kt parseDate가 받는 포맷:
 *   yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ (ISO 8601 with timezone)
 * Date.toISOString()은 'Z'로 끝나는데 SimpleDateFormat의 ZZZZZ는
 * +00:00 형식만 받으므로 replace 한 단계 필요.
 */
const buildExpiryString = (daysFromNow: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().replace('Z', '+00:00');
};
```

- [ ] **Step 2: restore() 루프 내부 cookieData 빌드 부분 교체**

같은 파일에서 `for (const [name, cookie] of Object.entries(cookies))` 루프(원래 158-176번째 줄)를 다음으로 **완전 교체**:

```ts
      for (const [name, cookie] of Object.entries(cookies)) {
        const isToken = TOKEN_COOKIE_PATTERN.test(name);

        // Token 쿠키: native가 잃어버린 attribute 강제 보정.
        // 비-token 쿠키: backup 시점 값 그대로 (secure/httpOnly가 명시적 true인 경우만 살림).
        const cookieData = {
          name,
          value: cookie.value,
          domain: cookie.domain || `.${BACKUP_DOMAIN}`,
          path: cookie.path || '/',
          ...(cookie.expires
            ? { expires: cookie.expires }
            : isToken
              ? { expires: buildExpiryString(TOKEN_RESTORE_EXPIRY_DAYS) }
              : {}),
          secure: isToken ? true : cookie.secure === true,
          httpOnly: isToken ? true : cookie.httpOnly === true,
        };

        if (Platform.OS === 'ios') {
          // WKWebView jar(useWebKit:true) + HTTPCookieStorage 둘 다 set
          // — clearAllCookies와 대칭. 둘 중 한쪽만 set하면 reload 시 401, 다음
          // background→foreground 동기화 후에야 적용되는 race가 발생.
          await CookieManager.set(`https://${BACKUP_DOMAIN}`, cookieData, true);
          await CookieManager.set(`https://${BACKUP_DOMAIN}`, cookieData, false);
        } else {
          await CookieManager.set(`https://${BACKUP_DOMAIN}`, cookieData);
        }
      }
```

기존 코드와의 차이:
- `secure: cookie.secure ?? true` → `secure: isToken ? true : cookie.secure === true` (함정 ① 해소)
- `httpOnly: cookie.httpOnly ?? false` → `httpOnly: isToken ? true : cookie.httpOnly === true`
- `...(cookie.expires && { expires: cookie.expires })` → 3-way 분기: cookie.expires 있으면 그대로, 없고 isToken이면 90일 future, 둘 다 아니면 omit
- iOS 분기 코드와 들여쓰기/주석은 보존

- [ ] **Step 3: TypeScript 컴파일 통과 확인**

Run: `npx tsc --noEmit`
Expected: 에러 0건. 새 상수와 사용 위치가 동시에 추가됐으므로 unused-vars 경고도 없음.

- [ ] **Step 4: ESLint 통과 확인**

Run: `npx eslint src/shared/lib/cookie-backup/cookieBackupService.ts`
Expected: 에러/경고 0건. 만약 `prefer-nullish-coalescing` 같은 규칙에서 경고가 뜨면, 본 변경의 `=== true` 명시 비교는 **의도된** 것이므로 그 라인에 `// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing` 추가 (메시지 먼저 확인 후).

- [ ] **Step 5: Diff 검토**

Run: `git diff src/shared/lib/cookie-backup/cookieBackupService.ts`
Expected: 변경은 정확히 (a) BACKUP_DOMAIN 직후 상수/헬퍼 블록 추가 (b) restore() 안 for 루프 cookieData 빌드 + Platform 분기. 그 외 함수(backup, summarizeCookies, clear) 변경 없음. import 추가/삭제 없음.

- [ ] **Step 6: Commit**

```bash
git add src/shared/lib/cookie-backup/cookieBackupService.ts
git commit -m "$(cat <<'EOF'
fix(cookie-backup): preserve secure/httpOnly/expires for token cookies on Android

안드 native CookieManager.get()이 RFC 6265 요청 헤더 포맷만 반환해
모든 attribute가 backup 시 소실되던 문제를 restore() 시 강제 보정.

- /token|session|auth/i 매치 쿠키: secure=true, httpOnly=true, expires=+90d
- 그 외 쿠키: cookie.secure === true 명시 비교로 함정 ① (false ?? true === false) 회피
- iOS는 backup이 attribute를 보존하므로 결과 회귀 없음

가설 B(httpOnly/expires 소실로 인한 session-cookie 다운그레이드)와
보안 회귀(WebView JS가 document.cookie로 토큰 raw 값 읽기) 동시 차단.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: authStateHandler가 context를 받아 backup으로 threading

**Files:**
- Modify: `src/features/bridge/model/handlers/authStateHandler.ts` (전체 교체)

`HandlerContext`엔 이미 `sendToWebView`가 있다 (`types.ts:5-8`). 시그니처를 다른 핸들러(`notificationHandler`, `pushTokenHandler` 등)와 일치시키고 `backup({ send: context?.sendToWebView })`로 thread만 하면 된다.

- [ ] **Step 1: authStateHandler 전체 교체**

`src/features/bridge/model/handlers/authStateHandler.ts` 전체를 다음으로 교체:

```ts
import { cookieBackupService } from '@/shared/lib/cookie-backup';
import type { AuthStatePayload, BridgeMessage } from '@/shared/types';
import type { BridgeHandler, HandlerContext } from './types';

/**
 * 웹에서 인증 상태 변경 알림을 받아 쿠키를 백업/삭제
 *
 * 웹 프론트엔드에서 보내는 메시지:
 * { type: 'AUTH_STATE_CHANGED', payload: { event: 'login' | 'refresh' | 'logout' } }
 *
 * 참고: WebView 쿠키 자체는 웹 측에서 관리. 여기선 AsyncStorage 백업만 갱신/삭제.
 */
export const authStateHandler: BridgeHandler<AuthStatePayload> = {
  handle: async (
    message: BridgeMessage<AuthStatePayload>,
    context?: HandlerContext
  ) => {
    const event = message.payload?.event;

    if (!event) {
      console.warn('[AuthStateHandler] Missing event in payload');
      return;
    }

    switch (event) {
      case 'login':
      case 'refresh':
        console.log(`[AuthStateHandler] ${event} — backing up cookies`);
        await cookieBackupService.backup({ send: context?.sendToWebView });
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
```

기존 대비 변경:
- `import type { BridgeHandler } from './types';` → `import type { BridgeHandler, HandlerContext } from './types';`
- `handle: async (message: BridgeMessage<AuthStatePayload>) => {` → `handle: async (message: BridgeMessage<AuthStatePayload>, context?: HandlerContext) => {`
- `await cookieBackupService.backup();` → `await cookieBackupService.backup({ send: context?.sendToWebView });`

(주석/case 본문은 그대로.)

- [ ] **Step 2: 다른 핸들러와 시그니처 일관성 확인**

Run: `grep -n "handle: async" src/features/bridge/model/handlers/notificationHandler.ts src/features/bridge/model/handlers/pushTokenHandler.ts src/features/bridge/model/handlers/authStateHandler.ts`
Expected: 세 핸들러 모두 두 번째 인자로 `context?: HandlerContext` (또는 _name 변형)를 받는 모양. authStateHandler가 일치하는지 시각 확인.

- [ ] **Step 3: messageRouter가 context를 실제로 넘기는지 재확인**

Run: `grep -n "messageRouter.route" src/features/bridge/lib/useBridge.ts`
Expected: `messageRouter.route(message, context);` 형태로 context 두 번째 인자 전달. 이미 그렇게 돼있음 (useBridge.ts:51) — 변경 불필요. 이 단계는 검증만.

- [ ] **Step 4: TypeScript 컴파일 통과 확인**

Run: `npx tsc --noEmit`
Expected: 에러 0건. context 파라미터 타입과 backup() opts 타입이 모두 매치.

- [ ] **Step 5: ESLint 통과 확인**

Run: `npx eslint src/features/bridge/model/handlers/authStateHandler.ts`
Expected: 에러/경고 0건.

- [ ] **Step 6: Diff 검토**

Run: `git diff src/features/bridge/model/handlers/authStateHandler.ts`
Expected: 변경은 정확히 (a) import 줄에 HandlerContext 추가 (b) handle 시그니처에 context 파라미터 추가 (c) backup() 호출에 `{ send: context?.sendToWebView }` 추가. 그 외 case 본문/주석/clear() 호출 변경 없음.

- [ ] **Step 7: Commit**

```bash
git add src/features/bridge/model/handlers/authStateHandler.ts
git commit -m "$(cat <<'EOF'
chore(bridge): thread sendToWebView through authStateHandler backup

handle 시그니처에 HandlerContext 추가하고 backup({ send })로 threading.
web-driven backup(AUTH_STATE_CHANGED: login/refresh) 발화 시에도
cookie-mutation:backup AUTH_DIAG가 emit되어 PHASE 2 telemetry에서
web-driven vs AppState-driven backup 분리 관측 가능.

다른 핸들러(notificationHandler 등)와 시그니처 일치.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: PHASE 1 dev client manual 검증 (코드 변경 없음)

**Files:** 없음 (manual verification만)

이 task는 spec의 Test plan §PHASE 1 그대로다. Commit 없음. 결과를 사용자한테 보고하고 PHASE 2(EAS preview build) 진입 여부 결정.

전제: `EXPO_PUBLIC_AUTH_DIAGNOSTIC_ENABLED=true` 가 `.env`에 있고, Capstone-frontend Vercel preview에 `AUTH_DIAGNOSTIC_ENABLED=true` env 설정 + redeploy 완료된 상태. 이 전제가 안 맞으면 task.md의 PHASE 1 §A~D 사전 준비부터 진행.

- [ ] **Step 1: Metro 재시작 (env 캐시 무효화)**

Run: `npx expo start --clear --dev-client`
Expected: 터미널 A에 Metro waiting on `exp://...` 표시. QR/URL 노출.

- [ ] **Step 2: Vercel 로그 follow 띄우기**

별도 터미널 B에서: `vercel logs <preview-url> --follow | grep "\[AUTH_DIAG\]"`
Expected: "Following logs..." 메시지, baseline 비어있음.

- [ ] **Step 3: 안드 dev client 단말 연결 + 카카오 로그인 1회**

- 단말 dev client 앱 실행 → Metro URL 입력
- 로그아웃 상태에서 시작
- 카카오 로그인 → 인증 → 메인 화면 진입
Expected: 정상 로그인 + 메인 콘텐츠 로드.

- [ ] **Step 4: web-driven backup emit 검증 (Task 2 검증)**

카카오 로그인 직후 (= `AUTH_STATE_CHANGED: login` 이벤트 발화 시점) 터미널 B 로그에 `phase":"cookie-mutation:backup","source":"app-rn-cookie-backup"` 라인이 떠야 함. 이게 web-driven backup 경로의 emit. 변경 전엔 안 떴음.
Expected: login 직후 약 1초 안에 cookie-mutation:backup 1회 발화.

- [ ] **Step 5: 쿠키삭제 → 복원테스트 시나리오 (Task 1 검증)**

- 디버그 바에서 `🍪 쿠키삭제` 탭 → 알림창 확인
- `🔑 복원테스트` 탭 → 알림창 확인
- WebView reload 후 메인 화면 정상 표시되는지 확인
Expected: 로그인 유지 + 메인 콘텐츠 정상 로드.

- [ ] **Step 6: Vercel 로그에서 restore 효과 검증 (중요: phase 분리)**

**주의:** `cookie-mutation:restore` phase의 `meta.cookies[]`는 AsyncStorage **원본 데이터**를 그대로 dump한 것 (backup 시점에 attribute 없이 저장됐으므로 여기서도 `secure: false`, `httpOnly: false`, `sessionOnly: true`가 정상). 이 phase로는 Task 1의 override 효과를 **검증할 수 없다**. `summarizeCookies()` (cookieBackupService.ts:43-73)는 AsyncStorage에서 읽은 값 그대로 fingerprint만 떼는 함수이고, override는 그 후 `CookieManager.set()` 호출 시점에 일어나므로 native cookie jar를 다시 읽어야 효과가 보임.

**진짜 verify 방법:** 복원테스트 후 WebView reload → 메인 화면 도달하면 `cookie-snapshot:post-login` 또는 60초 후 `cookie-snapshot:periodic` phase가 발화. 그 phase의 `meta.cookies[]`는 `nativeCookieSnapshot.ts`가 `CookieManager.get()`으로 native에서 다시 읽은 값. 여기서 검증:

- `sourceJar: "android-default"` 인 항목 중 `accessToken` / `refreshToken` 찾기
- `secure: true` ✓
- `httpOnly: true` ✓
- `sessionOnly: false` ✓ (expires 90일 후로 들어가 있음)

만약 native가 attribute를 다시 잃어버려서 (cookie jar에서 다시 RFC6265 헤더 포맷으로 read해서) 여기서도 `secure: false`, `httpOnly: false`, `sessionOnly: true`로 보일 수도 있음. 그건 Android `webkit.CookieManager.getCookie()` API의 **read 한계**라 정상이며, override 자체는 동작하고 있는 것. 그 경우 다음 Step 7 (document.cookie)이 진짜 effective verification.

Expected primary signal: Step 7 PASS = httpOnly 강제 적용됨. Step 6의 cookie-snapshot 메타는 보조 신호 (read 가능하면 보너스, 아니면 native 한계).

- [ ] **Step 7: WebView document.cookie 검증 (httpOnly 동작 확인)**

복원테스트 후 reload 직후, `App.tsx`의 `handleWebViewLoadEnd` 안에 임시로 다음 한 줄 추가:

```ts
webViewRef.current?.injectJavaScript(`
  console.log('[verify-httponly] document.cookie:', document.cookie);
  true;
`);
```

dev client는 `CONSOLE_BRIDGE_SCRIPT`가 이미 주입돼있어 (MainWebView.tsx:48) WebView 안 console.log가 자동으로 RN 쪽 Metro 로그에 `[WebView:log]` prefix로 흘러옴. 터미널 A에서 `[verify-httponly] document.cookie:` 라인 찾기.

Expected: 그 라인 뒤에 `accessToken=` / `refreshToken=` 가 **포함되지 않음**. (locale, GA `_ga` 같은 비-token만 보일 수 있음.)

검증 후 임시 한 줄 제거 (commit하지 않음).

- [ ] **Step 8: 결과 정리**

위 5/6/7 검증 항목 모두 통과 시 PHASE 1 PASS. 사용자한테 보고:
- "Task 1~2 코드 변경 완료, PHASE 1 검증 통과. 다음은 PHASE 2 EAS preview build로 며칠 장기 관측."

실패 항목 있으면 spec의 §"Test plan > Failure mode" 참고:
- restore 후 로그인 풀림 → expires 포맷 mismatch 의심. `node_modules/@preeternal/react-native-cookie-manager/android/.../CookieManagerModule.kt:230` parseDate 동작 확인.
- `document.cookie`에 token 보임 → `HTTP_ONLY_SUPPORTED` (Android N+, `CookieManagerModule.kt:304`) 게이트 확인. minSdk 점검.
- web-driven backup phase 안 보임 → useBridge.ts:51의 context 전달 또는 message type 라우팅 확인.

---

## Self-Review Checklist (실행 전 plan 자체 검증)

- ✅ **Spec coverage**:
  - 변경 1 (restore attribute 보정) → Task 1
  - 변경 2 (authStateHandler send threading) → Task 2
  - Test plan PHASE 1 → Task 3
  - Backwards compat → Task 1 변경 자체가 보장 (포맷 변경 0)
  - Test plan PHASE 2 → Task 3 Step 8에서 인계 (multi-day 관측이라 plan 범위 밖)
- ✅ **Placeholder 없음**: 모든 step에 exact 코드/명령어/expected 결과
- ✅ **Type 일관성**:
  - `TOKEN_COOKIE_PATTERN`, `TOKEN_RESTORE_EXPIRY_DAYS`, `buildExpiryString` Task 1 안에서 정의+사용 (단일 commit)
  - `HandlerContext` Task 2 import는 기존 `./types`에 있음 확인됨 (`types.ts:5`)
  - `cookieBackupService.backup({ send })` 시그니처는 기존 `EmitOpts` 그대로 (`cookieBackupService.ts:23`)
- ✅ **No 워크트리/체크아웃**: 현재 브랜치 그대로
- ✅ **TDD 변형**: 테스트 프레임워크 미도입 (spec 결정) → tsc + eslint + manual PHASE 1으로 대체

---

## 영향도 요약

- 코드 라인 변경: ~30 라인 (cookieBackupService.ts) + ~5 라인 (authStateHandler.ts)
- 커밋 수: 2 (Task 1/2 각 1건; Task 3는 manual이라 commit 없음)
- 신규 의존성: 0
- 빌드/번들 영향: 0 (런타임 코드만)
- AsyncStorage 마이그레이션: 불필요 (기존 backup 즉시 호환)
