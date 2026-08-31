import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import { AppQueryProvider } from "@/lib/query-client";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Fase 32 — `metadataBase` resolve toda URL relativa de metadata (OG,
// canonical) em todas as páginas pra uma URL absoluta; sem isso o Next
// falha o build ao encontrar uma URL relativa (ver generateMetadata de
// /arenas/[arenaSlug] e /arenas). `title.template`/`default` dão um
// título coerente pra qualquer página que não defina o próprio (nenhuma
// página privada define `openGraph`/`twitter` próprios — herdam os
// daqui, o que é o comportamento certo: só conteúdo público deveria
// aparecer bem ao ser compartilhado).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: "%s | ArenaHub",
    default: "ArenaHub",
  },
  description: "Encontre uma arena, escolha um horário e reserve sua quadra em segundos.",
  openGraph: {
    siteName: "ArenaHub",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html
        lang="pt-BR"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          <AppQueryProvider>{children}</AppQueryProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
