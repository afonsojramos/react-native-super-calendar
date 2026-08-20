// Per-slot styling for the native renderer.
//
// Every component styles itself from the theme, so zero-config consumers get a
// full look with no setup. This module mirrors the dom renderer's slot contract
// for consumers who style with Tailwind classes instead: each styleable element
// is a named "slot" that accepts a `className` (resolved by a Tailwind runtime
// such as uniwind or NativeWind, which compile the library's source through the
// consumer's bundler) and/or a style override.
//
// The contract, shared with the dom renderer: a slot's *structural* styles (the
// layout the component needs to not fall apart) always apply. Its *themed*
// styles (colours, typography, spacing) apply only when no class is supplied
// for that slot; supply a class and you own those. A per-slot `styles` override
// always merges last. Without a Tailwind runtime, `className` is an unknown
// prop React Native silently ignores, so the props are safe to pass everywhere.

import { createContext, createElement, type ReactNode, useContext, useMemo } from "react";
import type { ImageStyle, StyleProp, TextStyle, ViewStyle } from "react-native";

/**
 * The style shapes a slot can resolve to. A slot carries the style type of the
 * element it is spread on, because React Native's style types stop being
 * mutually assignable as soon as a consumer's types diverge them: Expo's
 * react-native-web types widen `cursor` on `TextStyle` and `userSelect` on
 * `ViewStyle`, so a `View` slot typed as `TextStyle` fails to compile in any
 * Expo app.
 */
export type SlotStyle = ViewStyle | TextStyle | ImageStyle;

/**
 * Per-slot styling overrides. Give a slot a Tailwind class (uniwind/NativeWind)
 * and/or a style override; missing slots keep the built-in look.
 */
export interface SlotStyleProps<Slot extends string> {
  /**
   * Class names per slot. Supplying a class for a slot drops the built-in
   * *themed* styles for that slot so the class fully controls its look; the
   * *structural* styles the layout depends on are kept. Requires a Tailwind
   * runtime (uniwind, NativeWind) in the consuming app.
   */
  classNames?: Partial<Record<Slot, string>>;
  /** Style overrides per slot, merged last (win over defaults and classes). */
  styles?: Partial<Record<Slot, StyleProp<SlotStyle>>>;
}

/** A slot's built-in styling, split so classes can replace the look but not the layout. */
export interface SlotDefault<Style extends SlotStyle = ViewStyle> {
  /** Structural styles kept even when a class is supplied. */
  base?: StyleProp<Style>;
  /** Themed styles (colour, type, spacing) dropped when a class is supplied. */
  themed?: StyleProp<Style>;
}

/** The props a resolved slot spreads onto an element. */
export interface ResolvedSlot<Style extends SlotStyle = ViewStyle> {
  style: StyleProp<Style>;
  className?: string;
}

/**
 * Build a slot resolver for one render. `slot(name, defaults)` returns the
 * props to spread on that element: the resolved `style` array and, when the
 * consumer supplied one, a `className` for the Tailwind runtime to pick up.
 */
export function createSlots<Slot extends string>({ classNames, styles }: SlotStyleProps<Slot>) {
  // `NoInfer` keeps the element type a decision, not a guess: without it the
  // literal type of a `StyleSheet.create` entry wins the inference and every
  // themed style passed alongside it is then measured against that one entry.
  // Slots default to a `View`; `slot<TextStyle>(...)` marks the text ones.
  return <Style extends SlotStyle = ViewStyle>(
    name: Slot,
    defaults?: SlotDefault<NoInfer<Style>>,
  ): ResolvedSlot<Style> => {
    const slotClass = classNames?.[name];
    return {
      style: [
        defaults?.base,
        slotClass ? undefined : defaults?.themed,
        // A consumer's override is declared for any element's style, so it is
        // narrowed to this slot's element here. React Native flattens the array
        // and drops properties the element does not support either way.
        styles?.[name] as StyleProp<Style>,
      ],
      ...(slotClass ? { className: slotClass } : null),
    };
  };
}

// Deeply componentized views (the time grid) distribute their slot maps through
// context, like the theme, instead of threading two props through every layer.
const SlotStylesContext = createContext<SlotStyleProps<string>>({});

/** Provide a component's `classNames`/`styles` maps to its internal slots. */
export function SlotStylesProvider({
  classNames,
  styles,
  children,
}: SlotStyleProps<string> & { children: ReactNode }) {
  const value = useMemo(() => ({ classNames, styles }), [classNames, styles]);
  return createElement(SlotStylesContext.Provider, { value }, children);
}

/** Resolve slots against the nearest {@link SlotStylesProvider}'s maps. */
export function useSlots<Slot extends string>() {
  const maps = useContext(SlotStylesContext) as SlotStyleProps<Slot>;
  return useMemo(() => createSlots<Slot>(maps), [maps]);
}
