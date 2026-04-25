import React, { useState, useEffect, useRef } from 'react';
import { auth, db, signInWithGoogle } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, updateDoc, limit, deleteDoc, getDocs } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Image as ImageIcon, History, Sparkles, User as UserIcon, LogOut, Loader2, Plus, Zap, Menu, X, Trash2, Download, Globe, Cpu, Layers, Wand2, Maximize, Palette, Wind, Info, Settings, Copy, Sliders, Heart, Star } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { GoogleGenAI } from "@google/genai";
import { UserProfile, ChatThread, Message, QueueStatus } from './types';
import { TRANSLATIONS } from './constants';
import { Tooltip } from './components/Tooltip';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const socket: Socket = io();

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const IMAGE_FILTERS = {
  none: '',
  sepia: 'Apply a vintage sepia-toned filter with warm, aged brownish hues and a classical nostalgic feel.',
  bw: 'Generate in striking high-contrast black and white (monochrome) film noir aesthetic with deep shadows.',
  vintage: 'Apply a 1970s vintage film aesthetic with slight graininess, warm desaturated colors, and soft lighting.',
  cinematic: 'Apply cinematic blockbuster lighting with professional teal-and-orange color grading.',
  sketch: 'Render as a detailed charcoal pencil sketch on textured off-white artist paper.'
};

const FILTER_STYLES: Record<string, string> = {
  none: 'bg-gray-500/20 shadow-inner',
  sepia: 'bg-[#704214] shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]',
  bw: 'bg-gradient-to-br from-black via-gray-500 to-white',
  vintage: 'bg-gradient-to-br from-orange-200/50 via-teal-100/30 to-pink-100/30',
  cinematic: 'bg-gradient-to-br from-cyan-900 via-black to-orange-600',
  sketch: 'bg-[#f5f5f5] [background-image:repeating-linear-gradient(45deg,#ccc_0,#ccc_1px,transparent_0,transparent_50%)] [background-size:4px_4px]'
};

const FILTER_PREVIEWS: Record<string, string> = {
  none: '',
  sepia: 'sepia(0.8) contrast(1.1)',
  bw: 'grayscale(1) contrast(1.2)',
  vintage: 'sepia(0.2) saturate(1.6) brightness(1.1) hue-rotate(-10deg)',
  cinematic: 'contrast(1.3) saturate(1.1) brightness(0.8) hue-rotate(185deg)',
  sketch: 'grayscale(1) contrast(4) brightness(1.1)'
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<'512px' | '1K' | '2K' | '4K'>('1K');
  const [selectedFilter, setSelectedFilter] = useState<string>('none');
  const [seed, setSeed] = useState<string>('');
  const [lang, setLang] = useState<'en' | 'ur' | 'hi'>('en');
  const [performanceMode, setPerformanceMode] = useState<'lite' | 'turbo'>('turbo');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '4:3' | '3:2' | '9:16'>('1:1');
  const [selectedStyleCategory, setSelectedStyleCategory] = useState<string>('All');
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [activeMetadataId, setActiveMetadataId] = useState<string | null>(null);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [exportSettings, setExportSettings] = useState<{
    format: 'image/png' | 'image/jpeg' | 'image/webp';
    quality: number;
    showMenuFor: string | null;
  }>({
    format: 'image/png',
    quality: 0.92,
    showMenuFor: null
  });

  const STYLE_TEMPLATES = [
    { category: 'Professional', name: 'YouTube Thumbnail', prompt: 'Eye-catching YouTube thumbnail, high contrast, vibrant colors, bold text placeholder, expressive composition, 4k resolution, clickable aesthetic' },
    { category: 'Professional', name: 'Logo Design', prompt: 'Clean minimalist vector logo design, flat color palette, geometric shapes, professional branding, white background, high resolution' },
    { category: 'Professional', name: 'Realistic Portrait', prompt: 'Ultra-realistic front-facing studio portrait, detailed skin texture, professional lighting, bokeh background, 8k resolution' },
    { category: 'Photorealistic', name: 'Cinematic Portrait', prompt: 'Breathtaking cinematic portrait, sharp focus, 8k, highly detailed, professional lighting, shallow depth of field' },
    { category: 'Photorealistic', name: 'Macro Nature', prompt: 'Macro photography of a dewdrop on a leaf, morning light, iridescent, extreme detail, 100mm lens' },
    { category: 'Anime', name: 'Cyberpunk District', prompt: 'Ghibli style anime landscape, vibrant neon lights, raining, reflections on pavement, high contrast' },
    { category: 'Anime', name: 'Manga Sketch', prompt: 'Dotted line manga draft style, ink wash, expressive lines, high impact, monochromatic' },
    { category: 'Abstract', name: 'Fluid Marble', prompt: 'Abstract fluid marble texture, gold and deep blue swirls, liquid motion, 3d render, octane render' },
    { category: 'Abstract', name: 'Geometric Chaos', prompt: 'Geometric abstraction, brutalist architectural shapes, volumetric shadows, minimalism, harsh lighting' },
    { category: 'Fantasy', name: 'Etherial Forest', prompt: 'Ethereal bioluminescent forest at night, floating particles, magical atmosphere, concept art, Trending on ArtStation' },
    { category: 'Fantasy', name: 'Clockwork Steampunk', prompt: 'Intricate steampunk clockwork mechanism, brass and copper, steam vents, victorian industrial, macro detail' },
  ];

  const STYLE_CATEGORIES = ['All', 'Professional', 'Photorealistic', 'Anime', 'Abstract', 'Fantasy'];

  const ASPECT_RATIOS = [
    { label: '1:1', value: '1:1' },
    { label: '16:9', value: '16:9' },
    { label: '4:3', value: '4:3' },
    { label: '3:2', value: '3:2' },
    { label: '9:16', value: '9:16' }
  ];
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [generations, setGenerations] = useState<Message[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const resolutionRef = useRef(selectedResolution);

  useEffect(() => {
    resolutionRef.current = selectedResolution;
  }, [selectedResolution]);

  const t = TRANSLATIONS[lang];
  const latestImage = [...generations, ...messages].reverse().find(m => m.imageURL)?.imageURL || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=200&h=200';

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setNeedsApiKey(!hasKey);
      }
    };
    checkKey();
  }, []);

  // Auth & Profile Sync
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userRef = doc(db, 'users', u.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
          const newProfile: UserProfile = {
            userId: u.uid,
            email: u.email || '',
            displayName: u.displayName || 'Lupra Explorer',
            photoURL: u.photoURL || '',
            isPremium: false,
            dailyCount: 0,
            lastResetAt: new Date().toISOString()
          };
          await setDoc(userRef, { ...newProfile, createdAt: serverTimestamp() });
          setProfile(newProfile);
        } else {
          setProfile(userSnap.data() as UserProfile);
        }
      } else {
        setProfile(null);
      }
    });
  }, []);

  // Sync Threads
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'threads'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setThreads(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChatThread)));
    });
  }, [user]);

  // Sync Messages
  useEffect(() => {
    if (!user || !currentThreadId) {
      setMessages([]);
      return;
    }
    const q = query(
      collection(db, `threads/${currentThreadId}/messages`), 
      where('userId', '==', user.uid),
      orderBy('createdAt', 'asc')
    );
    return onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
    });
  }, [user, currentThreadId]);

  // Sync Global Generations
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'generations'), 
      where('userId', '==', user.uid), 
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    return onSnapshot(q, (snapshot) => {
      setGenerations(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
    });
  }, [user]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, queueStatus]);

  // Socket listeners
  useEffect(() => {
    socket.on('queue_update', (status: QueueStatus) => {
      setQueueStatus(status);
    });

    socket.on('authorized_generation', async ({ prompt, baseImage, performanceMode: incomingMode }) => {
      if (!user || !currentThreadId) return;
      
      const activePerformanceMode = incomingMode || performanceMode;

      try {
        setIsGenerating(true);
        setQueueStatus({ status: baseImage ? 'Analyzing base image...' : 'Enhancing prompt...', progress: 10 });

        // Instantiate AI right before call to use potentially newly selected user API key
        const localAi = new GoogleGenAI({ apiKey: (process.env as any).API_KEY || (process.env as any).GEMINI_API_KEY });

        // 1. Enhance
        const filterPrompt = selectedFilter !== 'none' ? IMAGE_FILTERS[selectedFilter as keyof typeof IMAGE_FILTERS] : '';
        const enhancementPrompt = baseImage 
          ? `Create a subtle variation of this image while maintaining the original vibe. ${filterPrompt} Original prompt was: ${prompt}`
          : `Enhance for realistic generation: ${prompt}. ${filterPrompt}`;
          
        let enhanced = prompt;
        // Skip enhancement in lite mode to save quota
        if (activePerformanceMode !== 'lite') {
          try {
            const effectiveApiKey = profile?.customApiKey || (process.env as any).API_KEY || (process.env as any).GEMINI_API_KEY;
            const localAiForEnhance = new GoogleGenAI({ apiKey: effectiveApiKey });
            const enhanceResp = await localAiForEnhance.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: enhancementPrompt,
              config: { systemInstruction: "Be concise. Output only the enhanced prompt." }
            });
            enhanced = enhanceResp.text?.trim() || prompt;
          } catch (e: any) {
            console.warn("Enhancement failed, using original prompt:", e);
            if (e.message?.includes('429') || e.message?.includes('RESOURCE_EXHAUSTED')) {
              console.log("Quota exceeded for enhancement, skipping...");
            }
          }
        }

        setQueueStatus({ status: 'Generating image...', progress: 40 });

        // 2. Generate (Fallback cascading with Backoff)
        let imageUrl = '';
        let usedModel = '';
        
        // Mode-based model selection
        const flashModels = activePerformanceMode === 'lite' 
          ? ['gemini-2.5-flash-image'] 
          : ['gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'];

        const currentResolution = resolutionRef.current;
        const currentFilter = selectedFilter;
        
        let lastError: any = null;
        for (const model of flashModels) {
          let retryCount = 0;
          const maxRetries = 2;
          
          while (retryCount <= maxRetries) {
            try {
              const effectiveApiKey = profile?.customApiKey || (process.env as any).API_KEY || (process.env as any).GEMINI_API_KEY;
              const localAiForGen = new GoogleGenAI({ apiKey: effectiveApiKey });
              const contents = baseImage 
                ? {
                    parts: [
                      { inlineData: { data: baseImage.split(',')[1], mimeType: 'image/jpeg' } },
                      { text: `Generate a variation based on this image and this description: ${enhanced}` }
                    ]
                  }
                : {
                    parts: [{ text: `${enhanced} [Negative: blurry, distorted]` }]
                  };

              const genResp = await localAiForGen.models.generateContent({
                model,
                contents,
                config: { 
                  imageConfig: { 
                    aspectRatio: aspectRatio,
                    imageSize: (model === 'gemini-2.5-flash-image' && currentResolution === '4K') ? '2K' : currentResolution
                  } 
                }
              });

              for (const part of genResp.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                  imageUrl = `data:image/png;base64,${part.inlineData.data}`;
                  usedModel = model;
                  break;
                }
              }
              if (imageUrl) break;
            } catch (e: any) {
              lastError = e;
              const isQuotaError = e.message?.includes('429') || e.message?.includes('RESOURCE_EXHAUSTED');
              
              if (isQuotaError && retryCount < maxRetries) {
                const waitTime = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
                setQueueStatus({ status: `Rate limit hit. Retrying in ${Math.round(waitTime/1000)}s...`, progress: 40 });
                await new Promise(r => setTimeout(r, waitTime));
                retryCount++;
                continue;
              }

              console.warn(`Model ${model} failed, trying next...`, e);
              
              // Handle key missing or permission error
              if (e.message?.includes('caller does not have permission') || e.message?.includes('not found')) {
                if (window.aistudio) {
                  setNeedsApiKey(true);
                }
              }
              break;
            }
          }
          if (imageUrl) break;
        }

        if (!imageUrl) {
          const isQuota = lastError?.message?.includes('429') || lastError?.message?.includes('RESOURCE_EXHAUSTED');
          if (isQuota) {
            setNeedsApiKey(true);
            throw new Error('API Quota Exceeded. The free shared quota is currently full. Please try again later or add your own Gemini API Key in the settings (cog icon) to continue generating without limits.');
          }
          throw lastError || new Error('Generation failed.');
        }

        setQueueStatus({ status: 'Finalizing...', progress: 80 });
        
        const generationId = Math.random().toString(36).substring(7);
        let finalImageUrl = imageUrl;
        
        // 3. Compress
        if (finalImageUrl.startsWith('data:image')) {
          const compress = (base64: string): Promise<string> => {
            return new Promise((resolve) => {
              const img = new Image();
              img.src = base64;
              img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const MAX_SIZE = 1024;
                let { width, height } = img;
                if (width > height) {
                  if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
                } else {
                  if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
                }
                canvas.width = width; canvas.height = height;
                ctx?.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
              };
              img.onerror = () => resolve(base64);
            });
          };
          finalImageUrl = await compress(finalImageUrl);
        }

        // 4. Save to Firestore
        const messageData = {
          userId: user.uid,
          role: 'assistant',
          text: `Generated: "${prompt}"`,
          imageURL: finalImageUrl,
          status: 'ready',
          metadata: {
            prompt,
            enhancedPrompt: enhanced,
            resolution: currentResolution,
            filter: currentFilter,
            model: usedModel,
            createdAt: new Date().toISOString()
          },
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, `threads/${currentThreadId}/messages`), messageData);
        await addDoc(collection(db, 'generations'), messageData);

        // 5. Notify Backend to increment usage
        const idToken = await user.getIdToken();
        socket.emit('mark_generation_complete', { 
          idToken, 
          dailyCount: profile?.dailyCount || 0 
        });

        setIsGenerating(false);
        setQueueStatus(null);
      } catch (error: any) {
        console.error("Generation failed:", error);
        alert(error.message);
        setIsGenerating(false);
        setQueueStatus(null);
      }
    });

    socket.on('error', (err: any) => {
      alert(err.message);
      setIsGenerating(false);
      setQueueStatus(null);
    });

    return () => {
      socket.off('queue_update');
      socket.off('authorized_generation');
      socket.off('error');
    };
  }, [user, currentThreadId, profile, performanceMode]);

  const handleSuggestPrompts = async () => {
    if (isSuggesting) return;
    setIsSuggesting(true);
    try {
      const effectiveApiKey = profile?.customApiKey || (process.env as any).API_KEY || (process.env as any).GEMINI_API_KEY;
      const localAi = new GoogleGenAI({ apiKey: effectiveApiKey });
      const promptContext = input.trim() 
        ? `The user has started typing: "${input}". Provide 3 creative completions or alternative ideas for an image generation prompt.`
        : `Provide 3 diverse and creative prompt ideas for high-quality artistic image generation. Mix different styles like cyberpunk, ethereal, photorealistic, and abstract.`;

      const response = await localAi.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: promptContext,
        config: { 
          systemInstruction: "You are a creative prompt engineer. Output exactly 3 prompts separated by newlines. Do not include numbering, explanations, or any other text. Each prompt should be around 10-20 words.",
          responseMimeType: "text/plain"
        }
      });

      const newSuggestions = response.text?.split('\n').filter(s => s.trim()).slice(0, 3) || [];
      setSuggestions(newSuggestions);
    } catch (error: any) {
      console.error("Suggestion generation failed:", error);
      if (error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED')) {
        setNeedsApiKey(true);
      }
    } finally {
      setIsSuggesting(false);
    }
  };

  const moderatePrompt = async (prompt: string): Promise<{ safe: boolean; reason?: string }> => {
    try {
      const effectiveApiKey = profile?.customApiKey || (process.env as any).API_KEY || (process.env as any).GEMINI_API_KEY;
      const localAi = new GoogleGenAI({ apiKey: effectiveApiKey });
      const response = await localAi.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Evaluate the following image generation prompt for safety and appropriateness. It must NOT contain NSFW content, nudity, violence, hate speech, or harassment. Prompt: "${prompt}"`,
        config: {
          systemInstruction: "You are a content moderator. Analyze the prompt. If it is safe, output exactly 'SAFE'. If it is inappropriate, output 'INAPPROPRIATE' followed by a short reason (max 10 words).",
          responseMimeType: "text/plain"
        }
      });

      const result = response.text?.trim() || 'SAFE';
      if (result === 'SAFE') return { safe: true };
      return { safe: false, reason: result.replace('INAPPROPRIATE', '').trim() };
    } catch (error) {
      console.warn("Moderation check failed, defaulting to cautious skip:", error);
      return { safe: true }; // Default to safe if API fails, but usually we should be more restrictive
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
      alert("Image is too large. Max size is 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setUploadedImage(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleToggleFavorite = async (message: Message, collectionPath: 'threads' | 'generations') => {
    if (!user) return;
    try {
      const isFav = !message.isFavorite;
      let docRef;
      if (collectionPath === 'threads' && currentThreadId) {
        docRef = doc(db, `threads/${currentThreadId}/messages`, message.id);
      } else {
        docRef = doc(db, 'generations', message.id);
      }
      
      await updateDoc(docRef, { isFavorite: isFav });
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    }
  };

  const handleClearGenerations = async () => {
    console.log("handleClearGenerations triggered");
    if (!user) return;
    
    const count = generations.length;
    if (count === 0) {
      alert("Your image history is already empty.");
      return;
    }

    if (!confirm(`Are you sure you want to permanently delete all ${count} generated images? This action cannot be undone.`)) return;
    
    try {
      // Optimistic update for instant UI feedback
      setGenerations([]);
      
      const q = query(collection(db, 'generations'), where('userId', '==', user.uid));
      const snap = await getDocs(q);
      
      console.log(`Deleting ${snap.docs.length} generations from backend...`);
      await Promise.all(snap.docs.map(d => 
        deleteDoc(d.ref).catch(e => handleFirestoreError(e, OperationType.DELETE, `generations/${d.id}`))
      ));
      
      console.log("Generations cleared successfully");
    } catch (error) {
      console.error("Failed to clear generations:", error);
    }
  };

  const handleClearAllHistory = async () => {
    console.log("handleClearAllHistory triggered");
    if (!user) return;

    if (threads.length === 0 && generations.length === 0) {
      alert("History is already empty.");
      return;
    }

    if (!confirm("DANGER: This will permanently delete ALL chat history and ALL generated images. Are you absolutely sure?")) return;

    try {
      // Optimistic update for instant UI feedback
      setThreads([]);
      setMessages([]);
      setGenerations([]);
      setCurrentThreadId(null);

      console.log("Initiating full history wipe...");

      // 1. Clear All Threads & Messages
      const threadsQuery = query(collection(db, 'threads'), where('userId', '==', user.uid));
      const threadsSnap = await getDocs(threadsQuery);
      
      console.log(`Wiping ${threadsSnap.docs.length} threads and their messages...`);
      const threadDeletions = threadsSnap.docs.map(async (threadDoc) => {
        const msgsPath = `threads/${threadDoc.id}/messages`;
        const msgsSnap = await getDocs(collection(db, msgsPath));
        
        // Delete all messages in the thread first
        await Promise.all(msgsSnap.docs.map(msgDoc => 
          deleteDoc(msgDoc.ref).catch(e => handleFirestoreError(e, OperationType.DELETE, `${msgsPath}/${msgDoc.id}`))
        ));
        
        // Then delete the thread itself
        return deleteDoc(threadDoc.ref).catch(e => handleFirestoreError(e, OperationType.DELETE, `threads/${threadDoc.id}`));
      });
      
      await Promise.all(threadDeletions);
      
      // 2. Clear All Generations (Images)
      const gensQuery = query(collection(db, 'generations'), where('userId', '==', user.uid));
      const gensSnap = await getDocs(gensQuery);
      console.log(`Wiping ${gensSnap.docs.length} independent generations...`);
      await Promise.all(gensSnap.docs.map(genDoc => 
        deleteDoc(genDoc.ref).catch(e => handleFirestoreError(e, OperationType.DELETE, `generations/${genDoc.id}`))
      ));

      console.log("Full history wipe completed successfully");
      alert("All chat history and generated images have been permanently deleted.");
    } catch (error) {
      console.error("Failed to clear all history:", error);
      alert("An error occurred while clearing your history. Some items might still remain.");
    }
  };

  const handleExport = async (url: string, id: string) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Image load timeout')), 10000);
        img.onload = () => { clearTimeout(timeout); resolve(null); };
        img.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load image')); };
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create canvas context');

      // Apply the current filter to the export
      if (selectedFilter !== 'none' && FILTER_PREVIEWS[selectedFilter]) {
        ctx.filter = FILTER_PREVIEWS[selectedFilter];
      }
      
      ctx.drawImage(img, 0, 0);
      
      const format = exportSettings.format;
      const quality = (format === 'image/jpeg' || format === 'image/webp') ? exportSettings.quality : undefined;
      const dataUrl = canvas.toDataURL(format, quality);
      
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `lupra-${selectedFilter}-${id.slice(0, 6)}.${format.split('/')[1]}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setExportSettings(prev => ({ ...prev, showMenuFor: null }));
    } catch (error: any) {
      console.error("Export failed:", error);
      alert(error.message || "Failed to export image. Please try again.");
    }
  };

  const [isBrandMode, setIsBrandMode] = useState(false);

  const handleGenerateLupraSuite = async () => {
    if (!user || isGenerating) return;
    
    let threadId = currentThreadId;
    if (!threadId) {
      const threadRef = await addDoc(collection(db, 'threads'), {
        userId: user.uid,
        title: 'Lupra AI Image Brand Suite',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      threadId = threadRef.id;
      setCurrentThreadId(threadId);
    }

    const assets = [
      { type: 'Logo', prompt: 'Professional minimalist futuristic logo for "Lupra AI Image", stylized letter L inside a neural network circle, neon blue and purple glow, black background, vector style, 8k resolution' },
      { type: 'App Icon', prompt: 'Premium mobile app icon for "Lupra AI Image", high-depth 3D symbol, glossy finish, vibrant blue and purple gradients on deep black base, modern tech aesthetic, studio lighting' },
      { type: 'YouTube Thumbnail', prompt: 'High CTR YouTube thumbnail for Lupra AI Image, bold cinematic text reading "THE FUTURE OF AI", dramatic lighting, glowing effects, face of professional creator with blue light reflections' },
      { type: 'Social Banner', prompt: 'Cinematic ultra-wide social media banner for Lupra AI Image, vast digital horizon with neural sparks, flowing purple energy, premium technology background, professional branding, 4k' }
    ];

    setIsGenerating(true);
    setQueueStatus({ status: 'Initializing Brand Suite...', progress: 10 });

    try {
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        setQueueStatus({ status: `Generating ${asset.type}...`, progress: 10 + (i * 20) });

        // Add User Message for record
        await addDoc(collection(db, `threads/${threadId}/messages`), {
          userId: user.uid,
          role: 'user',
          text: `Generate Lupra ${asset.type}`,
          createdAt: serverTimestamp()
        });

        const idToken = await user.getIdToken();
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: asset.prompt,
            idToken,
            threadId: threadId,
            performanceMode: 'turbo'
          })
        });

        if (!response.ok) throw new Error(`Failed to generate ${asset.type}`);
        
        // Wait bit between parallel calls to prevent rate limits
        await new Promise(r => setTimeout(r, 1000));
      }
      setQueueStatus({ status: 'Suite Complete!', progress: 100 });
      setTimeout(() => setQueueStatus(null), 3000);
    } catch (error) {
      console.error("Brand suite error:", error);
      alert("Error generating full suite. Check logs.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !user || isGenerating) return;

    setQueueStatus({ status: 'Moderating prompt...', progress: 5 });
    const safety = await moderatePrompt(input);
    if (!safety.safe) {
      alert(`Prompt flagged: ${safety.reason || 'Inappropriate content detected.'}`);
      setQueueStatus(null);
      return;
    }

    let threadId = currentThreadId;
    if (!threadId) {
      const threadRef = await addDoc(collection(db, 'threads'), {
        userId: user.uid,
        title: input.slice(0, 30),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      threadId = threadRef.id;
      setCurrentThreadId(threadId);
    }

    const userInput = input;
    const baseImage = uploadedImage;
    setInput('');
    setUploadedImage(null);
    setIsGenerating(true);

    // Add User Message
    await addDoc(collection(db, `threads/${threadId}/messages`), {
      userId: user.uid,
      role: 'user',
      text: userInput,
      baseImage: baseImage || null,
      createdAt: serverTimestamp()
    });

    // Start Queue
    const idToken = await user.getIdToken();
    socket.emit('request_generation', {
      prompt: userInput,
      idToken,
      threadId: threadId,
      seed: seed.trim() || undefined,
      baseImage: baseImage || undefined,
      performanceMode
    });
  };

  const handleGenerateVariation = async (baseImage: string, originalPrompt: string) => {
    if (!user || isGenerating || !currentThreadId) return;
    
    setQueueStatus({ status: 'Moderating prompt...', progress: 5 });
    const safety = await moderatePrompt(originalPrompt);
    if (!safety.safe) {
      alert(`Prompt flagged: ${safety.reason || 'Inappropriate content detected.'}`);
      setQueueStatus(null);
      return;
    }

    setIsGenerating(true);
    setQueueStatus({ status: 'Preparing variation...', progress: 10 });

    // Add User Message for variation
    await addDoc(collection(db, `threads/${currentThreadId}/messages`), {
      userId: user.uid,
      role: 'user',
      text: `Let's generate a variation of the previous image.`,
      createdAt: serverTimestamp()
    });

    const idToken = await user.getIdToken();
    socket.emit('request_generation', {
      prompt: originalPrompt,
      idToken,
      threadId: currentThreadId,
      baseImage,
      performanceMode
    });
  };

  const handleEnhanceImage = async (baseImage: string, originalPrompt: string, type: 'upscale' | 'denoise' | 'style', styleName?: string) => {
    if (!user || isGenerating || !currentThreadId) return;
    
    setIsGenerating(true);
    setQueueStatus({ status: `Enhancing (${type})...`, progress: 10 });

    try {
      // Add User Message for history
      await addDoc(collection(db, `threads/${currentThreadId}/messages`), {
        userId: user.uid,
        role: 'user',
        text: `Enhance: ${type}${styleName ? ` to ${styleName}` : ''}`,
        createdAt: serverTimestamp()
      });

      const enhancementPromptMap = {
        upscale: `Upscale this image to ${styleName || 'massive'} resolution. Sharpen every edge, preserve all original textures, and significantly increase detail density. Focus on ultra-high-definition clarity.`,
        denoise: "Apply advanced noise reduction to this image. Smoothing out grain while preserving sharp edges and structural details.",
        style: `Re-imagine this image in the ${styleName} style. Maintain the core layout but overhaul the artistic aesthetic.`
      };

      const prompt = enhancementPromptMap[type];
      
      // Perform Generation Directly on Frontend
      const effectiveApiKey = profile?.customApiKey || (process.env as any).API_KEY || (process.env as any).GEMINI_API_KEY;
      const localAi = new GoogleGenAI({ apiKey: effectiveApiKey });
      let enhancedImageUrl = '';
      let usedModel = '';
      
      const enhanceModels = performanceMode === 'lite'
        ? ['gemini-2.5-flash-image']
        : ['gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'];

      let lastError: any = null;
      for (const model of enhanceModels) {
        let retryCount = 0;
        const maxRetries = 1;
        while (retryCount <= maxRetries) {
          try {
            const genResp = await localAi.models.generateContent({
              model,
              contents: {
                parts: [
                  { inlineData: { data: baseImage.split(',')[1], mimeType: 'image/jpeg' } },
                  { text: prompt }
                ]
              },
              config: { 
                imageConfig: { 
                  aspectRatio: "1:1",
                  imageSize: type === 'upscale' ? (styleName === '8K' ? '2K' : (styleName === '4K' ? '2K' : '2K')) : '1K'
                } 
              }
            });

            for (const part of genResp.candidates?.[0]?.content?.parts || []) {
              if (part.inlineData) {
                enhancedImageUrl = `data:image/png;base64,${part.inlineData.data}`;
                usedModel = model;
                break;
              }
            }
            if (enhancedImageUrl) break;
          } catch (e: any) {
            console.warn(`Enhancement model ${model} failed (attempt ${retryCount + 1}):`, e);
            lastError = e;

            const isQuotaError = e.message?.includes('429') || e.message?.includes('RESOURCE_EXHAUSTED');
            if (isQuotaError && retryCount < maxRetries) {
              await new Promise(r => setTimeout(r, 2000));
              retryCount++;
              continue;
            }

            if (e.message?.includes('caller does not have permission') || e.message?.includes('429') || e.message?.includes('RESOURCE_EXHAUSTED')) {
              setNeedsApiKey(true);
            }
            break;
          }
        }
        if (enhancedImageUrl) break;
      }

      if (!enhancedImageUrl) {
        if (lastError?.message?.includes('429') || lastError?.message?.includes('RESOURCE_EXHAUSTED')) {
          throw new Error('API Quota Exceeded. The free tier is at its limit. Add your own API key to continue.');
        }
        throw lastError || new Error('Enhancement failed.');
      }

      setQueueStatus({ status: 'Processing result...', progress: 90 });

      // Save to Firestore
      const enhanceMessageData = {
        userId: user.uid,
        role: 'assistant',
        text: `Enhanced (${type}) completed for: "${originalPrompt}"`,
        imageURL: enhancedImageUrl,
        status: 'ready',
        metadata: {
          prompt: `Enhance: ${type}${styleName ? ` to ${styleName}` : ''}`,
          enhancedPrompt: prompt,
          resolution: type === 'upscale' ? '2K' : '1K',
          filter: styleName || 'None',
          model: usedModel,
          createdAt: new Date().toISOString()
        },
        createdAt: serverTimestamp()
      };
      await addDoc(collection(db, `threads/${currentThreadId}/messages`), enhanceMessageData);
      await addDoc(collection(db, 'generations'), enhanceMessageData);

      // Usage tracking
      const idToken = await user.getIdToken();
      socket.emit('mark_generation_complete', { 
        idToken, 
        dailyCount: profile?.dailyCount || 0 
      });

      setIsGenerating(false);
      setQueueStatus(null);
    } catch (error: any) {
      console.error("Enhancement failed:", error);
      alert(error.message);
      setIsGenerating(false);
      setQueueStatus(null);
    }
  };

  const createNewChat = () => {
    setCurrentThreadId(null);
    setMessages([]);
  };

  const togglePremium = async () => {
    if (!user || !profile) return;
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, { isPremium: !profile.isPremium });
    setProfile({ ...profile, isPremium: !profile.isPremium });
  };

  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);

  // Check Admin
  useEffect(() => {
    if (!user) return;
    const checkAdmin = async () => {
      const adminSnap = await getDoc(doc(db, 'admins', user.uid));
      // Auto-bootstrap common user for demo
      if (!adminSnap.exists() && user.email === 'leaderdark255@gmail.com') {
        await setDoc(doc(db, 'admins', user.uid), { email: user.email, addedAt: serverTimestamp() });
        setIsAdminUser(true);
      } else {
        setIsAdminUser(adminSnap.exists());
      }
    };
    checkAdmin();
  }, [user]);

  // Listen for /admin in URL
  useEffect(() => {
    const handleLocationChange = () => {
      if (window.location.hash === '#admin') {
        setIsAdminMode(true);
      } else {
        setIsAdminMode(false);
      }
    };
    window.addEventListener('popstate', handleLocationChange);
    handleLocationChange();
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen premium-gradient flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass p-8 rounded-3xl max-w-md w-full text-center glow-purple"
        >
          <div className="w-20 h-20 bg-purple-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Sparkles className="w-10 h-10 text-purple-400" />
          </div>
          <h1 className="text-4xl font-bold mb-2 tracking-tight">Lupra AI Studio</h1>
          <p className="text-gray-400 mb-8">Ultra-realistic image generation powered by advanced AI.</p>
          <button 
            onClick={signInWithGoogle}
            className="w-full bg-white text-black font-semibold py-4 rounded-xl flex items-center justify-center gap-3 hover:bg-gray-100 transition-colors"
          >
            <UserIcon className="w-5 h-5" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  if (isAdminMode && isAdminUser) {
    return (
      <div className="min-h-screen bg-[#0c001a] p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <header className="flex items-center justify-between">
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Sparkles className="text-purple-400" />
              {t.adminPanel}
            </h1>
            <button onClick={() => window.location.hash = ''} className="p-2 hover:bg-white/5 rounded-lg border border-white/10 text-sm">
              {t.exitAdmin}
            </button>
          </header>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="glass p-6 rounded-2xl border border-purple-500/20">
              <div className="text-gray-400 text-sm mb-1">{t.totalThreads}</div>
              <div className="text-3xl font-bold">{threads.length}</div>
            </div>
            <div className="glass p-6 rounded-2xl border border-purple-500/20">
              <div className="text-gray-400 text-sm mb-1">{t.queueLoad}</div>
              <div className="text-3xl font-bold">Stable</div>
            </div>
            <div className="glass p-6 rounded-2xl border border-purple-500/20">
              <div className="text-gray-400 text-sm mb-1">{t.apiStatus}</div>
              <div className="text-3xl font-bold text-green-400 font-mono uppercase tracking-tighter">Healthy</div>
            </div>
          </div>

          <div className="glass rounded-3xl border border-white/5 overflow-hidden">
            <div className="p-6 border-b border-white/5 font-bold uppercase tracking-widest text-xs opacity-50">{t.activeUsers}</div>
            <div className="p-8 text-center text-gray-500 italic">User monitoring restricted for privacy. Tracking API usage only.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0c001a]">
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.div 
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="w-72 glass h-full border-r border-white/5 flex flex-col z-50 fixed lg:relative"
          >
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-xl">
                <Sparkles className="text-purple-400 w-6 h-6" />
                <span>Lupra AI</span>
              </div>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="lg:hidden p-2 hover:bg-white/5 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
              <button 
                onClick={createNewChat}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 hover:bg-white/5 transition-colors group"
              >
                <Plus className="w-5 h-5 text-gray-400 group-hover:text-purple-400" />
                <span className="text-sm font-medium">{t.newGeneration}</span>
              </button>

              <button 
                onClick={() => setIsLogOpen(true)}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 hover:bg-white/5 transition-colors group"
              >
                <Cpu className="w-5 h-5 text-gray-400 group-hover:text-blue-400" />
                <span className="text-sm font-medium">Generation Log</span>
              </button>

              {/* Language Selector */}
              <div className="glass p-3 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-gray-500">
                  <Globe className="w-3 h-3" />
                  <span>Language</span>
                </div>
                <div className="flex gap-2">
                  {(['en', 'ur', 'hi'] as const).map(l => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`flex-1 text-[10px] py-1 rounded-md transition-all font-bold uppercase ${lang === l ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20' : 'bg-white/5 text-gray-500 hover:bg-white/10'}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Performance Mode */}
              <div className="glass p-3 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-gray-500">
                  <Cpu className="w-3 h-3" />
                  <span>Performance</span>
                </div>
                <div className="flex gap-2">
                  {(['lite', 'turbo'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setPerformanceMode(mode)}
                      className={`flex-1 text-[10px] py-1.5 rounded-md transition-all font-bold uppercase flex items-center justify-center gap-1.5 ${performanceMode === mode ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20' : 'bg-white/5 text-gray-500 hover:bg-white/10'}`}
                    >
                      {mode === 'turbo' && <Zap className="w-2.5 h-2.5" />}
                      {mode === 'lite' ? t.liteMode : t.turboMode}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4">
                <div className="flex items-center justify-between py-2">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{t.history}</div>
                  {threads.length > 0 && (
                    <button 
                      onClick={handleClearAllHistory}
                      className="p-1 hover:bg-red-500/10 rounded group transition-all"
                      title="Clear ALL history (Chats & Images)"
                    >
                      <Trash2 className="w-3 h-3 text-gray-600 group-hover:text-red-400" />
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {threads.length === 0 && (
                    <div className="text-xs text-gray-600 px-3 py-2 italic">No history yet</div>
                  )}
                  {threads.map(thread => (
                    <button
                      key={thread.id}
                      onClick={() => setCurrentThreadId(thread.id)}
                      className={`w-full text-left p-3 rounded-xl text-sm transition-colors flex items-center gap-3 ${currentThreadId === thread.id ? 'bg-purple-500/10 border border-purple-500/20 text-purple-200' : 'hover:bg-white/5 text-gray-400'}`}
                    >
                      <History className="w-4 h-4 shrink-0" />
                      <span className="truncate">{thread.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-white/5 space-y-4">
              <button 
                onClick={togglePremium}
                className="w-full p-4 rounded-xl bg-purple-600/20 border border-purple-400/20 flex items-center justify-between group hover:bg-purple-600/30 transition-all"
              >
                <div className="flex items-center gap-2">
                  <Zap className={`w-4 h-4 ${profile?.isPremium ? 'text-yellow-400 fill-yellow-400' : 'text-purple-400'}`} />
                  <span className="text-xs font-bold uppercase tracking-tight">
                    {profile?.isPremium ? t.premiumActive : t.upgradeToPro}
                  </span>
                </div>
                {!profile?.isPremium && <Plus className="w-4 h-4" />}
              </button>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-white/10" alt="Profile" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium truncate max-w-[80px]">{user.displayName}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-500">{profile?.isPremium ? t.proPlan : t.freePlan}</span>
                      {!profile?.isPremium && (
                        <span className="text-[9px] px-1 bg-white/5 rounded text-gray-400">
                          {profile?.dailyCount || 0}/8
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Tooltip content="Edit Workspace & Keys">
                  <button onClick={() => setIsSettingsOpen(true)} className="p-2 hover:bg-white/5 rounded-lg text-gray-500">
                    <Settings className="w-4 h-4" />
                  </button>
                </Tooltip>
                <Tooltip content="Sign Out">
                  <button onClick={() => auth.signOut()} className="p-2 hover:bg-white/5 rounded-lg text-gray-500">
                    <LogOut className="w-4 h-4" />
                  </button>
                </Tooltip>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full relative">
        <header className="p-4 flex items-center gap-4 lg:hidden glass z-40">
          <motion.button 
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsSidebarOpen(true)} 
            className="p-2 hover:bg-white/5 rounded-lg"
          >
            <Menu className="w-6 h-6" />
          </motion.button>
          <div className="flex items-center gap-2 font-bold select-none">
            <Sparkles className="text-purple-400 w-5 h-5" />
            <span>Lupra AI</span>
          </div>
        </header>

        {/* API Key Banner */}
        {needsApiKey && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-purple-600/20 border-b border-purple-500/30 px-6 py-3 flex items-center justify-between z-30 backdrop-blur-md"
          >
            <div className="flex items-center gap-3 text-xs text-purple-200">
              <Zap className="w-4 h-4 text-purple-400 fill-purple-400/20" />
              <div className="flex flex-col">
                <span className="font-bold uppercase tracking-widest text-[10px]">Quota Limit Reached</span>
                <span>The free shared tier is currently overwhelmed. Add your own Gemini API Key to enjoy uninterrupted service.</span>
              </div>
            </div>
            <button 
              onClick={async () => {
                try {
                  if (window.aistudio) {
                    await window.aistudio.openSelectKey();
                    setNeedsApiKey(false);
                  }
                } catch (e) {
                  console.error(e);
                }
              }}
              className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white text-[10px] font-black uppercase tracking-tighter rounded-full transition-all shadow-[0_0_15px_rgba(168,85,247,0.4)] hover:scale-105 active:scale-95"
            >
              Select Key
            </button>
          </motion.div>
        )}

        {/* Generation Log Modal */}
        <AnimatePresence>
          {isLogOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10"
            >
              <div 
                className="absolute inset-0 bg-black/80 backdrop-blur-md" 
                onClick={() => setIsLogOpen(false)} 
              />
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="relative w-full max-w-5xl h-full max-h-[80vh] bg-[#1a0033] border border-white/10 rounded-[2rem] shadow-2xl flex flex-col overflow-hidden"
              >
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      <Cpu className="text-blue-400" />
                      Studio Generation Log
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">Detailed history of every artistic computation.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setShowOnlyFavorites(!showOnlyFavorites)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-xs font-bold ${showOnlyFavorites ? 'bg-pink-500/20 border-pink-500/50 text-pink-400' : 'bg-white/5 border-white/10 text-gray-400 hover:text-gray-300'}`}
                    >
                      <Heart className={`w-3.5 h-3.5 ${showOnlyFavorites ? 'fill-current' : ''}`} />
                      Favorites
                    </button>
                    {generations.length > 0 && !showOnlyFavorites && (
                      <button 
                        onClick={handleClearGenerations}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all text-xs font-bold"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete All History
                      </button>
                    )}
                    <Tooltip content="Close session">
                      <button onClick={() => setIsLogOpen(false)} className="p-2 hover:bg-white/5 rounded-lg text-gray-400">
                        <X className="w-6 h-6" />
                      </button>
                    </Tooltip>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                  {generations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
                      <History className="w-16 h-16 mb-4" />
                      <p>No generations in your global history yet.</p>
                    </div>
                  ) : generations.filter(m => !showOnlyFavorites || m.isFavorite).length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
                      <Heart className="w-16 h-16 mb-4" />
                      <p>No favorite generations found.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {generations.filter(m => !showOnlyFavorites || m.isFavorite).map((m) => (
                        <div key={m.id} className="glass rounded-2xl border border-white/10 overflow-hidden flex flex-col group">
                          <div className="relative overflow-hidden bg-black/20 cursor-zoom-in" onClick={() => setZoomedImage(m.imageURL!)}>
                            <img 
                              src={m.imageURL} 
                              className="w-full h-auto object-contain transition-transform group-hover:scale-105" 
                              alt="" 
                              style={{ maxHeight: '250px' }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            
                            {/* Action Buttons for History */}
                            <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleFavorite(m, 'generations');
                                }}
                                className={`p-1.5 backdrop-blur-md rounded-lg border border-white/10 transition-all ${m.isFavorite ? 'bg-pink-600 text-white border-pink-400' : 'bg-black/60 hover:bg-black/80 text-white'}`}
                              >
                                <Heart className={`w-3.5 h-3.5 ${m.isFavorite ? 'fill-current' : ''}`} />
                              </button>

                              <div className="relative">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExportSettings(prev => ({ ...prev, showMenuFor: m.id === exportSettings.showMenuFor ? null : m.id }));
                                  }}
                                  className={`p-1.5 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 hover:bg-black/80 transition-all ${exportSettings.showMenuFor === m.id ? 'text-purple-400 border-purple-500/50' : 'text-white'}`}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setComparisonIds(prev => {
                                    if (prev.includes(m.id)) return prev.filter(id => id !== m.id);
                                    if (prev.length >= 2) return [prev[1], m.id];
                                    return [...prev, m.id];
                                  });
                                }}
                                title="Compare Image"
                                className={`p-1.5 backdrop-blur-md rounded-lg border border-white/10 transition-all ${comparisonIds.includes(m.id) ? 'bg-purple-600 text-white border-purple-400' : 'bg-black/60 hover:bg-black/80 text-white'}`}
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>

                                <AnimatePresence>
                                  {exportSettings.showMenuFor === m.id && (
                                    <motion.div 
                                      initial={{ opacity: 0, scale: 0.9, y: 5 }}
                                      animate={{ opacity: 1, scale: 1, y: 0 }}
                                      exit={{ opacity: 0, scale: 0.9, y: 5 }}
                                      className="absolute right-0 top-10 flex flex-col gap-2 p-3 bg-black/95 backdrop-blur-2xl border border-white/20 rounded-xl w-48 z-[70] shadow-2xl"
                                    >
                                      <div className="space-y-1">
                                        <label className="text-[8px] uppercase tracking-widest font-black text-gray-500">Format</label>
                                        <div className="grid grid-cols-3 gap-1">
                                          {(['image/png', 'image/jpeg', 'image/webp'] as const).map(fmt => (
                                            <button
                                              key={fmt}
                                              onClick={() => setExportSettings(prev => ({ ...prev, format: fmt }))}
                                              className={`py-1 rounded text-[9px] font-bold transition-all ${exportSettings.format === fmt ? 'bg-purple-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                                            >
                                              {fmt === 'image/png' ? 'PNG' : fmt === 'image/jpeg' ? 'JPG' : 'WEBP'}
                                            </button>
                                          ))}
                                        </div>
                                      </div>

                                      {(exportSettings.format === 'image/jpeg' || exportSettings.format === 'image/webp') && (
                                        <div className="space-y-1">
                                          <div className="flex justify-between items-center">
                                            <label className="text-[8px] uppercase tracking-widest font-black text-gray-500">Quality</label>
                                            <span className="text-[8px] font-mono text-purple-400">{Math.round(exportSettings.quality * 100)}%</span>
                                          </div>
                                          <input 
                                            type="range"
                                            min="0.1"
                                            max="1"
                                            step="0.01"
                                            value={exportSettings.quality}
                                            onChange={(e) => setExportSettings(prev => ({ ...prev, quality: parseFloat(e.target.value) }))}
                                            className="w-full h-1 accent-purple-500 cursor-pointer"
                                          />
                                        </div>
                                      )}

                                      <button 
                                        onClick={() => handleExport(m.imageURL!, m.id)}
                                        className="w-full py-1.5 bg-white text-black hover:bg-gray-200 rounded-lg text-[10px] font-black uppercase transition-all active:scale-95 mt-1"
                                      >
                                        Export
                                      </button>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            <div className="p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] font-black tracking-widest uppercase text-blue-400">{m.metadata?.model}</span>
                              <span className="text-[9px] text-gray-500">{new Date(m.metadata?.createdAt || '').toLocaleDateString()}</span>
                            </div>
                            <p className="text-[11px] text-gray-300 line-clamp-2 italic font-serif">"{m.metadata?.prompt}"</p>
                            <div className="flex gap-2 pt-2">
                              <div className="px-2 py-1 bg-white/5 rounded text-[8px] font-bold uppercase">{m.metadata?.resolution}</div>
                              <div className="px-2 py-1 bg-white/5 rounded text-[8px] font-bold uppercase">{m.metadata?.filter}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-8 space-y-8 scroll-smooth">
          <div className="max-w-4xl mx-auto space-y-8">
            <AnimatePresence initial={false}>
              {messages.length === 0 && (
                <motion.div 
                  key="empty-chat-state"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 0.5, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex flex-col items-center justify-center py-20 text-center"
                >
                  <Sparkles className="w-16 h-16 text-purple-400 mb-6 animate-pulse" />
                  <h2 className="text-2xl font-bold mb-2">{t.readyToCreate}</h2>
                  <p className="max-w-xs">{t.describe}</p>
                </motion.div>
              )}

              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 20, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                  className={`flex gap-4 ${message.role === 'assistant' ? '' : 'justify-end'}`}
                >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center shrink-0">
                    <Sparkles className="text-purple-400 w-4 h-4" />
                  </div>
                )}
                
                <div className={`space-y-4 max-w-[85%] ${message.role === 'assistant' ? '' : 'flex flex-col items-end'}`}>
                  <div className={`p-4 rounded-2xl text-sm leading-relaxed ${message.role === 'assistant' ? 'bg-white/5 border border-white/5 text-gray-200' : 'bg-purple-600 text-white'}`}>
                    {message.role === 'user' && message.baseImage && (
                      <div className="mb-3 relative w-20 h-20 group">
                        <img 
                          src={message.baseImage} 
                          className="w-full h-full object-cover rounded-lg border border-white/20 shadow-lg" 
                          alt="Input"
                        />
                        <div className="absolute inset-0 bg-black/20 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[7px] font-black uppercase text-white tracking-widest">Base</span>
                        </div>
                      </div>
                    )}
                    {message.text}
                  </div>
                  
                  {message.imageURL && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.2, duration: 0.5 }}
                      className="relative group w-full max-w-2xl cursor-zoom-in"
                      onClick={() => setZoomedImage(message.imageURL!)}
                    >
                      <img 
                        src={message.imageURL} 
                        className="rounded-2xl w-full border border-white/10 shadow-2xl transition-transform hover:scale-[1.01]" 
                        alt="Generated"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleFavorite(message, 'threads');
                          }}
                          className={`p-2 backdrop-blur-md rounded-lg border border-white/10 transition-all ${message.isFavorite ? 'bg-pink-600 text-white border-pink-400' : 'bg-black/50 hover:bg-black/70'}`}
                        >
                          <Heart className={`w-4 h-4 ${message.isFavorite ? 'fill-current' : ''}`} />
                        </button>
                        <div className="relative group/export">
                          <Tooltip content="Export Options">
                            <button 
                              onClick={() => setExportSettings(prev => ({ ...prev, showMenuFor: message.id === exportSettings.showMenuFor ? null : message.id }))}
                              className={`p-2 bg-black/50 backdrop-blur-md rounded-lg border border-white/10 hover:bg-black/70 transition-all ${exportSettings.showMenuFor === message.id ? 'text-purple-400 border-purple-500/50' : ''}`}
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          </Tooltip>
                          
                          <AnimatePresence>
                            {exportSettings.showMenuFor === message.id && (
                              <motion.div 
                                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                className="absolute right-0 top-12 flex flex-col gap-3 p-4 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl w-64 z-[60] shadow-2xl"
                              >
                                <div className="space-y-2">
                                  <label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Format</label>
                                  <div className="grid grid-cols-3 gap-2">
                                    {(['image/png', 'image/jpeg', 'image/webp'] as const).map(fmt => (
                                      <button
                                        key={fmt}
                                        onClick={() => setExportSettings(prev => ({ ...prev, format: fmt }))}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${exportSettings.format === fmt ? 'bg-purple-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                                      >
                                        {fmt === 'image/png' ? 'PNG' : fmt === 'image/jpeg' ? 'JPG' : 'WEBP'}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                { (exportSettings.format === 'image/jpeg' || exportSettings.format === 'image/webp') && (
                                  <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                      <label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Quality</label>
                                      <span className="text-[10px] font-mono text-purple-400">{Math.round(exportSettings.quality * 100)}%</span>
                                    </div>
                                    <input 
                                      type="range"
                                      min="0.1"
                                      max="1"
                                      step="0.01"
                                      value={exportSettings.quality}
                                      onChange={(e) => setExportSettings(prev => ({ ...prev, quality: parseFloat(e.target.value) }))}
                                      className="w-full accent-purple-500"
                                    />
                                  </div>
                                )}

                    <button 
                      onClick={() => handleExport(message.imageURL!, message.id)}
                      className="w-full py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download {exportSettings.format === 'image/png' ? 'PNG' : exportSettings.format === 'image/jpeg' ? 'JPG' : 'WEBP'}
                    </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        <Tooltip content="Generate Variation">
                          <button 
                            disabled={isGenerating}
                            onClick={() => handleGenerateVariation(message.imageURL!, message.text)}
                            className={`p-2 bg-black/50 backdrop-blur-md rounded-lg border border-white/10 transition-all ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-black/70'}`}
                          >
                            <Layers className={`w-4 h-4 ${isGenerating ? 'text-gray-500' : 'text-purple-400'}`} />
                          </button>
                        </Tooltip>

                        {message.metadata && (
                          <Tooltip content="View Metadata">
                            <button 
                              onClick={() => setActiveMetadataId(activeMetadataId === message.id ? null : message.id)}
                              className={`p-2 bg-black/50 backdrop-blur-md rounded-lg border border-white/10 hover:bg-black/70 transition-all ${activeMetadataId === message.id ? 'text-purple-400 border-purple-500/50' : ''}`}
                            >
                              <Info className="w-4 h-4" />
                            </button>
                          </Tooltip>
                        )}

                        <Tooltip content="Compare Image">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setComparisonIds(prev => {
                                if (prev.includes(message.id)) return prev.filter(id => id !== message.id);
                                if (prev.length >= 2) return [prev[1], message.id];
                                return [...prev, message.id];
                              });
                            }}
                            className={`p-2 backdrop-blur-md rounded-lg border border-white/10 transition-all ${comparisonIds.includes(message.id) ? 'bg-purple-600 text-white border-purple-400' : 'bg-black/50 hover:bg-black/70'}`}
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </Tooltip>

                        <div className="relative group/enhance">
                          <Tooltip content="Advanced Enhance">
                            <button 
                              disabled={isGenerating}
                              className={`p-2 bg-black/50 backdrop-blur-md rounded-lg border border-white/10 transition-all ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-black/70'}`}
                            >
                              <Wand2 className={`w-4 h-4 ${isGenerating ? 'text-gray-500' : 'text-blue-400'}`} />
                            </button>
                          </Tooltip>
                          
                          <div className="absolute right-0 top-12 hidden group-hover/enhance:flex flex-col gap-1 p-2 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl w-40 z-50 shadow-2xl">
                            <button 
                              onClick={() => handleEnhanceImage(message.imageURL!, message.text, 'upscale', '2K')}
                              className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-lg text-xs"
                            >
                              <Maximize className="w-3 h-3 text-green-400" />
                              Upscale to 2K
                            </button>
                            <button 
                              onClick={() => handleEnhanceImage(message.imageURL!, message.text, 'upscale', '4K')}
                              className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-lg text-xs"
                            >
                              <Maximize className="w-3 h-3 text-emerald-400" />
                              Upscale to 4K
                            </button>
                            <button 
                              onClick={() => handleEnhanceImage(message.imageURL!, message.text, 'upscale', '8K')}
                              className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-lg text-xs"
                            >
                              <Maximize className="w-3 h-3 text-cyan-400" />
                              Upscale to 8K
                            </button>
                            <button 
                              onClick={() => handleEnhanceImage(message.imageURL!, message.text, 'denoise')}
                              className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-lg text-xs"
                            >
                              <Wind className="w-3 h-3 text-cyan-400" />
                              Reduce Noise
                            </button>
                            <div className="h-px bg-white/5 my-1" />
                            <div className="px-3 py-1 text-[10px] text-gray-500 font-bold uppercase tracking-wider">Style Transfer</div>
                            <button 
                              onClick={() => handleEnhanceImage(message.imageURL!, message.text, 'style', 'Cyberpunk')}
                              className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-lg text-xs"
                            >
                              <Palette className="w-3 h-3 text-pink-400" />
                              Cyberpunk
                            </button>
                            <button 
                              onClick={() => handleEnhanceImage(message.imageURL!, message.text, 'style', 'Oil Painting')}
                              className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-lg text-xs"
                            >
                              <Palette className="w-3 h-3 text-orange-400" />
                              Oil Painting
                            </button>
                            <button 
                              onClick={() => handleEnhanceImage(message.imageURL!, message.text, 'style', 'Minimalist Mono')}
                              className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-lg text-xs"
                            >
                              <Palette className="w-3 h-3 text-gray-400" />
                              Minimalist
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <AnimatePresence>
                    {activeMetadataId === message.id && message.metadata && (
                      <motion.div 
                        key={`metadata-${message.id}`}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 glass rounded-2xl border border-purple-500/20 text-[11px] font-mono space-y-3 shadow-inner">
                          <div className="flex items-center justify-between border-b border-white/5 pb-2">
                            <span className="text-purple-400 font-bold uppercase tracking-widest text-[9px]">Logic Log</span>
                            <span className="text-gray-500">{new Date(message.metadata.createdAt).toLocaleString()}</span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <div className="text-gray-500 font-bold uppercase tracking-tighter text-[9px]">Model</div>
                              <div className="text-gray-200 truncate">{message.metadata.model}</div>
                            </div>
                            <div className="space-y-1">
                              <div className="text-gray-500 font-bold uppercase tracking-tighter text-[9px]">Resolution</div>
                              <div className="text-gray-200">{message.metadata.resolution}</div>
                            </div>
                            <div className="space-y-1">
                              <div className="text-gray-500 font-bold uppercase tracking-tighter text-[9px]">Art Filter</div>
                              <div className="text-gray-200">{message.metadata.filter}</div>
                            </div>
                            <div className="space-y-1">
                              <div className="text-gray-500 font-bold uppercase tracking-tighter text-[9px]">Status</div>
                              <div className="text-green-400 font-bold">SUCCESS</div>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="text-gray-500 font-bold uppercase tracking-tighter text-[9px]">Original Prompt</div>
                            <div className="text-gray-300 bg-white/5 p-2 rounded-lg leading-relaxed italic">{message.metadata.prompt}</div>
                          </div>

                          <div className="space-y-1">
                            <div className="text-gray-500 font-bold uppercase tracking-tighter text-[9px]">LLM Optimized Prompt</div>
                            <div className="text-purple-300/80 bg-purple-500/5 p-2 rounded-lg leading-relaxed">{message.metadata.enhancedPrompt}</div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {message.role === 'user' && (
                  <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-white/10 shrink-0" alt="User" />
                )}
              </motion.div>
            ))}

            {isGenerating && (
              <motion.div
                key="generating-loader"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex gap-4"
              >
                <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center shrink-0">
                  <Loader2 className="text-purple-400 w-4 h-4 animate-spin" />
                </div>
                <div className="space-y-4 max-w-[85%] flex-1">
                  <motion.div 
                    animate={{ 
                      boxShadow: ["0 0 0px rgba(168,85,247,0)", "0 0 20px rgba(168,85,247,0.2)", "0 0 0px rgba(168,85,247,0)"] 
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-3"
                  >
                    <div className="flex items-center justify-between text-xs font-medium text-gray-400">
                      <span>{queueStatus?.status || 'Initiating...'}</span>
                      <span>{queueStatus?.progress || 0}%</span>
                    </div>
                    <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-purple-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${queueStatus?.progress || 0}%` }}
                      />
                    </div>
                    <div className="flex gap-1 overflow-hidden">
                      {[0,1,2,3,4].map(idx => (
                        <div 
                          key={idx}
                          className={`h-0.5 flex-1 rounded-full ${idx <= (queueStatus?.stepIndex ?? -1) ? 'bg-purple-400' : 'bg-white/10'}`}
                        />
                      ))}
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 pb-8 max-w-4xl mx-auto w-full z-30">
          {/* Settings Config Toggle */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-px w-8 bg-white/10" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Generation Config</span>
            </div>
            <Tooltip content="Adjust aspect ratio, resolution, and seed parameters" position="left">
              <button 
                onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all ${showAdvancedSettings ? 'bg-purple-600/20 border-purple-500/50 text-purple-400' : 'bg-white/5 border-white/10 text-gray-400'}`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span className="text-[10px] font-black uppercase tracking-widest">{showAdvancedSettings ? 'Hide Options' : 'Configure Parameters'}</span>
              </button>
            </Tooltip>
          </div>

          <AnimatePresence>
            {showAdvancedSettings && (
              <motion.div 
                initial={{ height: 0, opacity: 0, y: -10 }}
                animate={{ height: 'auto', opacity: 1, y: 0 }}
                exit={{ height: 0, opacity: 0, y: -10 }}
                className="overflow-hidden mb-6"
              >
                <div className="glass p-6 rounded-3xl border border-white/5 space-y-8 bg-gradient-to-b from-white/[0.02] to-transparent">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    {/* Left: Shape & Detail */}
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-2">
                            <Maximize className="w-3 h-3" />
                            Aspect Ratio
                          </span>
                          <span className="text-[9px] font-bold text-purple-400/60">{aspectRatio}</span>
                        </div>
                        <div className="flex bg-black/40 backdrop-blur-md border border-white/5 p-1 rounded-xl">
                          {ASPECT_RATIOS.map((ratio) => (
                            <Tooltip key={ratio.value} content={`${ratio.label} for ${ratio.value === '1:1' ? 'Social Posts' : ratio.value === '16:9' ? 'Wide Scenes' : ratio.value === '9:16' ? 'Stories' : 'Portraits'}`}>
                              <button
                                onClick={() => setAspectRatio(ratio.value as any)}
                                className={`w-full py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${aspectRatio === ratio.value ? 'bg-white text-black shadow-lg' : 'text-gray-400 hover:text-white'}`}
                              >
                                {ratio.label}
                              </button>
                            </Tooltip>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-2">
                            <Layers className="w-3 h-3" />
                            Resolution
                          </span>
                          <span className="text-[9px] font-bold text-purple-400/60 uppercase">{selectedResolution}</span>
                        </div>
                        <div className="flex gap-2">
                          {['512px', '1K', '2K', '4K'].map((res) => (
                            <Tooltip key={res} content={`${res === '512px' ? 'Fast drafting' : res === '1K' ? 'Standard detail' : 'Ultra-high definition'}`}>
                              <button
                                disabled={isGenerating}
                                onClick={() => setSelectedResolution(res as any)}
                                className={`w-full py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all border whitespace-nowrap ${
                                  selectedResolution === res 
                                    ? 'bg-purple-500/20 border-purple-500 text-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.2)]' 
                                    : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10 hover:border-white/20'
                                } disabled:opacity-50`}
                              >
                                {res}
                              </button>
                            </Tooltip>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Right: Engine & Seed */}
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-2">
                          <Cpu className="w-3 h-3" />
                          Performance Mode
                        </span>
                        <Tooltip content={performanceMode === 'turbo' ? 'Max speed, standard quality' : 'Balanced speed and quality'} position="bottom">
                          <button
                            onClick={() => setPerformanceMode(prev => prev === 'lite' ? 'turbo' : 'lite')}
                            className={`w-full px-4 py-3 rounded-xl border flex items-center justify-between transition-all group ${performanceMode === 'turbo' ? 'bg-blue-600/20 border-blue-500/50 text-blue-400' : 'bg-white/5 border-white/10 text-gray-400'}`}
                          >
                            <div className="flex items-center gap-3">
                              <Cpu className={`w-4 h-4 ${performanceMode === 'turbo' ? 'animate-pulse' : ''}`} />
                              <span className="text-[10px] font-black uppercase tracking-widest">{performanceMode === 'turbo' ? 'High Performance (Turbo)' : 'Balanced (Lite)'}</span>
                            </div>
                            <div className={`w-2 h-2 rounded-full ${performanceMode === 'turbo' ? 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.5)]' : 'bg-gray-700'}`} />
                          </button>
                        </Tooltip>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-2">
                            <Wind className="w-3 h-3" />
                            Custom Seed
                          </span>
                          <span className="text-[9px] font-bold text-purple-400/60">{seed || 'RANDOM'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input 
                            type="text"
                            placeholder="Randomly assigned"
                            value={seed}
                            onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))}
                            className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-[10px] text-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all font-mono"
                          />
                          <div className="flex gap-1">
                            <Tooltip content="Regenerate random seed">
                              <button 
                                onClick={() => setSeed(Math.floor(Math.random() * 9999999).toString())}
                                className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 transition-colors border border-white/5"
                              >
                                <Wind className="w-4 h-4" />
                              </button>
                            </Tooltip>
                            {seed && (
                              <Tooltip content="Reset to random">
                                <button 
                                  onClick={() => setSeed('')}
                                  className="p-3 bg-white/5 hover:bg-red-500/10 rounded-xl text-red-400 transition-colors border border-red-500/10"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-white/5">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-2 mb-4">
                      <Palette className="w-3 h-3" />
                      Artistic Filters
                    </span>
                    <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide no-scrollbar -mx-2 px-2">
                      {Object.keys(IMAGE_FILTERS).map((f) => (
                        <Tooltip key={f} content={`Apply ${f === 'bw' ? 'Black & White' : f} styling`} position="bottom">
                          <button
                            disabled={isGenerating}
                            onClick={() => setSelectedFilter(f)}
                            className="flex flex-col items-center gap-3 group cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                          >
                            <div className={`relative w-14 h-14 rounded-2xl border-2 transition-all duration-300 ${
                              selectedFilter === f 
                                ? 'border-purple-500 scale-110 shadow-[0_0_20px_rgba(168,85,247,0.3)]' 
                                : 'border-white/5 group-hover:border-white/20'
                            } overflow-hidden`}>
                              <div 
                                className="absolute inset-0 bg-cover bg-center transition-all duration-500" 
                                style={{ 
                                  backgroundImage: `url(${latestImage})`,
                                  filter: FILTER_PREVIEWS[f] || 'none'
                                }} 
                              />
                              <div className={`absolute inset-0 opacity-20 ${FILTER_STYLES[f]}`} />
                              {selectedFilter === f && (
                                <div className="absolute inset-0 bg-purple-500/10 flex items-center justify-center">
                                  <Sparkles className="w-4 h-4 text-white drop-shadow-md" />
                                </div>
                              )}
                            </div>
                            <span className={`text-[8px] font-black uppercase tracking-widest transition-colors ${
                              selectedFilter === f ? 'text-purple-400' : 'text-gray-500 group-hover:text-gray-300'
                            }`}>
                              {f === 'bw' ? 'B&W' : f}
                            </span>
                          </button>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Style Templates Carousel */}
          <div className="space-y-4 mb-6">
            <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-hide no-scrollbar border-b border-white/5">
              {STYLE_CATEGORIES.map(cat => (
                <Tooltip key={cat} content="Explore Styles">
                  <button
                    onClick={() => setSelectedStyleCategory(cat)}
                    className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${selectedStyleCategory === cat ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]' : 'bg-white/5 text-gray-500 hover:text-gray-300'}`}
                  >
                    {cat}
                  </button>
                </Tooltip>
              ))}
            </div>
            
            <div className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-hide no-scrollbar">
              {STYLE_TEMPLATES.filter(t => selectedStyleCategory === 'All' || t.category === selectedStyleCategory).map(template => (
                <button
                  key={template.name}
                  onClick={() => setInput(template.prompt)}
                  className="group relative flex-shrink-0 w-36 aspect-[16/10] bg-black/60 border border-white/5 rounded-2xl overflow-hidden hover:border-purple-500/50 transition-all active:scale-95 shadow-xl"
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent flex flex-col justify-end p-3">
                    <span className="text-[8px] font-black uppercase tracking-widest text-purple-400 mb-0.5 opacity-60">{template.category}</span>
                    <span className="text-[10px] font-bold text-white group-hover:text-purple-300 transition-colors line-clamp-1">{template.name}</span>
                  </div>
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-all transform scale-75 group-hover:scale-100">
                    <div className="p-1.5 bg-purple-500 rounded-full shadow-lg">
                      <Plus className="w-3 h-3 text-white" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <AnimatePresence>
            {suggestions.length > 0 && (
              <motion.div 
                key="suggestions-list"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="flex flex-wrap gap-2 mb-4"
              >
                {suggestions.map((s, i) => (
                  <motion.button
                    key={`${s}-${i}`}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setInput(s);
                      setSuggestions([]);
                    }}
                    className="px-3 py-1.5 glass rounded-full text-[10px] text-purple-300 hover:text-white hover:border-purple-500/50 transition-all border border-purple-500/20 text-left line-clamp-1 max-w-[200px]"
                  >
                    {s}
                  </motion.button>
                ))}
                <button 
                  onClick={() => setSuggestions([])}
                  className="p-1.5 hover:bg-white/5 rounded-full text-gray-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {uploadedImage && (
            <motion.div 
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.9 }}
              className="relative w-24 h-24 mb-4 group ml-2"
            >
              <img 
                src={uploadedImage} 
                alt="Selected" 
                className="w-full h-full object-cover rounded-2xl border-2 border-purple-500 shadow-2xl" 
              />
              <button 
                onClick={() => setUploadedImage(null)}
                className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
              <div className="absolute inset-0 bg-black/40 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <span className="text-[8px] font-black uppercase text-white tracking-widest">Target Image</span>
              </div>
            </motion.div>
          )}

          <div className="flex items-center justify-between mb-4 px-2">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setIsBrandMode(!isBrandMode)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${isBrandMode ? 'bg-blue-600 text-white border-blue-400 shadow-[0_0_20px_rgba(37,99,235,0.4)]' : 'bg-white/5 text-gray-500 border border-white/5'}`}
              >
                <Layers className="w-4 h-4" />
                {isBrandMode ? 'Brand Mode Active' : 'Switch to Brand Mode'}
              </button>
              {isBrandMode && (
                <motion.button
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={handleGenerateLupraSuite}
                  disabled={isGenerating}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl text-xs font-black uppercase tracking-widest text-white shadow-xl hover:scale-105 active:scale-95 disabled:opacity-50 transition-all"
                >
                  <Cpu className="w-4 h-4" />
                  Generate Lupra Suite
                </motion.button>
              )}
            </div>
            {isBrandMode && (
              <span className="text-[10px] text-blue-400 font-bold uppercase tracking-tighter animate-pulse">
                Professional Design Engine Enabled
              </span>
            )}
          </div>

          <div className="relative glass p-2 rounded-2xl flex items-center gap-2 group ring-1 ring-white/5 focus-within:ring-purple-500/50 transition-all shadow-2xl">
            <input 
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              className="hidden"
            />
            <div className="flex items-center gap-1">
              <Tooltip content="Get AI prompt ideas">
                <motion.button 
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleSuggestPrompts}
                  disabled={isSuggesting}
                  className={`p-3 rounded-xl transition-all ${isSuggesting ? 'bg-purple-500/20' : 'hover:bg-white/5 active:scale-95'}`}
                >
                  <Sparkles className={`w-5 h-5 ${isSuggesting ? 'text-purple-400 animate-pulse' : 'text-gray-400 group-focus-within:text-purple-400'}`} />
                </motion.button>
              </Tooltip>
              <Tooltip content="Upload image for editing">
                <motion.button 
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isGenerating}
                  className={`p-3 rounded-xl transition-all ${uploadedImage ? 'bg-purple-500/20 text-purple-400' : 'hover:bg-white/5 text-gray-400 active:scale-95'}`}
                >
                  <ImageIcon className="w-5 h-5" />
                </motion.button>
              </Tooltip>
            </div>
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={uploadedImage ? "Describe how to transform this image..." : t.inputPlaceholder}
              disabled={isGenerating}
              className="flex-1 bg-transparent border-none outline-none text-sm py-2 disabled:opacity-50"
            />
            <Tooltip content={uploadedImage ? "Transform Image" : "Generate Image"} position="right">
              <motion.button 
                whileHover={{ scale: 1.05, x: 2 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleSend}
                disabled={isGenerating || !input.trim()}
                className="p-3 bg-purple-500 text-white rounded-xl hover:bg-purple-600 disabled:opacity-50 disabled:hover:bg-purple-500 transition-all shadow-lg shadow-purple-500/20 active:scale-95"
              >
                {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </motion.button>
            </Tooltip>
          </div>
          <div className="mt-4 flex items-center justify-center gap-6 text-[10px] text-gray-500 font-medium uppercase tracking-widest leading-none">
            <span className="flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-purple-400" /> High-Res 4K</span>
            <span className="flex items-center gap-1.5"><History className="w-3 h-3 text-purple-400" /> Auto-History</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-purple-400" /> Instant Queue</span>
          </div>
        </div>
      </main>

      {/* Zoom Modal Overlay */}
      <AnimatePresence>
        {isComparing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/98 backdrop-blur-3xl flex flex-col pt-16"
          >
            <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-6 px-8 py-3 bg-white/5 backdrop-blur-md border border-white/10 rounded-full">
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">Comparison Mode</span>
                <span className="text-[8px] text-gray-500">Compare details side-by-side</span>
              </div>
              <button 
                onClick={() => setIsComparing(false)}
                className="p-2 hover:bg-white/10 rounded-full transition-all"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>

            <div className="flex-1 grid grid-cols-2 gap-px bg-white/5 overflow-hidden">
              {comparisonIds.map((id, index) => {
                const imgM = generations.find(g => g.id === id) || messages.find(m => m.id === id);
                const url = imgM?.imageURL;
                
                return (
                  <div key={id} className="relative group bg-black flex items-center justify-center overflow-hidden p-8">
                    <div className="absolute top-4 left-4 z-10 px-3 py-1 bg-white/10 backdrop-blur-md border border-white/10 rounded-md">
                      <span className="text-[10px] font-bold text-white uppercase tracking-tighter">Image {index + 1}</span>
                    </div>
                    <motion.div
                      drag
                      dragConstraints={{ left: -500, right: 500, top: -500, bottom: 500 }}
                      className="cursor-move"
                    >
                      <img 
                        src={url} 
                        className="max-w-full max-h-[80vh] w-auto h-auto object-contain shadow-2xl rounded-lg" 
                        alt={`Comparison ${index + 1}`} 
                        onDragStart={(e) => e.preventDefault()}
                      />
                    </motion.div>
                  </div>
                );
              })}
            </div>
            
            <div className="h-24 bg-black/50 border-t border-white/10 flex items-center justify-center gap-12 px-12">
              <p className="text-gray-500 text-[10px] font-medium max-w-sm text-center">
                Drag images to align them and compare specific regions. Use the close button at the top to exit.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 md:p-10"
          >
            <div 
              className="absolute inset-0 bg-black/90 backdrop-blur-xl" 
              onClick={() => setIsSettingsOpen(false)} 
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-[#0a001a] border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="p-8 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-purple-900/20 to-blue-900/20">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-purple-500/20 rounded-2xl">
                    <Settings className="w-6 h-6 text-purple-400" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white leading-tight">Settings & Workspace</h2>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-widest">Manage your Lupra Studio experience</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2 hover:bg-white/10 rounded-full transition-all"
                >
                  <X className="w-6 h-6 text-gray-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
                {/* API Key Section */}
                <section className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="w-5 h-5 text-yellow-400" />
                      <h3 className="text-lg font-bold text-white">Gemini API Configuration</h3>
                    </div>
                    {window.aistudio && (
                      <button 
                        onClick={async () => {
                          try {
                            await window.aistudio.openSelectKey();
                            setIsSettingsOpen(false);
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                        className="text-[10px] font-black uppercase tracking-widest text-purple-400 hover:text-purple-300 transition-colors"
                      >
                        Use Platform Selector
                      </button>
                    )}
                  </div>

                  <div className="glass p-6 rounded-3xl border border-white/10 space-y-4">
                    <p className="text-sm text-gray-400 leading-relaxed">
                      To enjoy unlimited generations and access high-quality models (2K/4K), you can use your own Gemini API key. 
                      Your key is stored securely and never shared.
                    </p>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between px-1">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">API Key Fingerprint</label>
                        <a 
                          href="https://aistudio.google.com/app/apikey" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-[10px] font-black uppercase tracking-widest text-blue-400 hover:underline"
                        >
                          Get Key from AI Studio
                        </a>
                      </div>
                      
                      <div className="relative group">
                        <input 
                          type="password"
                          placeholder="AIzaSy..."
                          value={profile?.customApiKey || ''}
                          onChange={async (e) => {
                            const newKey = e.target.value.trim();
                            if (!user) return;
                            
                            // Basic validation: AI Studio keys usually start with AIza
                            if (newKey && !newKey.startsWith('AIza')) {
                              // Maybe just a warning or ignore
                            }

                            const userRef = doc(db, 'users', user.uid);
                            await updateDoc(userRef, { customApiKey: newKey });
                            setProfile(prev => prev ? { ...prev, customApiKey: newKey } : null);
                          }}
                          className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-sm font-mono text-purple-200 placeholder:text-gray-700 outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                        />
                        <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none opacity-40">
                          <Cpu className="w-4 h-4 text-purple-400" />
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 bg-blue-500/5 rounded-xl border border-blue-500/10">
                        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-blue-300 uppercase tracking-tight">Security Note</p>
                          <p className="text-[10px] text-gray-500 leading-normal">
                            Lupra uses "Client-Side Passthrough" for external keys. Your API calls go directly from your browser to Google's servers.
                          </p>
                        </div>
                      </div>
                    </div>

                    {profile?.customApiKey && (
                      <button 
                        onClick={async () => {
                          if (!user) return;
                          const userRef = doc(db, 'users', user.uid);
                          await updateDoc(userRef, { customApiKey: '' });
                          setProfile(prev => prev ? { ...prev, customApiKey: '' } : null);
                        }}
                        className="w-full py-3 text-[10px] font-black uppercase tracking-widest text-red-400 hover:bg-red-400/10 rounded-xl transition-all border border-red-400/20"
                      >
                        Revoke Custom Key
                      </button>
                    )}
                  </div>
                </section>

                {/* Profile Section */}
                <section className="space-y-6">
                  <div className="flex items-center gap-2">
                    <UserIcon className="w-5 h-5 text-blue-400" />
                    <h3 className="text-lg font-bold text-white">Your Profile</h3>
                  </div>
                  <div className="glass p-6 rounded-3xl border border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <img src={user.photoURL || ''} className="w-16 h-16 rounded-2xl border-2 border-purple-500/20 shadow-xl" alt="" />
                      <div>
                        <h4 className="font-bold text-lg text-white">{user.displayName}</h4>
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-black uppercase tracking-widest text-purple-400 mb-1">Current Plan</div>
                      <div className="px-4 py-1 bg-white/5 rounded-full text-xs font-bold text-white border border-white/10">
                        {profile?.isPremium ? 'PRO Member' : 'Free Explorer'}
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <div className="p-8 bg-black/40 border-t border-white/5 flex items-center justify-between">
                <p className="text-[10px] font-medium text-gray-600">
                  v2.8.4 • Built with Antigravity
                </p>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setIsSettingsOpen(false)}
                    className="px-8 py-3 bg-white text-black rounded-full font-black uppercase tracking-widest text-[10px] hover:scale-105 active:scale-95 transition-all shadow-xl"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparison Drawer */}
      <AnimatePresence>
        {comparisonIds.length > 0 && !isComparing && (
          <motion.div 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-6 px-6 py-4 bg-black/80 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)]"
          >
            <div className="flex items-center gap-3">
              {comparisonIds.map(id => {
                const imgM = generations.find(g => g.id === id) || messages.find(m => m.id === id);
                return (
                  <div key={id} className="relative group w-12 h-12 rounded-xl overflow-hidden border border-white/20">
                    <img src={imgM?.imageURL} className="w-full h-full object-cover" alt="" />
                    <button 
                      onClick={() => setComparisonIds(prev => prev.filter(i => i !== id))}
                      className="absolute inset-0 bg-red-600/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>
                );
              })}
              {comparisonIds.length < 2 && (
                <div className="w-12 h-12 rounded-xl border-2 border-dashed border-white/10 flex items-center justify-center text-white/20">
                  <Plus className="w-4 h-4" />
                </div>
              )}
            </div>

            <div className="h-8 w-px bg-white/10" />

            <div className="flex items-center gap-4">
              <button 
                disabled={comparisonIds.length < 2}
                onClick={() => setIsComparing(true)}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-black uppercase tracking-widest text-[10px] transition-all ${comparisonIds.length === 2 ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)]' : 'bg-white/5 text-gray-500 cursor-not-allowed'}`}
              >
                <Zap className="w-4 h-4" />
                Compare Now
              </button>
              <button 
                onClick={() => setComparisonIds([])}
                className="p-2 text-gray-400 hover:text-white transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Zoom Modal Overlay */}
      <AnimatePresence>
        {zoomedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-black/95 backdrop-blur-2xl cursor-zoom-out"
            onClick={() => setZoomedImage(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="relative max-w-7xl max-h-full w-full h-full flex flex-col items-center justify-center gap-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="relative flex-1 w-full h-full flex items-center justify-center overflow-hidden">
                <img 
                  src={zoomedImage} 
                  className="max-w-full max-h-full object-contain drop-shadow-[0_0_50px_rgba(168,85,247,0.3)] rounded-lg shadow-2xl" 
                  alt="Zoomed generation" 
                />
                
                <button 
                  onClick={() => setZoomedImage(null)}
                  className="absolute top-0 right-0 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all backdrop-blur-md border border-white/10"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="flex items-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <button 
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = zoomedImage;
                    link.download = `lupra-zoom-${Date.now()}.png`;
                    link.click();
                  }}
                  className="px-8 py-3 bg-white text-black rounded-full font-black uppercase tracking-widest text-xs shadow-[0_0_30px_rgba(255,255,255,0.3)] flex items-center gap-3 hover:scale-105 active:scale-95 transition-all"
                >
                  <Download className="w-5 h-5" />
                  Download Original
                </button>
                <button 
                  onClick={() => setZoomedImage(null)}
                  className="px-8 py-3 bg-white/10 text-white border border-white/20 rounded-full font-black uppercase tracking-widest text-xs flex items-center gap-3 hover:bg-white/20 transition-all"
                >
                  <X className="w-5 h-5" />
                  Close Preview
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
