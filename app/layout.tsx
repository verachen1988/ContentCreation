import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Upgrade Dialog Demo - Content Creation",
  description: "测试升级弹窗居中效果",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
