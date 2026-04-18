import type { Metadata } from 'next';
import { JetBrains_Mono, Sora } from 'next/font/google';
import './globals.css';

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PumpTx — PumpFun Buy Monitor',
  description: 'Real-time PumpFun BUY monitor with terminal dashboard',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${mono.variable} ${sora.variable}`}
        style={{
          margin: 0,
          minHeight: '100%',
          background: '#030303',
          color: '#f4f4f4',
        }}
      >
        {children}
      </body>
    </html>
  );
}
