// Reanimated 4's built-in mock pulls in the native worklets module, which throws
// under Jest. Mock just the hooks/components our code uses: run worklets inline
// and treat animated views as plain views.
jest.mock("react-native-reanimated", () => {
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: { View, ScrollView: View, createAnimatedComponent: (component) => component },
    useAnimatedStyle: (factory) => factory(),
    useDerivedValue: (factory) => ({ value: factory() }),
    useSharedValue: (initial) => ({ value: initial }),
    useAnimatedRef: () => ({ current: null }),
    useAnimatedReaction: () => {},
    useAnimatedScrollHandler: () => () => {},
    runOnJS: (fn) => fn,
    scrollTo: () => {},
  };
});
