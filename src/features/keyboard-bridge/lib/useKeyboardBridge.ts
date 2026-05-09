import { useEffect } from "react";
import {
  Keyboard,
  type EmitterSubscription,
  type KeyboardEvent,
} from "react-native";

import type { KeyboardStatePayload } from "@/shared/types";

type Sender = <T>(type: "KEYBOARD_STATE", payload: T) => void;

export const useKeyboardBridge = (sendToWebView: Sender) => {
  useEffect(() => {
    const post = (
      state: KeyboardStatePayload["state"],
      height: number,
      duration: number
    ) => {
      const payload: KeyboardStatePayload = { v: 1, state, height, duration };
      sendToWebView("KEYBOARD_STATE", payload);
    };

    const willShow = (e: KeyboardEvent) =>
      post("will-show", e.endCoordinates.height, e.duration ?? 250);
    const didShow = (e: KeyboardEvent) =>
      post("did-show", e.endCoordinates.height, 0);
    const willHide = (e: KeyboardEvent) =>
      post("will-hide", 0, e.duration ?? 250);
    const didHide = () => post("did-hide", 0, 0);

    const subs: EmitterSubscription[] = [
      Keyboard.addListener("keyboardWillShow", willShow),
      Keyboard.addListener("keyboardDidShow", didShow),
      Keyboard.addListener("keyboardWillHide", willHide),
      Keyboard.addListener("keyboardDidHide", didHide),
    ];

    return () => {
      subs.forEach((s) => s.remove());
    };
  }, [sendToWebView]);
};
