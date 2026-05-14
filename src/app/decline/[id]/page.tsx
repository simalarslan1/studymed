'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const TIME_OPTIONS = [
  { label: 'Bugün sabah', emoji: '☀️' },
  { label: 'Bugün öğleden sonra', emoji: '🌤' },
  { label: 'Bugün akşam', emoji: '🌆' },
  { label: 'Bugün gece', emoji: '🌙' },
  { label: 'Yarın', emoji: '📅' },
];

function DeclineContent() {
  const searchParams = useSearchParams();
  const forName = searchParams.get('for') || 'Arkadaşın';
  const fromName = searchParams.get('from') || 'Sen';

  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedTime, setSelectedTime] = useState('');

  const handleSelectTime = async (time: string) => {
    setSending(true);
    setSelectedTime(time);
    try {
      await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyName: forName, from: fromName, time }),
      });
    } catch {
      // best-effort
    } finally {
      setSending(false);
      setSent(true);
      // Auto-close after 3s if window.close is available
      setTimeout(() => {
        try { window.close(); } catch { /* ignore */ }
      }, 3000);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#0f0818]">
      {/* Blobs */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 left-0 w-[400px] h-[400px] bg-pink-500/8 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-gradient-to-br from-pink-500 to-purple-600 mb-4 shadow-2xl shadow-pink-500/30">
            <span className="text-3xl">📚</span>
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-pink-300 to-purple-300 bg-clip-text text-transparent">
            📚 {forName} ders çalışıyor
          </h1>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-7 shadow-2xl">
          {sent ? (
            <div className="text-center space-y-4 py-2">
              <div className="text-5xl">💌</div>
              <h2 className="text-white font-bold text-xl">
                {forName}&apos;a bildirildi!
              </h2>
              <p className="text-white/50 text-sm leading-relaxed">
                Umarız yakında birlikte çalışırsınız 📚
              </p>
              <p className="text-white/30 text-xs">{selectedTime} müsait olacaksın</p>
              <button
                onClick={() => window.close()}
                className="mt-4 w-full py-3 rounded-2xl bg-white/8 border border-white/10 text-white/60 hover:text-white hover:bg-white/12 transition-all text-sm font-medium"
              >
                Kapat
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-white font-semibold text-lg mb-1 text-center">
                Ne zaman müsait olursun?
              </h2>
              <p className="text-white/40 text-sm text-center mb-6">
                {forName} merak ediyor 🩷
              </p>

              <div className="space-y-3">
                {TIME_OPTIONS.map(({ label, emoji }) => (
                  <button
                    key={label}
                    onClick={() => handleSelectTime(`${emoji} ${label}`)}
                    disabled={sending}
                    className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-gradient-to-r hover:from-pink-600/20 hover:to-purple-600/20 hover:border-pink-500/30 text-white font-medium text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed text-left"
                  >
                    <span className="text-2xl">{emoji}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DeclinePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#0f0818]">
          <div className="flex items-center gap-2 text-white/40">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Yükleniyor...
          </div>
        </div>
      }
    >
      <DeclineContent />
    </Suspense>
  );
}
