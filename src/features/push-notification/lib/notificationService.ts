import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";

export type PushTokenResult =
  | { success: true; token: string; platform: "ios" | "android" }
  | {
      success: false;
      error: string;
      code: "DEVICE_NOT_SUPPORTED" | "PERMISSION_DENIED" | "TOKEN_FETCH_FAILED";
    };

export type NotificationStatus = "granted" | "denied" | "not_determined";

export async function getNotificationStatus(): Promise<NotificationStatus> {
  const { status } = await Notifications.getPermissionsAsync();

  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  return "not_determined";
}

async function requestPermissions(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();

  if (existingStatus === "granted") {
    return true;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

async function getExpoPushToken(): Promise<string> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;

  const token = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  return token.data;
}

export async function registerForPushNotifications(): Promise<PushTokenResult> {
  if (!Device.isDevice) {
    return {
      success: false,
      error: "Push notifications are only supported on physical devices",
      code: "DEVICE_NOT_SUPPORTED",
    };
  }

  const hasPermission = await requestPermissions();

  if (!hasPermission) {
    return {
      success: false,
      error: "Push notification permission denied",
      code: "PERMISSION_DENIED",
    };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  try {
    const token = await getExpoPushToken();
    const platform = Platform.OS as "ios" | "android";

    return {
      success: true,
      token,
      platform,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to get push token";

    return {
      success: false,
      error: errorMessage,
      code: "TOKEN_FETCH_FAILED",
    };
  }
}
