import { BootGuardScript } from "@/components/boot-guard"
import { BootSlowNote } from "@/components/boot-note"
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { NoNativeContextMenu } from "@/components/no-native-context-menu";
import { NoStickyFocus } from "@/components/no-sticky-focus";
import { CrashLogCapture } from "@/components/crash-log-capture";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next"
import { preload } from "react-dom";
import { DEFAULT_SCENE_DOC } from "@/lib/default-scene";
import { parseAssetsDoc } from "@/lib/scene";
import { modelPmxUrl } from "@/lib/scene";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The cover's display face: the scene's name, and nothing else.
const display = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const TITLE = "Reze Design - MMD design, rendering and sharing"
const DESCRIPTION =
  "MMD design, rendering and sharing in the browser. Compose a scene — node-graph material shaders compiled to WGSL, colour grading, background effects, lighting and framing — then export video or publish a live 3D link. Powered by reze-engine on WebGPU.";

export const metadata: Metadata = {
  // Resolves relative preview-image paths to absolute URLs, which every crawler
  // requires.
  metadataBase: new URL("https://reze.design"),
  title: TITLE,
  description: DESCRIPTION,
  // Scenes are shared as links, so the site's own card should say what the link
  // leads to. Published scenes override this with their own title and blurb.
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Reze Design" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  // The app translates itself — see lib/i18n. A machine translator on top of it
  // rewrites text nodes React is holding references to, and React's next
  // deletion walks into a node that is no longer its child: "Failed to execute
  // 'removeChild' on 'Node'", which takes the whole editor down. Reported from
  // the wild by a zh user, whose browser had every reason to offer it — `lang`
  // stays "en" while the UI renders Chinese.
  other: { google: "notranslate" },
};

// Phones: no zoom-in when a field is focused. Safari zooms on any input whose
// text is under 16px, and the editor's fields are 12px (text-xs, the chrome's
// body size); the zoom then strands the panel half off screen. maximumScale
// stops it without bending the type scale. userScalable is left alone on
// purpose: iOS still lets a person pinch-zoom (Safari ignores the cap for
// pinching), and nothing here should take that away from someone who needs it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Start the demo scene's heavy assets downloading at HTML parse instead of after the JS
  for (const entry of parseAssetsDoc(DEFAULT_SCENE_DOC.assets).models) {
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
      className={`dark notranslate ${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <head>
        {/* Before any of the app's code: recovers a page whose chunks did not
            arrive, and says so when the connection is slow (boot-guard). */}
        <BootGuardScript />
      </head>
      <body
        className="min-h-full flex flex-col text-foreground"
        // The colour this build boots into — the demo's, or the empty scene's,
        // whichever DEFAULT_SCENE_DOC resolves to. Painted before a line of React
        // exists, so the first frame is already the right colour.
        style={{ backgroundColor: DEFAULT_SCENE_DOC.settings.background.color }}
      >
        <NoNativeContextMenu />
        <NoStickyFocus />
        {/* Capture starts here so a crash report carries what led up to it. */}
        <CrashLogCapture />
        {/* I18nProvider is client-side; it keeps <html lang> in sync post-mount. */}
        <I18nProvider>
          {children}
          {/* Outcomes of things that ran against the network — see the libraries
              and the publish dialog. Mounted beside the tree rather than inside
              it so a toast survives the surface that raised it closing. */}
          <Toaster />
        </I18nProvider>
        <BootSlowNote />
        <Analytics/>
      </body>
    </html>
  );
}
