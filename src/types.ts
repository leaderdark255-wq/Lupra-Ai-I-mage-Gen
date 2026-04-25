export interface UserProfile {
  userId: string;
  email: string;
  displayName: string;
  photoURL: string;
  isPremium: boolean;
  dailyCount: number;
  lastResetAt: string;
  customApiKey?: string;
}

export interface ChatThread {
  id: string;
  userId: string;
  title: string;
  createdAt: any;
  updatedAt: any;
}

export interface MessageMetadata {
  prompt: string;
  enhancedPrompt?: string;
  resolution: string;
  filter: string;
  model: string;
  createdAt: string;
}

export interface Message {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  text: string;
  imageURL?: string;
  status?: 'pending' | 'enhancing' | 'generating' | 'ready' | 'failed';
  steps?: string[];
  metadata?: MessageMetadata;
  createdAt: any;
  isFavorite?: boolean;
  baseImage?: string;
}

export interface QueueStatus {
  status: string;
  progress: number;
  stepIndex: number;
}
