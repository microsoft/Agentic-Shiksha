import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TabConfig {
  /** Width of the top flat edge (narrower side) — SVG units */
  topWidth: number;
  /** Width of the bottom base edge (wider side) — SVG units */
  baseWidth: number;
  /** Height of the trapezium — rendered px */
  height: number;
  /** Corner radius on the top two corners */
  cornerRadius: number;
  /** Whether the glow/shadow filter is enabled */
  glowEnabled: boolean;
}

interface TabStore extends TabConfig {
  setTopWidth: (v: number) => void;
  setBaseWidth: (v: number) => void;
  setHeight: (v: number) => void;
  setCornerRadius: (v: number) => void;
  setGlowEnabled: (v: boolean) => void;
  reset: () => void;
}

const defaults: TabConfig = {
  topWidth: 50,
  baseWidth: 80,
  height: 18,
  cornerRadius: 3,
  glowEnabled: false,
};

export const useTabStore = create<TabStore>()(
  persist(
    (set) => ({
      ...defaults,
      setTopWidth: (v) => set({ topWidth: v }),
      setBaseWidth: (v) => set({ baseWidth: v }),
      setHeight: (v) => set({ height: v }),
      setCornerRadius: (v) => set({ cornerRadius: v }),
      setGlowEnabled: (v) => set({ glowEnabled: v }),
      reset: () => set(defaults),
    }),
    { name: "ekalaiva-tab-config" }
  )
);
