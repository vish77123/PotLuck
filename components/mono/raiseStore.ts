import { create } from "zustand";

/** Opens the raise-money flow on this phone, with how much is needed. Set when a payment fails for lack of cash. */
type RaiseState = { needed: number | null; open: (needed: number) => void; close: () => void };

export const useRaise = create<RaiseState>((set) => ({
  needed: null,
  open: (needed) => set({ needed }),
  close: () => set({ needed: null }),
}));
