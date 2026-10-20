import { Anton } from "next/font/google";

// Condensed display face for the Create page's empty-state headlines only.
const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${anton.variable} flex min-h-0 flex-1 flex-col`}>{children}</div>;
}
