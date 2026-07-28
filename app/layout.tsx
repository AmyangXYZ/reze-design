import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NoNativeContextMenu } from "@/components/no-native-context-menu";
import { NoStickyFocus } from "@/components/no-sticky-focus";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next"
import { preload } from "react-dom";
import { DEFAULT_SCENE } from "@/lib/default-scene";
import { modelPmxUrl } from "@/lib/scene";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reze Design",
  description:
    "Blender-style material node graphs compiled to WGSL live on a WebGPU MMD renderer. Web-native scene composing and styling, powered by reze-engine.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Start the demo scene's heavy assets downloading at HTML parse instead of after the JS
  for (const entry of DEFAULT_SCENE.assets.models) {
    const pmx = modelPmxUrl(entry.model);
    if (pmx) preload(encodeURI(pmx), { as: "fetch", crossOrigin: "anonymous" });
    if (entry.animation) preload(encodeURI(entry.animation.url), { as: "fetch", crossOrigin: "anonymous" });
  }
  return (

    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col text-foreground">
        {/* A small delay lets hover-revealed triggers finish laying out before the tooltip opens */}
        <NoNativeContextMenu />
        <NoStickyFocus />
        {/* I18nProvider is client-side; it keeps <html lang> in sync post-mount. */}
        <I18nProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </I18nProvider>
        <Analytics/>
      </body>
    </html>
  );
}
