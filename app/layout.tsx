import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NoNativeContextMenu } from "@/components/no-native-context-menu";
import { NoStickyFocus } from "@/components/no-sticky-focus";
import { CrashLogCapture } from "@/components/crash-log-capture";
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

const DESCRIPTION =
  "An MMD design, rendering and sharing platform. Compose a scene in the browser — node-graph material shaders compiled to WGSL, colour grading, background effects, lighting and framing — then export video or publish a live 3D link. Powered by reze-engine on WebGPU.";

export const metadata: Metadata = {
  title: "Reze Design",
  description: DESCRIPTION,
  // Scenes are shared as links, so the site's own card should say what the link
  // leads to. Published scenes override this with their own title and blurb.
  openGraph: { title: "Reze Design", description: DESCRIPTION, type: "website" },
  twitter: { card: "summary_large_image", title: "Reze Design", description: DESCRIPTION },
  // The app translates itself — see lib/i18n. A machine translator on top of it
  // rewrites text nodes React is holding references to, and React's next
  // deletion walks into a node that is no longer its child: "Failed to execute
  // 'removeChild' on 'Node'", which takes the whole editor down. Reported from
  // the wild by a zh user, whose browser had every reason to offer it — `lang`
  // stays "en" while the UI renders Chinese.
  other: { google: "notranslate" },
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
      // Belt and braces with the notranslate meta above: Chrome honours the
      // attribute, and the class is what older/other translators look for.
      translate="no"
      className={`dark notranslate ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col text-foreground">
        {/* A small delay lets hover-revealed triggers finish laying out before the tooltip opens */}
        <NoNativeContextMenu />
        <NoStickyFocus />
        {/* Capture starts here so a crash report carries what led up to it. */}
        <CrashLogCapture />
        {/* I18nProvider is client-side; it keeps <html lang> in sync post-mount. */}
        <I18nProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </I18nProvider>
        <Analytics/>
      </body>
    </html>
  );
}
