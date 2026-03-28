import './globals.css';
import { AuthProvider } from '@/context/AuthProvider';
import { ThemeProvider } from '@/context/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import Navbar from '@/components/layout/Navbar';

export const metadata = {
  title: 'WanderForge — Forge Your Perfect Journey',
  description:
    'AI-powered collaborative travel itinerary planner. Plan trips with smart route optimization, real-time collaboration, weather forecasts, and budget tracking. Experience-first trip planning.',
  keywords: 'travel planner, itinerary, AI travel, trip planning, collaborative travel, budget travel',
  openGraph: {
    title: 'WanderForge — Forge Your Perfect Journey',
    description: 'AI-powered collaborative travel itinerary planner that optimizes your experience.',
    type: 'website',
    siteName: 'WanderForge',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0F0F1A" />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <Navbar />
              <main style={{ paddingTop: 'var(--navbar-height)' }}>
                {children}
              </main>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
