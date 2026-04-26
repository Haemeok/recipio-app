# Network Status Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bug where the offline screen gets stuck after phone unlock (power button → sleep → wake), requiring multiple retry presses to reconnect.

**Architecture:** The root cause is a chain of three issues: (1) `App.tsx` calls `setShowOffline(true)` inside render body as a guard, which re-activates the offline screen on every render while `isOffline` is truthy; (2) `useNetworkStatus` only updates via `NetInfo.addEventListener`, never via `NetInfo.fetch()`, so its cached state stays stale after app resume; (3) there is no `AppState` listener to force a network refresh on foreground. Fix: move all network state ownership into the hook, add a `refresh()` action + AppState-driven auto-refresh, make `OfflineScreen` a dumb presentational component, and let `App.tsx` render directly off `isOffline` (no local mirror).

**Tech Stack:** React Native 0.81, Expo 54, `@react-native-community/netinfo` 11.4, TypeScript 5.9

---

## Design Decision — Please Confirm Before Task 3

**Current behavior:** The offline screen is *sticky* — once it appears, user must press retry to dismiss it, even if the network came back on its own. This is a side-effect of the render-body `setShowOffline(true)` guard plus the separate `showOffline` local state. It does not appear to be intentional UX.

**Proposed behavior (this plan implements this):** The offline screen auto-dismisses whenever the hook observes that the network is back — via any of: a NetInfo change event, a successful `refresh()` call, or the AppState-triggered refresh on foreground. No manual retry needed when the network truly returned.

**If you want to keep sticky behavior**, we keep `showOffline` as a separate state in `App.tsx` and only flip it to `false` when `handleRetry` confirms (via `refresh()`) the network is back. Tell me before executing Task 3 if you want this variant.

---

## Task 1: Extend `useNetworkStatus` with `refresh()` and AppState listener

**Files:**
- Modify: `src/shared/lib/network/useNetworkStatus.ts`

- [ ] **Step 1: Rewrite the hook**

Replace the entire contents of `src/shared/lib/network/useNetworkStatus.ts` with:

```tsx
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";

export const useNetworkStatus = () => {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [isInternetReachable, setIsInternetReachable] = useState<
    boolean | null
  >(true);

  const refresh = useCallback(async () => {
    const state = await NetInfo.fetch();
    setIsConnected(state.isConnected);
    setIsInternetReachable(state.isInternetReachable);
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setIsConnected(state.isConnected);
      setIsInternetReachable(state.isInternetReachable);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
      }
    });

    return () => subscription.remove();
  }, [refresh]);

  return {
    isConnected,
    isInternetReachable,
    isOffline: isConnected === false || isInternetReachable === false,
    refresh,
  };
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/lib/network/useNetworkStatus.ts
git commit -m "feat(network): add refresh() and AppState-driven refresh to useNetworkStatus"
```

---

## Task 2: Make `OfflineScreen` a presentational component

`OfflineScreen` currently owns network logic (`NetInfo.fetch()` inside `handleRetry`). Move that responsibility out so the component only renders and emits `onRetry`.

**Files:**
- Modify: `src/widgets/offline-screen/ui/OfflineScreen.tsx`

- [ ] **Step 1: Replace the component body**

Replace the entire contents of `src/widgets/offline-screen/ui/OfflineScreen.tsx` with:

```tsx
import { StyleSheet, Text, View, TouchableOpacity } from "react-native";

interface OfflineScreenProps {
  onRetry: () => void;
}

export const OfflineScreen = ({ onRetry }: OfflineScreenProps) => {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>📡</Text>
      <Text style={styles.title}>인터넷 연결 없음</Text>
      <Text style={styles.description}>
        네트워크 연결을 확인하고 다시 시도해주세요.
      </Text>
      <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
        <Text style={styles.retryButtonText}>다시 시도</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
    padding: 24,
  },
  icon: {
    fontSize: 64,
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: "#666666",
    textAlign: "center",
    marginBottom: 32,
  },
  retryButton: {
    backgroundColor: "#FF6B35",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
```

Notes:
- The `NetInfo` import is removed — the component no longer touches network state.
- `onRetry` is now required (was optional). The only current consumer always passes it.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/widgets/offline-screen/ui/OfflineScreen.tsx
git commit -m "refactor(offline-screen): make OfflineScreen a presentational component"
```

---

## Task 3: Remove `showOffline` local state and render-body setState in `App.tsx`

**Files:**
- Modify: `App.tsx` (three spots: hook destructure ~L91-92, render-body guard + handleRetry ~L142-149, conditional render ~L205)

Line numbers are hints — match by content since earlier edits may shift lines.

- [ ] **Step 1: Update the hook destructure and remove `showOffline` state**

Find:
```tsx
  const { isOffline } = useNetworkStatus();
  const [showOffline, setShowOffline] = useState(false);
  const [showDebugRefresh, setShowDebugRefresh] = useState(__DEV__);
```

Replace with:
```tsx
  const { isOffline, refresh: refreshNetwork } = useNetworkStatus();
  const [showDebugRefresh, setShowDebugRefresh] = useState(__DEV__);
```

- [ ] **Step 2: Replace the render-body setState guard and `handleRetry`**

Find:
```tsx
  // 네트워크 상태 변경 시 오프라인 화면 표시
  if (isOffline && !showOffline) {
    setShowOffline(true);
  }

  const handleRetry = () => {
    setShowOffline(false);
  };
```

Replace with:
```tsx
  const handleRetry = async () => {
    await refreshNetwork();
  };
```

- [ ] **Step 3: Render directly off `isOffline`**

Find:
```tsx
      {!cookiesRestored ? null : showOffline ? (
        <OfflineScreen onRetry={handleRetry} />
      ) : (
```

Replace with:
```tsx
      {!cookiesRestored ? null : isOffline ? (
        <OfflineScreen onRetry={handleRetry} />
      ) : (
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. In particular, verify no leftover references to `showOffline` or `setShowOffline`.

Run: `grep -n "showOffline" App.tsx || echo "clean"` (expected: `clean`)

- [ ] **Step 5: Commit**

```bash
git add App.tsx
git commit -m "fix(app): drive offline screen directly from isOffline, drop render-body setState"
```

---

## Task 4: Manual verification on device

**Preconditions:** Physical Android device (preferred — doze mode is the original trigger) running the dev client. An iOS device is also fine for the basic offline/online flow but less representative of the bug.

- [ ] **Step 1: Start the app**

Run: `npm run android`
Expected: App boots, WebView appears normally, no offline screen.

- [ ] **Step 2: Basic offline → online flow**

1. Toggle airplane mode ON.
2. Within ~3 seconds: offline screen appears.
3. Toggle airplane mode OFF.
4. Expected: **offline screen auto-dismisses within ~2 seconds** (without pressing retry). This is the new auto-dismiss behavior from the design decision above. If you chose the sticky variant, skip this and verify retry instead.

- [ ] **Step 3: Reproduce the original bug scenario**

1. Start the app, confirm it is online and the WebView has loaded.
2. Press the power button to lock the phone.
3. Wait at least 3 minutes (on Android, long enough for doze to kick in and suspend the radio).
4. Unlock the phone.
5. Expected: **either the offline screen does not appear at all** (because `AppState 'active'` triggers `refresh()` which resolves before any render shows isOffline as true), **or it appears briefly and auto-dismisses within ~2 seconds** once the AppState refresh resolves.
6. If the offline screen lingers: press retry **once**. Expected: screen dismisses immediately if the network is genuinely back.

**Failure modes to watch for:**
- Offline screen still requires multiple retry presses → AppState listener or `refresh()` wiring is wrong. Do not patch; re-enter systematic debugging.
- Offline screen flickers repeatedly → possible NetInfo event churn on foreground. Add instrumentation (`console.log` inside each `setIsConnected` call) to observe the sequence before making any further changes.

- [ ] **Step 4: WebView content sanity**

After returning online, the WebView may still be on its pre-sleep page. Navigate within the app to confirm network requests succeed. This plan does **not** reload the WebView on reconnect — if stale content is a concern, that is a separate follow-up (add `webViewRef.current?.reload()` inside `handleRetry` or on the `isOffline: false` edge).

---

## Out of Scope (explicit YAGNIs)

- **WebView reload on reconnect.** Leaving the WebView untouched; user's tested page state is preserved. Can be added later if reports come in.
- **Test framework setup.** The project has no Jest/vitest config. Adding one for this single fix is scope creep; manual verification covers it.
- **Replacing `@react-native-community/netinfo` with Expo Network.** Netinfo works; migrating is a separate initiative.
- **Debouncing transient offline events.** Not observed as a problem; premature.

---

## Rollback

If Task 3 breaks anything non-obvious, the safest rollback is `git revert` of the three commits in reverse order. Task 1 and Task 2 are backwards-compatible on their own (hook gains a new return field, component's `onRetry` becomes required — the only consumer already passes it).
