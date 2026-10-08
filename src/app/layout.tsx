export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "ФинансМАКС — финансовое управление",
  description: "Финансовая платформа аудиторской компании",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
