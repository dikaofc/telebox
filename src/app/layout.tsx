import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "telebox",
  description: "simple file hosting. telegram-backed storage.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}