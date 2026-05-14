'use client';

import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import io, { Socket } from 'socket.io-client';

interface Config {
  myName: string;
  friendName: string;
  friendPhone: string;
  meetLink: string;
}

interface AvailabilityMsg {
  from: string;
  time: string;
}

const CONFIG_KEY = 'studymed-config';
let socketInstance: Socket | null = null;

export default function HomePage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [availabilityMsg, setAvailabilityMsg] = useState<AvailabilityMsg | null>(null);

  // Setup form state
  const [myName, setMyName] = useState('');
  const [friendName, setFriendName] = useState('');
  const [friendPhone, setFriendPhone] = useState('');
  const [meetLink, setMeetLink] = useState('');

  const socketConnectedRef = useRef(false);

  // Load config from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
      try {
        const parsed: Config = JSON.parse(stored);
        setConfig(parsed);
      } catch {
        localStorage.removeItem(CONFIG_KEY);
      }
    } else {
      setShowSetup(true);
    }
  }, []);

  // When config is set, connect socket & fetch pending messages
  useEffect(() => {
    if (!config) return;

    // Fetch pending messages
    fetch(`/api/messages?name=${encodeURIComponent(config.myName)}`)
      .then(r => r.json())
      .then((msgs: AvailabilityMsg[]) => {
        if (msgs && msgs.length > 0) {
          setAvailabilityMsg({ from: msgs[0].from, time: msgs[0].time });
        }
      })
      .catch(() => {});

    // Connect socket
    if (!socketConnectedRef.current) {
      socketConnectedRef.current = true;
      const socket = io({ path: '/socket.io' });
      socketInstance = socket;
      socket.on('connect', () => {
        socket.emit('register', config.myName);
      });
      socket.on('availability-update', (data: AvailabilityMsg) => {
        setAvailabilityMsg(data);
      });
    }

    return () => {
      if (socketInstance) {
        socketInstance.disconnect();
        socketInstance = null;
        socketConnectedRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.myName]);

  const handleSaveSetup = () => {
    const trimmed: Config = {
      myName: myName.trim(),
      friendName: friendName.trim(),
      friendPhone: friendPhone.trim(),
      meetLink: meetLink.trim(),
    };
    if (!trimmed.myName || !trimmed.friendName || !trimmed.friendPhone || !trimmed.meetLink) return;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(trimmed));
    setConfig(trimmed);
    setShowSetup(false);
  };

  const handleResetSetup = () => {
    if (socketInstance) {
      socketInstance.disconnect();
      socketInstance = null;
      socketConnectedRef.current = false;
    }
    localStorage.removeItem(CONFIG_KEY);
    setConfig(null);
    setShowSetup(true);
    setInviteSent(false);
    setAvailabilityMsg(null);
    setMyName('');
    setFriendName('');
    setFriendPhone('');
    setMeetLink('');
  };

  const handleStartStudying = () => {
    if (!config) return;
    const sessionId = uuidv4();
    const origin = window.location.origin;
    const declineUrl = `${origin}/decline/${sessionId}?for=${encodeURIComponent(config.myName)}&from=${encodeURIComponent(config.friendName)}`;
    const waText = `📚 *${config.myName}* şu an ders çalışıyor!\n\nKatılmak ister misin?\n\n✅ *Müsaitim* → ${config.meetLink}\n\n❌ *Müsait değilim* → ${declineUrl}`;
    window.open(`https://wa.me/${config.friendPhone}?text=${encodeURIComponent(waText)}`, '_blank');
    window.open(config.meetLink, '_blank');
    setInviteSent(true);
  };

  const handleDismissAvailability = () => {
    if (!config) return;
    setAvailabilityMsg(null);
    fetch(`/api/messages?name=${encodeURIComponent(config.myName)}`, { method: 'DELETE' }).catch(() => {});
  };

  // ── SETUP FORM ──────────────────────────────────────────────────────────────
  if (!config || showSetup) {
    const isValid = myName.trim() && friendName.trim() && friendPhone.trim() && meetLink.trim();
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#0f0818]">
        {/* Blobs */}
        <div className="fixed top-0 left-0 w-[500px] h-[500px] bg-pink-500/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2 pointer-events-none" />

        <div className="w-full max-w-sm relative">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-pink-500 to-purple-600 mb-5 shadow-2xl shadow-pink-500/40">
              <span className="text-4xl">📚</span>
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-pink-300 via-fuchsia-300 to-purple-300 bg-clip-text text-transparent">
              StudyMed
            </h1>
            <p className="text-white/50 mt-2 text-sm">İki arkadaş, bir tık, ders başlıyor</p>
          </div>

          {/* Card */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-7 shadow-2xl space-y-4">
            {/* Adın */}
            <div>
              <label className="block text-white/60 text-xs font-medium mb-1.5 uppercase tracking-wider">Adın</label>
              <input
                type="text"
                value={myName}
                onChange={e => setMyName(e.target.value)}
                placeholder="Şimal"
                className="w-full px-4 py-3.5 bg-white/8 border border-white/15 rounded-2xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all"
              />
            </div>

            {/* Arkadaşının adı */}
            <div>
              <label className="block text-white/60 text-xs font-medium mb-1.5 uppercase tracking-wider">Arkadaşının adı</label>
              <input
                type="text"
                value={friendName}
                onChange={e => setFriendName(e.target.value)}
                placeholder="Süeda"
                className="w-full px-4 py-3.5 bg-white/8 border border-white/15 rounded-2xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all"
              />
            </div>

            {/* WhatsApp */}
            <div>
              <label className="block text-white/60 text-xs font-medium mb-1.5 uppercase tracking-wider">Arkadaşının WhatsApp numarası</label>
              <input
                type="tel"
                value={friendPhone}
                onChange={e => setFriendPhone(e.target.value)}
                placeholder="905551234567 — başında 0 olmadan"
                className="w-full px-4 py-3.5 bg-white/8 border border-white/15 rounded-2xl text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all text-sm"
              />
            </div>

            {/* Meet link */}
            <div>
              <label className="block text-white/60 text-xs font-medium mb-1.5 uppercase tracking-wider">Ortak Google Meet linkiniz</label>
              <input
                type="url"
                value={meetLink}
                onChange={e => setMeetLink(e.target.value)}
                placeholder="https://meet.google.com/xxx-xxx-xxx"
                className="w-full px-4 py-3.5 bg-white/8 border border-white/15 rounded-2xl text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all text-sm"
              />
              <p className="text-white/30 text-xs mt-1.5">
                meet.google.com&apos;da &apos;Yeni Toplantı&apos; oluştur ve linki kopyala
              </p>
            </div>

            {/* Submit */}
            <button
              onClick={handleSaveSetup}
              disabled={!isValid}
              className="w-full py-3.5 rounded-2xl font-semibold text-white bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-pink-500/25 transition-all duration-200 mt-2"
            >
              Başla →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── DASHBOARD ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[#0f0818] relative">
      {/* Blobs */}
      <div className="fixed top-0 right-0 w-[450px] h-[450px] bg-pink-500/8 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 left-0 w-[450px] h-[450px] bg-purple-500/8 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm relative flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center shadow-lg shadow-pink-500/30">
              <span className="text-sm">📚</span>
            </div>
            <span className="text-white/80 font-medium">Merhaba {config.myName}! 👋</span>
          </div>
          <button
            onClick={handleResetSetup}
            title="Ayarlar"
            className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/10 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        {/* Availability notification */}
        {availabilityMsg && (
          <div className="bg-white/5 backdrop-blur-xl border border-pink-500/30 rounded-3xl p-5 flex items-start gap-4">
            <span className="text-3xl flex-shrink-0">💌</span>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold">
                {availabilityMsg.from} {availabilityMsg.time} müsait olacak!
              </p>
              <p className="text-white/40 text-xs mt-0.5">Sana bildirdi</p>
            </div>
            <button
              onClick={handleDismissAvailability}
              className="flex-shrink-0 w-8 h-8 rounded-xl bg-pink-500/20 border border-pink-500/30 text-pink-300 hover:bg-pink-500/30 flex items-center justify-center transition-all text-sm font-bold"
              title="Tamam"
            >
              ✓
            </button>
          </div>
        )}

        {/* Main card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 flex flex-col items-center gap-6">
          {!inviteSent ? (
            <>
              {/* Big glowing button */}
              <button
                onClick={handleStartStudying}
                className="w-full py-6 rounded-2xl font-bold text-xl text-white bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 transition-all duration-200 glow-button"
              >
                📚 Ders Çalışmaya Başla
              </button>

              <p className="text-white/35 text-sm text-center leading-relaxed">
                {config.friendName}&apos;e WhatsApp daveti gönderilir + Meet otomatik açılır
              </p>
            </>
          ) : (
            <>
              {/* Confirmation */}
              <div className="text-center space-y-3">
                <div className="text-5xl">✨</div>
                <h2 className="text-white font-bold text-xl">{config.friendName}&apos;e davet gönderildi!</h2>
                <p className="text-white/45 text-sm leading-relaxed">
                  {config.friendName} &apos;Müsaitim&apos; derse Meet otomatik açılacak.
                </p>
              </div>
              <button
                onClick={() => setInviteSent(false)}
                className="w-full py-3.5 rounded-2xl font-semibold text-white bg-white/8 border border-white/15 hover:bg-white/12 transition-all text-sm"
              >
                Yeni Davet Gönder
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
