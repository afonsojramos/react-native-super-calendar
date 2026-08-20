// Reanimated 4's built-in mock pulls in the native worklets module, which throws
// under Jest. Mock just the hooks/components our code uses: run worklets inline
// and treat animated views as plain views.
// Gesture Handler reaches for a native TurboModule on import, which isn't
// registered under Jest. Mock the bits our grid uses: a passthrough
// GestureDetector and a chainable Gesture builder (every method returns the
// builder, so `Gesture.Pan().enabled(x).onStart(fn)` works without natives).
jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  // Every gesture built during a test lands here, with the callbacks it was
  // configured with, so a test can drive a pan without a native gesture stream:
  // `__gestures.at(-1).handlers.onStart({ x, y })`.
  const gestures = [];
  const makeChain = (kind) => {
    const handlers = {};
    const chain = new Proxy(() => chain, {
      get:
        (_target, prop) =>
        (...args) => {
          if (typeof prop === "string" && prop.startsWith("on") && typeof args[0] === "function") {
            handlers[prop] = args[0];
          }
          return chain;
        },
    });
    gestures.push({ kind, handlers });
    return chain;
  };
  return {
    __esModule: true,
    GestureDetector: ({ children }) => children,
    GestureHandlerRootView: View,
    Gesture: new Proxy({}, { get: (_target, kind) => () => makeChain(kind) }),
    __gestures: gestures,
  };
});

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
    useReducedMotion: () => false,
    runOnJS: (fn) => fn,
    scrollTo: () => {},
  };
});
