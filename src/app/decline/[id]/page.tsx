'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

export default function DeclinePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.id as string;
  const fromName = searchParams.get('from') || 'Arkadaşın';
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Daveti gönderene bildir
    fetch('/api/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, fromName }),
    }).finally(() => setDone(true));
  }, [roomId, fromName]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-pink-500 to-purple-600 mb-6 shadow-2xl shadow-pink-500/30">
          <span className="text-4xl">📚</span>
        </div>

        <h1 className="text-3xl font-bold bg-gradient-to-r from-pink-300 to-purple-300 bg-clip-text text-transparent mb-3">
          StudyMed
        </h1>

        {done ? (
          <>
            <div className="text-5xl mb-4">☕️</div>
            <h2 className="text-xl font-semibold text-white mb-2">Tamam, sorun değil!</h2>
            <p className="text-white/40 text-sm">
              Müsait olmadığın iletildi. Hazır olduğunda sen de davet gönderebilirsin.
            </p>
            <a
              href="/"
              className="inline-block mt-6 px-6 py-3 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 rounded-2xl text-white font-medium shadow-lg shadow-pink-500/20 transition-all"
            >
              Uygulamayı Aç
            </a>
          </>
        ) : (
          <div className="flex items-center justify-center gap-2 text-white/40 mt-4">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Gönderiliyor...
          </div>
        )}
      </div>
    </div>
  );
}
