import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Тренажёр 112 / ДДС",
  description: "Учебный тренажёр оператора 112 и диспетчера ДДС с ИИ-заявителем и разбором",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
