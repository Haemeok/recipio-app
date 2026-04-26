# 인증 진단 로깅 — 로컬 테스트 & 할 일

작성일: 2026-04-20

## 1. 적용된 변경 요약

### Capstone-frontend (Next)
- `src/shared/lib/auth/diag.ts` — fingerprint(SHA-256 앞 4바이트 hex), `authDiagLog`, feature flag 게이트
- `src/app/api/auth/refresh/route.ts` — refresh 전 구간 phase 로그
- `src/app/api/auth/callback/{google,kakao,naver,apple}/route.ts` — 백엔드 응답/Set-Cookie/분기/redirect 로그
- `src/app/api/auth/app-callback/route.ts` — 토큰 복호화/append/redirect 로그 (`?diagId=` 쿼리로 앱 플로우와 연결)
- `src/app/api/auth/debug-cookie/route.ts` (신규) — GET, 현재 cookies() fp 로그
- `src/app/api/auth/diag/route.ts` (신규) — POST, 앱이 보낸 phase 이벤트 수신
- `src/shared/lib/bridge/useAuthDiagBridge.ts` (신규) — RN → WebView `AUTH_DIAG` 수신 → diag POST + debug-cookie GET
- `src/shared/lib/auth/useAuthManager.ts` — `tokenRefreshed` 이벤트 후 debug-cookie 호출

### recipio-app
- `src/shared/types/bridge.ts` — `AUTH_DIAG` response type, `AuthDiagPayload`
- `src/shared/lib/auth-diag/index.ts` (신규) — `sendAuthDiag`, `generateDiagId`
- `src/features/social-auth/lib/useSocialAuth.ts` — flow 단위 diagId, `social-login-start` / `deep-link-received` / `app-callback-load` emit
- `App.tsx` — `foreground-resume`, `webview-nav-{app-callback, oauth-callback, main}` emit

## 2. 로컬 테스트 방법

### 2-1. feature flag 켜기

**Capstone-frontend** `.env.local`:
```
AUTH_DIAGNOSTIC_ENABLED=true
```
> 없으면 로그도 안 찍히고, `/api/auth/debug-cookie` · `/api/auth/diag`가 404를 반환한다.

**recipio-app** `.env`:
```
EXPO_PUBLIC_AUTH_DIAGNOSTIC_ENABLED=true
```
> 없으면 `sendAuthDiag`가 no-op. Expo는 `EXPO_PUBLIC_` prefix만 클라이언트 번들에 포함되므로 prefix 필수.

### 2-2. 실행

```bash
# Capstone-frontend
cd C:/Users/user/Desktop/recipio/Capstone-frontend
pnpm dev                      # 또는 npm run dev

# recipio-app (별도 터미널)
cd C:/Users/user/Desktop/recipio-app
npx expo start --clear        # env 캐시 때문에 --clear 필요
```

앱에서 WebView가 가리키는 `WEBVIEW_BASE_URL`을 로컬 Next로 바꾸거나, Vercel preview URL에 똑같이 `AUTH_DIAGNOSTIC_ENABLED`를 걸어 거기로 붙여도 된다.

### 2-3. 시나리오별 트리거

| 시나리오 | 수행 | 기대 로그 source |
|---|---|---|
| 신규 OAuth 로그인 | 앱에서 구글/카카오/네이버/애플 로그인 | `next-oauth-callback-*` → `next-app-callback` → `app-rn-social-auth` |
| refresh 회전 | 기존 세션에서 `accessToken` 만료까지 대기 또는 401 유발 | `next-refresh-route` → `web-token-refreshed` |
| 앱 foreground 복귀 | 홈 버튼 → 다시 앱 열기 | `app-rn-appstate` phase=`foreground-resume` |
| WebView 메인 복귀 | app-callback 후 메인 URL 도착 | `app-rn-webview-nav` phase=`webview-nav-main` |

### 2-4. 로그 보는 위치

- **Next 서버 로그**: Metro가 아니라 Next dev 터미널 (로컬) 또는 Vercel Functions 로그 (배포). `[AUTH_DIAG]` 로 grep.
- **앱 RN 콘솔**: `console.log('[AUTH_DIAG]', ...)`도 추가로 찍히므로 Metro에서 보이긴 함 (dev 전용). 운영 진단은 Next 로그가 정답.

### 2-5. 결과 조회 예시

Vercel CLI로:
```bash
vercel logs <deployment-url> --since 10m | grep "\[AUTH_DIAG\]"
```

한 플로우만 뽑고 싶으면 diagId로:
```bash
vercel logs ... | grep "\[AUTH_DIAG\]" | grep '"diagId":"9622ae55"'
```

## 3. 당신이 해야 할 일

### 필수
- [ ] `AUTH_DIAGNOSTIC_ENABLED` 를 Capstone-frontend의 Vercel env (Preview/Production)에 추가 — 운영에서 재현되는 이슈라 dev에선 못 잡을 가능성이 높음. **Preview/Production 모두 `true`로 잠시 켜고, 원인 찾으면 즉시 끈다.**
- [ ] `EXPO_PUBLIC_AUTH_DIAGNOSTIC_ENABLED` 를 EAS build env (또는 `eas.json` secrets)에 추가하고 앱을 재빌드. 현재 배포된 앱은 env를 받지 못하므로 새 빌드 필수.
- [ ] 신규 디바이스에서 로그인 → 몇 분 방치 → foreground 복귀 → 실제 refresh 실패 재현 시도.
- [ ] 재현된 flow의 diagId를 뽑아 아래 5개 질문을 로그만 보고 답해보기.

### 원인 특정 체크리스트 (완료 기준)
로그에서 다음이 모두 확인되어야 한다:
1. Next `/api/auth/refresh`가 백엔드 호출 직전 본 refreshFp → `source=next-refresh-route phase=refresh-pre-backend`
2. 백엔드가 Set-Cookie로 내린 새 refreshFp → `source=next-refresh-route phase=refresh-backend-setcookie` 의 `backendSetCookieRefreshFp`
3. 그 직후 Next가 다시 본 refreshFp → `source=web-token-refreshed phase=after-token-refresh` 의 `refreshFp`
4. 앱 WebView가 app-callback 이후 보는 refreshFp → `source=webview-post-rn-event phase=webview-nav-main` (또는 `foreground-resume`) 의 `refreshFp`
5. stale token 재사용 시점이 어디인가:
   - (3)에서 이미 옛 fp → Set-Cookie가 Next 응답에 실리지 않음 (append 단계 또는 브라우저 저장 실패)
   - (3)에선 새 fp, 이후 `refresh-cookie-read` 다시 보니 옛 fp → 쿠키가 덮어쓰기 전에 stale 세션이 동시 요청을 날림
   - (4)에서만 옛 fp → WebView cookie jar와 Next가 본 쿠키가 다름 (iOS WKWebView / Android sharedCookies 경로 의심)
   - `foreground-resume` 후에만 옛 fp → 백그라운드 사이 쿠키 롤백 또는 `cookie-backup` restore가 과거 스냅샷으로 덮어씀

### 정리 (원인 특정 후)
- [ ] `AUTH_DIAGNOSTIC_ENABLED` 두 쪽 다 끄기 (운영 상시화 금지).
- [ ] 새 엔드포인트 `/api/auth/debug-cookie`, `/api/auth/diag`는 유지해도 무해 (flag off면 404).
- [ ] 필요 시 로그 필드를 어느 문자열로 grep할지 팀에 공유.

## 4. 공유 규칙 재확인

- raw token / raw Cookie / raw Set-Cookie **절대 로그 금지** (구현은 fingerprint만 남기도록 돼 있음)
- fingerprint = SHA-256(token) 앞 4바이트 hex 8자리, 백엔드와 동일 포맷
- 로그 prefix `[AUTH_DIAG]` 고정
- 모든 로그 라인은 `{phase, source, diagId, accessFp?, refreshFp?, backendSetCookieAccessFp?, backendSetCookieRefreshFp?, status?, meta?, timestamp}` JSON

---

# 네트워크 오프라인 화면 stale state 수정 — 디바이스 검증

작성일: 2026-04-20
플랜: `docs/superpowers/plans/2026-04-20-network-status-refresh.md`

## 적용된 커밋 체인

- `817ff94` feat(network): useNetworkStatus에 refresh() + AppState 리스너 추가
- `e42cd8e` refactor(offline-screen): OfflineScreen presentational 컴포넌트화
- `b71bb95` fix(app): showOffline/render-body setState/handleRetry 제거, refreshNetwork 직결

원래 버그: 화면 잠금 후 몇 분 지나 해제하면 "인터넷 연결 없음" 화면이 뜨고 재시도를 여러 번 눌러야 복구됨. 원인은 (1) App.tsx의 render-body setState 안티패턴이 오프라인 화면을 자력으로 해제 못 하게 잠금, (2) useNetworkStatus가 `addEventListener`로만 갱신돼 foreground 복귀 시 stale, (3) AppState `active` 시 네트워크 재조회 로직 부재 — 세 원인의 조합.

## 네가 해야 할 일 (실기기 수동 검증)

**전제:** 안드로이드 실기기 (에뮬레이터는 doze/라디오 서스펜드가 원본 버그를 잘 재현 못 함). dev client 빌드.

### 시작

```bash
npm run android
```
앱 부팅, WebView 정상 표시 확인.

### 시나리오 1 — 오프라인 자동 해제

1. 비행기 모드 ON → 3초 내 오프라인 화면 표시
2. 비행기 모드 OFF → **재시도 버튼 안 눌러도 2초 내 자동 해제** (새 UX)
3. 자동 해제 안 되면 실패 — 보고 요망

### 시나리오 2 — 원래 버그 재현

1. 앱 켜진 상태, 온라인, WebView 로드 완료 확인
2. 전원 버튼으로 잠금
3. **최소 3분 이상** 대기 (doze 진입 필요)
4. 잠금 해제
5. 기대 동작 (둘 중 하나):
   - (a) 오프라인 화면 **아예 안 뜸** (AppState `active` refresh가 render보다 먼저 완료)
   - (b) 1~2초 잠깐 떴다가 **자동 해제**
6. 위 둘 다 아니고 오프라인 화면이 머무르면 → 재시도 **1회**에 복구되는지 확인 (원래는 여러 번 필요했음)

### 시나리오 3 — WebView 콘텐츠 sanity

복귀 후 WebView 내부를 조작해서 실제 네트워크 요청이 성공하는지. 요청 실패 지속되면 별개 이슈 (이 수정 범위 아님, WebView reload는 의도적으로 미포함).

## 실패 시 대응

- 여러 번 눌러야 되면 → AppState 리스너 또는 `refresh()` 배선 문제. 땜빵 금지, systematic-debugging 재진입.
- 오프라인 화면 깜빡임/플리커 → NetInfo 이벤트 churn 의심. `setIsConnected` 앞뒤로 `console.log` 박고 시퀀스 관찰 후 보고.

## 알려진 범위 제외 사항 (의도적으로 안 고침)

- 복귀 시 WebView auto-reload (별개 후속)
- 테스트 프레임워크 도입 (이 버그 하나로는 과함)
- NetInfo → Expo Network 마이그레이션

---

# 인증 진단 — 실기 테스트 절차 (PHASE 1 & 2)

작성일: 2026-04-24

두 단계로 나눠서 돈다. PHASE 1은 "배선 확인"만 빠르게, PHASE 2는 "프로덕션 재현".

## 공통 사전 준비 (두 단계 모두 필요)

### A. Capstone-frontend Preview 배포 확보

```bash
# 이미 dev 브랜치가 있다면 그대로, 없으면:
git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" status
git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" push origin HEAD
# GitHub에 push하면 Vercel이 자동으로 preview 빌드 → preview URL 생성
# Vercel 대시보드에서 URL 확인 (예: https://capstone-frontend-<hash>-git-<branch>-<team>.vercel.app)
```

### B. Vercel Preview env var 추가

1. Vercel 대시보드 → Capstone-frontend 프로젝트 → Settings → Environment Variables
2. `AUTH_DIAGNOSTIC_ENABLED=true` 추가, scope = **Preview** (Production 체크 해제)
3. 해당 preview deployment를 **redeploy** (env는 빌드 타임 캡처라 기존 배포엔 적용 안 됨)

### C. OAuth provider 콘솔에 preview URL redirect 등록

| Provider | 콘솔 | 등록할 redirect URI 패턴 |
|---|---|---|
| Google | Google Cloud Console > APIs & Services > Credentials | `https://<preview-host>/api/auth/callback/google` |
| Kakao | Kakao Developers > Redirect URI | `https://<preview-host>/api/auth/callback/kakao` |
| Naver | Naver Developers > Callback URL | `https://<preview-host>/api/auth/callback/naver` |
| Apple | Apple Developer > Services ID > Return URLs | `https://<preview-host>/api/auth/callback/apple` |

> Vercel preview URL이 매번 바뀌면 Kakao/Naver는 등록이 까다롭다. 이럴 땐 **고정 alias**를 쓴다 — Vercel > Settings > Domains에 preview branch 전용 custom alias (예: `auth-diag.recipio.kr`) 매핑한 뒤 그 호스트만 provider 콘솔에 등록.

### D. `WEBVIEW_BASE_URL` 오버라이드 (앱 쪽)

현재 `src/shared/config/webview.ts`에 `https://recipio.kr`로 하드코딩돼 있다. 테스트용으로 env 기반 오버라이드를 넣는다:

```ts
// src/shared/config/webview.ts (임시 수정)
const DEFAULT_BASE_URL = 'https://recipio.kr';
export const WEBVIEW_BASE_URL =
  process.env.EXPO_PUBLIC_WEBVIEW_BASE_URL ?? DEFAULT_BASE_URL;
```

> 조사 끝나면 원복. 또는 "default를 유지하면서 env 오버라이드 허용" 패턴이므로 그대로 남겨도 무해.

---

## PHASE 1 — Dev client로 배선 확인 (약 30분)

**목표:** sendAuthDiag → Next `/api/auth/diag` / `/api/auth/debug-cookie` 경로가 실제로 뚫렸는지, 각 phase가 예상 순서로 찍히는지만 확인. 버그 재현은 안 노림.

### 1. Dev client 빌드 (최초 1회만)

```bash
# EAS로 (권장 — 클라우드 빌드)
npx eas build --profile development --platform android
# 또는 iOS
npx eas build --profile development --platform ios
```

빌드 완료 시 EAS가 install URL을 보냄 → 실기에서 QR 스캔으로 설치.

**로컬 빌드 대안 (EAS 크레딧 아끼려면):**
```bash
npx expo prebuild                  # ios/, android/ 폴더 생성 (한 번만)
npx expo run:android               # Android Studio + SDK 필요
npx expo run:ios                   # Xcode 필요 (macOS only)
```

> 이미 dev client가 설치돼 있으면 이 단계 스킵.

### 2. `.env` 파일 생성 (recipio-app 루트)

```
EXPO_PUBLIC_AUTH_DIAGNOSTIC_ENABLED=true
EXPO_PUBLIC_WEBVIEW_BASE_URL=https://<preview-host>
```

### 3. Metro 시작

```bash
npx expo start --clear --dev-client
```

> `--clear`는 env 캐시 무효화용 필수. `--dev-client`는 Expo Go가 아닌 커스텀 dev client를 붙으라는 뜻.

단말기에서 dev client 앱 열기 → Metro URL 연결 → JS 번들 다운 → 자동 진입.

### 4. 로그 터미널 두 개 준비

| 터미널 | 명령 | 용도 |
|---|---|---|
| A | `npx expo start --clear --dev-client` | Metro, RN `console.log('[AUTH_DIAG]')` 실시간 |
| B | `vercel logs <preview-url> --follow` | Next `[AUTH_DIAG]` 실시간. `--follow` 지원 안 되면 `--since 5m`로 주기 실행 |

### 5. 시나리오 A — 신규 OAuth 로그인

1. 앱 시작 → WebView에 preview 호스트 로드 확인
2. 로그아웃 상태에서 "카카오로 로그인" 탭
3. 카카오 로그인 페이지 → 계정 선택
4. 앱 복귀 후 메인 화면 진입

**터미널 A 기대 로그 (순서):**
```
[AUTH_DIAG] {"phase":"social-login-start","source":"app-rn-social-auth","diagId":"...","meta":{"platform":"android"}}
[AUTH_DIAG] {"phase":"deep-link-received","source":"app-rn-social-auth","diagId":"<same>"}
[AUTH_DIAG] {"phase":"app-callback-load","source":"app-rn-social-auth","diagId":"<same>"}
[AUTH_DIAG] {"phase":"webview-nav-app-callback","source":"app-rn-webview-nav",...}
[AUTH_DIAG] {"phase":"webview-nav-main","source":"app-rn-webview-nav",...}
```

**터미널 B 기대 로그 (순서):**
```
[AUTH_DIAG] {"phase":"oauth-callback-start","source":"next-oauth-callback-kakao","diagId":"<next-쪽-id>",...}
[AUTH_DIAG] {"phase":"oauth-backend-response","source":"next-oauth-callback-kakao","status":200,"meta":{"isApp":true}}
[AUTH_DIAG] {"phase":"oauth-backend-setcookie","source":"next-oauth-callback-kakao","backendSetCookieAccessFp":"...","backendSetCookieRefreshFp":"..."}
[AUTH_DIAG] {"phase":"oauth-app-deeplink-redirect","source":"next-oauth-callback-kakao",...}
[AUTH_DIAG] {"phase":"app-callback-start","source":"next-app-callback","diagId":"<앱 쪽과 동일 — ?diagId= 쿼리로 전파>",...}
[AUTH_DIAG] {"phase":"app-callback-token-decoded","source":"next-app-callback","backendSetCookieRefreshFp":"..."}
[AUTH_DIAG] {"phase":"app-callback-pre-redirect","source":"next-app-callback","backendSetCookieRefreshFp":"..."}
[AUTH_DIAG] {"phase":"webview-nav-app-callback","source":"webview-post-rn-event","accessFp":"...","refreshFp":"..."}  ← WebView가 실제로 본 쿠키
```

**체크:**
- [ ] `app-callback`의 `diagId`가 `useSocialAuth`의 `diagIdRef`와 일치 (URL 쿼리로 전파 확인)
- [ ] `webview-post-rn-event`의 `refreshFp`가 `backendSetCookieRefreshFp`와 동일
- 불일치하면 → Set-Cookie가 WebView 쿠키 jar에 못 들어갔다는 증거. 여기서 실제 이슈 포착 가능.

### 6. 시나리오 B — YouTube 공유 딥링크

1. 단말기 YouTube 앱에서 아무 영상 재생
2. **공유** 버튼 → 앱 목록에서 "레시피오" 선택
3. 앱 열리고 WebView가 `/recipes/new/youtube?url=...`로 자동 이동 확인

**터미널 A 기대 로그:**
```
[AUTH_DIAG] {"phase":"foreground-resume","source":"app-rn-appstate","diagId":"<new>","meta":{"platform":"android"}}
```
> YouTube → 공유 → 앱 전환은 `AppState` active 이벤트를 발생시키므로 foreground-resume이 먼저 찍힌다.

**터미널 B 기대 로그:**
```
[AUTH_DIAG] {"phase":"foreground-resume","source":"webview-post-rn-event","accessFp":"...","refreshFp":"..."}
```
> `useAuthDiagBridge`가 RN AUTH_DIAG를 받아 `/api/auth/debug-cookie`를 호출 → 서버가 현재 WebView 쿠키 fp를 찍음.

**체크:**
- [ ] 공유 직후 WebView가 보는 `refreshFp`가 기대한 최신 fp인지
- [ ] YouTube 영상 URL이 `?url=...` 쿼리로 들어갔는지 (WebView 주소 확인)
- [ ] `INTERNAL_DOMAINS` 매칭 여부 — preview URL이 `vercel.app` 또는 `capstone-frontend` 포함 안 하면 `WebBrowser.openBrowserAsync`로 빠짐. 이 경우 App.tsx `INTERNAL_DOMAINS`에 preview host 문자열 한 조각 임시 추가.

### 7. 시나리오 C — Refresh 회전

로그인 상태에서 accessToken 만료까지 기다리거나 강제 401 유발 (WebView 개발자 도구로 `/api/auth/refresh` 직접 호출).

**터미널 B 기대 순서:**
```
[AUTH_DIAG] {"phase":"refresh-start","source":"next-refresh-route","diagId":"<N>"}
[AUTH_DIAG] {"phase":"refresh-cookie-read","source":"next-refresh-route","accessFp":"A1","refreshFp":"R1"}
[AUTH_DIAG] {"phase":"refresh-pre-backend","source":"next-refresh-route","refreshFp":"R1"}
[AUTH_DIAG] {"phase":"refresh-backend-response","source":"next-refresh-route","status":200}
[AUTH_DIAG] {"phase":"refresh-backend-setcookie","source":"next-refresh-route","backendSetCookieRefreshFp":"R2"}  ← 새 refresh fp
[AUTH_DIAG] {"phase":"refresh-response-append","source":"next-refresh-route","backendSetCookieRefreshFp":"R2","meta":{"appendedCount":2}}
[AUTH_DIAG] {"phase":"after-token-refresh","source":"web-token-refreshed","accessFp":"A2","refreshFp":"R2"}  ← refresh 후 Next가 다시 본 fp
```

**체크:**
- [ ] `refresh-pre-backend`의 `refreshFp` (R1) ≠ `refresh-backend-setcookie`의 `backendSetCookieRefreshFp` (R2) → 회전 발생
- [ ] `after-token-refresh`의 `refreshFp`가 R2 → 정상. R1이면 Set-Cookie가 소실됨 (원인 특정 1차 후보).

### 8. 시나리오 D — Foreground 복귀

1. 홈 버튼으로 앱 백그라운드
2. 1분 대기
3. 앱 다시 열기

**터미널 A / B 양쪽에:**
```
[AUTH_DIAG] {"phase":"foreground-resume","source":"app-rn-appstate",...}  ← A
[AUTH_DIAG] {"phase":"foreground-resume","source":"webview-post-rn-event","refreshFp":"..."}  ← B
```

**체크:**
- [ ] B의 `refreshFp`가 백그라운드 전 값과 동일 (쿠키 유실/롤백 없음)

### PHASE 1 완료 기준

4가지 시나리오 모두에서 기대 로그가 A/B 양쪽에 찍히면 배선 OK. 이제 PHASE 2로.

---

## PHASE 2 — Preview build로 프로덕션 재현 (수 시간 ~ 하루)

**목표:** dev 번들 아닌 **Hermes AOT + `__DEV__=false`** 실제 빌드로 간헐 버그 재현.

### 1. EAS preview build

```bash
# Android (APK 내부 배포)
npx eas build --profile preview --platform android

# iOS (ad-hoc 내부 배포)
npx eas build --profile preview --platform ios
```

**EAS env 세팅** (빌드 전):
```bash
npx eas env:create --environment preview --name EXPO_PUBLIC_AUTH_DIAGNOSTIC_ENABLED --value true
npx eas env:create --environment preview --name EXPO_PUBLIC_WEBVIEW_BASE_URL --value "https://<preview-host>"
```

> `EXPO_PUBLIC_*`은 빌드 시점 번들에 박혀 나오므로 preview 환경에 맞게 값 설정 후 빌드.

빌드 완료(10~20분) → EAS가 install link 발행 → 단말기에서 링크 열어 설치.

### 2. 설치 후 확인

- 앱 아이콘 탭 → 정상 부팅
- 하단/상단 debug refresh 바가 **안 보임** (`__DEV__=false`이므로) → 프로덕션 번들 맞는지 확인 포인트
- OAuth 로그인 1회 해서 Phase 1 시나리오 A 재현 → 로그 찍히면 OK

### 3. 장기 관측 시나리오

핵심은 **시간을 들이는 것**. 간헐 버그라 5분 테스트로는 안 나옴.

- 로그인 상태로 30분+ 방치 후 조작
- 30분+ 백그라운드 후 foreground 복귀
- 와이파이 ↔ LTE 전환 후 조작
- 단말기 doze 진입 (안드로이드 화면 잠금 + 움직임 없음 3분+) 후 복귀

**Vercel 로그 수집:**
```bash
# 한 번 떠서 조건 만족 diagId 찾기
vercel logs <preview-url> --since 30m | grep "\[AUTH_DIAG\]" > /tmp/auth-diag-$(date +%s).log

# 의심 diagId가 잡히면 해당 id만 뽑기
grep '"diagId":"9622ae55"' /tmp/auth-diag-*.log
```

### 4. 재현 시 체크리스트 (task.md §3 참조)

간헐 버그 재현 flow에서 5가지 관문을 순서대로 확인:

1. `source=next-refresh-route phase=refresh-pre-backend` 의 `refreshFp` = `X`
2. `phase=refresh-backend-setcookie` 의 `backendSetCookieRefreshFp` = `Y` (`X`와 다름 = 정상 회전)
3. `source=web-token-refreshed phase=after-token-refresh` 의 `refreshFp` = `Y`? 아니면 `X`?
4. 이후 `source=webview-post-rn-event`의 `refreshFp` = `Y`? 아니면 `X`?
5. `X`가 다시 등장하는 위치:

| X 재등장 위치 | 의심 지점 |
|---|---|
| 3에서 즉시 | Next 응답에 Set-Cookie가 실제로 append 안 됐거나 WebView가 거부 (Secure/SameSite) |
| 3은 Y, 이후 refresh-cookie-read에서 X | stale 세션이 동시 요청 → race |
| 4에서만 X | WebView cookie jar와 Next 쿠키 관찰 범위 다름 (iOS WKWebView / Android sharedCookies 경로) |
| `foreground-resume` 후에만 X | 백그라운드 사이 쿠키 롤백 or `cookie-backup` restore가 옛 스냅샷 덮어씀 |

### PHASE 2 완료 기준

- 최소 1회 재현
- 재현된 diagId로 5관문 중 어디서 fp가 틀어지는지 특정
- 결론을 백엔드팀 / 원인 담당 영역에 공유

---

## 정리 (PHASE 1~2 모두 끝나고)

- [ ] Vercel `AUTH_DIAGNOSTIC_ENABLED` Preview/Production 둘 다 끄기
- [ ] EAS `EXPO_PUBLIC_AUTH_DIAGNOSTIC_ENABLED` 제거 후 다음 릴리스 빌드에서 반영
- [ ] `EXPO_PUBLIC_WEBVIEW_BASE_URL` 오버라이드 env 제거
- [ ] `src/shared/config/webview.ts`에 env 오버라이드를 코드로 남겼으면 원복 여부 결정 (남겨도 무해 — default 유지)
- [ ] OAuth provider 콘솔에 임시 등록한 preview URL redirect 제거
- [ ] 새 엔드포인트 `/api/auth/debug-cookie`, `/api/auth/diag`는 flag off면 404이므로 **유지 가능**
