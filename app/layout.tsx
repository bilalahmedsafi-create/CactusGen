import type { Metadata, Viewport } from "next";
import { Anton, Geist, Geist_Mono, Doto } from "next/font/google";
import "./globals.css";
import GlobalModals from "@/components/GlobalModals";
import { AppFrame } from "@/components/AppFrame";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cookies } from "next/headers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Condensed display face for page heroes / empty states (`.cg-display` in globals.css).
const anton = Anton({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const doto = Doto({
  variable: "--font-doto",
  subsets: ["latin"],
  weight: ["900"],
});

export const metadata: Metadata = {
  title: "CactusGen",
  description: "Build AI image & video generation workflows visually",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read a request cookie so every route keeps rendering at request time (as it
  // did when the sidebar read its open/closed cookie here).
  await cookies();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${doto.variable} ${anton.variable} antialiased dark`}
      style={{ height: "100%" }}
    >
      <body className="bg-(--c-bg) text-(--c-text) h-full overflow-hidden">
        <TooltipProvider>
          {/* Top nav on every page; /create brings its own copy (components/AppFrame). */}
          <AppFrame>{children}</AppFrame>
        </TooltipProvider>
        <GlobalModals />
      </body>
    </html>
  );
}
