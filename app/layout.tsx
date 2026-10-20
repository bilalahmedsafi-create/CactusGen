import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Doto } from "next/font/google";
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

const doto = Doto({
  variable: "--font-doto",
  subsets: ["latin"],
  weight: ["900"],
});

export const metadata: Metadata = {
  title: "HeliosGen",
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
  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${doto.variable} antialiased dark`}
      style={{ height: "100%" }}
    >
      <body className="bg-black text-white h-full overflow-hidden">
        <TooltipProvider>
          {/* Sidebar + inset everywhere; full-bleed on /create (components/AppFrame). */}
          <AppFrame sidebarOpen={sidebarOpen}>{children}</AppFrame>
        </TooltipProvider>
        <GlobalModals />
      </body>
    </html>
  );
}
