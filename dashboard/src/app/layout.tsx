import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION =
  "A live globe watching 666 places on Earth: 10-year and 90-day trends from NASA POWER and FIRMS, and the 14-day risk of wildfire, drought, heat and heavy rain, rebuilt every three hours.";

export const metadata: Metadata = {
  metadataBase: new URL("https://globalalert.earth"),
  title: {
    default: "Earth System Trend Detective · live NASA trends and 14-day hazard risk",
    template: "%s · Earth System Trend Detective",
  },
  description: DESCRIPTION,
  applicationName: "Earth System Trend Detective",
  keywords: ["NASA", "FIRMS", "POWER", "GIBS", "wildfire", "drought", "heat", "climate trends", "Mann-Kendall", "Space Apps 2026"],
  openGraph: {
    type: "website",
    url: "https://globalalert.earth",
    siteName: "Earth System Trend Detective",
    title: "Earth System Trend Detective",
    description: DESCRIPTION,
    locale: "en",
  },
  twitter: { card: "summary", title: "Earth System Trend Detective", description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#0d0d0d", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
