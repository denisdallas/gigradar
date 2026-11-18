import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "GigRadar — Technical opportunity intelligence",
  description: "Automatically discover paid technical gigs and evidence-backed business prospects across 19 European markets.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

