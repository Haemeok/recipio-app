# AdSense WebView Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register recipio-app's WebView with the Google Mobile Ads SDK so AdSense loads policy-compliantly inside the app, eliminate the "white screen + external URL" environment-violation bug, and narrow the web-side gate so unsupported in-app browsers (KakaoTalk/FB/IG/Line) skip AdSense.

**Architecture:** Three new modules in `src/shared/lib/ads/` (ATT service, webview registration, bootstrap orchestrator) wired via a single line in `App.tsx`'s first `onLoadEnd`. Native manifest fields are injected by the `react-native-google-mobile-ads` config plugin. On the web (sister repo `Capstone-frontend`), `isAdsEnabled()` gains a User-Agent blocklist so only known in-app browsers are blocked; SSR and CSR call sites both honor it.

**Tech Stack:** Expo 54 (managed + dev client), React Native 0.81.5, `react-native-webview` 13.15.0, `react-native-google-mobile-ads` (Expo SDK 54 compatible — let `expo install` choose), `expo-tracking-transparency` for iOS ATT, EAS Build for native binaries. Web side uses Next.js.

**Spec reference:** `docs/superpowers/specs/2026-05-07-adsense-webview-integration-design.md`

---

## Testing Approach (Why This Plan Diverges from Strict TDD)

Two repos with different testing realities:

- **Capstone-frontend (web):** Jest is set up (`src/shared/adsense/__tests__/isAdsEnabled.test.ts` already exists). UA gate is pure logic — **TDD applies**.
- **recipio-app (RN):** No Jest configuration in this repo. Adding it just for this feature is scope creep, and most code wraps native SDK calls (`MobileAds().initialize()`, `registerWebView()`, ATT prompt) that require either elaborate mocks or a real device. **Manual device verification + `tsc --noEmit`** is the pragmatic verification path.

Each task below makes the verification approach explicit.

---

## File Structure (All Files Affected)

### `Capstone-frontend` (sister repo at `C:/Users/user/Desktop/recipio/Capstone-frontend`)

| Path | Action | Purpose |
|---|---|---|
| `src/shared/adsense/lib/isUnsupportedInAppBrowser.ts` | **create** | Pure UA blocklist function |
| `src/shared/adsense/__tests__/isUnsupportedInAppBrowser.test.ts` | **create** | Unit tests for UA matcher |
| `src/shared/adsense/lib/isAdsEnabled.ts` | **modify** | Add UA gate (CSR call site) |
| `src/shared/adsense/__tests__/isAdsEnabled.test.ts` | **modify** | Cover new UA gate behavior |
| `src/shared/adsense/AdSenseScript.tsx` | **modify** | Pass UA from `navigator` into `isAdsEnabled` |
| `src/shared/adsense/AdSlot.tsx` | **modify** | Same — pass UA into `isAdsEnabled` |

### `recipio-app` (this repo)

| Path | Action | Purpose |
|---|---|---|
| `package.json` | **modify** | Add `react-native-google-mobile-ads` + `expo-tracking-transparency` |
| `app.json` | **modify** | Add 2 plugin entries |
| `src/shared/lib/ads/types.ts` | **create** | `ATTStatus` type |
| `src/shared/lib/ads/attService.ts` | **create** | iOS-only ATT request, cached, fail-safe |
| `src/shared/lib/ads/webviewRegistration.ts` | **create** | `registerWebView` wrapper with mount-race retry |
| `src/shared/lib/ads/adsBootstrap.ts` | **create** | Orchestrator: init → ATT → register |
| `src/shared/lib/ads/index.ts` | **create** | Public API: `bootstrapAdsAfterFirstLoad` only |
| `App.tsx` | **modify** | One-line call inside first `onLoadEnd` |

---

## PHASE A — Web Side (Capstone-frontend)

> **All commands in this phase run inside `C:/Users/user/Desktop/recipio/Capstone-frontend`.** Use `git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" <subcmd>` for git, or change shell directory to that repo manually if running interactively. Stay on whatever branch the user designated for this work.

### Task A1: Create `isUnsupportedInAppBrowser` with TDD

**Files:**
- Create: `src/shared/adsense/lib/isUnsupportedInAppBrowser.ts`
- Test: `src/shared/adsense/__tests__/isUnsupportedInAppBrowser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/adsense/__tests__/isUnsupportedInAppBrowser.test.ts`:

```ts
import { isUnsupportedInAppBrowser } from "../lib/isUnsupportedInAppBrowser";

describe("isUnsupportedInAppBrowser", () => {
  // 차단되어야 하는 in-app 브라우저
  it.each([
    [
      "KakaoTalk",
      "Mozilla/5.0 (Linux; Android 13; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.0.0 Mobile Safari/537.36;KAKAOTALK 10.4.5",
    ],
    [
      "KakaoStory",
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 KAKAOSTORY 1.2.3",
    ],
    [
      "Facebook",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/450.0.0]",
    ],
    [
      "Instagram",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0.0",
    ],
    [
      "Line",
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Line/13.0.0",
    ],
    [
      "NAVER inapp",
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 NAVER(inapp; search; 1234)",
    ],
    [
      "DaumApps",
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 DaumApps/1.0",
    ],
  ])("차단: %s", (_name, ua) => {
    expect(isUnsupportedInAppBrowser(ua)).toBe(true);
  });

  // 통과시켜야 하는 정상 브라우저
  it.each([
    [
      "Safari iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ],
    [
      "Chrome Android",
      "Mozilla/5.0 (Linux; Android 13; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    ],
    [
      "RN WebView (no brand)",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    ],
    [
      "Desktop Chrome",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
  ])("통과: %s", (_name, ua) => {
    expect(isUnsupportedInAppBrowser(ua)).toBe(false);
  });

  it("빈 문자열은 false (감지 불가 시 차단하지 않음)", () => {
    expect(isUnsupportedInAppBrowser("")).toBe(false);
  });

  it("undefined-처럼 사용하는 호출자 보호: 함수는 string만 받음 (타입으로 강제)", () => {
    // 컴파일 단계에서 막히는 케이스. 런타임 가드는 호출자 책임.
    expect(typeof isUnsupportedInAppBrowser).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/shared/adsense/__tests__/isUnsupportedInAppBrowser.test.ts`
(or `npm test -- src/shared/adsense/__tests__/isUnsupportedInAppBrowser.test.ts` depending on package manager — check `Capstone-frontend/package.json` scripts)

Expected: FAIL with "Cannot find module '../lib/isUnsupportedInAppBrowser'".

- [ ] **Step 3: Write the implementation**

Create `src/shared/adsense/lib/isUnsupportedInAppBrowser.ts`:

```ts
// 등록되지 않은 in-app 브라우저(카톡/FB/IG/Line/네이버 등)에서 AdSense 노출을
// 차단한다. 정책 위반(환경위반 redirect → 흰화면 + 외부 URL 점프) 회피용.
// 우리 RN webview는 GMA SDK에 등록되므로 별도 표식 없이 통과시킨다 — 표준
// WebKit Mobile UA에는 이 패턴들이 들어있지 않아 자연 통과된다.
const IN_APP_BROWSER_UA_PATTERNS: readonly RegExp[] = [
  /KAKAOTALK/i,
  /KAKAOSTORY/i,
  /\bFBAN\/|\bFBAV\//i, // Facebook
  /Instagram/i,
  /\bLine\//i,
  /NAVER\(inapp/i, // 네이버 앱
  /DaumApps/i,
];

export const isUnsupportedInAppBrowser = (userAgent: string): boolean => {
  if (!userAgent) return false;
  return IN_APP_BROWSER_UA_PATTERNS.some((re) => re.test(userAgent));
};
```

- [ ] **Step 4: Run tests — verify pass**

Run: same command as Step 2.
Expected: all 12 cases pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" add src/shared/adsense/lib/isUnsupportedInAppBrowser.ts src/shared/adsense/__tests__/isUnsupportedInAppBrowser.test.ts
git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" commit -m "feat(adsense): add UA blocklist for unsupported in-app browsers"
```

---

### Task A2: Extend `isAdsEnabled` to honor UA gate

**Files:**
- Modify: `src/shared/adsense/lib/isAdsEnabled.ts`
- Modify: `src/shared/adsense/__tests__/isAdsEnabled.test.ts`

**Why we extend rather than wrap:** Two call sites (`AdSenseScript`, `AdSlot`) already use `isAdsEnabled()`. Putting the UA check inside it keeps both gates DRY. The function gains an optional `userAgent` parameter — when omitted, behaves as before (env-only). When provided, also checks UA.

- [ ] **Step 1: Update tests to cover new signature**

Replace `src/shared/adsense/__tests__/isAdsEnabled.test.ts` with:

```ts
describe("isAdsEnabled", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe("env 게이트 (기존 동작)", () => {
    it("퍼블리셔 ID 가 있으면 true", async () => {
      process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID = "ca-pub-3058720331631534";
      const { isAdsEnabled } = await import("../lib/isAdsEnabled");
      expect(isAdsEnabled()).toBe(true);
    });

    it("퍼블리셔 ID 가 undefined 면 false", async () => {
      delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
      const { isAdsEnabled } = await import("../lib/isAdsEnabled");
      expect(isAdsEnabled()).toBe(false);
    });

    it("퍼블리셔 ID 가 빈 문자열이면 false", async () => {
      process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID = "";
      const { isAdsEnabled } = await import("../lib/isAdsEnabled");
      expect(isAdsEnabled()).toBe(false);
    });
  });

  describe("UA 게이트 (신규)", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID = "ca-pub-3058720331631534";
    });

    it("KAKAOTALK UA 가 들어오면 false", async () => {
      const { isAdsEnabled } = await import("../lib/isAdsEnabled");
      expect(
        isAdsEnabled(
          "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36;KAKAOTALK 10.4.5",
        ),
      ).toBe(false);
    });

    it("Safari UA 는 true (env + UA 모두 통과)", async () => {
      const { isAdsEnabled } = await import("../lib/isAdsEnabled");
      expect(
        isAdsEnabled(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
        ),
      ).toBe(true);
    });

    it("UA 미지정(undefined) 시 env 게이트만 — 기존 호출 호환", async () => {
      const { isAdsEnabled } = await import("../lib/isAdsEnabled");
      expect(isAdsEnabled()).toBe(true);
    });

    it("env 가 없으면 UA 통과해도 false", async () => {
      delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
      const { isAdsEnabled } = await import("../lib/isAdsEnabled");
      expect(
        isAdsEnabled(
          "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile Safari/604.1",
        ),
      ).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `pnpm test src/shared/adsense/__tests__/isAdsEnabled.test.ts`
Expected: 4 new UA-gate tests fail (function signature doesn't accept UA yet).

- [ ] **Step 3: Update implementation**

Replace `src/shared/adsense/lib/isAdsEnabled.ts`:

```ts
import { ADSENSE_CLIENT_ID } from "../config";
import { isUnsupportedInAppBrowser } from "./isUnsupportedInAppBrowser";

// userAgent를 받으면 in-app 브라우저 차단 게이트도 함께 적용한다.
// userAgent를 안 받으면 env 게이트만 적용 (기존 호출 호환).
export const isAdsEnabled = (userAgent?: string): boolean => {
  if (!ADSENSE_CLIENT_ID) return false;
  if (userAgent && isUnsupportedInAppBrowser(userAgent)) return false;
  return true;
};
```

- [ ] **Step 4: Run all adsense tests — verify pass**

Run: `pnpm test src/shared/adsense`
Expected: all tests in `isAdsEnabled.test.ts` and `isUnsupportedInAppBrowser.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" add src/shared/adsense/lib/isAdsEnabled.ts src/shared/adsense/__tests__/isAdsEnabled.test.ts
git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" commit -m "feat(adsense): isAdsEnabled honors UA blocklist when UA provided"
```

---

### Task A3: Pass UA from call sites (CSR)

**Files:**
- Modify: `src/shared/adsense/AdSenseScript.tsx`
- Modify: `src/shared/adsense/AdSlot.tsx`

**Why CSR-only first:** SSR-side gating is a separate concern (next task). CSR coverage alone already eliminates the runtime AdSense load in unsupported in-app browsers because `<Script strategy="afterInteractive">` requires CSR to fire.

- [ ] **Step 1: Update `AdSenseScript.tsx`**

Replace the `useEffect` block in `src/shared/adsense/AdSenseScript.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

import { ADSENSE_CLIENT_ID } from "./config";
import { isAdsEnabled } from "./lib/isAdsEnabled";

export const AdSenseScript = () => {
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    if (!isAdsEnabled(navigator.userAgent)) return;
    setShouldLoad(true);
  }, []);

  if (!shouldLoad) return null;

  const src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`;

  return (
    <Script
      id="adsense-loader"
      async
      strategy="afterInteractive"
      src={src}
      crossOrigin="anonymous"
    />
  );
};
```

(Only change: `isAdsEnabled()` → `isAdsEnabled(navigator.userAgent)` on line 13.)

- [ ] **Step 2: Update `AdSlot.tsx`**

In `src/shared/adsense/AdSlot.tsx`, change line 114:

```tsx
// before
if (!isAdsEnabled()) return null;

// after
if (!isAdsEnabled(typeof navigator !== "undefined" ? navigator.userAgent : undefined)) return null;
```

(`typeof navigator` guard handles SSR — during SSR `isAdsEnabled` runs with undefined UA, which falls back to env-only gate; the slot is rendered, but the `<Script>` won't load on unsupported browsers, so empty `<ins>` is harmless.)

- [ ] **Step 3: TypeScript check**

Run: `pnpm typecheck` (or whatever the script is — check `package.json`)
Expected: PASS.

- [ ] **Step 4: Smoke test in dev (optional)**

Run dev server. Open page with ads in regular Chrome — confirm AdSense loads. Then in Chrome DevTools, override UA to `KAKAOTALK 10.4.5` (full string from Task A1 fixtures) → reload → confirm `adsense-loader` script does NOT appear in Network panel.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" add src/shared/adsense/AdSenseScript.tsx src/shared/adsense/AdSlot.tsx
git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" commit -m "feat(adsense): pass UA into isAdsEnabled at CSR call sites"
```

---

### Task A4: SSR-side gating in root layout

**Why:** With CSR-only gating, SSR still emits `<Script>` and `<ins>` markup that's only inert because of the CSR check. Stripping at SSR is more efficient and avoids any chance the script tag enters the DOM in an unsupported browser due to a hydration race.

**Files:**
- Modify: `src/app/layout.tsx` (or wherever `<AdSenseScript />` is rendered — confirm in repo)

- [ ] **Step 1: Locate `<AdSenseScript />` usage**

Run from `Capstone-frontend`:
```bash
grep -rn "AdSenseScript" src/app/
```

Expected: a single `<AdSenseScript />` rendered in `src/app/layout.tsx` or similar root layout.

- [ ] **Step 2: Add SSR UA read + conditional render**

In the layout file containing `<AdSenseScript />`, change to read UA from request headers and conditionally render:

```tsx
import { headers } from "next/headers";
import { AdSenseScript } from "@/shared/adsense/AdSenseScript";
import { isAdsEnabled } from "@/shared/adsense/lib/isAdsEnabled";

// inside the layout component
const ua = (await headers()).get("user-agent") ?? "";
const adsEnabled = isAdsEnabled(ua);

// in JSX
{adsEnabled && <AdSenseScript />}
```

(Adapt to whatever the existing layout shape is — sync vs async server component, RSC syntax.)

- [ ] **Step 3: TypeScript check**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Manual SSR verification**

Build and serve, or run dev:
- Curl with KAKAOTALK UA: `curl -A "Mozilla/5.0 ... KAKAOTALK 10.4.5" http://localhost:3000/` → confirm response HTML does NOT contain `adsense-loader` script tag.
- Curl with Safari UA → confirm response HTML DOES contain it.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" add src/app/layout.tsx
git -C "C:/Users/user/Desktop/recipio/Capstone-frontend" commit -m "feat(adsense): SSR-level UA gate strips script for in-app browsers"
```

---

## PHASE B — RN App (recipio-app)

> **All commands in this phase run inside `C:/Users/user/Desktop/recipio-app` (current cwd).** Stay on whatever branch the user designated.

### Task B1: Install packages

**Files:**
- Modify: `package.json` (via `npx expo install`)

- [ ] **Step 1: Install both packages**

Run:
```bash
npx expo install react-native-google-mobile-ads expo-tracking-transparency
```

Expected: both packages added to `package.json` `dependencies`. Versions chosen by Expo for SDK 54 compatibility.

- [ ] **Step 2: Verify package versions and exports**

Read the README of the installed `react-native-google-mobile-ads` to confirm the API surface used by this plan. Specifically verify these exact symbols exist:

- Default export: `mobileAds` function returning a `MobileAds` singleton
- `MobileAds#initialize(): Promise<...>`
- `MobileAds#registerWebView(webView: any): void`

Run:
```bash
cat node_modules/react-native-google-mobile-ads/lib/typescript/src/MobileAds.d.ts | head -60
```

If the API differs from what this plan assumes (e.g., `registerWebView` signature changed in this version), STOP and report the divergence to the user before continuing — do not proceed with hallucinated API. The plan's later code blocks may need adjustment.

For `expo-tracking-transparency`, verify:
```bash
cat node_modules/expo-tracking-transparency/build/TrackingTransparency.d.ts | head -40
```

Expected exports: `requestTrackingPermissionsAsync`, `getTrackingPermissionsAsync`, return shape `{ status: 'granted' | 'denied' | 'undetermined', canAskAgain: boolean }`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(deps): add react-native-google-mobile-ads + expo-tracking-transparency"
```

(If a `package-lock.json` or `yarn.lock` was modified, include it.)

---

### Task B2: Add config plugins to `app.json`

**Files:**
- Modify: `app.json`

- [ ] **Step 1: Edit `app.json`**

In `app.json`, add two entries to the `expo.plugins` array — `expo-tracking-transparency` and `react-native-google-mobile-ads`:

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
  ],
  [
    "expo-tracking-transparency",
    {
      "userTrackingPermission": "맞춤 광고 노출을 위해 IDFA 사용 동의를 요청합니다."
    }
  ],
  [
    "react-native-google-mobile-ads",
    {
      "iosAppId": "ca-app-pub-3940256099942544~1458002511",
      "androidAppId": "ca-app-pub-3940256099942544~3347511713",
      "delay_app_measurement_init": true
    }
  ]
]
```

> The `iosAppId` / `androidAppId` are Google's official test app IDs. They satisfy the config plugin's schema; the actual webview registration bypasses APPLICATION_ID verification via the integration manager meta-data the plugin will inject.

- [ ] **Step 2: Verify Expo merges plugin native edits**

Run:
```bash
npx expo prebuild --no-install --platform all
```

This generates `android/` and `ios/` directories temporarily so we can inspect what the plugins produce. After running:

```bash
grep -n "INTEGRATION_MANAGER" android/app/src/main/AndroidManifest.xml
grep -n "GADIntegrationManager\|NSUserTrackingUsageDescription" ios/recipio*/Info.plist
```

Expected:
- AndroidManifest.xml contains `<meta-data android:name="com.google.android.gms.ads.INTEGRATION_MANAGER" android:value="webview"/>` (or equivalent).
- Info.plist contains both `GADIntegrationManager` (`webview`) and `NSUserTrackingUsageDescription` (the Korean string).

If either is missing, the plugin config in this task is wrong — STOP and verify with package docs before continuing.

- [ ] **Step 3: Clean prebuild output**

Since this repo is managed Expo and does not commit `ios/`/`android/`, remove them:
```bash
rm -rf android ios
```

- [ ] **Step 4: Commit**

```bash
git add app.json
git commit -m "feat(ads): add admob+ATT config plugins, register integration manager"
```

---

### Task B3: Create `types.ts`

**Files:**
- Create: `src/shared/lib/ads/types.ts`

- [ ] **Step 1: Create file**

```ts
// expo-tracking-transparency status + 'not-required' (non-iOS) + 'fail' (catch).
// 'not-required'는 Android 및 iOS 14 미만에서 ATT API 자체가 의미 없을 때.
export type ATTStatus =
  | "authorized"
  | "denied"
  | "restricted"
  | "notDetermined"
  | "not-required"
  | "fail";
```

> `expo-tracking-transparency`가 노출하는 status는 `'granted' | 'denied' | 'undetermined'`만 있고 native ATT의 4개 상태(authorized/denied/restricted/notDetermined)가 합쳐져 있다. attService에서 매핑한다.

- [ ] **Step 2: Commit**

```bash
git add src/shared/lib/ads/types.ts
git commit -m "feat(ads): add ATTStatus type"
```

---

### Task B4: Create `attService.ts`

**Files:**
- Create: `src/shared/lib/ads/attService.ts`

- [ ] **Step 1: Create file**

```ts
import { Platform } from "react-native";
import {
  requestTrackingPermissionsAsync,
  getTrackingPermissionsAsync,
} from "expo-tracking-transparency";

import type { ATTStatus } from "./types";

let cached: ATTStatus | null = null;

const mapPermissionStatus = (status: string): ATTStatus => {
  switch (status) {
    case "granted":
      return "authorized";
    case "denied":
      return "denied";
    case "undetermined":
      return "notDetermined";
    default:
      return "fail";
  }
};

// iOS에서만 의미가 있다. Android / iOS<14는 즉시 'not-required' 반환.
// 한 번 결과를 받으면 in-memory 캐시 (모듈 라이프타임). 재요청 안 함.
// 에러는 'fail'로 보수적 처리 — 광고 SDK는 NPA로 fallback.
export const requestATT = async (): Promise<ATTStatus> => {
  if (cached) return cached;

  if (Platform.OS !== "ios") {
    cached = "not-required";
    return cached;
  }

  try {
    // 이미 사용자가 결정했다면 prompt 안 띄우고 현재 상태만 반환.
    const current = await getTrackingPermissionsAsync();
    if (current.status !== "undetermined") {
      cached = mapPermissionStatus(current.status);
      return cached;
    }
    const result = await requestTrackingPermissionsAsync();
    cached = mapPermissionStatus(result.status);
    return cached;
  } catch {
    cached = "fail";
    return cached;
  }
};

// 테스트 / dev 옵션용. 프로덕션 코드 경로에선 호출하지 말 것.
export const __resetATTForTest = (): void => {
  cached = null;
};
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors related to this file).

- [ ] **Step 3: Commit**

```bash
git add src/shared/lib/ads/attService.ts
git commit -m "feat(ads): attService — 1회 ATT 요청 + 캐싱, Android/iOS<14는 not-required"
```

---

### Task B5: Create `webviewRegistration.ts`

**Files:**
- Create: `src/shared/lib/ads/webviewRegistration.ts`

- [ ] **Step 1: Create file**

```ts
import type { RefObject } from "react";
import type WebView from "react-native-webview";
import mobileAds from "react-native-google-mobile-ads";

import { sendAuthDiag, generateDiagId } from "@/shared/lib/auth-diag";

// react-native-webview ref → GMA SDK 등록.
// mount race 가드: ref가 null이면 50ms 후 1회 재시도.
// SDK가 throw하면 진단 이벤트 전송 후 swallow — 앱 메인 플로우 영향 0.
export const registerWebView = async (
  webViewRef: RefObject<WebView | null>,
  // 호출자가 sendAuthDiag로 메시지를 web으로 던지려면 sendToWebView가 필요하지만,
  // bootstrap 단계에서는 web과의 진단 채널이 아직 의미 없을 수 있다. 진단은
  // 콘솔 + AUTH_DIAG 둘 다 — sendToWebView optional로 받는다.
  sendToWebView?: (msg: unknown) => void,
): Promise<boolean> => {
  const diagId = generateDiagId();

  const tryOnce = (): boolean => {
    const node = webViewRef.current;
    if (!node) return false;
    try {
      // @ts-expect-error — 라이브러리 타입이 NativeMethods 기반이라 webview 인스턴스를
      // 직접 받지 않을 수 있음. 라이브러리 README가 webView 인스턴스를 그대로 넘기라고
      // 안내. v14+ 기준 MobileAds#registerWebView가 ref 인스턴스를 받음.
      mobileAds().registerWebView(node);
      return true;
    } catch (e) {
      console.warn("[ads] registerWebView threw:", e);
      if (sendToWebView) {
        sendAuthDiag(sendToWebView, {
          phase: "ads-bootstrap-register-fail",
          source: "app-rn-ads-bootstrap",
          diagId,
          meta: { error: String(e) },
        });
      }
      return false;
    }
  };

  if (tryOnce()) {
    if (sendToWebView) {
      sendAuthDiag(sendToWebView, {
        phase: "ads-bootstrap-register-ok",
        source: "app-rn-ads-bootstrap",
        diagId,
        meta: {},
      });
    }
    return true;
  }

  // mount race: 50ms 후 1회 재시도
  await new Promise((r) => setTimeout(r, 50));
  if (tryOnce()) {
    if (sendToWebView) {
      sendAuthDiag(sendToWebView, {
        phase: "ads-bootstrap-register-ok",
        source: "app-rn-ads-bootstrap",
        diagId,
        meta: { retried: true },
      });
    }
    return true;
  }

  console.warn("[ads] registerWebView: ref still null after retry, giving up");
  if (sendToWebView) {
    sendAuthDiag(sendToWebView, {
      phase: "ads-bootstrap-register-fail",
      source: "app-rn-ads-bootstrap",
      diagId,
      meta: { reason: "ref-null-after-retry" },
    });
  }
  return false;
};
```

- [ ] **Step 2: Verify imports resolve**

Check that `@/shared/lib/auth-diag` exports `sendAuthDiag` and `generateDiagId`:

```bash
grep -n "export" src/shared/lib/auth-diag/index.ts
```

If either symbol is missing, fix the import path or add named re-exports as needed (do not duplicate logic).

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS. The `@ts-expect-error` is intentional — if the underlying library tightens its types and the error becomes unnecessary, TypeScript will fail loudly at that point so we can remove the comment.

- [ ] **Step 4: Commit**

```bash
git add src/shared/lib/ads/webviewRegistration.ts
git commit -m "feat(ads): registerWebView wrapper with mount-race retry + AUTH_DIAG"
```

---

### Task B6: Create `adsBootstrap.ts`

**Files:**
- Create: `src/shared/lib/ads/adsBootstrap.ts`

- [ ] **Step 1: Create file**

```ts
import type { RefObject } from "react";
import type WebView from "react-native-webview";
import mobileAds from "react-native-google-mobile-ads";

import { sendAuthDiag, generateDiagId } from "@/shared/lib/auth-diag";

import { requestATT } from "./attService";
import { registerWebView } from "./webviewRegistration";

let bootstrapped = false;

const initialize = async (
  sendToWebView: ((msg: unknown) => void) | undefined,
): Promise<boolean> => {
  const diagId = generateDiagId();
  const attempt = async (label: "first" | "retry"): Promise<boolean> => {
    try {
      await mobileAds().initialize();
      if (sendToWebView) {
        sendAuthDiag(sendToWebView, {
          phase: "ads-bootstrap-init-ok",
          source: "app-rn-ads-bootstrap",
          diagId,
          meta: { attempt: label },
        });
      }
      return true;
    } catch (e) {
      console.warn(`[ads] initialize ${label} threw:`, e);
      if (sendToWebView) {
        sendAuthDiag(sendToWebView, {
          phase: "ads-bootstrap-init-fail",
          source: "app-rn-ads-bootstrap",
          diagId,
          meta: { attempt: label, error: String(e) },
        });
      }
      return false;
    }
  };
  if (await attempt("first")) return true;
  return attempt("retry");
};

// onLoadEnd 첫 호출 시 1회만 실행되어야 한다. 호출자(App.tsx)가 isWebViewReadyRef
// 가드 안에서만 호출하므로 호출 횟수는 호출자 책임. 본 함수도 자체 가드 둠.
export const bootstrapAdsAfterFirstLoad = async (
  webViewRef: RefObject<WebView | null>,
  sendToWebView?: (msg: unknown) => void,
): Promise<void> => {
  if (bootstrapped) return;
  bootstrapped = true;

  const initOk = await initialize(sendToWebView);

  // ATT는 SDK init 결과와 독립적으로 진행한다. init 실패 시에도 ATT는 의미가
  // 있을 수 있다 (다음 콜드 스타트에서 init 성공하면 캐시된 ATT 사용).
  const attResult = await requestATT();
  if (sendToWebView) {
    sendAuthDiag(sendToWebView, {
      phase: `ads-bootstrap-att-${attResult}`,
      source: "app-rn-ads-bootstrap",
      diagId: generateDiagId(),
      meta: {},
    });
  }

  if (!initOk) {
    console.warn("[ads] init failed twice, skipping registerWebView");
    return;
  }

  await registerWebView(webViewRef, sendToWebView);
};

// 테스트 / dev 옵션용.
export const __resetBootstrapForTest = (): void => {
  bootstrapped = false;
};
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/shared/lib/ads/adsBootstrap.ts
git commit -m "feat(ads): bootstrap orchestrator init→ATT→register"
```

---

### Task B7: Create `index.ts` public API

**Files:**
- Create: `src/shared/lib/ads/index.ts`

- [ ] **Step 1: Create file**

```ts
export { bootstrapAdsAfterFirstLoad } from "./adsBootstrap";
export type { ATTStatus } from "./types";
```

> Per FSD: only the public API is exported. `attService`, `webviewRegistration`, internal types stay private to this slice.

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/shared/lib/ads/index.ts
git commit -m "feat(ads): public API surface"
```

---

### Task B8: Wire `App.tsx`

**Files:**
- Modify: `App.tsx` (lines 18, 219-243)

- [ ] **Step 1: Add import**

After line 18 (the existing `import { emitCookieSnapshot, useCookieSnapshotTimer } from '@/shared/lib/cookie-diag';`), add:

```ts
import { bootstrapAdsAfterFirstLoad } from '@/shared/lib/ads';
```

- [ ] **Step 2: Call bootstrap inside `handleWebViewLoadEnd` first-call branch**

Locate `handleWebViewLoadEnd` (currently around line 220). Inside the `if (!isWebViewReadyRef.current)` block, after the `pendingShareUrl` handling, add the bootstrap call:

```ts
const handleWebViewLoadEnd = async () => {
  if (!isWebViewReadyRef.current) {
    isWebViewReadyRef.current = true;
    const pending = pendingShareUrlRef.current;
    if (pending) {
      pendingShareUrlRef.current = null;
      webViewRef.current?.injectJavaScript(
        `window.location.href = ${JSON.stringify(pending)}; true;`
      );
    }
    void bootstrapAdsAfterFirstLoad(webViewRef, sendToWebView);  // ← 신규 라인
  }

  const status = await getNotificationStatus();
  // ... 이하 변경 없음
};
```

> `void` 키워드는 의도된 fire-and-forget. `await`하면 NOTIFICATION_STATUS 전송이 ATT 모달 응답까지 지연되어 UX 저해. ATT는 광고 통합과만 동기, 알림 권한 동기화와는 독립.

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Lint check (if eslint configured)**

Run: `npx eslint App.tsx`
Expected: PASS, or only pre-existing warnings unrelated to the change.

- [ ] **Step 5: Commit**

```bash
git add App.tsx
git commit -m "feat(ads): bootstrap GMA SDK after first WebView load"
```

---

### Task B9: EAS dev build + on-device verification

**Why a step:** This is where we discover whether the config plugin actually injected what we expect, the package versions cohabit, ATT prompt fires, and AdSense actually fills slots. Cannot be bypassed.

- [ ] **Step 1: Trigger EAS dev build for both platforms**

Run:
```bash
eas build --profile development --platform all
```

If `eas.json` has no `development` profile, check existing profiles and pick the dev-client one. Wait for build to finish (~15-30 min).

- [ ] **Step 2: Install on device**

iOS: scan QR / install via TestFlight invite from EAS.
Android: download APK from EAS build URL, install on test device.

- [ ] **Step 3: Verify cold-start sequence (iOS)**

1. Force-quit the app on the device.
2. Launch app cold.
3. Watch home screen render.
4. **Expected**: ATT prompt modal appears within ~1-3 seconds after home screen visible.
5. Tap "Allow" (or "Ask App not to Track" — either is fine for verification).
6. Navigate to a page that has AdSense slots (e.g., recipe detail or AI nutrition page).
7. **Expected**: AdSense slot fills with an ad creative within ~2-5 seconds. NO white screen jump to external Google URL.

If Metro / dev tools are connected, watch console:
- Should see no `[ads] initialize ... threw` or `[ads] registerWebView threw` warnings.
- AUTH_DIAG bridge should emit `ads-bootstrap-init-ok`, `ads-bootstrap-att-<result>`, `ads-bootstrap-register-ok`.

- [ ] **Step 4: Verify cold-start sequence (Android)**

Same as Step 3 but no ATT modal — `requestATT` returns `not-required` immediately. Confirm AdSense fills on a recipe detail page.

- [ ] **Step 5: Regression smoke test (both platforms)**

Walk through:
- [ ] Login (kakao OR naver — pick one most-used)
- [ ] Cookie persistence: kill app, reopen → still logged in
- [ ] YouTube share intent: share a YouTube link from another app to recipio → confirms import flow works
- [ ] Push notification permission flow (if not already granted, test the flow)
- [ ] WebView reload + back navigation in a multi-page session

If any regression appears, STOP and investigate before merging.

- [ ] **Step 6: ATT denial path (iOS only)**

1. iOS Settings → recipio → Privacy → Tracking → toggle OFF.
2. Force-quit app, relaunch.
3. **Expected**: app launches, no crash, AdSense still shows ads (NPA — Google decides server-side).

- [ ] **Step 7: Document verification result**

If all checks pass, write a short verification note in the commit message of the next (final) commit. If anything fails, file the failure as a follow-up issue or address inline before merge.

---

### Task B10 (Optional): Google diagnostic page test

Skip this task if Steps 3-6 in Task B9 all passed cleanly. Include only if there's any doubt the SDK registration fully wired.

**Files:**
- Modify temporarily: `App.tsx` (or test branch only)

- [ ] **Step 1: Add a temporary "diag" navigation**

Override the WebView source URL temporarily to Google's webview integration test page (URL pulled from official docs): `https://googleads.github.io/googleads-mobile-ios-examples/...` (verify exact URL in current docs).

- [ ] **Step 2: Launch app**

Confirm green status indicators per Google's diagnostic page.

- [ ] **Step 3: Revert + don't commit**

This task is throwaway — do NOT commit the temporary URL change. Use a local stash if needed.

---

## Self-Review (post-write)

I read this plan against the spec. Spec coverage spot-check:

- ✅ Web UA blocklist gate → Tasks A1-A4
- ✅ `react-native-google-mobile-ads` install → Task B1
- ✅ Config plugin injection → Task B2
- ✅ `attService.ts` → Task B4
- ✅ `webviewRegistration.ts` → Task B5
- ✅ `adsBootstrap.ts` → Task B6
- ✅ `index.ts` public API → Task B7
- ✅ `App.tsx` wire-up → Task B8
- ✅ EAS dev build + manual verification → Task B9
- ✅ AUTH_DIAG phases (`ads-bootstrap-init-{ok|fail}`, `ads-bootstrap-att-{...}`, `ads-bootstrap-register-{ok|fail}`) → embedded in B5/B6
- ✅ ATT timing (after first WebView load) → B8 wire site
- ✅ Error handling (init retry, register retry, fire-and-forget) → B5/B6/B8
- ✅ Regression check → B9 Step 5

Placeholder scan: clean. No "TBD"/"TODO"/"implement later"/"add appropriate error handling".

Type consistency: `ATTStatus` defined in B3, consumed by B4 (and indirectly by B6's diag-phase string). No type drift between tasks.

Known risks acknowledged in spec:
- API divergence with react-native-google-mobile-ads version → B1 Step 2 forces verification
- `registerWebView` signature uncertainty → `@ts-expect-error` in B5 with explanation
- Config plugin field names (`iosAppId` vs `ios_app_id` etc.) → B2 Step 2 verifies output
