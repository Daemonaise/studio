import type { Metadata } from "next";
import { Inter, Source_Code_Pro } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { ClientOverlays } from "@/components/layout/client-overlays";

const fontInter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const fontSourceCodePro = Source_Code_Pro({
  subsets: ["latin"],
  variable: "--font-source-code-pro",
});

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://karasawalabs.com";

export const metadata: Metadata = {
  title: {
    default: "Karasawa Labs",
    template: "%s | Karasawa Labs",
  },
  description:
    "Precision 3D printing & automotive manufacturing — from rapid prototyping to full-scale production. Get an instant AI-powered quote.",
  metadataBase: new URL(baseUrl),
  openGraph: {
    type: "website",
    siteName: "Karasawa Labs",
    title: "Karasawa Labs — Build Hardware Faster",
    description:
      "Precision 3D printing & automotive manufacturing — from rapid prototyping to full-scale production. Get an instant AI-powered quote.",
    url: baseUrl,
    images: [{ url: "/metadatapreview.png", width: 1484, height: 476, alt: "Karasawa Labs" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Karasawa Labs — Build Hardware Faster",
    description:
      "Precision 3D printing & automotive manufacturing — from rapid prototyping to full-scale production. Get an instant AI-powered quote.",
    images: ["/metadatapreview.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          fontInter.variable,
          fontSourceCodePro.variable
        )}
      >
        {/* Blocks page flash before React splash mounts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.createElement('div');d.id='kl-splash-init';d.style.cssText='position:fixed;inset:0;z-index:9999;background:hsl(240,6%,7%)';document.body.appendChild(d)})()`,
          }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          <ClientOverlays />
          <div className="relative flex min-h-screen flex-col">
            {children}
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
