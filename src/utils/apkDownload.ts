import { authFetch } from '../firebase';

export interface WhatsAppApkResult {
  success: boolean;
  sentTo?: string;
  viaBot?: string;
  message: string;
}

/**
 * Fetches YashiHallsPay-v1.0.0.apk using the authenticated browser fetch session
 * (sending preview cookies), verifies the APK ZIP ("PK") magic header so Google AI Studio's
 * HTML Cookie Check page is never mistakenly saved as a broken .apk file, and triggers
 * an in-memory Blob download.
 */
export async function downloadPayApkViaBlob(): Promise<void> {
  const res = await authFetch('/api/business/pay/apk/download', {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/vnd.android.package-archive, application/octet-stream',
    },
  });

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!res.ok || contentType.includes('text/html')) {
    throw new Error(
      'Browser Security Cookie නිසා කෙලින්ම APK එක ඩවුන්ලෝඩ් වීම අවහිර විය. කරුණාකර "Send APK to WhatsApp" ඔබන්න හෝ WhatsApp එකේ .payapk යවන්න.'
    );
  }

  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isValidZipApk = bytes.length > 1024 && bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (!isValidZipApk) {
    throw new Error(
      'වලංගු APK ගොනුවක් නොලැබුණි (Cookie Check පිටුවක් විය හැක). "Send APK to WhatsApp" භාවිතා කරන්න!'
    );
  }

  const blob = new Blob([buffer], {
    type: 'application/vnd.android.package-archive',
  });
  const blobUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = 'YashiHallsPay-v2.0.0.apk';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 15000);
}

/**
 * Sends the real YashiHallsPay-v1.0.0.apk directly as a WhatsApp document via the
 * active Business Bot or Main Bot engine — 100% bypassing mobile browser cookie issues.
 */
export async function sendPayApkToWhatsApp(
  businessBotUserId: string,
  phoneNumber?: string
): Promise<WhatsAppApkResult> {
  const res = await authFetch('/api/business/pay/apk/send-whatsapp', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': businessBotUserId,
    },
    body: JSON.stringify({
      userId: businessBotUserId,
      phoneNumber: phoneNumber?.trim() || undefined,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    return {
      success: false,
      message:
        data?.message ||
        'WhatsApp වෙත APK එක යැවීමට නොහැකි විය. Bot එක Connect දැයි පරීක්ෂා කරන්න.',
    };
  }

  return {
    success: true,
    sentTo: data.sentTo,
    viaBot: data.viaBot,
    message:
      data.message || 'YashiHallsPay-v1.0.0.apk ඔබේ WhatsApp වෙත සාර්ථකව යවන ලදී!',
  };
}
