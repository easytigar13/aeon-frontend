import type { Metadata } from 'next'
import { Inter, Space_Grotesk, Space_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Navbar } from '@/components/layout/Navbar'
import { MobileNav } from '@/components/layout/MobileNav'
import { ToastProvider } from '@/components/layout/ToastContext'
import { SiteBackdrop } from '@/components/layout/SiteBackdrop'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600'],
  display: 'swap',
})

const spaceMono = Space_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'AEON Protocol — ve(3,3) DEX on Robinhood Chain',
  description: 'The first fee-anchored DEX. Emissions = 25% of Fees. Built on Robinhood Chain.',
  icons: {
    icon: '/logo.jpg',
    apple: '/logo.jpg',
    shortcut: '/logo.jpg',
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
      <body className="bg-bg-base text-text-primary antialiased pb-16 md:pb-0">
        <Providers>
          <ToastProvider>
            <SiteBackdrop />
            <div className="min-h-screen flex flex-col">
              <Navbar />
              <main className="flex-1">
                {children}
              </main>
              <MobileNav />
            </div>
          </ToastProvider>
        </Providers>
      </body>
    </html>
  )
}
