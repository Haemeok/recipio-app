import * as Haptics from "expo-haptics";
import type { HapticStyle } from "@/shared/types";

const impactStyleMap: Record<
  Extract<HapticStyle, "Light" | "Medium" | "Heavy">,
  Haptics.ImpactFeedbackStyle
> = {
  Light: Haptics.ImpactFeedbackStyle.Light,
  Medium: Haptics.ImpactFeedbackStyle.Medium,
  Heavy: Haptics.ImpactFeedbackStyle.Heavy,
};

const notificationTypeMap: Record<
  Extract<HapticStyle, "Success" | "Warning" | "Error">,
  Haptics.NotificationFeedbackType
> = {
  Success: Haptics.NotificationFeedbackType.Success,
  Warning: Haptics.NotificationFeedbackType.Warning,
  Error: Haptics.NotificationFeedbackType.Error,
};

export const hapticService = {
  trigger: async (style: HapticStyle): Promise<void> => {
    if (style in impactStyleMap) {
      await Haptics.impactAsync(
        impactStyleMap[style as keyof typeof impactStyleMap]
      );
      return;
    }

    if (style in notificationTypeMap) {
      await Haptics.notificationAsync(
        notificationTypeMap[style as keyof typeof notificationTypeMap]
      );
      return;
    }
  },
};
