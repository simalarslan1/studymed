'use client';

import './globals.css';
import { useEffect } from 'react';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          console.log('Service Worker registered:', registration.scope);
        })
        .catch((err) => {
          console.error('Service Worker registration failed:', err);
        });
    }
  }, []);

  return (
    <html lang="tr">
      <head>
        <title>StudyMed - Birlikte Ders Çalış</title>
        <meta name="description" content="Tıp öğrencileri için görüntülü ders çalışma platformu" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#4f46e5" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white">
        {children}
      </body>
    </html>
  );
}
