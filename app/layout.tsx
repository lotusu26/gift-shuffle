import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const ramche = localFont({
  src: "./fonts/Ramche.ttf",
  variable: "--font-ramche",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "랜덤 선물 뽑기",
  description: "연말에 카카오톡 선물하기 코드를 서로 나누는 뽑기",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${ramche.variable} ${mono.variable} h-full overflow-hidden antialiased`}
    >
      <body className={`${ramche.className} flex h-full min-h-0 flex-col overflow-hidden`}>{children}</body>
    </html>
  );
}
