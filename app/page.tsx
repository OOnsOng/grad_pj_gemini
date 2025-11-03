'use client';
import { useRef, useState, useEffect } from 'react';
// (수정) 'next/image' 임포트 제거
// import Image from 'next/image';

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

  // 채팅창 스크롤 컨테이너 ref
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  // 자동 스크롤용 끝 기준 ref
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // messages 변경 시 자동으로 맨 아래로 스크롤
  useEffect(() => {
    // 우선 시각적으로 부드럽게 이동
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const c = chatContainerRef.current;
    if (c) {
      c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, loading]);

  async function onSend(selectedFile?: File) {
    const activeFile = selectedFile || file;
    if (!input && !activeFile) return;

    if (activeFile) {
      const maxBytes = 6 * 1024 * 1024;
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(activeFile.type)) {
        setMessages((m) => [
          ...m,
          {
            role: 'model',
            content: '이미지 형식은 JPEG/PNG/WebP만 지원합니다.',
          },
        ]);
        return;
      }
      if (activeFile.size > maxBytes) {
        setMessages((m) => [
          ...m,
          { role: 'model', content: '이미지 용량이 너무 큽니다. 최대 6MB.' },
        ]);
        return;
      }
    }

    setLoading(true);
    const imageBase64 = activeFile ? await toBase64(activeFile) : undefined;
    const imageMimeType = activeFile?.type;

    const userMsg: ChatMessage = {
      role: 'user',
      content: input,
      imageUrl: imageBase64
        ? URL.createObjectURL(activeFile as File)
        : undefined,
    };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    try {
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
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'model', content: '서버 통신 중 오류가 발생했습니다.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-col h-screen mx-auto max-w-3xl p-4 sm:p-6 text-[#024a9b] bg-white">
      {/* ✅ 로고 */}
      <div className="flex justify-center mb-4 mt-6 shrink-0">
        {/* (수정) Next.js <Image>를 표준 <img> 태그로 변경 */}
        <img
          src="/logo_big.png"
          alt="AI 한글 암호 전쟁 로고"
          width={360}
          height={120}
          className="object-contain"
        />
      </div>

      {/* ✅ 채팅 영역
          중요: flex 컨테이너에서 자식의 overflow가 동작하려면 부모에 min-h-0 필요 */}
      <div className="flex flex-col flex-grow space-y-3 sm:space-y-4 min-h-0">
        {/* relative 컨테이너 (여기에도 min-h-0) */}
        <div className="relative flex-grow mb-4 sm:mb-5 min-h-0">
          {/* 채팅창 박스: UI 그대로, 내부에서만 스크롤 가능하게 함 */}
          <div
            ref={chatContainerRef}
            className="flex flex-col border-[2px] border-[#024a9b] rounded-lg p-3 sm:p-4 bg-white h-full min-h-0"
          >
            {/* 메시지 리스트 영역 — 이 영역이 실제로 스크롤됨 */}
            <div className="flex-1 overflow-y-auto space-y-3">
              {messages.length === 0 && (
                <div className="text-center mt-8">
                  <p className="text-[#024a9b] text-sm sm:text-base">
                    제작한 한글 암호 사진을 업로드해서
                    <br />
                    AI 해독을 시도해보세요.
                  </p>
                  <p className="text-[#6b7280] text-[11px] mt-1">
                    *원활한 이용을 위해 데이터를 사용해주세요.
                  </p>
                </div>
              )}

              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={m.role === 'user' ? 'text-right' : 'text-left'}
                >
                  <div
                    className={
                      'inline-block rounded-xl px-3 py-2 sm:px-4 sm:py-2.5 ' +
                      (m.role === 'user'
                        ? 'bg-[#024a9b] text-white'
                        : 'bg-gray-100 text-[#024a9b]') +
                      ' max-w-[66%]'
                    }
                  >
                    <p className="whitespace-pre-wrap text-sm sm:text-base text-left">
                      {m.content}
                    </p>
                    {m.imageUrl && (
                      <img
                        src={m.imageUrl}
                        alt="uploaded"
                        className="mt-2 max-h-40 sm:max-h-48 rounded-md inline-block border border-[#024a9b]"
                      />
                    )}
                  </div>
                </div>
              ))}

              {/* AI 타이핑 표시 */}
              {loading && (
                <div className="text-left">
                  <div className="inline-block rounded-xl px-3 py-2 sm:px-4 sm:py-2.5 bg-gray-100 text-[#024a9b] max-w-[66%]">
                    {messages[messages.length - 1]?.imageUrl ? (
                      <div className="typing-text">해독중.. 약 30초 소요</div>
                    ) : (
                      <div className="typing-text">답변중...</div>
                    )}
                  </div>
                </div>
              )}

              {/* 자동 스크롤 기준점 */}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Gemini 크레딧 텍스트 (겹치지 않게 절대 위치) */}
          <p className="absolute bottom-2 right-3 text-xs text-[#6d8db8] select-none">
            gemini AI를 사용하였습니다.
          </p>
        </div>
      </div>

      {/* ✅ 입력 영역 */}
      <div className="flex items-stretch gap-2 w-full shrink-0">
        {/* 파일 선택 버튼 */}
        <label className="flex items-center justify-center bg-white border-[2px] border-[#024a9b] rounded-lg px-4 text-xl cursor-pointer whitespace-nowrap flex-shrink-0 hover:bg-[#f0f6ff] transition text-[#024a9b] h-11 sm:h-12">
          📎
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            className="hidden"
            onChange={async (e) => {
              const selected = e.target.files?.[0];
              if (selected) {
                setFile(selected);
                await onSend(selected); // 선택 즉시 자동 전송
              }
            }}
          />
        </label>

        {/* 텍스트 입력창 */}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend();
          }}
          placeholder="AI와 대화해보세요"
          className="flex-1 border-[2px] border-[#024a9b] rounded-lg px-3 text-sm sm:text-base min-w-0 text-[#024a9b] placeholder-[#6d8db8] h-11 sm:h-12"
        />

        {/* 전송 버튼 */}
        <button
          onClick={() => onSend()}
          disabled={loading}
          className="bg-[#024a9b] text-white px-5 rounded-lg whitespace-nowrap flex-shrink-0 hover:bg-[#013a7c] disabled:opacity-60 text-sm sm:text-base transition h-11 sm:h-12"
        >
          {loading ? '전송 중...' : '전송'}
        </button>
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
