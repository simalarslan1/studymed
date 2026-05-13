'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import io, { Socket } from 'socket.io-client';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

type ConnectionStatus = 'waiting' | 'connecting' | 'connected' | 'peer-left';

export default function RoomPage() {
  const router = useRouter();
  const params = useParams();
  const roomId = params.id as string;

  const [userName, setUserName] = useState('');
  const [peerName, setPeerName] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('waiting');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [studyTime, setStudyTime] = useState(0);
  const [roomUrl, setRoomUrl] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const createPeerConnection = useCallback(
    (targetSocketId: string, socket: Socket): RTCPeerConnection => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnectionRef.current = pc;

      // Add local tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // ICE candidate handler
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('signal', {
            to: targetSocketId,
            data: { ice: event.candidate },
          });
        }
      };

      // Remote track handler
      pc.ontrack = (event) => {
        console.log('Got remote track:', event.streams);
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          remoteVideoRef.current.play().catch(console.error);
          setConnectionStatus('connected');
        }
      };

      pc.onconnectionstatechange = () => {
        console.log('PC state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
          setConnectionStatus('connected');
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setConnectionStatus('peer-left');
        }
      };

      return pc;
    },
    []
  );

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.emit('leave-room');
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    setRoomUrl(window.location.href);

    const storedName = localStorage.getItem('studymed-username');
    const name = storedName || 'Misafir';
    setUserName(name);

    let socket: Socket;
    let pc: RTCPeerConnection | null = null;

    const init = async () => {
      // Get user media
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });

        localStreamRef.current = stream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(console.error);
        }
      } catch (err) {
        console.error('Media error:', err);
        setMediaError('Kamera veya mikrofon erişimi reddedildi. Lütfen izin verin ve sayfayı yenileyin.');
      }

      // Connect socket
      socket = io({ path: '/socket.io' });
      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('Room socket connected:', socket.id);
        socket.emit('register', name);
        socket.emit('join-room', { roomId, name });
      });

      // We are the guest (joining an existing room)
      socket.on('room-info', ({ members }: { members: { socketId: string; name: string }[] }) => {
        console.log('Room info, existing members:', members);
        if (members.length > 0) {
          setConnectionStatus('connecting');
          // The host will send us an offer when they get 'peer-joined'
          // We just wait here
        }
      });

      // We are the host (someone joined our room)
      socket.on('peer-joined', async ({ socketId, name: peerJoinedName }: { socketId: string; name: string }) => {
        console.log('Peer joined:', peerJoinedName, socketId);
        setPeerName(peerJoinedName);
        setConnectionStatus('connecting');

        // Create offer as host
        pc = createPeerConnection(socketId, socket);

        try {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          });
          await pc.setLocalDescription(offer);
          socket.emit('signal', { to: socketId, data: { sdp: offer } });
          console.log('Sent offer to', socketId);
        } catch (err) {
          console.error('Error creating offer:', err);
        }
      });

      // Signaling handler
      socket.on('signal', async ({ from, data }: { from: string; data: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit } }) => {
        console.log('Signal received from:', from, Object.keys(data));

        if (data.sdp) {
          if (data.sdp.type === 'offer') {
            // We are the guest - respond with answer
            console.log('Received offer, creating answer...');
            pc = createPeerConnection(from, socket);

            try {
              await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              socket.emit('signal', { to: from, data: { sdp: answer } });
              console.log('Sent answer to', from);
            } catch (err) {
              console.error('Error creating answer:', err);
            }
          } else if (data.sdp.type === 'answer') {
            // We are the host - set remote description
            console.log('Received answer');
            if (peerConnectionRef.current) {
              try {
                await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
              } catch (err) {
                console.error('Error setting remote description:', err);
              }
            }
          }
        } else if (data.ice) {
          // Add ICE candidate
          const target = peerConnectionRef.current || pc;
          if (target) {
            try {
              await target.addIceCandidate(new RTCIceCandidate(data.ice));
            } catch (err) {
              console.error('Error adding ICE candidate:', err);
            }
          }
        }
      });

      socket.on('peer-left', ({ name: leftName }: { name: string }) => {
        console.log('Peer left:', leftName);
        setPeerName(leftName || 'Arkadaşın');
        setConnectionStatus('peer-left');

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }

        if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
          peerConnectionRef.current = null;
        }
      });
    };

    init();

    return () => {
      cleanup();
    };
  }, [roomId, createPeerConnection, cleanup]);

  // Study timer
  useEffect(() => {
    if (connectionStatus === 'connected') {
      timerRef.current = setInterval(() => {
        setStudyTime((t) => t + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [connectionStatus]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOff(!videoTrack.enabled);
      }
    }
  };

  const handleLeave = () => {
    cleanup();
    router.push('/');
  };

  const handleWhatsAppShare = () => {
    const text = encodeURIComponent(`📚 StudyMed'de birlikte ders çalışalım! ${roomUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(roomUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900/80 backdrop-blur border-b border-white/10 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-teal-500 flex items-center justify-center">
            <span className="text-sm">📚</span>
          </div>
          <span className="font-bold text-white">StudyMed</span>
          {connectionStatus === 'connected' && (
            <div className="flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/30 rounded-full px-3 py-1">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-300 text-sm font-mono">{formatTime(studyTime)}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Connection status badge */}
          <div
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
              connectionStatus === 'connected'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : connectionStatus === 'connecting'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : connectionStatus === 'peer-left'
                ? 'bg-red-500/10 border-red-500/30 text-red-300'
                : 'bg-slate-500/10 border-slate-500/30 text-slate-400'
            }`}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-400 animate-pulse'
                  : connectionStatus === 'connecting'
                  ? 'bg-amber-400 animate-pulse'
                  : connectionStatus === 'peer-left'
                  ? 'bg-red-400'
                  : 'bg-slate-500'
              }`}
            />
            {connectionStatus === 'connected'
              ? 'Bağlandı'
              : connectionStatus === 'connecting'
              ? 'Bağlanıyor...'
              : connectionStatus === 'peer-left'
              ? 'Ayrıldı'
              : 'Bekleniyor'}
          </div>

          {/* Share buttons */}
          <button
            onClick={handleCopyLink}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs transition-all"
          >
            {linkCopied ? '✅' : '🔗'} {linkCopied ? 'Kopyalandı' : 'Link'}
          </button>
          <button
            onClick={handleWhatsAppShare}
            className="px-3 py-1.5 rounded-lg bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 text-green-300 text-xs transition-all"
          >
            💬 WhatsApp
          </button>
        </div>
      </header>

      {/* Video Area */}
      <div className="flex-1 relative bg-slate-950 overflow-hidden">
        {mediaError ? (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 max-w-md text-center">
              <div className="text-5xl mb-4">🎥</div>
              <h3 className="text-red-300 font-semibold text-lg mb-2">Kamera Erişimi Gerekli</h3>
              <p className="text-slate-400 text-sm">{mediaError}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 px-6 py-2 bg-red-500/20 border border-red-500/30 rounded-xl text-red-300 hover:bg-red-500/30 transition-all"
              >
                Sayfayı Yenile
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Remote video (main, full screen) */}
            <div className="absolute inset-0">
              {connectionStatus === 'waiting' || connectionStatus === 'connecting' ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="relative">
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500/20 to-teal-500/20 border-2 border-indigo-400/30 flex items-center justify-center">
                      <span className="text-5xl">
                        {connectionStatus === 'connecting' ? '🔗' : '🕐'}
                      </span>
                    </div>
                    {(connectionStatus === 'waiting' || connectionStatus === 'connecting') && (
                      <div className="absolute -inset-4 rounded-full border-2 border-indigo-400/20 animate-ping" />
                    )}
                  </div>
                  <p className="mt-6 text-white text-xl font-medium">
                    {connectionStatus === 'connecting' ? 'Bağlanıyor...' : 'Arkadaşın bekleniyor... 🕐'}
                  </p>
                  <p className="mt-2 text-slate-400 text-sm">
                    {connectionStatus === 'connecting'
                      ? 'WebRTC bağlantısı kuruluyor'
                      : 'Oda linkini arkadaşınla paylaş'}
                  </p>
                  {connectionStatus === 'waiting' && (
                    <div className="mt-6 flex gap-3">
                      <button
                        onClick={handleCopyLink}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-sm text-slate-300 transition-all"
                      >
                        {linkCopied ? '✅ Kopyalandı!' : '📋 Link Kopyala'}
                      </button>
                      <button
                        onClick={handleWhatsAppShare}
                        className="px-4 py-2 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 rounded-xl text-sm text-green-300 transition-all"
                      >
                        💬 WhatsApp'ta Paylaş
                      </button>
                    </div>
                  )}
                </div>
              ) : connectionStatus === 'peer-left' ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-6xl mb-4">😔</div>
                  <h3 className="text-white text-xl font-semibold">
                    {peerName || 'Arkadaşın'} ayrıldı
                  </h3>
                  <p className="text-slate-400 mt-2">Görüntülü görüşme sona erdi</p>
                  <p className="text-slate-500 text-sm mt-1">
                    Toplam ders süresi: {formatTime(studyTime)}
                  </p>
                  <button
                    onClick={handleLeave}
                    className="mt-6 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-medium transition-all"
                  >
                    Ana Sayfaya Dön
                  </button>
                </div>
              ) : null}

              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className={`w-full h-full object-cover ${connectionStatus !== 'connected' ? 'hidden' : ''}`}
              />

              {connectionStatus === 'connected' && peerName && (
                <div className="absolute bottom-24 left-4 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-white text-sm font-medium">{peerName}</span>
                </div>
              )}
            </div>

            {/* Local video (picture-in-picture) */}
            <div className="absolute bottom-20 right-4 w-32 h-24 sm:w-44 sm:h-32 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl bg-slate-800">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${isCameraOff ? 'opacity-0' : ''}`}
              />
              {isCameraOff && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
                  <span className="text-2xl">📷</span>
                </div>
              )}
              <div className="absolute bottom-1 left-2 text-white text-xs font-medium drop-shadow">
                {userName}
                {isMuted && ' 🔇'}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Controls */}
      <div className="bg-slate-900/90 backdrop-blur border-t border-white/10 px-4 py-4">
        <div className="flex items-center justify-center gap-3 max-w-md mx-auto">
          {/* Mute */}
          <button
            onClick={toggleMute}
            title={isMuted ? 'Sesi Aç' : 'Sesi Kapat'}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
              isMuted
                ? 'bg-red-500/20 border-2 border-red-500 text-red-400 hover:bg-red-500/30'
                : 'bg-white/10 border border-white/20 text-slate-300 hover:bg-white/20'
            }`}
          >
            {isMuted ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>

          {/* Camera */}
          <button
            onClick={toggleCamera}
            title={isCameraOff ? 'Kamerayı Aç' : 'Kamerayı Kapat'}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
              isCameraOff
                ? 'bg-red-500/20 border-2 border-red-500 text-red-400 hover:bg-red-500/30'
                : 'bg-white/10 border border-white/20 text-slate-300 hover:bg-white/20'
            }`}
          >
            {isCameraOff ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            )}
          </button>

          {/* Leave */}
          <button
            onClick={handleLeave}
            title="Odadan Ayrıl"
            className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-500/30 transition-all"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
          </button>

          {/* Share buttons (mobile-friendly compact) */}
          <button
            onClick={handleCopyLink}
            title="Link Kopyala"
            className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-slate-300 transition-all"
          >
            {linkCopied ? (
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </button>

          {/* WhatsApp */}
          <button
            onClick={handleWhatsAppShare}
            title="WhatsApp'ta Paylaş"
            className="w-12 h-12 rounded-full bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 flex items-center justify-center text-green-400 transition-all"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </button>
        </div>

        <div className="text-center mt-2">
          <p className="text-slate-600 text-xs">
            Oda: {roomId.slice(0, 8)}...
          </p>
        </div>
      </div>
    </div>
  );
}
