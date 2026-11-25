#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/android-pay"
SDK_DIR="/opt/android-sdk"
BT_DIR="$SDK_DIR/build-tools/34.0.0"
PLATFORM_JAR="$SDK_DIR/platforms/android-34/android.jar"
BUILD_DIR="/tmp/yashipay_build"
OUT_DIR="$ROOT_DIR/data/apk"
KEYSTORE="$OUT_DIR/yashipay-keystore.p12"
OUT_APK="$OUT_DIR/YashiHallsPay-v1.0.0.apk"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/res_compiled" "$BUILD_DIR/gen" "$BUILD_DIR/classes" "$BUILD_DIR/dex" "$OUT_DIR"

# 1. Generate crisp dark-gold launcher icons via Node + sharp
node -e '
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

async function main() {
  const sizes = [
    ["mipmap-mdpi", 48],
    ["mipmap-hdpi", 72],
    ["mipmap-xhdpi", 96],
    ["mipmap-xxhdpi", 144],
    ["mipmap-xxxhdpi", 192],
  ];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0B1324"/>
          <stop offset="100%" stop-color="#050811"/>
        </linearGradient>
        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FDE68A"/>
          <stop offset="50%" stop-color="#F59E0B"/>
          <stop offset="100%" stop-color="#D97706"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#bg)"/>
      <rect x="24" y="24" width="464" height="464" rx="94" fill="none" stroke="url(#gold)" stroke-width="14"/>
      <text x="256" y="258" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="168" fill="url(#gold)" letter-spacing="4">YH</text>
      <rect x="136" y="302" width="240" height="66" rx="33" fill="url(#gold)"/>
      <text x="256" y="349" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="38" fill="#050A14" letter-spacing="6">PAY</text>
    </svg>
  `;
  for (const [folder, size] of sizes) {
    const dir = path.join(process.argv[1], "res", folder);
    fs.mkdirSync(dir, { recursive: true });
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(dir, "ic_launcher.png"));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
' "$APP_DIR"

# 2. Generate signing keystore if missing
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -storetype PKCS12 \
    -alias yashipay \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass "YashiHallsPay2026" \
    -keypass "YashiHallsPay2026" \
    -dname "CN=YASHI HALLS Pay, OU=Business Automation, O=YASHI HALLS, L=Colombo, C=LK" >/dev/null 2>&1
fi

# 3. Compile Android resources with aapt2
"$BT_DIR/aapt2" compile --dir "$APP_DIR/res" -o "$BUILD_DIR/res.zip"
"$BT_DIR/aapt2" link \
  -o "$BUILD_DIR/unaligned.apk" \
  -I "$PLATFORM_JAR" \
  --manifest "$APP_DIR/AndroidManifest.xml" \
  --java "$BUILD_DIR/gen" \
  "$BUILD_DIR/res.zip"

# 4. Compile Java sources (including generated R.java)
find "$APP_DIR/src" "$BUILD_DIR/gen" -name "*.java" > "$BUILD_DIR/sources.txt"
javac -source 1.8 -target 1.8 -Xlint:-options \
  -bootclasspath "$PLATFORM_JAR" \
  -classpath "$PLATFORM_JAR" \
  -d "$BUILD_DIR/classes" \
  @"$BUILD_DIR/sources.txt"

# 5. Convert bytecode to DEX via d8
CLASS_FILES=$(find "$BUILD_DIR/classes" -name "*.class")
"$BT_DIR/d8" --min-api 26 --lib "$PLATFORM_JAR" --output "$BUILD_DIR/dex" $CLASS_FILES

# 6. Inject classes.dex into unaligned APK
(cd "$BUILD_DIR/dex" && zip -q "$BUILD_DIR/unaligned.apk" classes.dex)

# 7. Align & Sign APK (v1 + v2 + v3)
"$BT_DIR/zipalign" -f 4 "$BUILD_DIR/unaligned.apk" "$BUILD_DIR/aligned.apk"
"$BT_DIR/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-pass "pass:YashiHallsPay2026" \
  --ks-key-alias yashipay \
  --key-pass "pass:YashiHallsPay2026" \
  --out "$OUT_APK" \
  "$BUILD_DIR/aligned.apk"

# 8. Verify APK signature & print summary
"$BT_DIR/apksigner" verify --verbose "$OUT_APK"
rm -rf "$BUILD_DIR"
ls -lh "$OUT_APK"
