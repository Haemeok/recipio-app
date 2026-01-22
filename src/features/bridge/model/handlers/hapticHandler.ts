import { hapticService } from "@/shared/lib/haptic";
import type { BridgeMessage, HapticPayload } from "@/shared/types";
import type { BridgeHandler } from "./types";

export const hapticHandler: BridgeHandler<HapticPayload> = {
  handle: async (message: BridgeMessage<HapticPayload>): Promise<void> => {
    console.log("[HapticHandler] Received:", message.payload);

    const style = message.payload?.style;

    if (!style) {
      console.warn("[HapticHandler] Missing haptic style in payload");
      return;
    }

    console.log("[HapticHandler] Triggering haptic:", style);
    await hapticService.trigger(style);
    console.log("[HapticHandler] Haptic triggered successfully");
  },
};
