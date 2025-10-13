'use client';
import { useRef, useState } from 'react';
import Image from 'next/image';

type ChatMessage = {
  role: 'user' | 'model';
  content: string;
  imageUrl?: string;
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function onSend() {
    if (!input && !file) return;
    if (file) {
      const maxBytes = 6 * 1024 * 1024;
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.type)) {
        setMessages((m) => [
          ...m,
          {
            role: 'model',
            content: '이미지 형식은 JPEG/PNG/WebP만 지원합니다.',
          },
        ]);
        return;
      }
      if (file.size > maxBytes) {
        setMessages((m) => [
          ...m,
          { role: 'model', content: '이미지 용량이 너무 큽니다. 최대 6MB.' },
        ]);
        return;
      }
    }
    setLoading(true);
    const imageBase64 = file ? await toBase64(file) : undefined;
    const imageMimeType = file?.type;

    const userMsg: ChatMessage = {
      role: 'user',
      content: input,
      imageUrl: imageBase64 ? URL.createObjectURL(file as File) : undefined,
    };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: userMsg.content,
            imageBase64: imageBase64?.split(',')[1],
            imageMimeType,
          },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessages((m) => [
        ...m,
        { role: 'model', content: data.error || '오류가 발생했어요.' },
      ]);
    } else {
      setMessages((m) => [...m, { role: 'model', content: data.reply }]);
    }
    setLoading(false);
  }

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      {/* ✅ 여기가 기존 <h1> 자리에 들어갈 부분 */}
      <div className="flex justify-center mb-4">
        <Image
          src="/logo_big.png" // public/logo.png 경로
          alt="AI 한글 암호 전쟁 로고"
          width={360} // 로고 크기 (가로 px)
          height={120} // 로고 크기 (세로 px)
          className="object-contain"
          priority
        />
      </div>

      {/* 트레일러 영상 섹션 */}
      <section className="text-center">
        <h2
          className="text-xl font-semibold mb-4 text-left"
          style={{ color: '#024a9b', marginTop: '2rem' }} // 색상 + 간격 조정
        >
          트레일러 영상
        </h2>
        <div className="mb-16">
          {' '}
          {/* 여기서 간격 조절 */}
          <div className="aspect-video w-full rounded-lg overflow-hidden border border-gray-200 shadow-sm">
            <video
              src="/trailer.mp4" // 🎥 public/trailer.mp4 파일 경로
              controls
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>

      <div className="space-y-3 sm:space-y-4">
        {/* 채팅 영역 */}
        <div className="border rounded-lg p-3 sm:p-4 min-h-[50vh] max-h-[70vh] overflow-y-auto bg-white">
          {messages.length === 0 && (
            <p className="text-gray-500 text-sm sm:text-base text-center">
              제작한 한글 암호 사진을 업로드해서 AI 해독을 시도해보세요.
            </p>
          )}
          <div className="space-y-3">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={m.role === 'user' ? 'text-right' : 'text-left'}
              >
                <div
                  className={
                    'inline-block rounded-xl px-3 py-2 sm:px-4 sm:py-2.5 ' +
                    (m.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-black')
                  }
                >
                  <p className="whitespace-pre-wrap text-sm sm:text-base">
                    {m.content}
                  </p>
                  {m.imageUrl && (
                    <img
                      src={m.imageUrl}
                      alt="uploaded"
                      className="mt-2 max-h-40 sm:max-h-48 rounded-md inline-block"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 입력 영역 */}
        <div className="flex items-center gap-2 w-full">
          {/* 파일 선택 버튼 */}
          <label className="flex items-center justify-center bg-gray-100 border border-gray-300 rounded-lg px-3 py-2 text-sm cursor-pointer whitespace-nowrap flex-shrink-0 hover:bg-gray-200 transition">
            📎
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="hidden"
            />
          </label>

          {/* 텍스트 입력창 */}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSend();
            }}
            placeholder="암호를 입력하세요"
            className="flex-1 border rounded-lg px-3 py-2 text-sm sm:text-base min-w-0"
          />

          {/* 전송 버튼 */}
          <button
            onClick={onSend}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg whitespace-nowrap flex-shrink-0 hover:bg-blue-700 disabled:opacity-60 text-sm sm:text-base transition"
          >
            {loading ? '전송 중...' : '전송'}
          </button>
        </div>
      </div>
    </main>
  );
}

async function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = (error) => reject(error);
  });
}
