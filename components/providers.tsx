"use client";

import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { SettingsSheet } from "@/components/settings-sheet";
import { Toaster } from "@/components/ui/Toaster";
import { useUi } from "@/stores/ui";

/** Each device gets an anonymous Convex Auth identity the first time it opens the app. No login screen. */
function AutoSignIn() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    let cancelled = false;
    signIn("anonymous").catch(() => {
      // Offline on first open: try again shortly.
      if (!cancelled) setTimeout(() => setAttempt((n) => n + 1), 2000);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoading, isAuthenticated, signIn, attempt]);
  return null;
}

/** Keeps <html> in step with the Night / Day / Auto setting and the animation level. */
function ThemeSync() {
  const appearance = useUi((s) => s.appearance);
  const animations = useUi((s) => s.animations);
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = appearance === "night" || (appearance === "auto" && media.matches);
      root.classList.toggle("pl-dark", dark);
      root.classList.toggle("pl-light", !dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b0c0a" : "#f4ecda");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);
  useEffect(() => {
    document.documentElement.dataset.motion = animations;
  }, [animations]);
  return null;
}

/** Registers the service worker in production builds only, so dev hot reload isn't cached. */
function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL as string));
  return (
    <ConvexAuthProvider client={client}>
      <AutoSignIn />
      <ThemeSync />
      <ServiceWorker />
      {children}
      <SettingsSheet />
      <Toaster />
    </ConvexAuthProvider>
  );
}
