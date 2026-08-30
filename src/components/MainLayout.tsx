import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { logout, getUserNotes, saveNote, deleteNote, updateNote } from '../lib/firebase';
import { SentenceNote } from '../types';
import { LogOut, Tag as TagIcon, Calendar, Search, X, Trash2, Brain, CheckCircle2 } from 'lucide-react';

interface MainLayoutProps {
  user: User;
}

export default function MainLayout({ user }: MainLayoutProps) {
  const [notes, setNotes] = useState<SentenceNote[]>([]);
  const [selectedNote, setSelectedNote] = useState<SentenceNote | null>(null);
  const [inputText, setInputText] = useState('');
  const [activeAnalysisIds, setActiveAnalysisIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  
  // Review Mode states
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);

  // Calculate unique tags
  const allTags = Array.from(new Set(notes.flatMap(n => n.tags || []))).sort();

  // Due notes for spaced repetition
  const dueNotes = notes.filter(n => 
    (!n.status || n.status === 'completed') && n.nextReviewDate <= Date.now()
  ).sort((a, b) => a.nextReviewDate - b.nextReviewDate);

  // Filter notes based on search query and selected tag
  const filteredNotes = notes.filter(note => {
    const searchLower = searchQuery.trim().toLowerCase();
    const matchesSearch = !searchLower || 
      (note.originalSentence && note.originalSentence.toLowerCase().includes(searchLower)) || 
      (note.sentenceTranslation && note.sentenceTranslation.toLowerCase().includes(searchLower));
    const matchesTag = !selectedTag || (note.tags && note.tags.includes(selectedTag));
    return matchesSearch && matchesTag;
  });

  useEffect(() => {
    fetchNotes();
  }, [user.uid]);

  const fetchNotes = async () => {
    try {
      const fetchedNotes = await getUserNotes(user.uid);
      setNotes(fetchedNotes);
      if (fetchedNotes.length > 0 && !selectedNote) {
        setSelectedNote(fetchedNotes[0]);
      }
    } catch (err) {
      console.error("Failed to fetch notes:", err);
    }
  };

  const processNoteAnalysis = async (noteId: string, sentence: string) => {
    setActiveAnalysisIds(prev => new Set(prev).add(noteId));
    
    // Set note to pending locally
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, status: 'pending' } : n));
    
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 60000); // 60s timeout

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence }),
        signal: abortController.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Analysis failed');

      const analysis = await response.json();
      
      const updates: Partial<SentenceNote> = {
        sentenceTranslation: analysis.sentenceTranslation,
        words: analysis.words,
        grammarUsage: analysis.grammarUsage,
        examples: analysis.examples,
        tags: analysis.tags,
        status: 'completed'
      };

      await updateNote(noteId, updates);
      
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, ...updates } : n));
      
      // Auto-select if no note is selected
      setSelectedNote(prev => {
        if (!prev || prev.id === noteId) {
          return { ...prev, ...updates } as SentenceNote;
        }
        return prev;
      });
      
    } catch (err: any) {
      console.error(err);
      await updateNote(noteId, { status: 'error' });
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, status: 'error' } : n));
    } finally {
      setActiveAnalysisIds(prev => {
        const next = new Set(prev);
        next.delete(noteId);
        return next;
      });
    }
  };

  const handleAddNote = async () => {
    if (!inputText.trim()) return;
    
    const sentence = inputText.trim();
    
    // Basic duplication check
    const existingNote = notes.find(n => 
      n.originalSentence && n.originalSentence.toLowerCase() === sentence.toLowerCase()
    );
    if (existingNote) {
      setSelectedNote(existingNote);
      setInputText('');
      return;
    }

    setInputText(''); // Clear input immediately for better UX
    setError(null);

    const tempId = `temp-${Date.now()}`;
    const optimisticNote: SentenceNote = {
      id: tempId,
      userId: user.uid,
      originalSentence: sentence,
      sentenceTranslation: '',
      words: [],
      grammarUsage: '',
      examples: [],
      tags: [],
      createdAt: Date.now(),
      nextReviewDate: Date.now() + 86400000,
      reviewCount: 0,
      easinessFactor: 2.5,
      interval: 1,
      status: 'pending'
    };

    // Optimistic update
    setNotes(prev => [optimisticNote, ...prev]);
    setSelectedNote(optimisticNote);
    setActiveAnalysisIds(prev => new Set(prev).add(tempId));

    try {
      // Create a copy without the temporary id for saving
      const { id: _, ...noteDataToSave } = optimisticNote;
      const savedNote = await saveNote(noteDataToSave);
      
      // Update state with the real ID from database
      setNotes(prev => prev.map(n => n.id === tempId ? savedNote : n));
      setSelectedNote(prev => prev?.id === tempId ? (savedNote as SentenceNote) : prev);
      
      // Transfer active analysis ID tracking
      setActiveAnalysisIds(prev => {
        const next = new Set(prev);
        next.delete(tempId);
        next.add(savedNote.id!);
        return next;
      });
      
      // 2. Fire and forget the analysis process with the real ID
      processNoteAnalysis(savedNote.id!, sentence);
    } catch (err) {
      console.error("Failed to save pending note", err);
      // Revert optimistic update
      setNotes(prev => prev.filter(n => n.id !== tempId));
      if (selectedNote?.id === tempId) setSelectedNote(null);
      setActiveAnalysisIds(prev => {
        const next = new Set(prev);
        next.delete(tempId);
        return next;
      });
      setError("Không thể lưu ghi chú. Vui lòng thử lại.");
    }
  };

  const handleDeleteNote = async (id: string) => {
    try {
      await deleteNote(id);
      setNotes(prev => prev.filter(note => note.id !== id));
      if (selectedNote?.id === id) {
        setSelectedNote(null);
      }
    } catch (err) {
      console.error("Failed to delete note:", err);
      setError('Không thể xóa ghi chú. Vui lòng tải lại trang và thử lại.');
    }
  };

  const handleReview = async (quality: number) => {
    if (dueNotes.length === 0) return;
    const note = dueNotes[0];
    
    let { interval, reviewCount, easinessFactor } = note;

    if (quality < 3) {
      reviewCount = 0;
      interval = 1;
    } else {
      if (reviewCount === 0) interval = 1;
      else if (reviewCount === 1) interval = 6;
      else interval = Math.round(interval * easinessFactor);
      reviewCount++;
    }

    easinessFactor = easinessFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easinessFactor < 1.3) easinessFactor = 1.3;

    const nextReviewDate = Date.now() + interval * 24 * 60 * 60 * 1000;

    const updates = {
      interval,
      reviewCount,
      easinessFactor,
      nextReviewDate
    };

    try {
      await updateNote(note.id!, updates);
      setNotes(prev => prev.map(n => n.id === note.id ? { ...n, ...updates } : n));
      setShowAnswer(false);
    } catch (err) {
      console.error("Failed to update review status", err);
      setError("Không thể cập nhật trạng thái ôn tập.");
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#F1F5F9] text-slate-900 font-sans overflow-hidden">
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-white rounded-sm"></div>
          </div>
          <h1 className="font-bold text-xl tracking-tight">LinguistNote</h1>
        </div>
        
        <div className="flex-1 max-w-2xl px-12">
          <div className="relative">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
              placeholder="Nhập câu tiếng Anh cần note và nhấn Enter..."
              className="w-full bg-slate-100 border-none rounded-full py-2.5 px-6 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
            <button
              onClick={handleAddNote}
              disabled={!inputText.trim()}
              className="absolute right-1.5 top-1.5 bg-indigo-600 disabled:bg-slate-400 text-white px-4 py-1 rounded-full text-xs font-medium cursor-pointer hover:bg-indigo-700 transition-colors h-7 flex items-center"
            >
              {activeAnalysisIds.size > 0 ? (activeAnalysisIds.size === 1 ? 'Đang phân tích...' : `Đang phân tích (${activeAnalysisIds.size})...`) : 'Thêm Note'}
            </button>
          </div>
          {error && <p className="text-red-500 text-xs mt-1 absolute">{error}</p>}
        </div>

        <div className="flex items-center gap-4 text-slate-500">
          <button 
            onClick={() => setIsReviewMode(!isReviewMode)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium text-sm transition-colors ${
              isReviewMode ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Brain className="w-4 h-4" />
            Ôn tập
            {dueNotes.length > 0 && (
              <span className="bg-indigo-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                {dueNotes.length}
              </span>
            )}
          </button>
          <div className="flex items-center gap-2">
            <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.email}`} alt="User" className="w-8 h-8 rounded-full" />
          </div>
          <button onClick={logout} className="hover:bg-slate-100 p-2 rounded-full transition-colors" title="Đăng xuất">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {isReviewMode ? (
          <section className="flex-1 flex flex-col p-8 overflow-hidden min-w-0 bg-slate-50/50 items-center justify-center">
            {dueNotes.length === 0 ? (
              <div className="text-center flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-2">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-light text-slate-800">Hoàn thành ôn tập hôm nay!</h2>
                <p className="text-slate-500">Bạn đã ôn tập xong tất cả các ghi chú cần thiết.</p>
                <button onClick={() => setIsReviewMode(false)} className="mt-4 px-6 py-2 bg-indigo-600 text-white rounded-full font-medium hover:bg-indigo-700 transition-colors">
                  Quay lại danh sách
                </button>
              </div>
            ) : (
              <div className="w-full max-w-3xl bg-white rounded-3xl shadow-lg shadow-indigo-100/50 border border-slate-200 flex flex-col overflow-hidden max-h-full">
                <div className="p-12 text-center border-b border-slate-100 shrink-0 relative">
                  <button onClick={() => setIsReviewMode(false)} className="absolute left-6 top-6 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors" title="Thoát ôn tập">
                    <X className="w-5 h-5" />
                  </button>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-6">
                    Còn {dueNotes.length} câu cần ôn
                  </span>
                  <h2 className="text-4xl font-light text-slate-800 leading-tight">
                    {dueNotes[0].originalSentence}
                  </h2>
                </div>
                
                {!showAnswer ? (
                  <div className="p-12 text-center bg-slate-50 flex-1 flex flex-col items-center justify-center min-h-[300px]">
                    <button onClick={() => setShowAnswer(true)} className="px-10 py-4 bg-indigo-600 text-white rounded-full font-medium hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200">
                      Xem đáp án
                    </button>
                  </div>
                ) : (
                  <div className="p-8 bg-slate-50 flex-1 flex flex-col overflow-y-auto min-h-[300px]">
                    <div className="mb-8 max-w-2xl mx-auto w-full">
                      <p className="text-2xl text-indigo-600 text-center mb-8 pb-8 border-b border-slate-200">{dueNotes[0].sentenceTranslation}</p>
                      
                      {dueNotes[0].words && dueNotes[0].words.length > 0 && (
                         <div className="mb-6 space-y-3">
                           {dueNotes[0].words.map((w, idx) => (
                             <div key={idx} className="flex items-baseline gap-2">
                               <span className="font-bold text-slate-800">{w.originalWord}</span>
                               <span className="text-[10px] uppercase font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{w.partOfSpeech}</span>
                               <span className="text-slate-600 text-sm ml-2">- {w.contextualMeaning}</span>
                             </div>
                           ))}
                         </div>
                      )}
                      {dueNotes[0].grammarUsage && (
                         <div className="bg-white p-6 rounded-2xl border border-slate-200 text-sm text-slate-600 leading-relaxed shadow-sm">
                           <span className="font-bold text-indigo-400 uppercase text-[10px] block mb-3">Ngữ pháp & Cách dùng</span>
                           {dueNotes[0].grammarUsage}
                         </div>
                      )}
                    </div>
                    
                    <div className="flex flex-wrap items-center justify-center gap-4 border-t border-slate-200 pt-8 mt-auto shrink-0 bg-slate-50 sticky bottom-0">
                      <button onClick={() => handleReview(1)} className="px-8 py-3 bg-red-100 text-red-700 rounded-full font-medium hover:bg-red-200 transition-colors">
                        Quên (Lại từ đầu)
                      </button>
                      <button onClick={() => handleReview(3)} className="px-8 py-3 bg-amber-100 text-amber-700 rounded-full font-medium hover:bg-amber-200 transition-colors">
                        Khó (Nhớ mang máng)
                      </button>
                      <button onClick={() => handleReview(5)} className="px-8 py-3 bg-green-100 text-green-700 rounded-full font-medium hover:bg-green-200 transition-colors">
                        Dễ (Nhớ rõ)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        ) : (
          <>
            <aside className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Ghi chú ({filteredNotes.length})</h2>
              {dueNotes.length > 0 && (
                <button onClick={() => setIsReviewMode(true)} className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-1 rounded font-bold uppercase hover:bg-indigo-200 transition-colors">
                  Ôn tập ({dueNotes.length})
                </button>
              )}
            </div>
            
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm kiếm câu, từ..."
                className="w-full bg-white border border-slate-200 rounded-lg py-2 pl-9 pr-8 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none focus:border-indigo-500"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2 p-1 text-slate-400 hover:text-slate-600 rounded-full transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {allTags.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] -mx-1 px-1">
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                    selectedTag === null
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Tất cả
                </button>
                {allTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                    className={`shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                      selectedTag === tag
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto space-y-px">
            {filteredNotes.map(note => (
              <div 
                key={note.id}
                onClick={() => setSelectedNote(note)}
                className={`p-4 cursor-pointer border-r-4 transition-colors ${
                  selectedNote?.id === note.id 
                    ? 'bg-indigo-50 border-indigo-600' 
                    : 'hover:bg-slate-50 border-transparent'
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                   <p className="text-sm font-semibold truncate flex-1">{note.originalSentence}</p>
                   {activeAnalysisIds.has(note.id!) && (
                     <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin shrink-0 mt-1"></div>
                   )}
                </div>
                {activeAnalysisIds.has(note.id!) ? (
                  <p className="text-xs text-indigo-500 mt-1 italic truncate">Đang phân tích...</p>
                ) : (note.status === 'pending' || note.status === 'error') ? (
                  <p className="text-xs text-amber-500 mt-1 truncate">Chưa dịch. Bấm để thử lại.</p>
                ) : (
                  <p className="text-xs text-slate-500 mt-1 truncate">{note.sentenceTranslation}</p>
                )}
              </div>
            ))}
            {filteredNotes.length === 0 && activeAnalysisIds.size === 0 && (
              <div className="p-8 text-center text-slate-400 text-sm">
                {notes.length === 0 ? "Chưa có ghi chú nào. Hãy nhập một câu ở ô tìm kiếm để bắt đầu!" : "Không tìm thấy ghi chú phù hợp với bộ lọc."}
              </div>
            )}
          </div>
        </aside>

        <section className="flex-1 flex flex-col p-8 overflow-hidden min-w-0">
          {selectedNote ? (
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 flex flex-col h-full overflow-hidden">
              <div className="p-8 border-b border-slate-100 shrink-0">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest">Câu đang chọn</span>
                    <h2 className="text-3xl font-light mt-2">{selectedNote.originalSentence}</h2>
                    <p className="text-xl text-slate-500 italic mt-1">{selectedNote.sentenceTranslation}</p>
                  </div>
                  <button 
                    onClick={() => selectedNote.id && handleDeleteNote(selectedNote.id)}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                    title="Xóa ghi chú"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
                
                {selectedNote.tags && selectedNote.tags.length > 0 && (
                  <div className="flex gap-2 mt-4 flex-wrap">
                    {selectedNote.tags.map((tag, idx) => (
                      <span key={idx} className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider bg-slate-100 text-slate-600 px-2 py-1 rounded-md">
                        <TagIcon className="w-3 h-3" /> {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="flex-1 flex flex-col overflow-hidden">
                {activeAnalysisIds.has(selectedNote.id!) ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-4">
                    <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                    <p>Hệ thống đang phân tích ngữ nghĩa...</p>
                  </div>
                ) : (selectedNote.status === 'pending' || selectedNote.status === 'error') ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-4">
                    <p>Ghi chú này chưa được phân tích (hoặc bị gián đoạn).</p>
                    <button 
                      onClick={() => processNoteAnalysis(selectedNote.id!, selectedNote.originalSentence)}
                      className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors"
                    >
                      Phân tích ngay
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 flex overflow-hidden">
                    <div className="w-1/2 p-8 border-r border-slate-100 overflow-y-auto">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Phân tích từ vựng (Theo ngữ cảnh)</h3>
                      <div className="space-y-4">
                        {selectedNote.words.map((word, idx) => (
                          <div key={idx} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                            <div className="flex justify-between items-center mb-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-indigo-600 text-lg">{word.originalWord}</span>
                                {word.originalWord.toLowerCase() !== word.baseWord.toLowerCase() && (
                                  <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 italic">
                                    dạng nguyên thể: <strong>{word.baseWord}</strong>
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] bg-white px-2 py-0.5 rounded border border-slate-200 font-mono text-slate-600">
                                {word.partOfSpeech.toUpperCase()}
                              </span>
                            </div>
                            <p className="text-sm text-slate-700 mt-2">{word.contextualMeaning}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div className="w-1/2 p-8 flex flex-col gap-8 overflow-y-auto">
                      <div>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Cách dùng & Ngữ pháp</h3>
                        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                          {selectedNote.grammarUsage}
                        </p>
                      </div>
                      {selectedNote.examples && selectedNote.examples.length > 0 && (
                        <div>
                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Ví dụ thêm</h3>
                          <ul className="space-y-3">
                            {selectedNote.examples.map((example, idx) => (
                              <li key={idx} className="text-sm p-3 bg-indigo-50/50 rounded-lg border-l-4 border-indigo-200 text-slate-700">
                                {example}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div>
                         <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Thông tin ôn tập</h3>
                         <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                            <Calendar className="w-4 h-4 text-indigo-500" />
                            <span>Ôn tập lần tới: {new Date(selectedNote.nextReviewDate).toLocaleDateString('vi-VN')}</span>
                         </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              {activeAnalysisIds.size > 0 ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                  <p>AI đang phân tích ngữ nghĩa...</p>
                </div>
              ) : (
                <p>Chọn một ghi chú bên trái hoặc thêm mới để xem chi tiết.</p>
              )}
            </div>
          )}
        </section>
        </>
        )}
      </main>
    </div>
  );
}
