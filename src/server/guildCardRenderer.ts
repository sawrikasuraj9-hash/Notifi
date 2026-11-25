/**
 * YASHI HALLS — Premium Dark Purple + Black WhatsApp UI Card Renderer (Server-Side)
 * Dynamically renders crisp PNG cards using Sharp (SVG -> PNG) for every phase of
 * the Interactive Guild Order & Auto Delivery System:
 *   - Phase 1: Welcome Service Selection Card
 *   - Phase 2: Bot Quantity Pricing Card
 *   - Phase 3: Premium Payment Card
 *   - Phase 5: Guild Configuration Card
 *   - Phase 7: Real-Status Launch Processing Card
 *   - Phase 8: Success Card & Live Glory Data Card
 */

import sharp from 'sharp';

function escXml(input: any): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateText(input: any, maxLen: number): string {
  const str = String(input ?? '').trim();
  if (str.length <= maxLen) return str;
  return str.slice(0, Math.max(1, maxLen - 1)) + '…';
}

function formatLkr(amount: number): string {
  const n = Number(amount) || 0;
  return `LKR ${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

async function svgToPngBuffer(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg, 'utf8')).png({ compressionLevel: 8 }).toBuffer();
}

function baseCardShell(width: number, height: number, brandName: string, subtitle: string, innerSvg: string): string {
  const safeBrand = escXml(truncateText(brandName || 'YASHI HALLS', 26));
  const safeSub = escXml(truncateText(subtitle, 52));
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#07040F"/>
      <stop offset="50%" stop-color="#110824"/>
      <stop offset="100%" stop-color="#090514"/>
    </linearGradient>
    <radialGradient id="purpleGlowTop" cx="85%" cy="10%" r="55%">
      <stop offset="0%" stop-color="#9333EA" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#9333EA" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="purpleGlowBot" cx="12%" cy="92%" r="50%">
      <stop offset="0%" stop-color="#6D28D9" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#6D28D9" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="accentLine" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#7C3AED"/>
      <stop offset="50%" stop-color="#C084FC"/>
      <stop offset="100%" stop-color="#7C3AED" stop-opacity="0.2"/>
    </linearGradient>
    <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#A855F7"/>
      <stop offset="100%" stop-color="#5B21B6"/>
    </linearGradient>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>
  <rect width="${width}" height="${height}" fill="url(#purpleGlowTop)"/>
  <rect width="${width}" height="${height}" fill="url(#purpleGlowBot)"/>

  <!-- Subtle outer frame -->
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="24" fill="#0D0819" fill-opacity="0.72" stroke="#7C3AED" stroke-opacity="0.35" stroke-width="1.5"/>

  <!-- Top Brand Header -->
  <g transform="translate(52, 48)">
    <rect x="0" y="0" width="52" height="52" rx="14" fill="url(#logoGrad)"/>
    <text x="26" y="34" text-anchor="middle" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="800">YH</text>
    <text x="68" y="24" fill="#F8FAFC" font-family="DejaVu Sans, Arial, sans-serif" font-size="23" font-weight="800" letter-spacing="1.5">${safeBrand}</text>
    <text x="68" y="45" fill="#C4B5FD" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="500" letter-spacing="0.5">${safeSub}</text>
  </g>

  <rect x="52" y="116" width="${width - 104}" height="2" fill="url(#accentLine)" opacity="0.7"/>

  ${innerSvg}

  <!-- Clean Footer -->
  <text x="52" y="${height - 38}" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="500">YASHI HALLS Automated Guild &amp; Delivery Platform</text>
  <text x="${width - 52}" y="${height - 38}" text-anchor="end" fill="#A78BFA" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="600">Secure Verified System</text>
</svg>`.trim();
}

/** PHASE 1 — Welcome Service Selection Card */
export async function renderWelcomeCardPng(brandName = 'YASHI HALLS'): Promise<Buffer> {
  const inner = `
    <g transform="translate(52, 152)">
      <text x="0" y="34" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="36" font-weight="800">Welcome to ${escXml(brandName)}</text>
      <text x="0" y="68" fill="#CBD5E1" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="400">What service would you like today? Select an option below.</text>

      <!-- Option 1: GUILD SERVICE -->
      <rect x="0" y="106" width="430" height="196" rx="18" fill="#170E2E" stroke="#9333EA" stroke-opacity="0.55" stroke-width="1.5"/>
      <text x="28" y="148" fill="#C084FC" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1.2">OPTION 01 · INSTANT AUTO DELIVERY</text>
      <text x="28" y="186" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="800">GUILD SERVICE</text>
      <text x="28" y="218" fill="#CBD5E1" font-family="DejaVu Sans, Arial, sans-serif" font-size="14">Free Fire Glory Bots (4 / 8 / 12 / 16 Bots)</text>
      <text x="28" y="242" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="13">Verified Bank Payment + Live Glory Monitoring</text>
      <rect x="28" y="262" width="170" height="24" rx="6" fill="#7C3AED" fill-opacity="0.25"/>
      <text x="40" y="278" fill="#E9D5FF" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="700">Tap GUILD SERVICE below</text>

      <!-- Option 2: PANEL SERVICE -->
      <rect x="466" y="106" width="430" height="196" rx="18" fill="#130D24" stroke="#64748B" stroke-opacity="0.35" stroke-width="1.5"/>
      <text x="494" y="148" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1.2">OPTION 02 · STORE CATALOG</text>
      <text x="494" y="186" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="800">PANEL SERVICE</text>
      <text x="494" y="218" fill="#CBD5E1" font-family="DejaVu Sans, Arial, sans-serif" font-size="14">Mobile, PC &amp; iOS Gaming Panels &amp; Keys</text>
      <text x="494" y="242" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="13">Browse full verified YASHI HALLS panel catalog</text>
      <rect x="494" y="262" width="170" height="24" rx="6" fill="#334155" fill-opacity="0.45"/>
      <text x="506" y="278" fill="#E2E8F0" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="700">Tap PANEL SERVICE below</text>
    </g>
  `;
  return svgToPngBuffer(baseCardShell(1000, 560, brandName, 'Official Interactive Order Hub', inner));
}

/** PHASE 2 — Bot Quantity Selection Card */
export async function renderQuantityCardPng(
  brandName: string,
  tierPricing: { bots4: number; bots8: number; bots12: number; bots16: number }
): Promise<Buffer> {
  const tiers = [
    { qty: 4, price: tierPricing.bots4, note: 'Starter Glory Pack' },
    { qty: 8, price: tierPricing.bots8, note: 'Standard Glory Pack' },
    { qty: 12, price: tierPricing.bots12, note: 'Pro Guild Pack' },
    { qty: 16, price: tierPricing.bots16, note: 'Maximum Glory Pack' },
  ];

  const boxes = tiers
    .map((t, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = col * 462;
      const y = 100 + row * 144;
      const isHighlight = t.qty === 4;
      return `
        <g transform="translate(${x}, ${y})">
          <rect x="0" y="0" width="434" height="122" rx="16" fill="${isHighlight ? '#1C1038' : '#140C28'}" stroke="${isHighlight ? '#A855F7' : '#6D28D9'}" stroke-opacity="${isHighlight ? '0.8' : '0.45'}" stroke-width="1.5"/>
          <text x="26" y="42" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="800">${t.qty} BOTS</text>
          <text x="26" y="70" fill="#A78BFA" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="600">${escXml(t.note)}</text>
          <text x="26" y="100" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">Instant Order ID + Receipt Verification</text>
          <text x="408" y="54" text-anchor="end" fill="#E9D5FF" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="800">${escXml(formatLkr(t.price))}</text>
          <text x="408" y="80" text-anchor="end" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">Total Price</text>
        </g>
      `;
    })
    .join('\n');

  const inner = `
    <g transform="translate(52, 146)">
      <text x="0" y="30" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="31" font-weight="800">How many Glory Bots do you need?</text>
      <text x="0" y="62" fill="#CBD5E1" font-family="DejaVu Sans, Arial, sans-serif" font-size="16">Choose your Glory Bot package below to generate your verified Payment Card.</text>
      ${boxes}
    </g>
  `;
  return svgToPngBuffer(baseCardShell(1000, 610, brandName, 'Guild Service · Bot Quantity Selection', inner));
}

/** PHASE 3 — Premium Payment UI Card */
export async function renderPaymentCardPng(params: {
  brandName: string;
  orderId: string;
  serviceLabel: string;
  botQuantity: number;
  amountLkr: number;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchName?: string;
  instructions: string;
}): Promise<Buffer> {
  const inner = `
    <g transform="translate(52, 142)">
      <text x="0" y="28" fill="#C084FC" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1.4">OFFICIAL PAYMENT CARD · PENDING PAYMENT</text>
      <text x="0" y="64" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="32" font-weight="800">Order ${escXml(params.orderId)}</text>

      <!-- Left Column: Order Summary -->
      <rect x="0" y="88" width="424" height="262" rx="16" fill="#150D2B" stroke="#7C3AED" stroke-opacity="0.45" stroke-width="1.5"/>
      <text x="24" y="122" fill="#A78BFA" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="700">ORDER SUMMARY</text>

      <text x="24" y="158" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="13">Order ID</text>
      <text x="400" y="158" text-anchor="end" fill="#F8FAFC" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="700">${escXml(params.orderId)}</text>

      <text x="24" y="196" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="13">Selected Service</text>
      <text x="400" y="196" text-anchor="end" fill="#F8FAFC" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="700">${escXml(truncateText(params.serviceLabel, 24))}</text>

      <text x="24" y="234" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="13">Selected Quantity</text>
      <text x="400" y="234" text-anchor="end" fill="#E9D5FF" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="800">${params.botQuantity} BOTS</text>

      <line x1="24" y1="262" x2="400" y2="262" stroke="#7C3AED" stroke-opacity="0.3" stroke-width="1"/>
      <text x="24" y="302" fill="#CBD5E1" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="600">Total Amount</text>
      <text x="400" y="308" text-anchor="end" fill="#C084FC" font-family="DejaVu Sans, Arial, sans-serif" font-size="28" font-weight="800">${escXml(formatLkr(params.amountLkr))}</text>

      <!-- Right Column: Bank Transfer Details -->
      <rect x="448" y="88" width="448" height="262" rx="16" fill="#130A26" stroke="#A855F7" stroke-opacity="0.55" stroke-width="1.5"/>
      <text x="472" y="122" fill="#C084FC" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="700">BANK TRANSFER DETAILS</text>

      <text x="472" y="156" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">Bank Name</text>
      <text x="472" y="178" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="17" font-weight="700">${escXml(truncateText(params.bankName || 'Configure in Admin', 34))}</text>

      <text x="472" y="212" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">Account Name</text>
      <text x="472" y="234" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" font-weight="700">${escXml(truncateText(params.accountName || 'YASHI HALLS', 34))}</text>

      <text x="472" y="268" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">Account Number${params.branchName ? ` · ${escXml(truncateText(params.branchName, 18))}` : ''}</text>
      <text x="472" y="298" fill="#E9D5FF" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="800" letter-spacing="1">${escXml(truncateText(params.accountNumber || 'Contact Admin', 26))}</text>

      <text x="472" y="330" fill="#A78BFA" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="600">Remark / Ref: ${escXml(params.orderId)}</text>

      <!-- Bottom Upload Instruction Strip -->
      <rect x="0" y="370" width="896" height="92" rx="14" fill="#1C1038" stroke="#9333EA" stroke-opacity="0.5" stroke-width="1"/>
      <text x="24" y="402" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="700">NEXT STEP: Upload Your Payment Receipt (Image / PDF / Document)</text>
      <text x="24" y="428" fill="#CBD5E1" font-family="DejaVu Sans, Arial, sans-serif" font-size="13">${escXml(truncateText(params.instructions || 'Transfer the exact amount and upload your receipt directly in this WhatsApp chat.', 96))}</text>
      <text x="24" y="448" fill="#A78BFA" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">Verified automatically against our real-time Bank Confirmation System.</text>
    </g>
  `;
  return svgToPngBuffer(baseCardShell(1000, 680, params.brandName, 'Guild Service · Payment Instructions', inner));
}

/** PHASE 5 — Interactive Guild Configuration Card */
export async function renderGuildConfigCardPng(params: {
  brandName: string;
  orderId: string;
  botQuantity: number;
  amountLkr: number;
  regionsPreview: string[];
}): Promise<Buffer> {
  const regionStr = params.regionsPreview.length > 0
    ? params.regionsPreview.slice(0, 6).join('  ·  ')
    : 'Bangladesh  ·  Indonesia  ·  India  ·  Europe  ·  Singapore';

  const inner = `
    <g transform="translate(52, 146)">
      <text x="0" y="24" fill="#4ADE80" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1.4">PAYMENT VERIFIED · ${escXml(formatLkr(params.amountLkr))}</text>
      <text x="0" y="62" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" font-weight="800">GLORY BOT CONFIGURATION</text>
      <text x="0" y="94" fill="#CBD5E1" font-family="DejaVu Sans, Arial, sans-serif" font-size="16">Please enter your Guild Details to continue launching Order ${escXml(params.orderId)} (${params.botQuantity} BOTS).</text>

      <rect x="0" y="122" width="896" height="196" rx="18" fill="#160E2E" stroke="#9333EA" stroke-opacity="0.55" stroke-width="1.5"/>
      <text x="28" y="160" fill="#C084FC" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1">AVAILABLE LIVE REGIONS (FFGLORY)</text>
      <text x="28" y="190" fill="#F8FAFC" font-family="DejaVu Sans, Arial, sans-serif" font-size="17" font-weight="600">${escXml(truncateText(regionStr, 78))}</text>

      <line x1="28" y1="214" x2="868" y2="214" stroke="#7C3AED" stroke-opacity="0.28"/>

      <text x="28" y="248" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" font-weight="700">How to Submit Your Guild Details:</text>
      <text x="28" y="276" fill="#CBD5E1" font-family="DejaVu Sans, Arial, sans-serif" font-size="14">1. Tap OPEN CONFIGURATION CARD below, choose Region, enter Guild ID &amp; press SUBMIT or COPY DETAILS.</text>
      <text x="28" y="300" fill="#CBD5E1" font-family="DejaVu Sans, Arial, sans-serif" font-size="14">2. Or tap a Region button right here in WhatsApp and reply with your Free Fire Guild ID.</text>
    </g>
  `;
  return svgToPngBuffer(baseCardShell(1000, 560, params.brandName, 'Phase 5 · Guild Configuration', inner));
}

/** PHASE 7 — Processing Card (Real Status Only — Zero Fake Percentages) */
export async function renderProcessingCardPng(params: {
  brandName: string;
  orderId: string;
  clanId: string;
  regionLabel: string;
  botQuantity: number;
  stageIndex: number; // 1..5
  currentStatusText: string;
}): Promise<Buffer> {
  const steps = [
    'Payment Verified',
    'Guild Details Verified',
    'Connecting to FFGlory',
    'Launch Request Submitted',
    'Waiting for API Response',
  ];

  const stepRows = steps
    .map((label, idx) => {
      const stepNum = idx + 1;
      const done = stepNum < params.stageIndex;
      const active = stepNum === params.stageIndex;
      const y = 210 + idx * 46;
      const circleFill = done ? '#22C55E' : active ? '#A855F7' : '#1E1B4B';
      const textFill = done ? '#86EFAC' : active ? '#FFFFFF' : '#64748B';
      const statusLabel = done ? 'DONE' : active ? 'IN PROGRESS' : 'PENDING';
      return `
        <g transform="translate(28, ${y})">
          <circle cx="14" cy="14" r="11" fill="${circleFill}"/>
          <text x="14" y="18" text-anchor="middle" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="800">${done ? '✓' : stepNum}</text>
          <text x="40" y="19" fill="${textFill}" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" font-weight="${active || done ? '700' : '500'}">${escXml(label)}</text>
          <text x="840" y="19" text-anchor="end" fill="${done ? '#4ADE80' : active ? '#C084FC' : '#475569'}" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="700">${statusLabel}</text>
        </g>
      `;
    })
    .join('\n');

  const inner = `
    <g transform="translate(52, 144)">
      <text x="0" y="24" fill="#C084FC" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1.4">LIVE EXECUTION STATUS</text>
      <text x="0" y="62" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="32" font-weight="800">YOUR GLORY BOTS ARE LAUNCHING</text>

      <!-- Info Strip -->
      <rect x="0" y="84" width="896" height="86" rx="14" fill="#150D2B" stroke="#7C3AED" stroke-opacity="0.45"/>
      <text x="24" y="114" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">ORDER ID</text>
      <text x="24" y="142" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="800">${escXml(params.orderId)}</text>

      <text x="248" y="114" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">GUILD ID</text>
      <text x="248" y="142" fill="#E9D5FF" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="800">${escXml(params.clanId)}</text>

      <text x="500" y="114" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">REGION</text>
      <text x="500" y="142" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="800">${escXml(params.regionLabel.toUpperCase())}</text>

      <text x="720" y="114" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">SELECTED QTY</text>
      <text x="720" y="142" fill="#C084FC" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="800">${params.botQuantity} BOTS</text>

      <!-- Real Steps Container -->
      <rect x="0" y="188" width="896" height="264" rx="16" fill="#110921" stroke="#6D28D9" stroke-opacity="0.35"/>
      ${stepRows}
    </g>
  `;
  return svgToPngBuffer(baseCardShell(1000, 670, params.brandName, truncateText(params.currentStatusText, 48), inner));
}

/** PHASE 8 — Premium Success Card */
export async function renderSuccessCardPng(params: {
  brandName: string;
  orderId: string;
  groupId: string;
  clanId: string;
  regionLabel: string;
  actualBotCount: number;
  launchTime: string;
  groupStatus: string;
  isTestMode?: boolean;
}): Promise<Buffer> {
  const inner = `
    <g transform="translate(52, 144)">
      <text x="0" y="24" fill="#4ADE80" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1.4">${params.isTestMode ? 'TEST MODE · VERIFIED LAUNCH' : 'LAUNCH CONFIRMED · FFGLORY API'}</text>
      <text x="0" y="62" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="31" font-weight="800">GLORY BOTS SUCCESSFULLY LAUNCHED!</text>

      <rect x="0" y="92" width="896" height="292" rx="18" fill="#140C28" stroke="#22C55E" stroke-opacity="0.45" stroke-width="1.5"/>

      <!-- Row 1 -->
      <text x="32" y="132" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">ORDER ID</text>
      <text x="32" y="160" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="800">${escXml(params.orderId)}</text>

      <text x="320" y="132" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">GROUP ID</text>
      <text x="320" y="160" fill="#C084FC" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="800">${escXml(truncateText(params.groupId, 22))}</text>

      <text x="660" y="132" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">GROUP STATUS</text>
      <text x="660" y="160" fill="#4ADE80" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="800">${escXml(params.groupStatus.toUpperCase())}</text>

      <line x1="32" y1="186" x2="864" y2="186" stroke="#7C3AED" stroke-opacity="0.25"/>

      <!-- Row 2 -->
      <text x="32" y="224" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">GUILD / CLAN ID</text>
      <text x="32" y="252" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="800">${escXml(params.clanId)}</text>

      <text x="320" y="224" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">SERVER REGION</text>
      <text x="320" y="252" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="800">${escXml(params.regionLabel.toUpperCase())}</text>

      <text x="660" y="224" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">ACTUAL BOT COUNT</text>
      <text x="660" y="252" fill="#E9D5FF" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="800">${params.actualBotCount} BOTS</text>

      <line x1="32" y1="282" x2="864" y2="282" stroke="#7C3AED" stroke-opacity="0.25"/>

      <text x="32" y="320" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">LAUNCH TIME</text>
      <text x="32" y="346" fill="#CBD5E1" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="600">${escXml(params.launchTime)}</text>

      <text x="864" y="346" text-anchor="end" fill="#A78BFA" font-family="DejaVu Sans, Arial, sans-serif" font-size="14" font-weight="700">Tap LIVE GLORY STATUS below to monitor real-time stats</text>
    </g>
  `;
  return svgToPngBuffer(baseCardShell(1000, 620, params.brandName, 'Order Delivered · Glory Group Active', inner));
}

/** PHASE 8 — Live Glory Data Card */
export async function renderLiveGloryCardPng(params: {
  brandName: string;
  orderId: string;
  groupId: string;
  clanId: string;
  currentGlory: string;
  clanName: string;
  clanLevel: string;
  memberCount?: string;
  groupStatus: string;
  lastUpdated: string;
}): Promise<Buffer> {
  const inner = `
    <g transform="translate(52, 144)">
      <text x="0" y="24" fill="#C084FC" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1.4">REAL-TIME FFGLORY TELEMETRY</text>
      <text x="0" y="62" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="32" font-weight="800">LIVE GLORY MONITOR</text>

      <!-- Big Glory Highlight Box -->
      <rect x="0" y="88" width="420" height="234" rx="18" fill="#1B0F38" stroke="#A855F7" stroke-opacity="0.7" stroke-width="1.5"/>
      <text x="28" y="128" fill="#C4B5FD" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="700">CURRENT CLAN GLORY</text>
      <text x="28" y="198" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="48" font-weight="800">${escXml(truncateText(params.currentGlory, 14))}</text>
      <text x="28" y="240" fill="#4ADE80" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="700">Status: ${escXml(params.groupStatus.toUpperCase())}</text>
      <text x="28" y="294" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">Group ID: ${escXml(truncateText(params.groupId, 26))}</text>

      <!-- Clan Info Box -->
      <rect x="444" y="88" width="452" height="234" rx="18" fill="#130B26" stroke="#7C3AED" stroke-opacity="0.45" stroke-width="1.5"/>
      <text x="472" y="128" fill="#A78BFA" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="700">CLAN DETAILS</text>

      <text x="472" y="166" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="13">Clan Name</text>
      <text x="868" y="166" text-anchor="end" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" font-weight="700">${escXml(truncateText(params.clanName, 22))}</text>

      <text x="472" y="206" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="13">Clan ID</text>
      <text x="868" y="206" text-anchor="end" fill="#E9D5FF" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" font-weight="700">${escXml(params.clanId)}</text>

      <text x="472" y="246" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="13">Clan Level</text>
      <text x="868" y="246" text-anchor="end" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" font-weight="700">${escXml(params.clanLevel)}</text>

      <text x="472" y="286" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="13">Members</text>
      <text x="868" y="286" text-anchor="end" fill="#FFFFFF" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" font-weight="700">${escXml(params.memberCount || 'N/A')}</text>

      <text x="0" y="362" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="13">Order: ${escXml(params.orderId)}  ·  Last Updated: ${escXml(params.lastUpdated)}</text>
    </g>
  `;
  return svgToPngBuffer(baseCardShell(1000, 580, params.brandName, 'Live Glory & Clan Stats', inner));
}
