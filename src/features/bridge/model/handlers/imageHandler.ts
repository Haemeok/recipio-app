import * as ImagePicker from "expo-image-picker";
import type {
  BridgeMessage,
  ImagePickerPayload,
  ImageResultPayload,
  ImageErrorPayload,
} from "@/shared/types";
import type { BridgeHandler, HandlerContext } from "./types";

const DEFAULT_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  allowsEditing: true,
  quality: 0.8,
  base64: true,
};

async function requestCameraPermission(): Promise<boolean> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  return status === "granted";
}

async function requestMediaLibraryPermission(): Promise<boolean> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return status === "granted";
}

function sendImageResult(
  context: HandlerContext,
  result: ImagePicker.ImagePickerResult
) {
  if (result.canceled || !result.assets || result.assets.length === 0) {
    const errorPayload: ImageErrorPayload = {
      error: "Image selection cancelled",
      code: "CANCELLED",
    };
    context.sendToWebView("IMAGE_ERROR", errorPayload);
    return;
  }

  const asset = result.assets[0];
  const payload: ImageResultPayload = {
    uri: asset.uri,
    base64: asset.base64 ?? undefined,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType ?? undefined,
  };
  context.sendToWebView("IMAGE_RESULT", payload);
}

export const pickImageHandler: BridgeHandler<ImagePickerPayload> = {
  handle: async (
    message: BridgeMessage<ImagePickerPayload>,
    context?: HandlerContext
  ) => {
    if (!context) {
      console.warn("[PickImageHandler] No context provided");
      return;
    }

    const hasPermission = await requestMediaLibraryPermission();
    if (!hasPermission) {
      const errorPayload: ImageErrorPayload = {
        error: "Media library permission denied",
        code: "PERMISSION_DENIED",
      };
      context.sendToWebView("IMAGE_ERROR", errorPayload);
      return;
    }

    try {
      const options: ImagePicker.ImagePickerOptions = {
        ...DEFAULT_OPTIONS,
        allowsEditing: message.payload?.allowsEditing ?? true,
        quality: message.payload?.quality ?? 0.8,
      };

      const result = await ImagePicker.launchImageLibraryAsync(options);
      sendImageResult(context, result);
    } catch (error) {
      const errorPayload: ImageErrorPayload = {
        error: error instanceof Error ? error.message : "Unknown error",
        code: "UNKNOWN_ERROR",
      };
      context.sendToWebView("IMAGE_ERROR", errorPayload);
    }
  },
};

export const takePhotoHandler: BridgeHandler<ImagePickerPayload> = {
  handle: async (
    message: BridgeMessage<ImagePickerPayload>,
    context?: HandlerContext
  ) => {
    if (!context) {
      console.warn("[TakePhotoHandler] No context provided");
      return;
    }

    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      const errorPayload: ImageErrorPayload = {
        error: "Camera permission denied",
        code: "PERMISSION_DENIED",
      };
      context.sendToWebView("IMAGE_ERROR", errorPayload);
      return;
    }

    try {
      const options: ImagePicker.ImagePickerOptions = {
        ...DEFAULT_OPTIONS,
        allowsEditing: message.payload?.allowsEditing ?? true,
        quality: message.payload?.quality ?? 0.8,
      };

      const result = await ImagePicker.launchCameraAsync(options);
      sendImageResult(context, result);
    } catch (error) {
      const errorPayload: ImageErrorPayload = {
        error: error instanceof Error ? error.message : "Unknown error",
        code: "UNKNOWN_ERROR",
      };
      context.sendToWebView("IMAGE_ERROR", errorPayload);
    }
  },
};
