'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import io, { Socket } from 'socket.io-client';

interface User {
  name: string;
  online: boolean;
}

interface ActiveInvite {
  fromName: string;
  roomId: string;
}

async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    const padding = '='.repeat((4 - (vapidPublicKey.length % 4)) % 4);
    const base64 = (vapidPublicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const keyData = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) keyData[i] = rawData.charCodeAt(i);
    const keyBuffer = keyData.buffer.slice(keyData.byteOffset, keyData.byteOffset + keyData.byteLength);
    return await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBuffer });
  } catch {
    return null;
  }
}

let socketInstance: Socket | null = null;

export default function HomePage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [activeInvite, setActiveInvite] = useState<ActiveInvite | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [invitedFriend, setInvitedFriend] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedRoomLink, setGeneratedRoomLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      setUsers(await res.json());
    } catch {}
  }, []);

  const initSocket = useCallback((name: string) => {
    if (socketInstance?.connected) {
      socketInstance.emit('register', name);
      return;
    }
    const socket = io({ path: '/socket.io' });
    socketInstance = socket;
    socket.on('connect', () => socket.emit('register', name));
    socket.on('invite', (data: ActiveInvite) => setActiveInvite(data));
    socket.on('users-update', (updatedUsers: User[]) => setUsers(updatedUsers));
  }, []);

  useEffect(() => {
    const storedName = localStorage.getItem('studymed-username');
    if (storedName) {
      setUserName(storedName);
      setIsRegistered(true);
      initSocket(storedName);
      fetchUsers();
    }
  }, [initSocket, fetchUsers]);

  useEffect(() => {
    if (!isRegistered) return;
    fetchUsers();
    const interval = setInterval(fetchUsers, 10000);
    return () => clearInterval(interval);
  }, [isRegistered, fetchUsers]);

  const handleRegister = async () => {
    const name = nameInput.trim();
    if (!name) return;
    setIsLoading(true);
    setError(null);
    try {
      let subscription: PushSubscription | null = null;
      if ('Notification' in window) {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          const vapidRes = await fetch('/api/vapid-key');
          const { publicKey } = await vapidRes.json();
          subscription = await subscribeToPush(publicKey);
        }
      }
      await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, subscription: subscription ? JSON.parse(JSON.stringify(subscription)) : null }),
      });
      localStorage.setItem('studymed-username', name);
      setUserName(name);
      setIsRegistered(true);
      initSocket(name);
      await fetchUsers();
    } catch {
      setError('Bir hata oluştu, tekrar dene.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInvite = async (friendName: string) => {
    const roomId = uuidv4();
    setInvitedFriend(friendName);
    try {
      await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromName: userName, toName: friendName, roomId }),
      });
    } catch {}
    router.push(`/room/${roomId}`);
  };

  const handleCreateRoom = () => {
    const roomId = uuidv4();
    setGeneratedRoomLink(`${window.location.origin}/room/${roomId}`);
  };

  const handleCopyLink = () => {
    if (generatedRoomLink) {
      navigator.clipboard.writeText(generatedRoomLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const onlineUsers = users.filter(u => u.online && u.name !== userName);
  const offlineUsers = users.filter(u => !u.online && u.name !== userName);

  if (!isRegistered) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        {/* Decorative blobs */}
        <div className="fixed top-0 left-0 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <div className="fixed bottom-0 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2 pointer-events-none" />

        <div className="w-full max-w-sm relative">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-pink-500 to-purple-600 mb-5 shadow-2xl shadow-pink-500/40">
              <span className="text-4xl">📚</span>
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-pink-300 via-fuchsia-300 to-purple-300 bg-clip-text text-transparent">
              StudyMed
            </h1>
            <p className="text-white/50 mt-2">Birlikte daha kolay öğren</p>
          </div>

          <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl p-7 shadow-2xl">
            <p className="text-white/70 text-sm mb-5">Adını gir ve hemen başla ✨</p>

            <input
              type="text"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRegister()}
              placeholder="Adın..."
              className="w-full px-4 py-3.5 bg-white/8 border border-white/15 rounded-2xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all mb-4"
            />

            {error && (
              <p className="text-rose-400 text-sm mb-3 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-2">
                {error}
              </p>
            )}

            <button
              onClick={handleRegister}
              disabled={isLoading || !nameInput.trim()}
              className="w-full py-3.5 rounded-2xl font-semibold text-white bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-pink-500/25 transition-all duration-200 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : '✨'} {isLoading ? 'Yükleniyor...' : 'Başla'}
            </button>

            <p className="text-center text-white/25 text-xs mt-4">
              Bildirim iznine izin vererek davet alabilirsin
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6">
      {/* Decorative blobs */}
      <div className="fixed top-0 right-0 w-80 h-80 bg-pink-500/8 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 left-0 w-80 h-80 bg-purple-500/8 rounded-full blur-3xl pointer-events-none" />

      {/* Invite modal */}
      {activeInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="bg-gradient-to-br from-[#2a0a3e] to-[#1a0a2e] border border-pink-500/20 rounded-3xl p-8 shadow-2xl max-w-sm w-full">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600 mb-4 shadow-lg shadow-pink-500/30 animate-bounce">
                <span className="text-3xl">📚</span>
              </div>
              <h2 className="text-2xl font-bold text-white mb-1">{activeInvite.fromName}</h2>
              <p className="text-pink-300 mb-7">seni ders çalışmaya davet ediyor!</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setActiveInvite(null)}
                  className="flex-1 py-3 rounded-2xl bg-white/8 border border-white/10 text-white/60 hover:bg-white/12 transition-all font-medium"
                >
                  Şimdi Değil
                </button>
                <button
                  onClick={() => { setActiveInvite(null); router.push(`/room/${activeInvite.roomId}`); }}
                  className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-semibold shadow-lg shadow-pink-500/25 transition-all"
                >
                  Katıl 🎓
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-7">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center shadow-lg shadow-pink-500/30">
              <span className="text-lg">📚</span>
            </div>
            <span className="font-bold text-lg bg-gradient-to-r from-pink-300 to-purple-300 bg-clip-text text-transparent">StudyMed</span>
          </div>
          <button
            onClick={() => { localStorage.removeItem('studymed-username'); socketInstance?.disconnect(); socketInstance = null; setIsRegistered(false); setUserName(''); }}
            className="text-white/30 hover:text-white/60 text-sm px-3 py-1.5 rounded-xl hover:bg-white/5 transition-all"
          >
            Çıkış
          </button>
        </div>

        {/* Greeting */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white">Merhaba, {userName}! 👋</h2>
          <p className="text-white/40 mt-1 text-sm">Bugün birlikte ders çalışmaya hazır mısın?</p>
        </div>

        {/* Friends list */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/8 rounded-3xl p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Ders Arkadaşları</h3>
            <span className="text-white/30 text-xs">{users.filter(u => u.name !== userName).length} kişi</span>
          </div>

          {users.filter(u => u.name !== userName).length === 0 ? (
            <div className="text-center py-10">
              <div className="text-5xl mb-3">🏥</div>
              <p className="text-white/40 text-sm">Henüz başka kullanıcı yok</p>
              <p className="text-white/20 text-xs mt-1">Arkadaşına bu uygulamayı gönder!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {onlineUsers.length > 0 && (
                <div>
                  <p className="text-xs text-white/25 uppercase tracking-widest mb-3">Çevrimiçi</p>
                  <div className="space-y-2">
                    {onlineUsers.map(user => (
                      <button
                        key={user.name}
                        onClick={() => handleInvite(user.name)}
                        disabled={invitedFriend === user.name}
                        className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-pink-500/10 to-purple-500/10 border border-pink-500/20 hover:border-pink-400/40 hover:from-pink-500/15 hover:to-purple-500/15 transition-all group disabled:opacity-60"
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500/30 to-purple-500/30 border border-pink-400/20 flex items-center justify-center font-bold text-white">
                              {user.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#1a0a2e] animate-pulse" />
                          </div>
                          <div className="text-left">
                            <p className="font-semibold text-white text-sm">{user.name}</p>
                            <p className="text-xs text-emerald-400">Çevrimiçi · tıkla, başla</p>
                          </div>
                        </div>
                        <span className="text-pink-300 text-sm font-medium group-hover:text-white transition-colors">
                          {invitedFriend === user.name ? (
                            <span className="flex items-center gap-1 text-xs">
                              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Gönderildi
                            </span>
                          ) : 'Davet Et →'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {offlineUsers.length > 0 && (
                <div className={onlineUsers.length > 0 ? 'mt-4' : ''}>
                  {onlineUsers.length > 0 && <div className="border-t border-white/5 mb-3" />}
                  <p className="text-xs text-white/25 uppercase tracking-widest mb-3">Çevrimdışı</p>
                  {offlineUsers.map(user => (
                    <div key={user.name} className="flex items-center gap-3 p-3 rounded-2xl opacity-40">
                      <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center font-bold text-white/50 text-sm">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-white/60 text-sm font-medium">{user.name}</p>
                        <p className="text-xs text-white/25">Çevrimdışı</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Create room */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/8 rounded-3xl p-5">
          <h3 className="font-semibold text-white mb-1 text-sm">Link ile Davet Et</h3>
          <p className="text-white/30 text-xs mb-4">Oda oluştur, linkini WhatsApp'tan gönder</p>
          <button
            onClick={handleCreateRoom}
            className="w-full py-3 rounded-2xl bg-white/8 border border-white/10 hover:bg-white/12 text-white/70 hover:text-white text-sm font-medium transition-all"
          >
            🔗 Oda Linki Oluştur
          </button>

          {generatedRoomLink && (
            <div className="mt-3 space-y-2">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-white/70 text-xs font-mono break-all">{generatedRoomLink}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleCopyLink} className="flex-1 py-2.5 rounded-xl bg-white/8 border border-white/10 text-white/60 hover:text-white text-xs font-medium transition-all">
                  {linkCopied ? '✅ Kopyalandı' : '📋 Kopyala'}
                </button>
                <button
                  onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`📚 StudyMed'de ders çalışalım! ${generatedRoomLink}`)}`, '_blank')}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20 text-xs font-medium transition-all"
                >
                  💬 WhatsApp
                </button>
                <button
                  onClick={() => router.push(generatedRoomLink.replace(window.location.origin, ''))}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-pink-600/30 to-purple-600/30 border border-pink-500/20 text-pink-300 hover:from-pink-600/40 hover:to-purple-600/40 text-xs font-medium transition-all"
                >
                  🚀 Katıl
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="bg-white/5 border border-white/8 rounded-2xl p-4 text-center">
            <div className="text-2xl mb-1">🟢</div>
            <div className="text-xl font-bold text-white">{users.filter(u => u.online).length}</div>
            <div className="text-white/30 text-xs">Çevrimiçi</div>
          </div>
          <div className="bg-white/5 border border-white/8 rounded-2xl p-4 text-center">
            <div className="text-2xl mb-1">👥</div>
            <div className="text-xl font-bold text-white">{users.length}</div>
            <div className="text-white/30 text-xs">Kayıtlı</div>
          </div>
        </div>
      </div>
    </div>
  );
}
