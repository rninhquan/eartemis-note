export interface WordAnalysis {
  originalWord: string;
  baseWord: string;
  partOfSpeech: string;
  contextualMeaning: string;
}

export interface SentenceNote {
  id?: string;
  userId: string;
  originalSentence: string;
  sentenceTranslation: string;
  words: WordAnalysis[];
  grammarUsage: string;
  examples: string[];
  tags: string[];
  createdAt: number;
  nextReviewDate: number; // timestamp
  reviewCount: number;
  easinessFactor: number; // For spaced repetition (SM-2 basic)
  interval: number; // in days
  status?: 'pending' | 'completed' | 'error';
}
