// A consumer's type environment can pull React Native's style types apart, and
// a slot typed for the wrong element then stops compiling in *their* app, where
// they cannot fix it. Expo does exactly this: every Expo app references
// `expo/types` through a generated `expo-env.d.ts`, and its react-native-web
// declarations widen `cursor` on `TextStyle` and `userSelect` on `ViewStyle`,
// which leaves the two mutually unassignable.
//
// Mirroring that divergence here puts it in front of `pnpm typecheck`, so a
// `View` slot typed as `TextStyle` fails in this repo instead of downstream.
// This fixture is only ever type-checked; it is not part of any published
// package, and the exact properties matter less than the divergence itself.
export {};

declare module "react-native" {
  interface ViewStyle {
    /** @platform web */
    userSelect?: string;
  }

  interface TextStyle {
    /** @platform web */
    cursor?: string;
  }
}
