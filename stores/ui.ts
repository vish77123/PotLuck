import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type Appearance = "night" | "day" | "auto";
export type Motion = "full" | "reduced" | "off";

type UiState = {
  // Persisted on this phone (localStorage).
  sound: boolean;
  haptics: boolean;
  animations: Motion;
  appearance: Appearance;
  /** crewId → crew member this phone last played as, so Join can preselect "you". */
  lastMember: Record<string, string>;
  setSound: (v: boolean) => void;
  setHaptics: (v: boolean) => void;
  setAnimations: (v: Motion) => void;
  setAppearance: (v: Appearance) => void;
  rememberMember: (crewId: string, memberId: string) => void;

  // UI-only, never persisted.
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
};

export type Toast = { id: number; text: string; tone?: "default" | "error" | "warn"; badge?: string };

// localStorage can throw (private windows, blocked site data), so every access is guarded.
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

let toastId = 0;

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sound: true,
      haptics: true,
      animations: "full",
      appearance: "night",
      lastMember: {},
      setSound: (sound) => set({ sound }),
      setHaptics: (haptics) => set({ haptics }),
      setAnimations: (animations) => set({ animations }),
      setAppearance: (appearance) => set({ appearance }),
      rememberMember: (crewId, memberId) => set((s) => ({ lastMember: { ...s.lastMember, [crewId]: memberId } })),

      settingsOpen: false,
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      toasts: [],
      pushToast: (t) => {
        const id = ++toastId;
        set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.tone === "error" ? 5000 : 3200);
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
    }),
    {
      name: "potluck-ui",
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        sound: s.sound,
        haptics: s.haptics,
        animations: s.animations,
        appearance: s.appearance,
        lastMember: s.lastMember,
      }),
    },
  ),
);
