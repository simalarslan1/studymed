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
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications not supported');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    // Convert base64url to Uint8Array manually to satisfy TypeScript
    const padding = '='.repeat((4 - (vapidPublicKey.length % 4)) % 4);
    const base64 = (vapidPublicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const keyData = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      keyData[i] = rawData.charCodeAt(i);
    }
    // Use the raw ArrayBuffer directly (avoids SharedArrayBuffer type mismatch)
    const keyBuffer = keyData.buffer.slice(keyData.byteOffset, keyData.byteOffset + keyData.byteLength);
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBuffer,
    });
    return subscription;
  } catch (err) {
    console.error('Push subscription failed:', err);
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
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');
  const [isLoading, setIsLoading] = useState(false);
  const [invitedFriend, setInvitedFriend] = useState<string | null>(null);
  const [roomLinkCopied, setRoomLinkCopied] = useState(false);
  const [generatedRoomLink, setGeneratedRoomLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  }, []);

  const initSocket = useCallback((name: string) => {
    if (socketInstance?.connected) {
      socketInstance.emit('register', name);
      return;
    }

    const socket = io({ path: '/socket.io' });
    socketInstance = socket;

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      socket.emit('register', name);
    });

    socket.on('invite', (data: ActiveInvite) => {
      console.log('Received invite:', data);
      setActiveInvite(data);
    });

    socket.on('users-update', (updatedUsers: User[]) => {
      setUsers(updatedUsers);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });
  }, []);

  useEffect(() => {
    const storedName = localStorage.getItem('studymed-username');
    if (storedName) {
      setUserName(storedName);
      setIsRegistered(true);
      initSocket(storedName);
      fetchUsers();
    }

    if ('Notification' in window) {
      setNotifPermission(Notification.permission);
    }

    return () => {
      // Don't disconnect on unmount — needed for invite notifications
    };
  }, [initSocket, fetchUsers]);

  useEffect(() => {
    if (!isRegistered) return;
    fetchUsers();
    const interval = setInterval(fetchUsers, 10000);
    return () => clearInterval(interval);
  }, [isRegistered, fetchUsers]);

  const handleRegister = async () => {
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setError('Lütfen adınızı girin.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Request notification permission
      let permission: NotificationPermission = 'default';
      if ('Notification' in window) {
        permission = await Notification.requestPermission();
        setNotifPermission(permission);
      }

      // Get VAPID public key
      let subscription: PushSubscription | null = null;
      try {
        const vapidRes = await fetch('/api/vapid-key');
        const { publicKey } = await vapidRes.json();
        if (permission === 'granted' && publicKey) {
          subscription = await subscribeToPush(publicKey);
        }
      } catch (err) {
        console.warn('Could not subscribe to push:', err);
      }

      // Register user
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          subscription: subscription ? JSON.parse(JSON.stringify(subscription)) : null,
        }),
      });

      if (!res.ok) throw new Error('Kayıt başarısız');

      localStorage.setItem('studymed-username', trimmedName);
      setUserName(trimmedName);
      setIsRegistered(true);
      initSocket(trimmedName);
      await fetchUsers();
    } catch (err) {
      setError('Kayıt sırasında bir hata oluştu. Lütfen tekrar deneyin.');
      console.error(err);
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
      router.push(`/room/${roomId}`);
    } catch (err) {
      console.error('Invite failed:', err);
      setInvitedFriend(null);
      router.push(`/room/${roomId}`);
    }
  };

  const handleCreateRoom = () => {
    const roomId = uuidv4();
    const url = `${window.location.origin}/room/${roomId}`;
    setGeneratedRoomLink(url);
  };

  const handleCopyLink = () => {
    if (generatedRoomLink) {
      navigator.clipboard.writeText(generatedRoomLink);
      setRoomLinkCopied(true);
      setTimeout(() => setRoomLinkCopied(false), 2000);
    }
  };

  const handleWhatsAppShare = () => {
    if (generatedRoomLink) {
      const text = encodeURIComponent(`📚 StudyMed'de birlikte ders çalışalım! ${generatedRoomLink}`);
      window.open(`https://wa.me/?text=${text}`, '_blank');
    }
  };

  const handleJoinRoom = (roomId: string) => {
    setActiveInvite(null);
    router.push(`/room/${roomId}`);
  };

  const handleLogout = () => {
    localStorage.removeItem('studymed-username');
    setUserName('');
    setIsRegistered(false);
    setUsers([]);
    if (socketInstance) {
      socketInstance.disconnect();
      socketInstance = null;
    }
  };

  const onlineUsers = users.filter((u) => u.online && u.name !== userName);
  const offlineUsers = users.filter((u) => !u.online && u.name !== userName);

  // Registration screen
  if (!isRegistered) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo / Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-teal-500 mb-4 shadow-lg shadow-indigo-500/30">
              <span className="text-4xl">📚</span>
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-300 to-teal-300 bg-clip-text text-transparent">
              StudyMed
            </h1>
            <p className="text-slate-400 mt-2 text-lg">Ders arkadaşlarınla bağlan</p>
          </div>

          {/* Card */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
            <h2 className="text-xl font-semibold text-white mb-1">Hoş geldin!</h2>
            <p className="text-slate-400 text-sm mb-6">Başlamak için adını gir</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Adın
                </label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                  placeholder="Örn: Şimal"
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-300 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={handleRegister}
                disabled={isLoading || !nameInput.trim()}
                className="w-full py-3 px-6 bg-gradient-to-r from-indigo-600 to-teal-600 hover:from-indigo-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all duration-200 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Kaydediliyor...
                  </>
                ) : (
                  <>
                    <span>🔔</span>
                    Bildirim İzni Ver ve Başla
                  </>
                )}
              </button>
            </div>

            <div className="mt-6 pt-6 border-t border-white/10">
              <div className="flex items-center gap-3 text-slate-400 text-xs">
                <span className="text-lg">🏥</span>
                <p>Tıp öğrencileri için güvenli, gerçek zamanlı video görüşme platformu</p>
              </div>
            </div>
          </div>

          <p className="text-center text-slate-600 text-xs mt-4">
            Bildirimlere izin vererek arkadaşlarından davet alabilirsin
          </p>
        </div>
      </div>
    );
  }

  // Main dashboard
  return (
    <div className="min-h-screen p-4 md:p-8">
      {/* Active Invite Banner */}
      {activeInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gradient-to-br from-indigo-900 to-teal-900 border border-indigo-400/30 rounded-2xl p-8 shadow-2xl max-w-sm w-full">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-500/20 border-2 border-indigo-400 mb-4">
                <span className="text-3xl">📚</span>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">
                {activeInvite.fromName} ders çalışıyor!
              </h2>
              <p className="text-indigo-300 mb-8">
                Seni ders çalışmaya davet ediyor
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setActiveInvite(null)}
                  className="flex-1 py-3 px-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl font-medium text-slate-300 transition-all"
                >
                  Şimdi Değil
                </button>
                <button
                  onClick={() => handleJoinRoom(activeInvite.roomId)}
                  className="flex-1 py-3 px-4 bg-gradient-to-r from-indigo-600 to-teal-600 hover:from-indigo-500 hover:to-teal-500 rounded-xl font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all"
                >
                  Katıl 🎓
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-teal-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <span className="text-xl">📚</span>
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-300 to-teal-300 bg-clip-text text-transparent">
                StudyMed
              </h1>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/10 transition-all"
          >
            Çıkış
          </button>
        </div>

        {/* Greeting */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-white">
            Merhaba, {userName}! 👋
          </h2>
          <p className="text-slate-400 mt-1">Bugün birlikte ders çalışmaya hazır mısın?</p>
          {notifPermission !== 'granted' && (
            <div className="mt-3 inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-300 text-sm">
              <span>⚠️</span>
              Bildirimler kapalı — davetleri kaçırabilirsin
            </div>
          )}
        </div>

        {/* Create Room Card */}
        <div className="bg-gradient-to-br from-indigo-600/20 to-teal-600/20 border border-indigo-500/30 rounded-2xl p-6 mb-6">
          <h3 className="font-semibold text-white text-lg mb-1">Ders Çalışmaya Başla</h3>
          <p className="text-slate-400 text-sm mb-4">Oda oluştur ve link paylaş veya arkadaşını davet et</p>

          <button
            onClick={handleCreateRoom}
            className="w-full py-3 px-6 bg-gradient-to-r from-indigo-600 to-teal-600 hover:from-indigo-500 hover:to-teal-500 rounded-xl font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all duration-200 flex items-center justify-center gap-2"
          >
            <span>🎓</span>
            Oda Linki Oluştur
          </button>

          {generatedRoomLink && (
            <div className="mt-4 space-y-3">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-slate-400 text-xs mb-1">Oda linki:</p>
                <p className="text-white text-sm font-mono break-all">{generatedRoomLink}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCopyLink}
                  className="flex-1 py-2 px-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-sm font-medium text-slate-300 transition-all flex items-center justify-center gap-2"
                >
                  {roomLinkCopied ? '✅ Kopyalandı!' : '📋 Kopyala'}
                </button>
                <button
                  onClick={handleWhatsAppShare}
                  className="flex-1 py-2 px-4 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 rounded-xl text-sm font-medium text-green-300 transition-all flex items-center justify-center gap-2"
                >
                  <span>💬</span> WhatsApp
                </button>
                <button
                  onClick={() => router.push(generatedRoomLink.replace(window.location.origin, ''))}
                  className="flex-1 py-2 px-4 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 rounded-xl text-sm font-medium text-indigo-300 transition-all flex items-center justify-center gap-2"
                >
                  <span>🚀</span> Katıl
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Friends List */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white text-lg">Ders Arkadaşları</h3>
            <span className="text-slate-400 text-sm">{users.filter((u) => u.name !== userName).length} kişi</span>
          </div>

          {users.filter((u) => u.name !== userName).length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">🏥</div>
              <p className="text-slate-400">Henüz kayıtlı arkadaş yok</p>
              <p className="text-slate-500 text-sm mt-1">Arkadaşına bu uygulamayı gönder!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Online users first */}
              {onlineUsers.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Çevrimiçi ({onlineUsers.length})</p>
                  <div className="space-y-2">
                    {onlineUsers.map((user) => (
                      <button
                        key={user.name}
                        onClick={() => handleInvite(user.name)}
                        disabled={invitedFriend === user.name}
                        className="w-full flex items-center justify-between p-4 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 hover:border-emerald-400/50 transition-all duration-200 group disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-500/40 to-teal-500/40 border border-emerald-400/30 flex items-center justify-center">
                              <span className="text-base font-bold text-white">
                                {user.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-slate-900 animate-pulse" />
                          </div>
                          <div className="text-left">
                            <p className="font-semibold text-white">{user.name}</p>
                            <p className="text-xs text-emerald-400">Çevrimiçi — tıkla, hemen başla</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-emerald-300 group-hover:text-white transition-colors">
                          {invitedFriend === user.name ? (
                            <span className="text-sm flex items-center gap-1">
                              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Davet gönderildi
                            </span>
                          ) : (
                            <span className="text-sm font-medium">Ders Çalış →</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Offline users */}
              {offlineUsers.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Çevrimdışı ({offlineUsers.length})</p>
                  {offlineUsers.map((user) => (
                    <div key={user.name} className="flex items-center gap-3 p-3 rounded-xl opacity-50">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-slate-700 border border-white/10 flex items-center justify-center">
                          <span className="text-sm font-semibold text-slate-400">
                            {user.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-slate-600 border-2 border-slate-900" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-400 text-sm">{user.name}</p>
                        <p className="text-xs text-slate-600">Çevrimdışı</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <StatCard icon="👥" label="Kayıtlı" value={users.length} />
          <StatCard icon="🟢" label="Çevrimiçi" value={users.filter((u) => u.online).length} />
          <StatCard icon="📚" label="Ders Odası" value={0} />
        </div>
      </div>
    </div>
  );
}

function UserRow({
  user,
  isInviting,
  onInvite,
}: {
  user: User;
  isInviting: boolean;
  onInvite: (name: string) => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-all group">
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500/30 to-teal-500/30 border border-white/10 flex items-center justify-center">
            <span className="text-sm font-semibold text-white">
              {user.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${
              user.online ? 'bg-emerald-400' : 'bg-slate-600'
            }`}
          />
        </div>
        <div>
          <p className="font-medium text-white text-sm">{user.name}</p>
          <p className={`text-xs ${user.online ? 'text-emerald-400' : 'text-slate-500'}`}>
            {user.online ? 'Çevrimiçi' : 'Çevrimdışı'}
          </p>
        </div>
      </div>

      <button
        onClick={() => onInvite(user.name)}
        disabled={isInviting}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
          user.online
            ? 'bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/50 text-indigo-300 hover:text-indigo-200'
            : 'bg-white/5 border border-white/10 text-slate-500 cursor-not-allowed'
        } ${isInviting ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isInviting ? (
          <span className="flex items-center gap-1">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Gönderildi
          </span>
        ) : (
          'Davet Et'
        )}
      </button>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-slate-500 text-xs">{label}</div>
    </div>
  );
}
