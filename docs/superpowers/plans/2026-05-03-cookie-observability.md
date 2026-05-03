# Cookie/Auth Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture per-cookie diagnostic data on the RN side (both jars on iOS, with expiration / secure / httpOnly / sessionOnly attributes) so the team can differentiate between four hypothesized root causes for the intermittent iOS+Android login-loss reports.

**Architecture:** Reuse the existing `AUTH_DIAG` bridge channel — RN emits `sendAuthDiag(...)` → web `useAuthDiagBridge` POSTs to `/api/auth/diag` (already shipped in commit `57ce09c`). This plan adds (1) a native cookie snapshot helper that reads both `WKHTTPCookieStore` and `HTTPCookieStorage` on iOS, (2) cookie-mutation logging inside `cookieBackupService.backup/restore`, (3) a foreground periodic snapshot timer, and (4) a fix for the iOS `clearAll` debug button that targets the wrong jar. Fingerprints (SHA-256 prefix, no raw values) for safe logging.

**Tech Stack:** RN 0.81, expo 54, `react-native-webview` 13, `@preeternal/react-native-cookie-manager` 6.3.1 (supports `useWebKit` flag), `expo-crypto` (NEW dep — SHA-256 in Hermes).

**Hypotheses this plan tries to discriminate** (from `token.md`):
- **A. Torn state** — backup() called mid Set-Cookie → snapshot has access but not refresh (or vice versa)
- **B. httpOnly/expires loss** — Android `CookieManager.get()` doesn't return `httpOnly`/`expires` for some cookies → restore() downgrades them to session cookies that die on process exit
- **C. Rotation + stale snapshot** — refresh-token rotation + stale snapshot reinjection → first refresh after restore fails 401
- **D. Domain mismatch** — `restore()` defaults to `.recipio.kr` but server may have set `recipio.kr` (no dot) → cookie not attached
- **E. iOS WKWebView vs HTTPCookieStorage divergence** — debug `clearAll` button targets the wrong jar; could a similar pattern be silently corrupting state in production paths?

**Out of scope** (separate plans/repos):
- `Capstone-frontend` companion changes (web-side `document.cookie` dump, fetch interceptor for 401 inventory, refresh-failure stage attribution). Several tasks below have a `Companion change required` note.
- Migration to `expo-secure-store` + refresh-token-only backup (deferred refactor recommended in `token.md` — different plan)
- Test framework introduction — verification is manual via dev refresh bar + Vercel logs

**Backup service stays — do not propose removal.** `token.md` historically suggested disabling `cookieBackupService` as a cheap alternative. That recommendation is superseded: production telemetry shows the backup is net-positive (login-loss reports were MORE frequent before its introduction in `57ce09c`). The backup catches the "Android app update wipes WebView jar" case; the remaining intermittent losses are a separate cause this plan tries to identify by working *around* the backup, not removing it.

**File map (created/modified):**
- Create: `src/shared/lib/auth-diag/fingerprint.ts`
- Create: `src/shared/lib/cookie-diag/nativeCookieSnapshot.ts`
- Create: `src/shared/lib/cookie-diag/emit.ts`
- Create: `src/shared/lib/cookie-diag/useCookieSnapshotTimer.ts`
- Create: `src/shared/lib/cookie-diag/index.ts`
- Modify: `src/shared/lib/cookie-backup/cookieBackupService.ts` (instrument backup/restore)
- Modify: `App.tsx` (wire snapshot to existing trigger points + periodic timer + iOS clearAll fix)
- Modify: `package.json` (add `expo-crypto`)
- Modify: `task.md` (document new phases)

---

### Task 1: Add `expo-crypto` and fingerprint helper

**Files:**
- Modify: `package.json`
- Create: `src/shared/lib/auth-diag/fingerprint.ts`

- [ ] **Step 1: Install `expo-crypto`**

Run: `npx expo install expo-crypto`
Expected: `package.json` gains `"expo-crypto": "~14.x.x"`. Lockfile updates.

- [ ] **Step 2: Create the fingerprint helper**

Create `src/shared/lib/auth-diag/fingerprint.ts`:

```ts
import * as Crypto from 'expo-crypto';

/**
 * SHA-256 첫 4바이트(8자 hex) — 백엔드/웹 `tokenFingerprint`와 동일 포맷.
 * 빈 문자열은 빈 문자열을 반환 (로그에서 "쿠키 없음"과 구분 가능).
 */
export const tokenFingerprint = async (value: string): Promise<string> => {
  if (!value) return '';
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value
  );
  return digest.slice(0, 8);
};
```

- [ ] **Step 3: Self-check at module load (DEV only)**

Append to `src/shared/lib/auth-diag/fingerprint.ts`:

```ts
if (__DEV__) {
  // SHA-256("test") = 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
  void tokenFingerprint('test').then((fp) => {
    if (fp !== '9f86d081') {
      console.warn('[fingerprint] self-check failed — got', fp);
    }
  });
}
```

- [ ] **Step 4: Verify in Metro**

Run: `npx expo start --clear`
Open the app on a dev client. Expected: no `[fingerprint] self-check failed` warning in Metro. If you see one, fix encoding before continuing.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/shared/lib/auth-diag/fingerprint.ts
git commit -m "feat(auth-diag): add SHA-256 token fingerprint helper"
```

---

### Task 2: Native cookie snapshot reader (both jars on iOS)

**Files:**
- Create: `src/shared/lib/cookie-diag/nativeCookieSnapshot.ts`

- [ ] **Step 1: Define the snapshot type and helper**

Create `src/shared/lib/cookie-diag/nativeCookieSnapshot.ts`:

```ts
import CookieManager from '@preeternal/react-native-cookie-manager';
import { Platform } from 'react-native';
import { tokenFingerprint } from '@/shared/lib/auth-diag/fingerprint';

const TARGET_DOMAIN = 'recipio.kr';
const TARGET_URL = `https://${TARGET_DOMAIN}`;

export type CookieJarSource = 'wkwebview' | 'httpcookiestorage' | 'android-default';

export type CookieDiagEntry = {
  name: string;
  fp: string;            // 8-char SHA-256 prefix of value
  domain?: string;
  path?: string;
  expires?: string;      // ISO if present, undefined => session cookie
  sessionOnly: boolean;  // true if expires missing/empty
  secure?: boolean;
  httpOnly?: boolean;
  sourceJar: CookieJarSource;
};

type RawCookieEntry = {
  value?: string;
  domain?: string;
  path?: string;
  expires?: string;
  secure?: boolean;
  httpOnly?: boolean;
};

const toEntries = async (
  raw: Record<string, RawCookieEntry> | null | undefined,
  source: CookieJarSource
): Promise<CookieDiagEntry[]> => {
  if (!raw) return [];
  const names = Object.keys(raw);
  return Promise.all(
    names.map(async (name) => {
      const c = raw[name] ?? {};
      return {
        name,
        fp: await tokenFingerprint(c.value ?? ''),
        domain: c.domain,
        path: c.path,
        expires: c.expires || undefined,
        sessionOnly: !c.expires,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sourceJar: source,
      };
    })
  );
};

/**
 * iOS는 두 개의 jar(WKWebView vs HTTPCookieStorage)를 모두 캡처.
 * Android는 단일 jar.
 * 실패는 swallow — 진단이 앱 동작을 막으면 안 됨.
 */
export const captureNativeCookieSnapshot = async (): Promise<CookieDiagEntry[]> => {
  try {
    if (Platform.OS === 'ios') {
      const [wk, http] = await Promise.all([
        CookieManager.get(TARGET_URL, true).catch(() => null),
        CookieManager.get(TARGET_URL, false).catch(() => null),
      ]);
      const wkEntries = await toEntries(wk as Record<string, RawCookieEntry> | null, 'wkwebview');
      const httpEntries = await toEntries(http as Record<string, RawCookieEntry> | null, 'httpcookiestorage');
      return [...wkEntries, ...httpEntries];
    }
    const cookies = await CookieManager.get(TARGET_URL).catch(() => null);
    return toEntries(cookies as Record<string, RawCookieEntry> | null, 'android-default');
  } catch (err) {
    console.warn('[cookie-diag] snapshot failed:', err);
    return [];
  }
};
```

- [ ] **Step 2: Quick smoke check in dev refresh bar**

Temporarily add a button to `App.tsx`'s `debugRefreshBar` (you'll remove it after verifying):

```tsx
<TouchableOpacity
  onPress={async () => {
    const snap = await captureNativeCookieSnapshot();
    console.log('[cookie-diag] snapshot:', JSON.stringify(snap, null, 2));
  }}
  style={styles.debugRefreshButton}
>
  <Text style={styles.debugRefreshText}>📸 스냅샷</Text>
</TouchableOpacity>
```

Add the import at top:
```tsx
import { captureNativeCookieSnapshot } from '@/shared/lib/cookie-diag/nativeCookieSnapshot';
```

- [ ] **Step 3: Manual verification on device**

1. Run `npx expo start --clear` and load on dev client (both iOS and Android if possible).
2. Log in to recipio.kr through the app.
3. Tap 📸 스냅샷 and read Metro output.

Expected output (Android, post-login):
```
[cookie-diag] snapshot: [
  { name: "accessToken", fp: "ab12cd34", domain: ".recipio.kr", path: "/", expires: "2026-...", sessionOnly: false, secure: true, httpOnly: true, sourceJar: "android-default" },
  { name: "refreshToken", fp: "...", ... }
]
```

Expected output (iOS, post-login): two source jars present.

If `httpOnly` returns `undefined` for httpOnly cookies, that's the data point that confirms hypothesis B.

- [ ] **Step 4: Revert the temporary button**

Remove the 📸 button and import from `App.tsx`. (You'll add a permanent wiring in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/cookie-diag/nativeCookieSnapshot.ts
git commit -m "feat(cookie-diag): native snapshot reader for iOS dual jars + Android"
```

---

### Task 3: Snapshot emit helper using existing AUTH_DIAG channel

**Files:**
- Create: `src/shared/lib/cookie-diag/emit.ts`
- Create: `src/shared/lib/cookie-diag/index.ts`

- [ ] **Step 1: Create the emit helper**

Create `src/shared/lib/cookie-diag/emit.ts`:

```ts
import { Platform } from 'react-native';
import {
  generateDiagId,
  sendAuthDiag,
  type SendToWebViewFn,
} from '@/shared/lib/auth-diag';
import { captureNativeCookieSnapshot, type CookieDiagEntry } from './nativeCookieSnapshot';

const MAX_COOKIES_IN_PAYLOAD = 20;

type Trigger =
  | 'foreground-resume'
  | 'post-login'
  | 'post-app-callback'
  | 'cold-start-after-restore'
  | 'periodic'
  | 'pre-backup'
  | 'pre-restore';

const isTokenCookie = (name: string): boolean =>
  /token/i.test(name) || /session/i.test(name) || /auth/i.test(name);

/**
 * iOS의 WK/HTTP 두 jar에 같은 이름 쿠키 fp가 다르면 divergence — 별도 phase로 강조.
 */
const computeDivergence = (snap: CookieDiagEntry[]): string[] => {
  if (Platform.OS !== 'ios') return [];
  const byName = new Map<string, CookieDiagEntry[]>();
  for (const e of snap) {
    const list = byName.get(e.name) ?? [];
    list.push(e);
    byName.set(e.name, list);
  }
  const diverged: string[] = [];
  for (const [name, entries] of byName) {
    if (entries.length < 2) continue;
    const fps = new Set(entries.map((e) => e.fp));
    if (fps.size > 1) diverged.push(name);
  }
  return diverged;
};

export const emitCookieSnapshot = async (
  send: SendToWebViewFn,
  params: { trigger: Trigger; diagId?: string }
): Promise<void> => {
  const snapshot = await captureNativeCookieSnapshot();
  const diagId = params.diagId ?? generateDiagId();

  // Compact payload: token-related cookies first, cap total.
  const sorted = [...snapshot].sort((a, b) => {
    const ax = isTokenCookie(a.name) ? 0 : 1;
    const bx = isTokenCookie(b.name) ? 0 : 1;
    return ax - bx;
  });
  const truncated = sorted.length > MAX_COOKIES_IN_PAYLOAD;
  const cookies = sorted.slice(0, MAX_COOKIES_IN_PAYLOAD);

  sendAuthDiag(send, {
    phase: `cookie-snapshot:${params.trigger}`,
    source: 'app-rn-cookie-diag',
    diagId,
    meta: {
      platform: Platform.OS,
      total: snapshot.length,
      truncated,
      cookies,
    },
  });

  const diverged = computeDivergence(snapshot);
  if (diverged.length > 0) {
    sendAuthDiag(send, {
      phase: 'cookie-jar-divergence',
      source: 'app-rn-cookie-diag',
      diagId,
      meta: { divergedNames: diverged },
    });
  }
};
```

- [ ] **Step 2: Public API**

Create `src/shared/lib/cookie-diag/index.ts`:

```ts
export { captureNativeCookieSnapshot, type CookieDiagEntry } from './nativeCookieSnapshot';
export { emitCookieSnapshot } from './emit';
export { useCookieSnapshotTimer } from './useCookieSnapshotTimer';
```

> Note: `useCookieSnapshotTimer` is created in Task 7; the export will fail-import until then. If you want to commit this task in isolation, leave that line commented out and re-add in Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/shared/lib/cookie-diag/emit.ts src/shared/lib/cookie-diag/index.ts
git commit -m "feat(cookie-diag): emit helper using AUTH_DIAG channel + jar divergence detection"
```

---

### Task 4: Wire snapshot to foreground-resume

**Files:**
- Modify: `App.tsx:140-153`

- [ ] **Step 1: Update the AppState `active` effect to also emit a snapshot**

Replace the existing block at `App.tsx:140-153`:

```tsx
// 진단: foreground 복귀 시 WebView 쿠키 상태 스냅샷
useEffect(() => {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
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
    }
  });

  return () => subscription.remove();
}, [sendToWebView]);
```

Add the import at the top of `App.tsx`:
```tsx
import { emitCookieSnapshot } from '@/shared/lib/cookie-diag';
```

- [ ] **Step 2: Manual verification**

1. `npx expo start --clear`, run on dev client.
2. Make sure `EXPO_PUBLIC_AUTH_DIAGNOSTIC_ENABLED=true` is set in `.env`.
3. Log in. Press home → wait 5s → reopen app.
4. Check Metro logs.

Expected: two `[AUTH_DIAG]` lines with the same diagId — one with `phase: "foreground-resume"` and one with `phase: "cookie-snapshot:foreground-resume"`. The second should include the cookie array.

- [ ] **Step 3: Commit**

```bash
git add App.tsx
git commit -m "feat(cookie-diag): emit native cookie snapshot on foreground-resume"
```

---

### Task 5: Wire snapshot to post-login navigation

**Files:**
- Modify: `App.tsx:298-321` (the `onNavigationStateChange` callback)

- [ ] **Step 1: Snapshot on the auth-related nav phases**

Replace the `if (authPhase) { ... }` block inside `onNavigationStateChange` at `App.tsx:313-320`:

```tsx
if (authPhase) {
  const diagId = generateDiagId();
  sendAuthDiag(sendToWebView, {
    phase: authPhase,
    source: 'app-rn-webview-nav',
    diagId,
    meta: { url, loading: navState.loading },
  });
  // Snapshot only AFTER load completes (loading=false) so we read the post-Set-Cookie state
  if (!navState.loading && (authPhase === 'webview-nav-app-callback' || authPhase === 'webview-nav-main')) {
    const trigger = authPhase === 'webview-nav-app-callback' ? 'post-app-callback' : 'post-login';
    void emitCookieSnapshot(sendToWebView, { trigger, diagId });
  }
}
```

- [ ] **Step 2: Manual verification — full OAuth flow**

1. Logged out state, run app.
2. Tap a social login (Kakao recommended — fastest).
3. Complete the OAuth dance.

Expected Metro/Vercel sequence (within ~1s of landing back):
```
[AUTH_DIAG] {"phase":"webview-nav-app-callback","source":"app-rn-webview-nav",...}
[AUTH_DIAG] {"phase":"cookie-snapshot:post-app-callback",...,"meta":{"cookies":[...]}}
[AUTH_DIAG] {"phase":"webview-nav-main","source":"app-rn-webview-nav",...}
[AUTH_DIAG] {"phase":"cookie-snapshot:post-login",...,"meta":{"cookies":[...]}}
```

Verify the post-login snapshot contains entries for `accessToken` / `refreshToken` (or whatever names the backend uses) with `expires` populated and `sessionOnly: false`. If `sessionOnly: true` immediately after login on Android — that's hypothesis B confirmed.

- [ ] **Step 3: Commit**

```bash
git add App.tsx
git commit -m "feat(cookie-diag): snapshot after webview auth nav events"
```

---

### Task 6: Instrument `cookieBackupService.backup()` and `restore()`

**Files:**
- Modify: `src/shared/lib/cookie-backup/cookieBackupService.ts`
- Modify: `App.tsx` (cold-start restore path) and `src/features/bridge/model/handlers/authStateHandler.ts` (backup path) to pass `sendToWebView`

> The service is a stateless object. To emit diagnostics it needs a `sendToWebView` ref. Two options: (a) pass it in per call, (b) module-level setter. Option (a) is cleaner.

- [ ] **Step 1: Refactor `cookieBackupService` to accept an optional emitter**

Replace `src/shared/lib/cookie-backup/cookieBackupService.ts` entirely:

```ts
import CookieManager from '@preeternal/react-native-cookie-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { tokenFingerprint } from '@/shared/lib/auth-diag/fingerprint';
import {
  generateDiagId,
  sendAuthDiag,
  type SendToWebViewFn,
} from '@/shared/lib/auth-diag';

const COOKIE_BACKUP_KEY = 'recipio_cookie_backup';
const BACKUP_DOMAIN = 'recipio.kr';

type CookieEntry = {
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  secure?: boolean;
  httpOnly?: boolean;
};

type EmitOpts = { send?: SendToWebViewFn };

const summarizeCookies = async (
  cookies: Record<string, CookieEntry>
): Promise<Array<{
  name: string; fp: string; domain?: string; path?: string;
  expires?: string; sessionOnly: boolean; secure?: boolean; httpOnly?: boolean;
}>> => {
  const names = Object.keys(cookies);
  return Promise.all(
    names.map(async (name) => {
      const c = cookies[name];
      return {
        name,
        fp: await tokenFingerprint(c.value ?? ''),
        domain: c.domain,
        path: c.path,
        expires: c.expires || undefined,
        sessionOnly: !c.expires,
        secure: c.secure,
        httpOnly: c.httpOnly,
      };
    })
  );
};

export const cookieBackupService = {
  backup: async ({ send }: EmitOpts = {}): Promise<void> => {
    try {
      const cookies = await CookieManager.get(`https://${BACKUP_DOMAIN}`);

      if (!cookies || Object.keys(cookies).length === 0) {
        console.log('[CookieBackup] No cookies to backup');
        if (send) {
          sendAuthDiag(send, {
            phase: 'cookie-mutation:backup',
            source: 'app-rn-cookie-backup',
            diagId: generateDiagId(),
            meta: { result: 'no-cookies' },
          });
        }
        return;
      }

      if (send) {
        const summary = await summarizeCookies(cookies as Record<string, CookieEntry>);
        sendAuthDiag(send, {
          phase: 'cookie-mutation:backup',
          source: 'app-rn-cookie-backup',
          diagId: generateDiagId(),
          meta: { result: 'written', count: summary.length, cookies: summary },
        });
      }

      await AsyncStorage.setItem(COOKIE_BACKUP_KEY, JSON.stringify(cookies));
      console.log('[CookieBackup] Backed up', Object.keys(cookies).length, 'cookies');
    } catch (error) {
      console.warn('[CookieBackup] Backup failed:', error);
      if (send) {
        sendAuthDiag(send, {
          phase: 'cookie-mutation:backup',
          source: 'app-rn-cookie-backup',
          diagId: generateDiagId(),
          meta: { result: 'error', error: String(error) },
        });
      }
    }
  },

  restore: async ({ send }: EmitOpts = {}): Promise<boolean> => {
    try {
      const stored = await AsyncStorage.getItem(COOKIE_BACKUP_KEY);

      if (!stored) {
        console.log('[CookieBackup] No backup found');
        if (send) {
          sendAuthDiag(send, {
            phase: 'cookie-mutation:restore',
            source: 'app-rn-cookie-backup',
            diagId: generateDiagId(),
            meta: { result: 'no-backup' },
          });
        }
        return false;
      }

      const cookies = JSON.parse(stored) as Record<string, CookieEntry>;

      if (send) {
        const summary = await summarizeCookies(cookies);
        sendAuthDiag(send, {
          phase: 'cookie-mutation:restore',
          source: 'app-rn-cookie-backup',
          diagId: generateDiagId(),
          meta: { result: 'restoring', count: summary.length, cookies: summary },
        });
      }

      for (const [name, cookie] of Object.entries(cookies)) {
        await CookieManager.set(`https://${BACKUP_DOMAIN}`, {
          name,
          value: cookie.value,
          domain: cookie.domain || `.${BACKUP_DOMAIN}`,
          path: cookie.path || '/',
          ...(cookie.expires && { expires: cookie.expires }),
          secure: cookie.secure ?? true,
          httpOnly: cookie.httpOnly ?? false,
        });
      }

      console.log('[CookieBackup] Restored', Object.keys(cookies).length, 'cookies');
      return true;
    } catch (error) {
      console.warn('[CookieBackup] Restore failed:', error);
      if (send) {
        sendAuthDiag(send, {
          phase: 'cookie-mutation:restore',
          source: 'app-rn-cookie-backup',
          diagId: generateDiagId(),
          meta: { result: 'error', error: String(error) },
        });
      }
      return false;
    }
  },

  clear: async (): Promise<void> => {
    try {
      await AsyncStorage.removeItem(COOKIE_BACKUP_KEY);
      console.log('[CookieBackup] Backup cleared');
    } catch (error) {
      console.warn('[CookieBackup] Clear failed:', error);
    }
  },
};
```

- [ ] **Step 2: Pass `sendToWebView` from cold-start restore in `App.tsx`**

Replace the cold-start restore effect at `App.tsx:117-124`:

```tsx
// Android: 앱 시작 시 백업된 쿠키 복원 (WebView 로드 전에 실행)
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
```

- [ ] **Step 3: Pass `sendToWebView` from background backup in `App.tsx`**

Replace the AppState backup effect at `App.tsx:127-137`:

```tsx
// Android: 앱이 백그라운드로 갈 때 쿠키 백업
useEffect(() => {
  if (Platform.OS !== 'android') return;

  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') {
      void cookieBackupService.backup({ send: sendToWebView });
    }
  });

  return () => subscription.remove();
}, [sendToWebView]);
```

- [ ] **Step 4: Update `authStateHandler` to pass an emitter**

The handler runs from `messageRouter.route(message, context)` — context already exists for other handlers. Inspect `src/features/bridge/model/handlers/types.ts` to see the `HandlerContext` shape; if `sendToWebView` isn't available there, take the simpler route: pass `undefined` (handler will just not emit). Acceptable since the foreground/post-login snapshot will catch the same state.

For now, leave `authStateHandler` as-is. The cold-start path (Step 2) and AppState path (Step 3) cover the high-value cases. Note this gap in the commit message.

- [ ] **Step 5: Manual verification (Android only)**

1. Run on Android dev client.
2. Log in.
3. Tap 🍪 쿠키삭제 (clears WebView jar). Then tap 🔑 복원테스트.

Expected new logs:
```
[AUTH_DIAG] {"phase":"cookie-mutation:restore","source":"app-rn-cookie-backup","meta":{"result":"restoring","count":N,"cookies":[...]}}
```

Critically: check whether the restored cookies show `httpOnly: true/false/undefined` and `expires: "..."/undefined` — this is the data point that distinguishes hypothesis B (loss-during-restore) from C (rotation).

4. Press home → wait → reopen.

Expected sequence:
```
[AUTH_DIAG] {"phase":"cookie-mutation:backup",...}  // when going background
... (later, on reopen)
[AUTH_DIAG] {"phase":"cookie-mutation:restore","meta":{"result":"no-backup"}}  // restore only runs at cold start, not warm
```

Note: if `restore` doesn't run on warm start, that's existing behavior and not a defect — backup vs restore asymmetry is documented in the existing service comments.

- [ ] **Step 6: Commit**

```bash
git add src/shared/lib/cookie-backup/cookieBackupService.ts App.tsx
git commit -m "feat(cookie-backup): instrument backup/restore with mutation diag events"
```

---

### Task 7: Foreground periodic snapshot timer

**Files:**
- Create: `src/shared/lib/cookie-diag/useCookieSnapshotTimer.ts`
- Modify: `App.tsx` (mount the hook)

- [ ] **Step 1: Build the timer hook**

Create `src/shared/lib/cookie-diag/useCookieSnapshotTimer.ts`:

```ts
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { emitCookieSnapshot } from './emit';
import type { SendToWebViewFn } from '@/shared/lib/auth-diag';

const DEFAULT_INTERVAL_MS = 60_000; // 1 min

const readIntervalMs = (): number => {
  const raw = process.env.EXPO_PUBLIC_COOKIE_DIAG_INTERVAL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
};

/**
 * 포그라운드 동안만 N초 간격으로 쿠키 스냅샷을 emit.
 * 백그라운드면 timer 정지, foreground 복귀 시 재시작.
 * AUTH_DIAG flag가 꺼져 있으면 emitCookieSnapshot 내부의 sendAuthDiag가 no-op이라
 *   별도 분기는 두지 않음 (one less thing to keep in sync).
 */
export const useCookieSnapshotTimer = (send: SendToWebViewFn): void => {
  useEffect(() => {
    const intervalMs = readIntervalMs();
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer != null) return;
      timer = setInterval(() => {
        void emitCookieSnapshot(send, { trigger: 'periodic' });
      }, intervalMs);
    };

    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };

    if (AppState.currentState === 'active') start();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [send]);
};
```

- [ ] **Step 2: Mount in `AppContent`**

In `App.tsx`, import:

```tsx
import { useCookieSnapshotTimer, emitCookieSnapshot } from '@/shared/lib/cookie-diag';
```

(Replace the existing `import { emitCookieSnapshot } from '@/shared/lib/cookie-diag';` from Task 4.)

Then inside `AppContent`, after `useSocialAuth`:

```tsx
useCookieSnapshotTimer(sendToWebView);
```

- [ ] **Step 3: Manual verification**

1. Set `EXPO_PUBLIC_COOKIE_DIAG_INTERVAL_MS=30000` in `.env` for faster verification.
2. Run app, log in, leave foreground.
3. Wait ~95 seconds.

Expected: at least 3 `cookie-snapshot:periodic` events in Metro / Vercel logs.

4. Press home button. Wait 60s. Reopen.

Expected: no periodic events during background. Resumption after `foreground-resume`.

- [ ] **Step 4: Commit**

```bash
git add src/shared/lib/cookie-diag/useCookieSnapshotTimer.ts src/shared/lib/cookie-diag/index.ts App.tsx
git commit -m "feat(cookie-diag): foreground-only periodic snapshot timer"
```

---

### Task 8: Fix iOS `clearAll` to target the right jar

**Files:**
- Modify: `App.tsx:262-267` (the 🍪 쿠키삭제 button) and `App.tsx:271-281` (the 🔑 복원테스트 button)

> Per `token.md`: `CookieManager.clearAll()` without `useWebKit:true` only touches `HTTPCookieStorage`, leaving `WKHTTPCookieStore` (where WKWebView actually reads from) intact. The button looks effective in dev but the underlying primitive is correct — the bug is that the iOS test path is misleading. Make the dev affordance actually clear what the WebView sees.

- [ ] **Step 1: Wrap the clear logic to target both jars on iOS**

Replace the 🍪 쿠키삭제 button's `onPress` in `App.tsx`:

```tsx
onPress={async () => {
  if (Platform.OS === 'ios') {
    // WKWebView store first (this is what the WebView actually reads), then HTTPCookieStorage
    await CookieManager.clearAll(true);
    await CookieManager.clearAll(false);
  } else {
    await CookieManager.clearAll();
  }
  Alert.alert('쿠키 삭제됨', 'WebView 쿠키가 초기화되었습니다.\n새로고침하면 로그인이 풀려야 정상입니다.');
  webViewRef.current?.reload();
}}
```

Apply the same pattern to the 🔑 복원테스트 button's clear step.

- [ ] **Step 2: iOS device verification**

1. Run on iOS dev client.
2. Log in.
3. Tap 🍪 쿠키삭제. Reload.

Expected: WebView lands on the login screen (not the logged-in home). Previous behavior was that the user stayed logged in — confirming the bug from `token.md`.

- [ ] **Step 3: Commit**

```bash
git add App.tsx
git commit -m "fix(debug): iOS clearAll must target WKHTTPCookieStore (useWebKit=true) too"
```

---

### Task 9: Document new phases in `task.md`

**Files:**
- Modify: `task.md`

- [ ] **Step 1: Add a new section to `task.md`**

Append to the end of `task.md`:

```markdown

---

# 쿠키 진단 확장 (2026-05-03)

## 추가된 phase

| phase | source | 발생 시점 | 핵심 meta |
|---|---|---|---|
| `cookie-snapshot:foreground-resume` | `app-rn-cookie-diag` | AppState `active` | `cookies[]` (name/fp/expires/sessionOnly/secure/httpOnly/sourceJar) |
| `cookie-snapshot:post-app-callback` | `app-rn-cookie-diag` | `/api/auth/app-callback` 로드 종료 후 | 동일 |
| `cookie-snapshot:post-login` | `app-rn-cookie-diag` | 메인 URL 도착 후 | 동일 |
| `cookie-snapshot:cold-start-after-restore` | `app-rn-cookie-diag` | Android cold start `restore()` 성공 직후 | 동일 |
| `cookie-snapshot:periodic` | `app-rn-cookie-diag` | foreground 동안 N초 간격 | 동일 |
| `cookie-jar-divergence` | `app-rn-cookie-diag` | iOS에서 WK/HTTP jar 동일 이름 쿠키의 fp가 다를 때 | `divergedNames[]` |
| `cookie-mutation:backup` | `app-rn-cookie-backup` | `cookieBackupService.backup()` 직전 | `cookies[]` 또는 `result: no-cookies/error` |
| `cookie-mutation:restore` | `app-rn-cookie-backup` | `cookieBackupService.restore()` 직전 | `cookies[]` 또는 `result: no-backup/error` |

## 가설별 진단 매핑

- **A. Torn state**: `cookie-mutation:backup` 시점에 token 쿠키 일부만 보이면 적중. 직후 다른 phase에서 짝이 다 들어오면 race window가 짧다는 증거.
- **B. httpOnly/expires 소실**: `cookie-mutation:backup` 또는 cold-start의 `cookie-mutation:restore`에서 `sessionOnly: true` 또는 `httpOnly: undefined`인 토큰 쿠키 발견 시 적중.
- **C. Rotation + stale**: cold-start `cookie-mutation:restore`의 `refreshToken` fp ≠ 직전 세션의 마지막 `cookie-snapshot:periodic`/`foreground-resume`의 fp. 직후 첫 `/api/auth/refresh`가 401이면 confirm.
- **D. Domain 불일치**: snapshot의 `domain` 필드가 서버 발급값과 다른지 확인 (서버 측 Set-Cookie domain은 Capstone-frontend `oauth-backend-setcookie` phase에 추가 필요).
- **E. WK/HTTP divergence**: `cookie-jar-divergence` phase 발생 자체가 evidence.

## Capstone-frontend 측 보완 필요 (별도 plan)

- `document.cookie` 주기 dump (httpOnly 안 보이지만 client-readable cookie state 비교용)
- Fetch interceptor로 401 응답 시점에 `auth-401-detected` phase 발생 + cookie inventory POST
- `tokenRefreshFailed` 이벤트에 stage attribution (network/parse/store) meta 추가
- 서버 Set-Cookie 응답에 expires/maxAge attribute 별도 phase 로깅 (현재 fp만 찍힘)
```

- [ ] **Step 2: Commit**

```bash
git add task.md
git commit -m "docs(auth-diag): document cookie observability phases and hypothesis mapping"
```

---

### Task 10: End-to-end smoke run + Vercel log check

This is a verification task, not new code.

- [ ] **Step 1: Make sure both env flags are on**

`recipio-app/.env`:
```
EXPO_PUBLIC_AUTH_DIAGNOSTIC_ENABLED=true
EXPO_PUBLIC_COOKIE_DIAG_INTERVAL_MS=60000
```

Capstone-frontend Preview env (Vercel dashboard):
```
AUTH_DIAGNOSTIC_ENABLED=true
```

Redeploy preview.

- [ ] **Step 2: Run a full session on Android dev client**

1. Cold start the app.
2. Log in via Kakao.
3. Use the app for ~3 minutes (browse a recipe).
4. Press home, wait 90s, reopen.
5. Tap 🍪 쿠키삭제 → 🔑 복원테스트.
6. Reload, verify login state.

- [ ] **Step 3: Pull the diag log**

```bash
vercel logs <preview-url> --since 10m | grep "\[AUTH_DIAG\]" > /tmp/diag-android-$(date +%s).log
```

Expected the log contains AT LEAST:
- 1× `social-login-start`
- 1× `cookie-snapshot:post-app-callback`
- 1× `cookie-snapshot:post-login` with token cookies present
- 2+× `cookie-snapshot:periodic`
- 1× `cookie-mutation:backup` (when going background)
- 1× `foreground-resume`
- 1× `cookie-snapshot:foreground-resume`
- 1× `cookie-mutation:restore` (manual restore button)

- [ ] **Step 4: Run the same on iOS dev client**

Same steps. Additionally check for:
- Two `sourceJar` values in snapshots (`wkwebview` and `httpcookiestorage`)
- `cookie-jar-divergence` phase if jars disagree

- [ ] **Step 5: File the data**

Save the two log files. They're the dataset that the next investigation cycle reads. Don't analyze yet — let the user drive that interpretation.

- [ ] **Step 6: Commit a sanitized excerpt to the docs folder for reference**

(Optional — only if you want a record in repo.)

```bash
# Skip if you'd rather keep raw logs out of git
```

---

## Self-review notes

- All file paths exact ✓
- Each step has runnable code or runnable command ✓
- No "TBD" / "implement later" ✓
- Helper types referenced across tasks (`SendToWebViewFn`, `CookieDiagEntry`) defined in earlier tasks ✓
- Periodic timer is gated by `AUTH_DIAGNOSTIC_ENABLED` indirectly (since `sendAuthDiag` no-ops when off) — explicit comment in Task 7 covers this ✓
- iOS jar comparison handled in Task 3 (`computeDivergence`) and exercised in Task 4 ✓
- `authStateHandler` instrumentation gap explicitly noted in Task 6 Step 4 (acceptable scope cut, not a hidden TODO) ✓
- Cross-repo Capstone-frontend work explicitly out of scope and documented in Task 9 ✓
