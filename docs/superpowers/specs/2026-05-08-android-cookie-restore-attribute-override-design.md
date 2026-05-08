# Android Cookie Restore Attribute Override + Web-driven Backup Telemetry 설계

**작성일**: 2026-05-08
**상태**: 합의됨, 구현 계획 작성 대기
**관련 repo**: `recipio-app` (RN, 본 repo)

## 배경

`recipio-app`의 안드로이드 로그인 간헐 풀림 원인을 systematic-debugging으로 추적한 결과, `@preeternal/react-native-cookie-manager`의 안드 native 모듈(`CookieManagerModule.kt`)이 구조적 한계를 갖고 있음을 확인했다.

`CookieManager.get(url)` 호출 시 native 측은 Android `webkit.CookieManager.getCookie(url)`을 사용하는데, 이 API는 RFC 6265 요청 헤더 포맷(`name=value; name=value`)만 반환하고 cookie attribute(`expires`, `httpOnly`, `secure`, `domain`)는 일체 노출하지 않는다 (안드 WebView CookieManager 자체에 metadata-aware enumeration API가 public으로 없음). native 코드는 이 문자열을 `HttpCookie.parse()`로 다시 파싱하는데, 결과 객체는 모든 attribute가 기본값(`secure=false`, `isHttpOnly=false`, `maxAge=-1`, `domain=null`, `path=null`)으로 채워진다.

결과: `cookieBackupService.backup()`이 만드는 AsyncStorage 스냅샷은 매번 token 쿠키의 attribute가 전부 소실된 상태다. 그 스냅샷을 읽어 들이는 `restore()`은 다음 함정에 빠진다:

1. **`secure: cookie.secure ?? true`** — native가 `false`(undefined가 아님)를 내려보내므로 nullish coalescing이 작동하지 않음. 결과: `secure=false`로 저장.
2. **`httpOnly: cookie.httpOnly ?? false`** — 동일 이유로 `httpOnly=false`로 저장. WebView 안 JS에서 `document.cookie`로 raw 토큰 읽기 가능 (보안 회귀).
3. **`...(cookie.expires && { expires })`** — `cookie.expires`가 항상 undefined이므로 spread가 비어 있음. 결과: 모든 token 쿠키가 **session cookie**로 저장. AsyncStorage chain이 한 번이라도 끊기면 (앱 데이터 삭제, 저장소 손상) 복구 불가능.

이는 `token.md`의 **Hypothesis B (httpOnly/expires 소실)** 그리고 cookie-observability plan에서 가설 수준으로만 명시됐던 손실 경로를 코드 레벨에서 확정한 것이다. iOS의 "두 jar(WK + HTTPCookieStorage) 동기화" 패치와 정확히 대칭되는 안드 고유 함정이다.

부수적으로 `authStateHandler`는 `AUTH_STATE_CHANGED: login/refresh` 이벤트 수신 시 `cookieBackupService.backup()`을 호출하지만 `send` 인자를 전달하지 않아 PHASE 2 telemetry에서 **web-driven backup**과 **AppState-driven backup**을 분리할 수 없다. Hypothesis A(torn-state) 진단을 위해서도 이 분리는 필수다.

## 목표

- `restore()`이 token 쿠키를 secure / httpOnly / 영속(persistent) 형태로 재주입하도록 하여 가설 B(session cookie 다운그레이드)와 보안 회귀(httpOnly 소실) 동시 차단
- `authStateHandler`도 backup 시 AUTH_DIAG emit하도록 배선해서 PHASE 2 로그에서 두 backup 경로 분리 관측 가능
- 기존 AsyncStorage 백업 데이터 포맷 변경 0 (backwards-compatible)

## 비-목표

- AppState `background` backup race window debounce (Hypothesis A 직접 fix) — 별도 plan
- Capstone-frontend가 `AUTH_STATE_CHANGED` 페이로드에 cookie attribute 직배달 (가장 정확한 fix이지만 cross-repo 변경) — 별도 plan
- Cookie value 안 `;` / `=` 문자 escaping — token cookie는 JWT 또는 base64url이라 영향 없음, 비-token은 별도 이슈
- `secure: cookie.secure ?? true` 함정 자체의 별도 수정 — 본 변경에서 자연 해소됨
- 네이티브 모듈 fork/patch — 안드 public API 한계라 우회 불가능

## 결정 사항

| 항목 | 선택 | 근거 |
|---|---|---|
| Token 쿠키 식별 패턴 | `/token\|session\|auth/i` | `cookie-diag/emit.ts:21`과 일치, 일관성 |
| Override 적용 attribute | `secure`, `httpOnly`, `expires` | native가 잃어버리는 정확히 이 셋 |
| Forward-dated expires 기간 | 90일 | 서버가 실제 만료를 검증하므로 보수적으로 길게. accessToken/refreshToken 통일 |
| 비-token 쿠키 처리 | `secure === true` / `httpOnly === true`만 보존, 그 외 false | 함정 ① 회피하면서 복원 시 secure=false인 비-token 쿠키 의도 보존 |
| Domain/path 처리 | 기존 default(`.recipio.kr`, `/`) 유지 | 별도 가설(D)이라 이번 plan 범위 밖 |
| Telemetry trigger 메타 | 본 plan 미포함 (별도 후속) | emit 활성화만 1차 |
| Test framework 도입 | 미도입 | 변경 표면이 작고 PHASE 1/2 manual 검증으로 충분 |

## 변경되는 파일

- **수정**: `src/shared/lib/cookie-backup/cookieBackupService.ts` — `restore()`의 `cookieData` 빌드 로직 변경, 헬퍼/상수 추가
- **수정**: `src/features/bridge/model/handlers/authStateHandler.ts` — `handle`이 `context` 받아 `backup({ send })`로 threading

신규 파일 없음. 의존성 추가 없음.

## 변경 1 — `cookieBackupService.restore()` attribute 보정

### 추가되는 상수/헬퍼 (모듈 상단)

```ts
const TOKEN_COOKIE_PATTERN = /token|session|auth/i; // cookie-diag/emit.ts:21과 일치
const TOKEN_RESTORE_EXPIRY_DAYS = 90;

/**
 * Native CookieManagerModule.kt parseDate가 받는 포맷:
 *   yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ (ISO 8601 with timezone)
 * Date.toISOString()은 'Z'로 끝나는데 SimpleDateFormat의 ZZZZZ는 +00:00 형식만 받음.
 */
const buildExpiryString = (daysFromNow: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().replace('Z', '+00:00');
};
```

### `restore()` 본문 변경 (line 158-176 영역)

기존 `for (const [name, cookie] of Object.entries(cookies))` 루프 안 `cookieData` 빌드 부분만 변경:

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
    await CookieManager.set(`https://${BACKUP_DOMAIN}`, cookieData, true);
    await CookieManager.set(`https://${BACKUP_DOMAIN}`, cookieData, false);
  } else {
    await CookieManager.set(`https://${BACKUP_DOMAIN}`, cookieData);
  }
}
```

### 동작 변화

- 안드: `accessToken`/`refreshToken`/`*session*`/`*auth*` 쿠키가 secure + httpOnly + 90일 만료 cookie로 재주입됨. WebView reload 후 process death를 거쳐도 영속.
- iOS: 양쪽 jar 모두 동일하게 적용. iOS는 native가 attribute를 보존하지만 token 쿠키엔 어차피 secure/httpOnly가 정상값이고 expires가 있으므로 결과 동일 (회귀 없음).
- 비-token 쿠키 (locale, GA `_ga` 등): `secure === true`인 경우만 secure 살리고, httpOnly도 동일. 함정 ① (`false ?? true === false`) 자연 해소.

### Backwards compatibility

기존 사용자 기기의 AsyncStorage(`recipio_cookie_backup` 키) 데이터는 attribute 누락 상태로 저장돼 있다. 이 변경 적용 후 첫 cold start의 `restore()`이 누락 attribute를 정확히 강제 보정하므로 backup format 변경 불필요. 기존 데이터 즉시 사용 가능.

## 변경 2 — `authStateHandler` send threading

### 변경 전 (`authStateHandler.ts:14-37`)

```ts
export const authStateHandler: BridgeHandler<AuthStatePayload> = {
  handle: async (message: BridgeMessage<AuthStatePayload>) => {
    const event = message.payload?.event;
    if (!event) { ... return; }
    switch (event) {
      case 'login':
      case 'refresh':
        await cookieBackupService.backup();
        break;
      case 'logout':
        await cookieBackupService.clear();
        break;
      ...
```

### 변경 후

```ts
import type { BridgeHandler, HandlerContext } from './types';

export const authStateHandler: BridgeHandler<AuthStatePayload> = {
  handle: async (message, context) => {
    const event = message.payload?.event;
    if (!event) { ... return; }
    switch (event) {
      case 'login':
      case 'refresh':
        await cookieBackupService.backup({ send: context?.sendToWebView });
        break;
      case 'logout':
        await cookieBackupService.clear();
        break;
      ...
```

### 동작 변화

- `cookie-mutation:backup` AUTH_DIAG 이벤트가 web-driven backup 경로에서도 emit됨.
- `clear()`는 emit 없음 (필요 시 후속 plan에서 추가).
- 다른 핸들러(`pushTokenHandler`, `notificationHandler` 등) 일관성과 동일한 (`message, context?`) 시그니처로 정렬.

### Telemetry trigger 분리는 후속

이번 plan은 **emit 활성화**까지만 한다. backup() 메타에 `trigger: 'web-event' | 'appstate-background'`를 넣으려면 `EmitOpts`에 trigger 필드 추가가 필요한데, 그 변경은 cookie-observability plan §1과 합쳐 별도 후속으로 다룬다. 본 변경 후에도 두 경로의 발화 시각/직전 직후 phase 시퀀스로 충분히 구분 가능.

## Test plan

### PHASE 1 — dev client 검증 (~30분)

전제: `EXPO_PUBLIC_AUTH_DIAGNOSTIC_ENABLED=true`, Capstone-frontend Vercel preview에 `AUTH_DIAGNOSTIC_ENABLED=true`.

1. dev client 부팅 (`npx expo start --clear --dev-client`) → 카카오 로그인 1회
2. `🍪 쿠키삭제` 버튼 → `🔑 복원테스트` 버튼 순차 탭
3. Vercel 로그에서 `cookie-mutation:restore` phase의 `meta.cookies[]` 확인:
   - `accessToken` / `refreshToken` 항목 존재
   - 각 항목의 `secure: true`, `httpOnly: true`, `sessionOnly: false` (즉 `expires`가 90일 후로 채워짐)
4. WebView reload 후 `cookie-snapshot:post-login` 다시 발화. 해당 토큰들이 동일 fp로 보존되는지 확인.
5. WebView 안에서 (개발자 콘솔 또는 `eval`) `document.cookie` 실행 — `accessToken`/`refreshToken`이 **포함되지 않아야** 정상 (httpOnly이므로 JS에서 안 보임).
6. `AUTH_STATE_CHANGED: login` 이벤트 발화 시 `cookie-mutation:backup` Vercel 로그 동시 발화 확인 (변경 2 검증).

### PHASE 2 — preview build 검증 (수일 ~ 1주)

기존 `task.md` PHASE 2 시나리오 그대로 진행. 추가로 다음을 매일 확인:
- `cookie-snapshot:cold-start-after-restore` 메타 cookies[] 안 token 쿠키:
  - `sessionOnly: false`
  - `httpOnly: true`
  - `secure: true`
- 가설 B 분류된 풀림 사건 발생 빈도 감소 추세 관측 (정량 비교는 주간 단위)
- `cookie-mutation:backup` phase 빈도/순서 분포 분석으로 web-driven vs appstate-driven backup 비율 파악 (Hypothesis A 분리 진단 1차 데이터)

### Failure mode

- WebView reload 후 로그인 풀림 → 변경 1의 expires 포맷 mismatch 의심. `CookieManagerModule.kt:230` parseDate 동작 재검증.
- `document.cookie`에 token이 보임 → `httpOnly: true`가 정상 적용 안 됨. native makeHTTPCookieObject (`CookieManagerModule.kt:190`)의 `HTTP_ONLY_SUPPORTED` 게이트 (Android N+) 확인. 운영 디바이스 minSdk 점검.

## 영향도

- 변경 코드 라인 수: ~30 라인 (cookieBackupService.ts) + ~3 라인 (authStateHandler.ts)
- 새 의존성: 0
- 빌드 영향: 0 (런타임 코드만)
- 사용자 마이그레이션: 없음 (기존 AsyncStorage backup 즉시 호환)
- 보안 영향: **개선** — 안드에서 token 쿠키가 더 이상 non-httpOnly로 다운그레이드되지 않음
