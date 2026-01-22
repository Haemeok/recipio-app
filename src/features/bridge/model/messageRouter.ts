import type { BridgeMessage, BridgeMessageType } from "@/shared/types";
import {
  hapticHandler,
  shareHandler,
  pushTokenHandler,
  pickImageHandler,
  takePhotoHandler,
  type BridgeHandler,
  type HandlerContext,
} from "./handlers";

const handlers: Partial<Record<BridgeMessageType, BridgeHandler>> = {
  HAPTIC: hapticHandler,
  SHARE: shareHandler,
  REQUEST_PUSH_TOKEN: pushTokenHandler,
  PICK_IMAGE: pickImageHandler,
  TAKE_PHOTO: takePhotoHandler,
};

export const messageRouter = {
  route: async (
    message: BridgeMessage,
    context?: HandlerContext
  ): Promise<void> => {
    const handler = handlers[message.type];

    if (!handler) {
      console.warn(`[MessageRouter] No handler for type: ${message.type}`);
      return;
    }

    await handler.handle(message, context);
  },

  parse: (data: string): BridgeMessage | null => {
    try {
      return JSON.parse(data) as BridgeMessage;
    } catch {
      console.warn("[MessageRouter] Failed to parse message:", data);
      return null;
    }
  },
};
