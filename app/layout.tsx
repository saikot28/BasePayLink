import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BasePayLink",
  description: "Simple USDC payments powered by Base",
  other: {
    "base:app_id": "6a7b3054547e6338062940dd",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}