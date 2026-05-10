# Admin Video Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only page that pipelines (1) GPT Image 1 generation (configurable quality / count / optional reference image / editable prompt) → (2) image selection → (3) BytePlus Seedance 2.0 image-to-video generation (editable video prompt + model/resolution/ratio/duration/audio).

**Architecture:** New admin route at `src/app/admin/video-studio/`, modeled on the existing `image-quality-test` page. Three new API routes (image gen, video submit, video status). Adapter pattern wraps the BytePlus Seedance HTTP API. Polling is client-side (~5s interval) — server functions stay short-lived. No persistent storage in MVP — outputs are shown in-page; user can right-click save / use the `<a download>` link on the final video.

**Tech Stack:**
- Next.js 15 App Router (existing project)
- OpenAI gpt-image-1 (`/v1/images/generations` and `/v1/images/edits`)
- BytePlus ModelArk Seedance 2.0 (`https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks`)
- Tailwind, shadcn primitives (existing)
- Existing `assertAdminApi()` / `requireAdminPage()` guard from `@/shared/lib/admin-guard`

---

## Required API Keys

1. **`OPENAI_API_KEY`** — already configured in production. Add to `.env.local` for dev if missing.
2. **`ARK_API_KEY`** — NEW. BytePlus ModelArk API key.
   - Sign up at https://console.byteplus.com (international console — *not* the China-region Volcengine one).
   - Complete real-name verification under ModelArk.
   - In ModelArk console → Endpoint → API Key Management → generate.
   - Add to `.env.local` and to Vercel project env (Production + Preview).
   - Beta limits: ~20 free Fast-tier calls / month / account, QPS=2, 3 concurrent tasks.

---

## Cost / Quota Notes (read before running)

- A single image-stage call generates up to **N images at once** (`n` 1..4). gpt-image-1 quality `high` is meaningfully more expensive than `low`. Default the count to 2 and quality to `medium`.
- A single video-stage call burns **one Seedance task**. During public beta the Fast tier free quota is small (~20/month/account). Default the model to `dreamina-seedance-2-0-fast-260128` and duration to 5s.
- These defaults are deliberate; do not change without asking the user.

---

## Spec Notes / Watch Items

- **Model ID strings can drift.** As of 2026-05-09 the official BytePlus IDs are `dreamina-seedance-2-0-260128` and `dreamina-seedance-2-0-fast-260128`. Earlier third-party blogs use `seedance-2.0` / `seedance-2.0-fast` / `seedance-2.0-pro` — those are likely aliases or older. If a 400 comes back with "model not found", try the bare-string variants from the official docs page (`docs.byteplus.com/en/docs/ModelArk/1520757`).
- **OpenAI model name is `gpt-image-1`**, not `gpt-image-2`. Keep the user's wording in UI labels but call the right model.
- **Seedance image input:** the API accepts a `image_url.url` field that takes either a public HTTPS URL or a base64 data URL. We pass the data URL directly from OpenAI (≈1.5–2 MB at 1024×1024). If we ever hit request-size limits, swap in Vercel Blob — out of scope for this plan.
- **Seedance status values:** `queued | running | succeeded | failed | expired | cancelled`. Final video URL lives at `content.video_url` of the GET response.
- **Polling cadence:** 5s interval, 10-minute hard timeout. Per BytePlus docs, the platform uses HTTP 429 for rate-limit; we do NOT retry on 429 in MVP — surface the error so the user backs off.

---

## File Map (everything this plan touches)

**New files**
- `src/app/admin/video-studio/page.tsx`
- `src/app/admin/video-studio/lib/types.ts`
- `src/app/admin/video-studio/lib/buildVideoPrompt.ts`
- `src/app/admin/video-studio/lib/useImageGeneration.ts`
- `src/app/admin/video-studio/lib/useVideoGeneration.ts`
- `src/app/admin/video-studio/lib/adapters/seedanceAdapter.ts`
- `src/app/admin/video-studio/components/ImageGenerationPanel.tsx`
- `src/app/admin/video-studio/components/ImageGrid.tsx`
- `src/app/admin/video-studio/components/VideoGenerationPanel.tsx`
- `src/app/admin/video-studio/components/VideoResultCard.tsx`
- `src/app/api/admin/video-studio/image/route.ts`
- `src/app/api/admin/video-studio/video/submit/route.ts`
- `src/app/api/admin/video-studio/video/status/[taskId]/route.ts`

**Modified files**
- `src/app/admin/image-quality-test/lib/adapters/openaiAdapter.ts` (add multi-image variants — keep existing exports untouched so `image-quality-test` keeps working)
- `.env.example` (document `ARK_API_KEY`)
- `src/app/admin/layout.tsx` (add nav link if a nav exists; otherwise skip — see Task 13)

**Reused without modification**
- `src/app/admin/image-quality-test/components/RecipeSearchPanel.tsx`
- `src/app/admin/image-quality-test/lib/buildPrompt.ts`
- `@/shared/lib/admin-guard` (`assertAdminApi`)
- `@/entities/recipe/model/api` (`getRecipe`)
- `@/entities/recipe/model/types` (`DetailedRecipeGridItem`)

---

## Task 1: Document the new env var

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append `ARK_API_KEY` line**

Add this line to `.env.example` (create the file if it does not exist):

```
# BytePlus ModelArk (Seedance 2.0 video generation) — admin video-studio only
ARK_API_KEY=
```

- [ ] **Step 2: Sanity-check user has set the value locally**

User runs (one-shot, do NOT commit `.env.local`):

```bash
node -e "require('dotenv').config({path:'.env.local'}); console.log('ARK_API_KEY set:', !!process.env.ARK_API_KEY)"
```

Expected: `ARK_API_KEY set: true`

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore(admin): document ARK_API_KEY env var for video-studio"
```

---

## Task 2: Seedance shared types

**Files:**
- Create: `src/app/admin/video-studio/lib/types.ts`

- [ ] **Step 1: Write the file**

```ts
// src/app/admin/video-studio/lib/types.ts

export type SeedanceModelId =
  | "dreamina-seedance-2-0-260128"
  | "dreamina-seedance-2-0-fast-260128";

export type SeedanceResolution = "480p" | "720p" | "1080p";
export type SeedanceRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

export type SeedanceSubmitInput = {
  model: SeedanceModelId;
  prompt: string;
  imageDataUrlOrUrl: string; // base64 data URL or public https URL
  resolution: SeedanceResolution;
  ratio: SeedanceRatio;
  durationSec: number; // 4..15
  generateAudio: boolean;
};

export type SeedanceTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled";

export type SeedanceTaskState = {
  taskId: string;
  status: SeedanceTaskStatus;
  videoUrl?: string;
  errorMessage?: string;
};
```

- [ ] **Step 2: typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/video-studio/lib/types.ts
git commit -m "feat(admin): add seedance type definitions"
```

---

## Task 3: Seedance adapter (submit + poll)

**Files:**
- Create: `src/app/admin/video-studio/lib/adapters/seedanceAdapter.ts`

- [ ] **Step 1: Write the adapter**

```ts
// src/app/admin/video-studio/lib/adapters/seedanceAdapter.ts
import "server-only";

import type {
  SeedanceSubmitInput,
  SeedanceTaskState,
  SeedanceTaskStatus,
} from "../types";

const ARK_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";

export const submitSeedanceTask = async (
  input: SeedanceSubmitInput,
  signal?: AbortSignal
): Promise<{ taskId: string }> => {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error("ARK_API_KEY is not set");

  const body = {
    model: input.model,
    content: [
      { type: "text", text: input.prompt },
      {
        type: "image_url",
        image_url: { url: input.imageDataUrlOrUrl },
        role: "first_frame",
      },
    ],
    ratio: input.ratio,
    resolution: input.resolution,
    duration: input.durationSec,
    generate_audio: input.generateAudio,
  };

  const res = await fetch(`${ARK_BASE}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Seedance submit ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("Seedance submit response missing id");
  return { taskId: data.id };
};

export const fetchSeedanceTask = async (
  taskId: string,
  signal?: AbortSignal
): Promise<SeedanceTaskState> => {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error("ARK_API_KEY is not set");

  const res = await fetch(
    `${ARK_BASE}/contents/generations/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Seedance fetch ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    id: string;
    status: SeedanceTaskStatus;
    content?: { video_url?: string };
    error?: { message?: string };
  };

  return {
    taskId: data.id,
    status: data.status,
    videoUrl: data.content?.video_url,
    errorMessage: data.error?.message,
  };
};
```

- [ ] **Step 2: typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/video-studio/lib/adapters/seedanceAdapter.ts
git commit -m "feat(admin): add seedance 2.0 submit/poll adapter"
```

---

## Task 4: Extend OpenAI adapter for `n > 1`

**Files:**
- Modify: `src/app/admin/image-quality-test/lib/adapters/openaiAdapter.ts:6` (extend the `ExtraParams` type) and append two new exported functions at the end of the file.

The existing `generateViaOpenAI` / `editViaOpenAI` (single-result) **must stay untouched** — `image-quality-test` still depends on them. Add new multi-result variants alongside.

- [ ] **Step 1: Update `ExtraParams`**

Replace line 6 of `openaiAdapter.ts`:

```ts
type ExtraParams = { quality?: "low" | "medium" | "high" | "auto" };
```

with:

```ts
type ExtraParams = { quality?: "low" | "medium" | "high" | "auto"; n?: number };
```

- [ ] **Step 2: Append new multi-image generation function**

Append below `editViaOpenAI` (after the existing `dataUrlToBlob` helper at line 91+):

```ts
type MultiResult = { imageDataUrls: string[] };

export const generateMultiViaOpenAI = async (
  model: string,
  prompt: string,
  extra: ExtraParams = {},
  signal?: AbortSignal
): Promise<MultiResult> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const n = extra.n ?? 1;

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      n,
      size: "1024x1024",
      ...(extra.quality ? { quality: extra.quality } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const items = data.data ?? [];
  if (items.length === 0) throw new Error("OpenAI returned empty data array");
  return {
    imageDataUrls: items.map((it) => {
      if (it.b64_json) return `data:image/png;base64,${it.b64_json}`;
      if (it.url) return it.url;
      throw new Error("OpenAI returned neither b64_json nor url");
    }),
  };
};

export const editMultiViaOpenAI = async (
  model: string,
  prompt: string,
  referenceDataUrl: string,
  extra: ExtraParams = {},
  signal?: AbortSignal
): Promise<MultiResult> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const n = extra.n ?? 1;

  const referenceBlob = await dataUrlToBlob(referenceDataUrl);
  const formData = new FormData();
  formData.append("model", model);
  formData.append("prompt", prompt);
  formData.append("image", referenceBlob, "reference.png");
  formData.append("size", "1024x1024");
  formData.append("n", String(n));
  if (extra.quality) formData.append("quality", extra.quality);

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI edit ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const items = data.data ?? [];
  if (items.length === 0) throw new Error("OpenAI edit returned empty data array");
  return {
    imageDataUrls: items.map((it) => {
      if (it.b64_json) return `data:image/png;base64,${it.b64_json}`;
      if (it.url) return it.url;
      throw new Error("OpenAI edit returned neither b64_json nor url");
    }),
  };
};
```

- [ ] **Step 3: typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS. The single-result functions still exist and `image-quality-test` route still typechecks.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/image-quality-test/lib/adapters/openaiAdapter.ts
git commit -m "feat(admin): add multi-image variants to openai image adapter"
```

---

## Task 5: Image generation API route

**Files:**
- Create: `src/app/api/admin/video-studio/image/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/admin/video-studio/image/route.ts
import { NextRequest, NextResponse } from "next/server";

import {
  editMultiViaOpenAI,
  generateMultiViaOpenAI,
} from "@/app/admin/image-quality-test/lib/adapters/openaiAdapter";
import { assertAdminApi } from "@/shared/lib/admin-guard";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  prompt: string;
  quality: "low" | "medium" | "high";
  n: number;
  referenceImageUrl?: string;
};

export async function POST(req: NextRequest) {
  const guardResponse = await assertAdminApi();
  if (guardResponse) return guardResponse;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.prompt || !body.quality || !body.n) {
    return NextResponse.json(
      { error: "prompt, quality, n are required" },
      { status: 400 }
    );
  }
  if (body.n < 1 || body.n > 4) {
    return NextResponse.json({ error: "n must be 1..4" }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const result = body.referenceImageUrl
      ? await editMultiViaOpenAI(
          "gpt-image-1",
          body.prompt,
          body.referenceImageUrl,
          { quality: body.quality, n: body.n },
          req.signal
        )
      : await generateMultiViaOpenAI(
          "gpt-image-1",
          body.prompt,
          { quality: body.quality, n: body.n },
          req.signal
        );

    return NextResponse.json({
      images: result.imageDataUrls,
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, latencyMs: Date.now() - startedAt },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Smoke test (manual, after admin login)**

User starts dev server, signs into admin in the browser, then runs in DevTools console:

```js
fetch("/api/admin/video-studio/image", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "a single ripe tomato on a wood table", quality: "low", n: 1 }),
}).then(r => r.json()).then(console.log)
```

Expected: `{ images: ["data:image/png;base64,..."], latencyMs: <ms> }`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/video-studio/image/route.ts
git commit -m "feat(admin): add video-studio image generation route"
```

---

## Task 6: Seedance submit route

**Files:**
- Create: `src/app/api/admin/video-studio/video/submit/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/admin/video-studio/video/submit/route.ts
import { NextRequest, NextResponse } from "next/server";

import { submitSeedanceTask } from "@/app/admin/video-studio/lib/adapters/seedanceAdapter";
import type { SeedanceSubmitInput } from "@/app/admin/video-studio/lib/types";
import { assertAdminApi } from "@/shared/lib/admin-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const guardResponse = await assertAdminApi();
  if (guardResponse) return guardResponse;

  let body: SeedanceSubmitInput;
  try {
    body = (await req.json()) as SeedanceSubmitInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const { taskId } = await submitSeedanceTask(body, req.signal);
    return NextResponse.json({ taskId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 2: typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/admin/video-studio/video/submit/route.ts
git commit -m "feat(admin): add seedance task submit route"
```

---

## Task 7: Seedance status route

**Files:**
- Create: `src/app/api/admin/video-studio/video/status/[taskId]/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/admin/video-studio/video/status/[taskId]/route.ts
import { NextRequest, NextResponse } from "next/server";

import { fetchSeedanceTask } from "@/app/admin/video-studio/lib/adapters/seedanceAdapter";
import { assertAdminApi } from "@/shared/lib/admin-guard";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const guardResponse = await assertAdminApi();
  if (guardResponse) return guardResponse;

  const { taskId } = await ctx.params;
  if (!taskId)
    return NextResponse.json({ error: "taskId missing" }, { status: 400 });

  try {
    const state = await fetchSeedanceTask(taskId, req.signal);
    return NextResponse.json(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 2: typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/admin/video-studio/video/status
git commit -m "feat(admin): add seedance task status poll route"
```

---

## Task 8: Default video prompt builder

**Files:**
- Create: `src/app/admin/video-studio/lib/buildVideoPrompt.ts`

- [ ] **Step 1: Write the file**

```ts
// src/app/admin/video-studio/lib/buildVideoPrompt.ts
import type { DetailedRecipeGridItem } from "@/entities/recipe/model/types";

export const buildDefaultVideoPrompt = (
  recipe?: Pick<DetailedRecipeGridItem, "title">
) => {
  const subject = recipe?.title ?? "the dish";
  return [
    `Subtle cinematic motion of ${subject}.`,
    "Slow camera dolly-in, shallow depth of field.",
    "Soft warm rim light, gentle steam rising from the dish.",
    "No people, no text, no logos. 5 seconds.",
  ].join(" ");
};
```

- [ ] **Step 2: typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/admin/video-studio/lib/buildVideoPrompt.ts
git commit -m "feat(admin): add default video prompt builder"
```

---

## Task 9: `useImageGeneration` client hook

**Files:**
- Create: `src/app/admin/video-studio/lib/useImageGeneration.ts`

- [ ] **Step 1: Write the file**

```ts
"use client";

import { useCallback, useRef, useState } from "react";

export type ImageGenState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; imageDataUrls: string[]; latencyMs: number }
  | { status: "error"; message: string };

type RunInput = {
  prompt: string;
  quality: "low" | "medium" | "high";
  n: number;
  referenceImageUrl?: string;
};

export const useImageGeneration = () => {
  const [state, setState] = useState<ImageGenState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (input: RunInput) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "pending" });

    try {
      const res = await fetch("/api/admin/video-studio/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const data = (await res.json()) as
        | { images: string[]; latencyMs: number }
        | { error: string };
      if (!res.ok || !("images" in data)) {
        setState({
          status: "error",
          message: "error" in data ? data.error : `HTTP ${res.status}`,
        });
        return;
      }
      setState({
        status: "success",
        imageDataUrls: data.images,
        latencyMs: data.latencyMs,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        setState({ status: "idle" });
        return;
      }
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle" });
  }, []);

  return { state, run, cancel };
};
```

- [ ] **Step 2: typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/admin/video-studio/lib/useImageGeneration.ts
git commit -m "feat(admin): add image generation client hook"
```

---

## Task 10: `useVideoGeneration` client hook (submit + poll)

**Files:**
- Create: `src/app/admin/video-studio/lib/useVideoGeneration.ts`

- [ ] **Step 1: Write the file**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  SeedanceModelId,
  SeedanceRatio,
  SeedanceResolution,
  SeedanceTaskState,
} from "./types";

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

export type VideoGenState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "polling"; taskId: string; lastStatus: SeedanceTaskState["status"] }
  | { status: "success"; taskId: string; videoUrl: string }
  | { status: "error"; message: string };

type RunInput = {
  model: SeedanceModelId;
  prompt: string;
  imageDataUrlOrUrl: string;
  resolution: SeedanceResolution;
  ratio: SeedanceRatio;
  durationSec: number;
  generateAudio: boolean;
};

export const useVideoGeneration = () => {
  const [state, setState] = useState<VideoGenState>({ status: "idle" });
  const stoppedRef = useRef(false);

  const run = useCallback(async (input: RunInput) => {
    stoppedRef.current = false;
    setState({ status: "submitting" });

    let taskId: string;
    try {
      const submitRes = await fetch("/api/admin/video-studio/video/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const submitData = (await submitRes.json()) as {
        taskId?: string;
        error?: string;
      };
      if (!submitRes.ok || !submitData.taskId) {
        setState({
          status: "error",
          message: submitData.error ?? `HTTP ${submitRes.status}`,
        });
        return;
      }
      taskId = submitData.taskId;
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    setState({ status: "polling", taskId, lastStatus: "queued" });

    const startedAt = Date.now();
    while (!stoppedRef.current) {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setState({ status: "error", message: "timeout (>10min)" });
        return;
      }

      try {
        const r = await fetch(
          `/api/admin/video-studio/video/status/${encodeURIComponent(taskId)}`
        );
        const t = (await r.json()) as SeedanceTaskState & { error?: string };
        if (!r.ok || !t.status) {
          setState({ status: "error", message: t.error ?? `HTTP ${r.status}` });
          return;
        }
        if (t.status === "succeeded" && t.videoUrl) {
          setState({ status: "success", taskId, videoUrl: t.videoUrl });
          return;
        }
        if (
          t.status === "failed" ||
          t.status === "cancelled" ||
          t.status === "expired"
        ) {
          setState({
            status: "error",
            message: t.errorMessage ?? `task ${t.status}`,
          });
          return;
        }
        setState({ status: "polling", taskId, lastStatus: t.status });
      } catch (err) {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
    }
  }, []);

  const cancel = useCallback(() => {
    stoppedRef.current = true;
    setState({ status: "idle" });
  }, []);

  useEffect(() => {
    return () => {
      stoppedRef.current = true;
    };
  }, []);

  return { state, run, cancel };
};
```

- [ ] **Step 2: typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/admin/video-studio/lib/useVideoGeneration.ts
git commit -m "feat(admin): add video generation submit+poll hook"
```

---

## Task 11: `ImageGenerationPanel`, `ImageGrid`, `VideoGenerationPanel`, `VideoResultCard`

These are 4 small presentational components. Per project policy on commit splitting, **commit them as one unit** at the end.

**Files:**
- Create: `src/app/admin/video-studio/components/ImageGenerationPanel.tsx`
- Create: `src/app/admin/video-studio/components/ImageGrid.tsx`
- Create: `src/app/admin/video-studio/components/VideoGenerationPanel.tsx`
- Create: `src/app/admin/video-studio/components/VideoResultCard.tsx`

- [ ] **Step 1: Write `ImageGenerationPanel.tsx`**

```tsx
"use client";

import { useRef } from "react";

type Props = {
  prompt: string;
  onPromptChange: (v: string) => void;
  quality: "low" | "medium" | "high";
  onQualityChange: (v: "low" | "medium" | "high") => void;
  count: number;
  onCountChange: (v: number) => void;
  referenceImageUrl: string | null;
  onReferenceImageChange: (dataUrl: string | null) => void;
  running: boolean;
  onSubmit: () => void;
  onCancel: () => void;
};

export const ImageGenerationPanel = ({
  prompt,
  onPromptChange,
  quality,
  onQualityChange,
  count,
  onCountChange,
  referenceImageUrl,
  onReferenceImageChange,
  running,
  onSubmit,
  onCancel,
}: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      onReferenceImageChange(typeof r === "string" ? r : null);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-bold text-gray-900">1단계 · 이미지 생성</h2>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-gray-600">
          품질
          <select
            value={quality}
            onChange={(e) =>
              onQualityChange(e.target.value as "low" | "medium" | "high")
            }
            className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-gray-600">
          장수 (1~4)
          <input
            type="number"
            min={1}
            max={4}
            value={count}
            onChange={(e) =>
              onCountChange(Math.max(1, Math.min(4, Number(e.target.value) || 1)))
            }
            className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm"
          />
        </label>
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-600">
          레퍼런스 이미지 (선택)
        </label>
        {referenceImageUrl ? (
          <div className="flex items-center gap-2">
            <img
              src={referenceImageUrl}
              alt="reference"
              className="h-16 w-16 rounded-lg object-cover"
            />
            <button
              type="button"
              onClick={() => onReferenceImageChange(null)}
              className="text-xs text-gray-500 underline"
            >
              제거
            </button>
          </div>
        ) : (
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="text-sm"
          />
        )}
      </div>

      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        rows={6}
        placeholder="프롬프트를 입력하세요 (레시피 선택 시 자동으로 채워집니다)"
        className="w-full rounded-lg border border-gray-200 p-2 text-sm"
      />

      <div className="flex items-center gap-2">
        <button
          onClick={onSubmit}
          disabled={running || !prompt.trim()}
          className="h-10 rounded-xl bg-olive-light px-4 text-sm font-bold text-white disabled:bg-gray-200 disabled:text-gray-400"
        >
          {running ? "생성 중…" : `이미지 ${count}장 생성`}
        </button>
        {running && (
          <button onClick={onCancel} className="text-xs text-red-500 underline">
            취소
          </button>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Write `ImageGrid.tsx`**

```tsx
"use client";

type Props = {
  imageUrls: string[];
  selectedUrl: string | null;
  onSelect: (url: string) => void;
};

export const ImageGrid = ({ imageUrls, selectedUrl, onSelect }: Props) => {
  if (imageUrls.length === 0) return null;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="mb-2 text-xs text-gray-500">
        생성된 이미지 — 영상 입력으로 사용할 이미지를 선택하세요
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {imageUrls.map((url) => {
          const isSelected = url === selectedUrl;
          return (
            <button
              key={url}
              type="button"
              onClick={() => onSelect(url)}
              className={`relative overflow-hidden rounded-xl border-2 ${
                isSelected ? "border-olive-light" : "border-transparent"
              }`}
            >
              <img
                src={url}
                alt="generated"
                className="aspect-square w-full object-cover"
              />
              {isSelected && (
                <span className="absolute right-2 top-2 rounded-full bg-olive-light px-2 py-0.5 text-[10px] font-bold text-white">
                  선택됨
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Write `VideoGenerationPanel.tsx`**

```tsx
"use client";

import type {
  SeedanceModelId,
  SeedanceRatio,
  SeedanceResolution,
} from "../lib/types";

type Props = {
  selectedImageUrl: string | null;
  prompt: string;
  onPromptChange: (v: string) => void;
  model: SeedanceModelId;
  onModelChange: (v: SeedanceModelId) => void;
  resolution: SeedanceResolution;
  onResolutionChange: (v: SeedanceResolution) => void;
  ratio: SeedanceRatio;
  onRatioChange: (v: SeedanceRatio) => void;
  durationSec: number;
  onDurationChange: (v: number) => void;
  generateAudio: boolean;
  onGenerateAudioChange: (v: boolean) => void;
  running: boolean;
  pollLabel?: string;
  onSubmit: () => void;
  onCancel: () => void;
};

export const VideoGenerationPanel = ({
  selectedImageUrl,
  prompt,
  onPromptChange,
  model,
  onModelChange,
  resolution,
  onResolutionChange,
  ratio,
  onRatioChange,
  durationSec,
  onDurationChange,
  generateAudio,
  onGenerateAudioChange,
  running,
  pollLabel,
  onSubmit,
  onCancel,
}: Props) => {
  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-bold text-gray-900">2단계 · 영상 생성</h2>

      {selectedImageUrl ? (
        <div className="flex items-center gap-3">
          <img
            src={selectedImageUrl}
            alt="selected"
            className="h-20 w-20 rounded-lg object-cover"
          />
          <span className="text-xs text-gray-500">
            이미지 선택됨 (위 그리드에서 변경 가능)
          </span>
        </div>
      ) : (
        <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
          위 1단계에서 이미지를 먼저 생성·선택해 주세요
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 text-xs text-gray-600">
          모델
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value as SeedanceModelId)}
            className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
          >
            <option value="dreamina-seedance-2-0-fast-260128">
              2.0 Fast (저렴/빠름)
            </option>
            <option value="dreamina-seedance-2-0-260128">
              2.0 Standard (고품질)
            </option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-gray-600">
          해상도
          <select
            value={resolution}
            onChange={(e) =>
              onResolutionChange(e.target.value as SeedanceResolution)
            }
            className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
          >
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-gray-600">
          비율
          <select
            value={ratio}
            onChange={(e) => onRatioChange(e.target.value as SeedanceRatio)}
            className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
          >
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
            <option value="4:3">4:3</option>
            <option value="3:4">3:4</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-gray-600">
          길이(초)
          <input
            type="number"
            min={4}
            max={15}
            value={durationSec}
            onChange={(e) =>
              onDurationChange(
                Math.max(4, Math.min(15, Number(e.target.value) || 5))
              )
            }
            className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm"
          />
        </label>

        <label className="col-span-2 flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={generateAudio}
            onChange={(e) => onGenerateAudioChange(e.target.checked)}
          />
          오디오 생성
        </label>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        rows={5}
        placeholder="영상 프롬프트"
        className="w-full rounded-lg border border-gray-200 p-2 text-sm"
      />

      <div className="flex items-center gap-2">
        <button
          onClick={onSubmit}
          disabled={running || !selectedImageUrl || !prompt.trim()}
          className="h-10 rounded-xl bg-olive-light px-4 text-sm font-bold text-white disabled:bg-gray-200 disabled:text-gray-400"
        >
          {running ? `진행 중 (${pollLabel ?? "..."})` : "영상 생성"}
        </button>
        {running && (
          <button onClick={onCancel} className="text-xs text-red-500 underline">
            취소
          </button>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Write `VideoResultCard.tsx`**

```tsx
"use client";

import type { VideoGenState } from "../lib/useVideoGeneration";

type Props = { state: VideoGenState };

export const VideoResultCard = ({ state }: Props) => {
  if (state.status === "idle") return null;

  if (state.status === "submitting" || state.status === "polling") {
    const label =
      state.status === "submitting"
        ? "submitting…"
        : `task: ${state.taskId} · ${state.lastStatus}`;
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-sm text-gray-500">
        영상 생성 중 — {label}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
        실패: {state.message}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-500">완료 (task {state.taskId})</div>
      <video src={state.videoUrl} controls className="w-full rounded-xl" />
      <a
        href={state.videoUrl}
        download
        className="text-xs text-olive-dark underline"
      >
        다운로드
      </a>
    </div>
  );
};
```

- [ ] **Step 5: typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/admin/video-studio/components/
git commit -m "feat(admin): add video-studio panels and result components"
```

---

## Task 12: Page composition

**Files:**
- Create: `src/app/admin/video-studio/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

import { RecipeSearchPanel } from "@/app/admin/image-quality-test/components/RecipeSearchPanel";
import { buildPrompt } from "@/app/admin/image-quality-test/lib/buildPrompt";
import { getRecipe } from "@/entities/recipe/model/api";
import type { DetailedRecipeGridItem } from "@/entities/recipe/model/types";

import { ImageGenerationPanel } from "./components/ImageGenerationPanel";
import { ImageGrid } from "./components/ImageGrid";
import { VideoGenerationPanel } from "./components/VideoGenerationPanel";
import { VideoResultCard } from "./components/VideoResultCard";
import { buildDefaultVideoPrompt } from "./lib/buildVideoPrompt";
import type {
  SeedanceModelId,
  SeedanceRatio,
  SeedanceResolution,
} from "./lib/types";
import { useImageGeneration } from "./lib/useImageGeneration";
import { useVideoGeneration } from "./lib/useVideoGeneration";

const VideoStudioPage = () => {
  const [recipe, setRecipe] = useState<DetailedRecipeGridItem | null>(null);

  // image stage
  const [imagePrompt, setImagePrompt] = useState("");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [count, setCount] = useState(2);
  const [refImage, setRefImage] = useState<string | null>(null);
  const { state: imageState, run: runImage, cancel: cancelImage } =
    useImageGeneration();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // video stage
  const [videoPrompt, setVideoPrompt] = useState(() =>
    buildDefaultVideoPrompt()
  );
  const [model, setModel] = useState<SeedanceModelId>(
    "dreamina-seedance-2-0-fast-260128"
  );
  const [resolution, setResolution] = useState<SeedanceResolution>("720p");
  const [ratio, setRatio] = useState<SeedanceRatio>("16:9");
  const [durationSec, setDurationSec] = useState(5);
  const [generateAudio, setGenerateAudio] = useState(false);
  const { state: videoState, run: runVideo, cancel: cancelVideo } =
    useVideoGeneration();

  const handleRecipeSelect = useCallback(async (r: DetailedRecipeGridItem) => {
    setRecipe(r);
    setImagePrompt("레시피 상세 조회 중...");
    setVideoPrompt(buildDefaultVideoPrompt({ title: r.title }));
    try {
      const detail = await getRecipe(r.id);
      setImagePrompt(
        buildPrompt({
          title: detail.title,
          description: detail.description,
          dishType: detail.dishType,
          ingredients: detail.ingredients,
          steps: detail.steps,
          fineDiningInfo: detail.fineDiningInfo,
        })
      );
    } catch (err) {
      console.error("레시피 상세 조회 실패", err);
      setImagePrompt(buildPrompt({ title: r.title }));
    }
  }, []);

  // auto-select first generated image whenever a fresh batch arrives
  useEffect(() => {
    if (imageState.status === "success" && !selectedImage) {
      setSelectedImage(imageState.imageDataUrls[0] ?? null);
    }
  }, [imageState, selectedImage]);

  const handleGenerateImages = useCallback(() => {
    setSelectedImage(null);
    runImage({
      prompt: imagePrompt,
      quality,
      n: count,
      referenceImageUrl: refImage ?? undefined,
    });
  }, [imagePrompt, quality, count, refImage, runImage]);

  const handleGenerateVideo = useCallback(() => {
    if (!selectedImage) return;
    runVideo({
      model,
      prompt: videoPrompt,
      imageDataUrlOrUrl: selectedImage,
      resolution,
      ratio,
      durationSec,
      generateAudio,
    });
  }, [
    selectedImage,
    model,
    videoPrompt,
    resolution,
    ratio,
    durationSec,
    generateAudio,
    runVideo,
  ]);

  const imageRunning = imageState.status === "pending";
  const videoRunning =
    videoState.status === "submitting" || videoState.status === "polling";
  const videoPollLabel =
    videoState.status === "polling"
      ? videoState.lastStatus
      : videoState.status === "submitting"
      ? "submit"
      : undefined;
  const generatedImages =
    imageState.status === "success" ? imageState.imageDataUrls : [];

  return (
    <div className="mx-auto min-h-screen max-w-6xl bg-beige-light/40 p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold text-gray-900">Video Studio</h1>

      <div className="mb-4">
        <RecipeSearchPanel
          selectedId={recipe?.id ?? null}
          onSelect={handleRecipeSelect}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ImageGenerationPanel
          prompt={imagePrompt}
          onPromptChange={setImagePrompt}
          quality={quality}
          onQualityChange={setQuality}
          count={count}
          onCountChange={setCount}
          referenceImageUrl={refImage}
          onReferenceImageChange={setRefImage}
          running={imageRunning}
          onSubmit={handleGenerateImages}
          onCancel={cancelImage}
        />

        <VideoGenerationPanel
          selectedImageUrl={selectedImage}
          prompt={videoPrompt}
          onPromptChange={setVideoPrompt}
          model={model}
          onModelChange={setModel}
          resolution={resolution}
          onResolutionChange={setResolution}
          ratio={ratio}
          onRatioChange={setRatio}
          durationSec={durationSec}
          onDurationChange={setDurationSec}
          generateAudio={generateAudio}
          onGenerateAudioChange={setGenerateAudio}
          running={videoRunning}
          pollLabel={videoPollLabel}
          onSubmit={handleGenerateVideo}
          onCancel={cancelVideo}
        />
      </div>

      <div className="mt-4 space-y-4">
        {imageState.status === "error" && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            이미지 생성 실패: {imageState.message}
          </div>
        )}
        <ImageGrid
          imageUrls={generatedImages}
          selectedUrl={selectedImage}
          onSelect={setSelectedImage}
        />
        <VideoResultCard state={videoState} />
      </div>
    </div>
  );
};

export default VideoStudioPage;
```

- [ ] **Step 2: typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Manual smoke test**

User runs `npm run dev`, signs into admin, and visits `/admin/video-studio`. Verify, in order:

1. Recipe search panel renders and a recipe can be selected.
2. After recipe select, image prompt textarea fills with the cached recipe-derived prompt.
3. Clicking "이미지 N장 생성" returns N images and they render in the grid.
4. Selecting an image moves the green "선택됨" badge.
5. Video panel "영상 생성" button enables only when an image is selected.
6. Submitting video shows "진행 중 (queued|running)" status, ticks every ~5s.
7. After the Seedance task completes, the video player renders with `src` set to `content.video_url`.

If model id `dreamina-seedance-2-0-260128` returns 400 "model not found", swap to the bare `seedance-2.0` IDs in `lib/types.ts` and re-run.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/video-studio/page.tsx
git commit -m "feat(admin): wire video-studio page composition"
```

---

## Task 13: Admin nav link (conditional)

The existing `src/app/admin/layout.tsx` is 16 lines (per Explore). If it just renders `{children}`, skip this task entirely. If it has a sidebar/nav listing the admin pages, append a link.

**Files:**
- Possibly modify: `src/app/admin/layout.tsx`

- [ ] **Step 1: Inspect the layout**

Read `src/app/admin/layout.tsx`. Look for an `<aside>`, `<nav>`, or anything iterating a list of admin pages.

- [ ] **Step 2: If a nav exists, add the link**

Add an entry like:

```tsx
<Link href="/admin/video-studio" className="block px-3 py-2 hover:bg-beige-light">
  Video Studio
</Link>
```

(Place it consistently with how the other admin pages are listed.)

- [ ] **Step 3: If no nav exists, skip and note**

Add a one-line entry to the project's running admin index — or just leave the page reachable via direct URL. Either is acceptable for an admin tool.

- [ ] **Step 4: Commit (only if changes)**

```bash
git add src/app/admin/layout.tsx
git commit -m "feat(admin): link video-studio in admin nav"
```

---

## Out of scope (not implemented in this plan)

- Persistent storage of generated images/videos to a backend or to Vercel Blob. MVP uses base64 data URLs and keeps the artifacts in-page only. The video URL returned by Seedance is BytePlus-hosted and may expire — the user can download it from the page while the session is open.
- Cost telemetry / per-call cost summary (the existing `image-quality-test` has a `CostSummary` widget — port it later if useful).
- Reference-to-video / multi-reference Seedance flow (the API supports up to 12 references). Out of scope; first-frame image-to-video is enough for the user's described pipeline.
- Retry logic on HTTP 429. Surface the error and let the user back off manually. If we hit the QPS=2 limit often, add backoff later.
