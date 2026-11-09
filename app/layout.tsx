import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PotLuck",
  description: "A live cash pool for physical card games.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
