import type { Metadata, Viewport } from "next";
import { Manrope, Playfair_Display } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", weight: ["400", "500", "600", "700", "800"] });
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  applicationName: "PotLuck",
  appleWebApp: { capable: true, title: "PotLuck", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  title: "PotLuck",
  description: "A live cash pool for physical card games. The cards stay on the table — the money lives on everyone's phone.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0c0a",
};

// Runs before first paint so there's no flash of the wrong theme.
const themeScript = `(function(){try{var s=JSON.parse(localStorage.getItem('potluck-ui')||'{}').state||{};var a=s.appearance||'night';var d=a==='night'||(a==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var h=document.documentElement;h.classList.add(d?'pl-dark':'pl-light');h.dataset.motion=s.animations||'full'}catch(e){document.documentElement.classList.add('pl-dark')}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${playfair.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
