import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export interface ReceiptOcrData {
  amountLkr: number;
  currency: string;
  bankName: string;
  transactionRefId: string;
  paymentDateTime: string;
  senderName: string;
  receiverAccount: string;
  remarkOrderId: string;
  confidence: number;
  isPaymentReceipt: boolean;
  rawSummary: string;
}

export interface ReceiptOcrResult {
  success: boolean;
  data?: ReceiptOcrData;
  error?: string;
}

const OCR_PRIMARY_MODEL = 'gemini-4-hydrogen';
const OCR_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

function sanitizeOcrError(err: any): string {
  const raw = String(err?.message || err || '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('503') || lower.includes('unavailable') || lower.includes('high demand')) {
    return 'AI scanner temporarily busy — routed for Bank & Admin approval';
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('quota')) {
    return 'AI scanner busy — routed for Bank & Admin approval';
  }
  if (lower.includes('timeout') || lower.includes('aborted')) {
    return 'AI scanner timed out — routed for Bank & Admin approval';
  }
  // Never leak raw JSON error blobs into WhatsApp messages
  if (raw.startsWith('{') || raw.includes('{"error"')) {
    return 'Receipt scan pending — routed for Bank & Admin approval';
  }
  return raw.slice(0, 110) || 'Automatic OCR unavailable';
}

function isRetryableGeminiError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('timeout') ||
    msg.includes('econnreset')
  );
}

/**
 * Extracts structured payment details from a customer-uploaded bank/eZ Cash receipt image or PDF
 * using Gemini Vision with automatic retry and fallback to gemini-3.1-flash-lite.
 *
 * SECURITY RULE: Receipt OCR NEVER auto-approves orders on its own.
 * It only extracts metadata for cross-checking against Bank Notifications or Owner approval.
 */
export async function extractPaymentReceiptWithAI(
  fileBuffer: Buffer,
  mimeType: string
): Promise<ReceiptOcrResult> {
  const safeMime = (mimeType || 'image/jpeg').split(';')[0].trim().toLowerCase();
  const supported =
    safeMime.startsWith('image/') || safeMime === 'application/pdf';

  if (!supported || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    return {
      success: false,
      error: 'Unsupported receipt file type (please send Image or PDF)',
    };
  }

  const ai = getGeminiClient();
  if (!ai) {
    return {
      success: false,
      error: 'OCR scanner not configured — routed for Bank & Admin approval',
    };
  }

  const prompt = [
    'You are a strict Sri Lankan payment receipt OCR extractor (NSB, Dialog eZ Cash, Commercial Bank, Sampath Bank, HNB, BOC, Peoples Bank, Seylan, NTB, FriMi, Genie, mCash, CEFT/SLIPS).',
    'Inspect this uploaded image or PDF carefully and extract exact payment details.',
    'Rules:',
    '- Return isPaymentReceipt=false if the file is clearly NOT a bank transfer slip, payment screenshot, eZ Cash / mCash slip, or financial receipt.',
    '- Extract the exact numeric paid amount (amountLkr) as a plain number (e.g. 650, 1300, 620). Ignore account numbers, phone numbers, and account balances.',
    '- Extract bankName (e.g. "Dialog eZ Cash", "NSB", "Commercial Bank", "Sampath Bank", "BOC", "HNB", "FriMi").',
    '- Extract transactionRefId (reference / transaction ID / receipt number / mobile sender number if shown).',
    '- Extract paymentDateTime as shown on the slip.',
    '- Extract receiverAccount (receiving account number like 100156103618 or eZ Cash number like 0743865934) if visible.',
    '- Extract remarkOrderId if any order code like YH-123456 appears in remarks.',
    '- Give a confidence score between 0 and 100.',
    '- Provide a concise 1-line rawSummary.',
  ].join('\n');

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      isPaymentReceipt: { type: Type.BOOLEAN },
      amountLkr: { type: Type.NUMBER },
      currency: { type: Type.STRING },
      bankName: { type: Type.STRING },
      transactionRefId: { type: Type.STRING },
      paymentDateTime: { type: Type.STRING },
      senderName: { type: Type.STRING },
      receiverAccount: { type: Type.STRING },
      remarkOrderId: { type: Type.STRING },
      confidence: { type: Type.NUMBER },
      rawSummary: { type: Type.STRING },
    },
    required: ['isPaymentReceipt', 'amountLkr', 'currency', 'confidence', 'rawSummary'],
  };

  const base64Data = fileBuffer.toString('base64');
  const attempts: Array<{ model: string; thinkingLevel?: ThinkingLevel }> = [
    { model: OCR_PRIMARY_MODEL, thinkingLevel: ThinkingLevel.LOW },
    { model: OCR_FALLBACK_MODEL },
    { model: OCR_FALLBACK_MODEL },
  ];

  let lastErr: any = null;

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 650 * i));
    }
    try {
      const config: Record<string, any> = {
        responseMimeType: 'application/json',
        responseSchema,
      };
      if (attempt.thinkingLevel) {
        config.thinkingConfig = { thinkingLevel: attempt.thinkingLevel };
      }

      const response = await ai.models.generateContent({
        model: attempt.model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: safeMime,
                  data: base64Data,
                },
              },
            ],
          },
        ],
        config,
      });

      const rawText = response.text || '{}';
      const parsed = JSON.parse(rawText);
      const amountNum =
        typeof parsed.amountLkr === 'number' && Number.isFinite(parsed.amountLkr) && parsed.amountLkr > 0
          ? Math.round(parsed.amountLkr * 100) / 100
          : 0;

      return {
        success: true,
        data: {
          amountLkr: amountNum,
          currency: String(parsed.currency || 'LKR').toUpperCase(),
          bankName: String(parsed.bankName || '').trim(),
          transactionRefId: String(parsed.transactionRefId || '').trim(),
          paymentDateTime: String(parsed.paymentDateTime || '').trim(),
          senderName: String(parsed.senderName || '').trim(),
          receiverAccount: String(parsed.receiverAccount || '').trim(),
          remarkOrderId: String(parsed.remarkOrderId || '').trim().toUpperCase(),
          confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
          isPaymentReceipt: parsed.isPaymentReceipt !== false,
          rawSummary: String(parsed.rawSummary || 'Receipt scanned').trim(),
        },
      };
    } catch (err: any) {
      lastErr = err;
      if (!isRetryableGeminiError(err) && i >= 1) {
        break;
      }
    }
  }

  return {
    success: false,
    error: sanitizeOcrError(lastErr),
  };
}
