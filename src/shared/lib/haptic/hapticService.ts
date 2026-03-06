import { Platform } from "react-native";
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

const androidHapticMap: Record<HapticStyle, Haptics.AndroidHaptics> = {
  Light: Haptics.AndroidHaptics.Clock_Tick,
  Medium: Haptics.AndroidHaptics.Context_Click,
  Heavy: Haptics.AndroidHaptics.Long_Press,
  Success: Haptics.AndroidHaptics.Confirm,
  Warning: Haptics.AndroidHaptics.Segment_Tick,
  Error: Haptics.AndroidHaptics.Reject,
};

export const hapticService = {
  trigger: async (style: HapticStyle): Promise<void> => {
    if (Platform.OS === "android") {
      await Haptics.performAndroidHapticsAsync(androidHapticMap[style]);
      return;
    }

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
