/**
 * Normalizes Sri Lankan or international phone numbers into WhatsApp JID digits (without '+' or '@s.whatsapp.net').
 */
export function normalizeWhatsAppNumber(input: string, defaultCountryCode = '94'): string {
  const raw = String(input || '').trim();
  if (!raw) return '';

  // Strip JID suffixes if passed
  const withoutJid = raw.split('@')[0].split(':')[0];
  let digits = withoutJid.replace(/\D/g, '');
  if (!digits) return '';

  const cc = String(defaultCountryCode || '94').replace(/\D/g, '') || '94';

  // Handle leading international "00"
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Handle common mistake: country code followed by local trunk "0" (e.g. +94 0740712934 -> 94740712934)
  if (
    digits.startsWith(`${cc}0`) &&
    digits.length >= cc.length + 9 &&
    digits.length <= cc.length + 11
  ) {
    digits = `${cc}${digits.slice(cc.length + 1)}`;
  }

  // Handle local leading "0" (e.g., 0740712934 -> 94740712934)
  if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 11) {
    digits = `${cc}${digits.slice(1)}`;
  } else if (digits.length === 9 && cc === '94' && digits.startsWith('7')) {
    // 9-digit Sri Lankan mobile without leading 0
    digits = `${cc}${digits}`;
  } else if (!digits.startsWith(cc) && digits.length >= 7 && digits.length <= 10) {
    // Local number without country code (covers 9-digit SL and 10-digit IN/UK/US numbers)
    digits = `${cc}${digits}`;
  }

  return digits;
}
