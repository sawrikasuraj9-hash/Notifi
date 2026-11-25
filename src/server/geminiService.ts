import { GoogleGenAI, Type } from '@google/genai';

export interface ChatMemoryItem {
  role: 'user' | 'assistant' | 'model';
  text: string;
  senderName?: string;
  timestamp?: number;
  hasLink?: string;
}

export interface GeminiTextResult {
  success: boolean;
  text: string;
  error?: string;
}

export interface SmartChatAIResult {
  replyText: string;
  action?: 'none' | 'send_mp3' | 'send_video';
  targetQuery?: string;
}

function createAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) return null;
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const DEFAULT_MODEL = 'gemini-4-hydrogen';

export async function askGemini(prompt: string, context?: string): Promise<GeminiTextResult> {
  const ai = createAiClient();
  if (!ai) {
    return {
      success: false,
      text: 'AI service is currently unavailable because GEMINI_API_KEY is not configured on the server.',
      error: 'GEMINI_API_KEY missing',
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: prompt,
      config: context
        ? { systemInstruction: context }
        : {
            systemInstruction:
              'You are YASHI HALLS MINI BOT AI — a helpful, concise, friendly assistant fluent in Sinhala, Singlish, and English. Format responses cleanly for WhatsApp.',
          },
    });
    const text = (response.text || '').trim();
    return {
      success: true,
      text: text || 'No response generated.',
    };
  } catch (err: any) {
    return {
      success: false,
      text: `AI request failed: ${err?.message || 'Unknown error'}`,
      error: err?.message || String(err),
    };
  }
}

export async function analyzeAudioWithGemini(
  audioBuffer: Buffer,
  mimeType = 'audio/ogg'
): Promise<GeminiTextResult> {
  const ai = createAiClient();
  if (!ai) {
    return { success: false, text: 'AI audio analysis unavailable (API key missing).', error: 'GEMINI_API_KEY missing' };
  }
  try {
    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'audio/ogg',
              data: audioBuffer.toString('base64'),
            },
          },
          {
            text: 'Listen to this WhatsApp voice note or audio clip. Understand what the speaker says (in Sinhala, Singlish, or English) and reply helpfully and naturally in the same language.',
          },
        ],
      },
    });
    return { success: true, text: (response.text || '').trim() || 'Could not interpret the audio.' };
  } catch (err: any) {
    return { success: false, text: `Audio analysis failed: ${err?.message || 'Error'}`, error: err?.message };
  }
}

export async function transcribeAudioWithGemini(
  audioBuffer: Buffer,
  mimeType = 'audio/ogg'
): Promise<GeminiTextResult> {
  const ai = createAiClient();
  if (!ai) {
    return { success: false, text: 'Transcription unavailable (API key missing).', error: 'GEMINI_API_KEY missing' };
  }
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'audio/ogg',
              data: audioBuffer.toString('base64'),
            },
          },
          {
            text: 'Transcribe all spoken words accurately in the original language (Sinhala, English, Tamil, etc.). Output only the clean transcript.',
          },
        ],
      },
    });
    return { success: true, text: (response.text || '').trim() || 'No speech detected.' };
  } catch (err: any) {
    return { success: false, text: `Transcription failed: ${err?.message || 'Error'}`, error: err?.message };
  }
}

export async function translateAudioWithGemini(
  audioBuffer: Buffer,
  mimeType = 'audio/ogg',
  targetLang = 'English'
): Promise<GeminiTextResult> {
  const ai = createAiClient();
  if (!ai) {
    return { success: false, text: 'Audio translation unavailable (API key missing).', error: 'GEMINI_API_KEY missing' };
  }
  try {
    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'audio/ogg',
              data: audioBuffer.toString('base64'),
            },
          },
          {
            text: `Transcribe the spoken audio and provide a clear, accurate translation into ${targetLang}. Format with Original and Translation sections.`,
          },
        ],
      },
    });
    return { success: true, text: (response.text || '').trim() || 'Could not translate audio.' };
  } catch (err: any) {
    return { success: false, text: `Audio translation failed: ${err?.message || 'Error'}`, error: err?.message };
  }
}

export async function analyzeVideoWithGemini(
  videoBuffer: Buffer,
  mimeType = 'video/mp4',
  caption?: string
): Promise<GeminiTextResult> {
  const ai = createAiClient();
  if (!ai) {
    return { success: false, text: 'Video analysis unavailable (API key missing).', error: 'GEMINI_API_KEY missing' };
  }
  try {
    const prompt = caption?.trim()
      ? `Analyze this video based on the user's request: "${caption.trim()}". Reply concisely in Sinhala or English matching the user's language.`
      : 'Summarize what happens in this video concisely in clear Sinhala & English.';
    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'video/mp4',
              data: videoBuffer.toString('base64'),
            },
          },
          { text: prompt },
        ],
      },
    });
    return { success: true, text: (response.text || '').trim() || 'Could not analyze the video.' };
  } catch (err: any) {
    return { success: false, text: `Video analysis failed: ${err?.message || 'Error'}`, error: err?.message };
  }
}

export async function generateCVWithGemini(details: string): Promise<GeminiTextResult> {
  const prompt = `Create a polished, professional, ATS-friendly CV / Resume formatted neatly for WhatsApp using bold headings and bullet points based on these details:\n\n${details}`;
  return askGemini(
    prompt,
    'You are an expert executive career coach and CV writer. Create clean, structured resumes ready to copy or share.'
  );
}

export async function chatAsYashiHallsAI(params: {
  userText: string;
  senderName?: string;
  recentMessages?: ChatMemoryItem[];
}): Promise<SmartChatAIResult> {
  const ai = createAiClient();
  if (!ai) {
    return {
      replyText: 'හායි! මට දැන් AI සේවාවට සම්බන්ධ වීමට නොහැකිය. පසුව නැවත උත්සාහ කරන්න.',
      action: 'none',
    };
  }

  const historyLines = (params.recentMessages || [])
    .slice(-8)
    .map((m) => `${m.role === 'user' ? m.senderName || 'User' : 'YASHI Bot'}: ${m.text}`)
    .join('\n');

  const prompt = [
    historyLines ? `Recent conversation:\n${historyLines}\n` : '',
    `Sender: ${params.senderName || 'Friend'}`,
    `Message: ${params.userText}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: prompt,
      config: {
        systemInstruction:
          'You are YASHI HALLS Smart WhatsApp Assistant. Reply naturally, briefly (1-3 sentences), friendly, matching Sinhala / Singlish / English. If the user explicitly asks to download/send a song or MP3 (or asks for the MP3 of a previously shared link), set action to "send_mp3" and targetQuery to the song name or URL. Otherwise set action to "none".',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            replyText: { type: Type.STRING },
            action: { type: Type.STRING },
            targetQuery: { type: Type.STRING },
          },
          required: ['replyText', 'action'],
        },
      },
    });

    const raw = (response.text || '').trim();
    const parsed = JSON.parse(raw);
    return {
      replyText: String(parsed.replyText || '').trim() || 'හරි! තව මොනවද උදව් ඕනේ?',
      action: parsed.action === 'send_mp3' ? 'send_mp3' : 'none',
      targetQuery: parsed.targetQuery ? String(parsed.targetQuery) : undefined,
    };
  } catch {
    const fallback = await askGemini(params.userText);
    return {
      replyText: fallback.text || 'හරි! කොහොමද උදව් කරන්නේ?',
      action: 'none',
    };
  }
}
