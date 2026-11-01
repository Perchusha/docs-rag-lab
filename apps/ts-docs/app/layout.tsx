import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import config from '../rag.config.ts'
import './globals.css'

export const metadata: Metadata = {
  title: config.title,
  description: config.tagline,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
