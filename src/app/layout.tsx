import type { Metadata } from 'next'
import { Inter, Space_Grotesk, Space_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Navbar } from '@/components/layout/Navbar'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700'],
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600'],
})

const spaceMono = Space_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '700'],
})

export const metadata: Metadata = {
  title: 'AEON Protocol — ve(3,3) DEX on Robinhood Chain',
  description: 'The first fee-anchored DEX. Emissions = Fees ÷ 10. Built on Robinhood Chain.',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
    shortcut: '/logo.png',
  },
  openGraph: {
    title: 'AEON Protocol',
    description: 'Fee-anchored ve(3,3) DEX on Robinhood Chain',
    images: ['/og.png'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable} ${spaceMono.variable}`}>
      <body className="bg-bg-base text-text-primary antialiased">
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-1">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  )
}
