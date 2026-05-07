# AdSense WebView 통합 설계

**작성일**: 2026-05-07
**상태**: 합의됨, 구현 계획 작성 대기
**관련 repo**: `recipio-app` (RN, 본 repo) + `Capstone-frontend` (웹, sister repo)

## 배경

`recipio-app`은 `react-native-webview`로 `https://recipio.kr`을 래핑한다. 웹(`Capstone-frontend`)에는 Google AdSense 스크립트가 있으나 webview/in-app 환경을 차단하는 if문 게이트가 있다. 이 게이트를 단순히 제거하면 AdSense가 webview를 unregistered 환경으로 감지해 `googleads.g.doubleclick.net` 등으로 top-level navigation을 일으키고, 앱의 navigation 게이트가 이를 외부 브라우저로 송출해 "흰화면 + 외부 URL 점프" UX 버그가 발생한다.

Google은 이 시나리오의 공식 해법으로 **WebView API for Ads** (`MobileAds.registerWebView()`)를 제공한다. 등록된 webview에서는 AdSense가 환경위반 redirect를 일으키지 않고 정책상 정상 경로가 된다.

## 목표

- recipio-app webview를 Google Mobile Ads SDK에 등록해 AdSense를 정책 위반 없이 노출
- 흰화면 + 외부 URL 점프 버그 제거
- 카톡/FB/Instagram 등 등록 불가능한 in-app 브라우저는 AdSense를 차단해 동일 버그 재발 방지
- 기존 앱 기능(OAuth, 쿠키 백업, 공유 인텐트, 푸시) 동작 영향 0

## 비-목표

- 네이티브 광고 unit (AdMob 배너/전면) — 본 작업 범위 외
- UMP(GDPR/CCPA) 컨센트 폼
- "외부 브라우저로 열기" 배너/모달
- 광고 수익 A/B 테스트, 메트릭 추적

## 결정 사항 (요약)

| 항목 | 선택 | 근거 |
|---|---|---|
| 광고 surface | webview AdSense 등록만, 네이티브 광고 없음 | 사용자 결정 |
| 개인화 | 개인화 ON, iOS ATT 모달, UMP 없음 | 한국 위주 사용자 |
| ATT 타이밍 | WebView 첫 로드 완료 직후 | 첫 화면 광고 없음 → race window 0 |
| 웹 게이트 | in-app 브라우저 UA 블록리스트만, 그 외 통과 | 단순/robust |
| SDK 통합 | `react-native-google-mobile-ads` (커뮤니티 패키지) | 표준, 향후 확장 자유 |
| In-app 브라우저 사용자 유도 | 안 함 (그냥 광고만 차단) | 사용자 결정 |

## 시스템 구조

```
┌─────────────────────────────────────────────────────────────┐
│  recipio-app (RN, Expo 54 managed + dev client)             │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ App.tsx (AppContent)                                 │   │
│  │  ├─ <WebView ref={webViewRef} />                     │   │
│  │  │   ├─ onLoadEnd (1회): bootstrapAdsAfterFirstLoad │   │
│  │  │   └─ onShouldStartLoadWithRequest (변경 없음)    │   │
│  │  └─ navigation gate 그대로                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  shared/lib/ads/  (신규)                                     │
│   • adsBootstrap.ts: init → ATT → register 오케스트레이터   │
│   • attService.ts: requestATT 1회, 캐싱                     │
│   • webviewRegistration.ts: registerWebView 래퍼            │
│                                                              │
│  Native (config plugin이 EAS 빌드 시 자동 주입):             │
│   • AndroidManifest.xml: INTEGRATION_MANAGER=webview         │
│   • Info.plist: GADIntegrationManager=webview                │
│   • Info.plist: NSUserTrackingUsageDescription               │
└─────────────────────────────────────────────────────────────┘
                          │ HTTPS (recipio.kr)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Capstone-frontend (웹)                                      │
│   • AdSense if문: in-app 브라우저 UA 블록리스트만 차단      │
│   • 그 외(Safari/Chrome/RN webview) → 정상 로드             │
└─────────────────────────────────────────────────────────────┘
```

## 책임 경계

- **RN 앱**: SDK 초기화, ATT 모달, WebView ↔ SDK 등록. 광고 자체에는 관여 안 함.
- **웹**: AdSense 스크립트와 슬롯 보유. 환경 감지(in-app browser UA)만 책임.
- **GMA SDK**: 등록 후 AdSense JS 코드 ↔ SDK 사이의 핸들러 자동 관리.

## RN 측 컴포넌트

### 신규 파일

```
src/shared/lib/ads/
├── index.ts                # public API: bootstrapAdsAfterFirstLoad만 export
├── adsBootstrap.ts         # SDK init + ATT + register 오케스트레이터
├── attService.ts           # ATT 1회 요청 + 결과 캐싱
└── webviewRegistration.ts  # registerWebView 래퍼 (재시도/로깅 포함)
```

FSD 룰대로 `shared/lib`에 배치 (비즈니스 로직 없는 인프라).

### 모듈 책임

**`attService.ts`**
- `requestATT(): Promise<ATTStatus>` — `react-native-google-mobile-ads`의 `requestTrackingPermission()`를 1회만 호출
- 결과(authorized/denied/restricted/notDetermined) in-memory ref 캐싱
- iOS only — Android에서는 즉시 `'not-required'` 반환
- 에러는 `'denied'`로 보수적 처리

**`webviewRegistration.ts`**
- `registerWebView(webViewRef): Promise<void>` — `mobileAds().registerWebView(webViewRef.current)` 호출
- ref가 null이면 50ms 후 1회 재시도 (mount race 가드)
- 두 번 실패 시 AUTH_DIAG로 진단 이벤트 전송

**`adsBootstrap.ts`**
- `bootstrapAdsAfterFirstLoad(webViewRef)` — 1회만 트리거 (호출자 측 ref guard로 보장)
- 순서: `MobileAds().initialize()` → `requestATT()` → `registerWebView(webViewRef)`
- `initialize()` 실패 시 1회 재시도 후 포기. 이후 단계도 진행 (NPA로 동작 가능)
- 모든 단계 AUTH_DIAG: `ads-bootstrap-{init|att|register}-{ok|fail}`

**`index.ts`** — public API: `bootstrapAdsAfterFirstLoad`만 export.

### `App.tsx` 변경 — 최소 침습

```ts
import { bootstrapAdsAfterFirstLoad } from '@/shared/lib/ads';

const handleWebViewLoadEnd = async () => {
  if (!isWebViewReadyRef.current) {
    isWebViewReadyRef.current = true;
    // ... 기존 pendingShareUrl 처리 ...
    void bootstrapAdsAfterFirstLoad(webViewRef);  // ← 추가
  }
  // ... 기존 NOTIFICATION_STATUS 전송 ...
};
```

`onShouldStartLoadWithRequest` 등 기존 navigation 게이트는 변경하지 않는다. 등록 후엔 환경위반 redirect가 안 일어나므로 잔여 ad-domain navigation은 광고 클릭뿐이며, 현재 동작(외부 브라우저 송출)이 권장 동작.

### 패키지/플러그인 추가

`package.json`:
```
"react-native-google-mobile-ads": "Expo 54 호환 latest (구현 시 npx expo install로 자동 결정)"
```

> 정확한 버전은 `npx expo install react-native-google-mobile-ads`가 SDK 54 호환 라인을 자동 선정. 14.x 라인이 SDK 54 지원하는 것으로 알려져 있으나, 실제 설치 시점에 확정.

`app.json` plugins 배열:
```json
[
  "react-native-google-mobile-ads",
  {
    "iosAppId": "ca-app-pub-3940256099942544~1458002511",
    "androidAppId": "ca-app-pub-3940256099942544~3347511713",
    "user_tracking_usage_description": "맞춤 광고 노출을 위해 IDFA 사용 동의를 요청합니다.",
    "delay_app_measurement_init": true
  }
]
```

**AdMob 계정·콘솔 등록 불필요**. 이 통합은 AdMob 광고 unit(`BannerAd`/`InterstitialAd` 등)을 일절 사용하지 않고, AdSense를 webview에서 띄우기 위한 SDK 등록 용도로만 GMA SDK를 사용한다.

`INTEGRATION_MANAGER=webview` meta-data가 APPLICATION_ID 검증을 명시적으로 우회시키므로, plugin schema 충족용으로 위 값(Google이 공식 문서에서 제공하는 **테스트 app ID**)을 그대로 사용한다. 실제 광고 노출은 AdSense 측에서 일어나며, 이 ID는 SDK 초기화 시 형식 검증만 통과하면 된다.

> 용어 정리: `react-native-google-mobile-ads`는 **Google Mobile Ads SDK**(=AdMob SDK)의 RN 바인딩. 라이브러리 이름이 그렇다는 것뿐이며, AdMob 광고 unit 사용을 의미하지 않는다. `MobileAds.registerWebView()`는 이 SDK의 메서드라 SDK 자체는 설치 필수.

## 웹(Capstone-frontend) 측 변경

### 게이트 로직 — UA 블록리스트

```ts
const IN_APP_BROWSER_UA_PATTERNS = [
  /KAKAOTALK/i,
  /KAKAOSTORY/i,
  /\bFBAN\/|FBAV\//i,
  /Instagram/i,
  /\bLine\//i,
  /NAVER\(inapp/i,
  /DaumApps/i,
];

const isUnsupportedInAppBrowser = (ua: string): boolean =>
  IN_APP_BROWSER_UA_PATTERNS.some((re) => re.test(ua));

if (typeof window !== 'undefined' && !isUnsupportedInAppBrowser(navigator.userAgent)) {
  // AdSense 스크립트 로드
}
```

RN webview UA는 표준 WebKit Mobile UA(브랜드 토큰 없음)라 자연 통과.

### SSR 게이트

Next.js 환경이면 서버에서 `request.headers['user-agent']`로 동일 함수 호출 → SSR 응답에 AdSense `<script>` 자체를 포함하지 않음. CSR-only 차단보다 깔끔. 양쪽 적용 권장.

### 변경 범위

- 파일 1~2개 (게이트 위치 + 유틸 추출)
- 라인 수: ~20줄

## 데이터 플로우 (콜드 스타트)

```
[t=0ms]    App 프로세스 시작 → SafeAreaProvider → AppContent mount
[t=~150ms] cookiesRestored=true → WebView mount
[t=~600~1500ms] WebView 첫 페이지(홈) 로드 완료
   │
   │ 홈 페이지에는 AdSense 슬롯 없음 → race window 0
   │
[t=onLoadEnd] handleWebViewLoadEnd 첫 호출
   │  └─ bootstrapAdsAfterFirstLoad(webViewRef) 시작
   │      ├─ MobileAds().initialize()    [~100ms]
   │      ├─ requestATT()                 [iOS 모달 대기, Android 즉시]
   │      └─ registerWebView(webViewRef)  [~10ms]
   │
[t=after bootstrap] 사용자가 광고 있는 페이지(레시피 상세 등)로 이동
   └─ register/ATT 모두 완료 → AdSense 정상 personalized 로드
```

### 핵심 가정 — 첫 화면(홈) 광고 없음

홈 페이지에는 AdSense 슬롯이 없으므로, "WebView 첫 로드 ↔ register 완료" 갭 동안 광고 코드가 평가될 일이 없다. 이는 ATT 타이밍 Y 선택의 트레이드오프(첫 화면 NPA)도 무효화한다.

광고가 있는 페이지로 진입하기 전에 register는 항상 완료되어 있다는 invariant이 본 design의 안전성을 보장한다. **이 invariant이 깨지는 순간(예: 향후 홈에 광고 추가) 환경위반 redirect 가능성이 부활한다** — 그 시점에 lazy-init 또는 register 완료 신호 채널 추가가 필요해진다.

### ATT 결과 → AdSense 반영

ATT 결과는 SDK가 webview JS bridge로 자동 전달. 추가 수동 코드 0.

- iOS authorized → IDFA 사용, personalized
- iOS denied/restricted/notDetermined → IDFA = 0, NPA fallback
- Android → AAID 자동 사용

### 워밍 시 (백그라운드 → 포그라운드)

- bootstrap은 1회만 실행 (`isWebViewReadyRef` 가드)
- ATT는 OS-level 영속, 재요청 안 함
- registerWebView 재호출 불필요

## 에러 처리

| # | 실패 모드 | 영향 | 대응 |
|---|---|---|---|
| 1 | `MobileAds().initialize()` 실패 | SDK 미초기화 | 1회 재시도 후 포기, AUTH_DIAG, 앱 동작 영향 0 |
| 2 | `requestATT()` 거부/제한 | personalized 불가 | 정상 흐름 — NPA fallback |
| 3 | `requestATT()` throw | 코드/OS 이슈 | catch → `'denied'` 취급 |
| 4 | `webViewRef.current` null | mount race | 50ms 후 1회 재시도, 그래도 null이면 포기 |
| 5 | `registerWebView()` throw | 알 수 없는 native 예외 | AUTH_DIAG, 포기. AdSense는 unregistered fallback |
| 6 | 등록 실패 후 광고 페이지 진입 | 환경위반 redirect 발생 | 현 게이트가 외부 브라우저 송출 (현 동작 유지) |
| 7 | `Info.plist` ATT 문자열 누락 | 모달 미표시 → 영구 NPA | plugin이 자동 주입 + `__DEV__` 어설션 |

### 핵심 원칙

광고 통합은 절대 앱 메인 플로우를 막지 않는다. 모든 단계는 `try/catch` + `void` fire-and-forget. WebView/쿠키/OAuth/공유 등 기존 기능 영향 0.

### AUTH_DIAG phase 추가

기존 진단 인프라 재사용:

```
ads-bootstrap-init-ok / -fail
ads-bootstrap-att-{authorized|denied|restricted|notDetermined|not-required|fail}
ads-bootstrap-register-ok / -fail
```

## 테스트·검증

### 성공 기준

광고 있는 페이지에서 흰화면 + 외부 URL 점프가 발생하지 않는다.

### 검증 단계

**A) Local dev build**
1. EAS dev build (config plugin 적용된 native 빌드)
2. Android + iOS 실기기
3. AUTH_DIAG 로그로 bootstrap 시퀀스 확인
4. 광고 있는 페이지에서 슬롯 렌더 + redirect 없음 확인

**B) UA 게이트 검증 (웹 측)**
- 카톡 인앱: AdSense `<script>` 미주입 확인
- Safari/Chrome: 정상 로드
- RecipioApp: 정상 로드 + register 시그널

**C) ATT 모달 (iOS)**
- 콜드 스타트 → 홈 렌더 → 모달 1회 노출
- 허용 후 재시작 → 모달 재노출 없음

**D) Google 진단 URL (선택)**
- dev 모드 `?adsdiag=1` 쿼리로 Google 공식 webview 진단 페이지 임시 로드
- 녹색 status bar 확인 (등록 정상 시그널)
- 구현 부담 작으면 포함, 부담되면 skip

### 회귀 체크리스트

광고 통합 직전 1회 풀패스:

- [ ] OAuth 로그인 (kakao/naver/google/apple)
- [ ] 쿠키 백업/복원
- [ ] 공유 인텐트 (youtube import)
- [ ] 푸시 알림 권한
- [ ] WebView reload·뒤로가기·`canGoBack`

## 롤백 전략

문제 발생 시:

1. **앱**: config plugin 비활성화 + bootstrap 호출 1줄 제거 → EAS 빌드 → 즉시 롤백
2. **웹**: UA 블록리스트 → 원래 webview 차단으로 1줄 변경 → 즉시 롤백
3. 두 repo 독립 — 한 쪽만 롤백도 가능

## 알려진 미커버 케이스 (수용)

- iOS 14 미만: ATT API 자체 없음 — `react-native-google-mobile-ads`가 자동 분기
- Android API 21 미만: GMA SDK 요구 미달, Expo 54 minSdk 23 이상이라 무관
- WebView 컴포넌트가 `react-native-webview`가 아닌 다른 것으로 교체될 경우: 명시적 비-목표
- 향후 홈 화면에 AdSense 슬롯 추가될 경우: race window 부활 — lazy-init 또는 register 완료 신호 채널 추가 필요. 본 design은 이 변경을 다루지 않음.
