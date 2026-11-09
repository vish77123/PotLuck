import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

export type SessionState = FunctionReturnType<typeof api.sessions.state>;
export type PlayerRow = SessionState["players"][number];
export type TemplateRow = SessionState["templates"][number];
