"use client";

import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReference, OptionalRestArgs } from "convex/server";

/** useQuery that waits for this device's anonymous sign-in, since every function needs an identity. */
export function useAuthedQuery<Q extends FunctionReference<"query">>(
  query: Q,
  args: OptionalRestArgs<Q>[0] | "skip",
) {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(query, (isAuthenticated ? args : "skip") as never) as Q["_returnType"] | undefined;
}
