import type { Metadata } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const _geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: 'ComparaTuEntrada — Compara precios de entradas y eventos',
  description: 'Compara precios de entradas de conciertos, teatro, deportes y espectáculos en Taquilla.com, Ticketmaster y El Corte Inglés. Encuentra la mejor oferta.',
  keywords: 'comparar entradas, taquilla, ticketmaster, el corte inglés, conciertos, teatro, deportes',
  openGraph: {
    title: 'ComparaTuEntrada — Compara precios de entradas',
    description: 'Encuentra el mejor precio para tus eventos favoritos comparando todas las ticketeras.',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className={`${inter.variable} bg-background`}>
      <body className="font-sans antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
