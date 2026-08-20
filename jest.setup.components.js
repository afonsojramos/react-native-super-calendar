// Reanimated 4's built-in mock pulls in the native worklets module, which throws
// under Jest. Mock just the hooks/components our code uses: run worklets inline
// and treat animated views as plain views.
// Gesture Handler reaches for a native TurboModule on import, which isn't
// registered under Jest. Mock the bits our grid uses: a passthrough
// GestureDetector and a chainable Gesture builder (every method returns the
// builder, so `Gesture.Pan().enabled(x).onStart(fn)` works without natives).
// Each builder also records the callbacks it is given, and every builder made
// during a test is pushed to `__gestures`, so a test can drive a gesture
// directly: `__gestures.at(-1).handlers.onStart({ x, y })`.
jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const gestures = [];
  const makeChain = () => {
    const handlers = {};
    const chain = new Proxy(() => chain, {
      get: (_target, prop) =>
        prop === "handlers"
          ? handlers
          : (...args) => {
              const callback = args.find((arg) => typeof arg === "function");
              if (callback) handlers[prop] = callback;
              return chain;
            },
    });
    gestures.push(chain);
    return chain;
  };
  return {
    __esModule: true,
    GestureDetector: ({ children }) => children,
    GestureHandlerRootView: View,
    Gesture: new Proxy({}, { get: () => () => makeChain() }),
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
