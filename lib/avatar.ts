// Seat avatars are initials on a stable per-name colour (design: "photos can drop in later").
const PALETTE = ["#9a4a5a", "#3d6a9a", "#6a4f96", "#2f8a74", "#9a6a2f", "#5f6f3a", "#8a3f7a", "#3f7f8a"];

export function avatarColor(name: string) {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}
