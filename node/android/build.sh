#!/bin/sh
# Builds the Loom Node app (loom-node.apk) with no gradle: it embeds the
# loom-node daemon as a native lib and supervises it with a foreground service,
# so an Android device joins by installing one APK instead of Termux. See
# node/android/README for the why. rel/deploy.sh runs this when an Android
# build toolchain is present; otherwise devices just won't get the APK.
#
# gradle-free pipeline: aapt2 -> javac -> d8 -> zip -> zipalign -> apksigner.
# aapt2/zipalign must be the host-arch build (Google ships x86_64 only; on arm64
# use the distro's: apt install aapt zipalign). d8/apksigner are JVM wrappers.
set -eu
APP="$(cd "$(dirname "$0")" && pwd)"
NODE="$(cd "$APP/.." && pwd)"

: "${JAVA_HOME:=$(dirname "$(dirname "$(readlink -f "$(command -v javac 2>/dev/null || echo /usr/bin/javac)")")")}"
: "${ANDROID_HOME:=$HOME/android-sdk}"
BT="$ANDROID_HOME/build-tools/34.0.0"
JAR="$ANDROID_HOME/platforms/android-34/android.jar"
MINSDK=26
TARGETSDK=34
AAPT2="$(command -v aapt2 || echo "$BT/aapt2")"
ZIPALIGN="$(command -v zipalign || echo "$BT/zipalign")"

cd "$APP"
rm -rf build/gen build/classes build/dex build/*.apk build/res.zip
mkdir -p build/gen build/classes build/dex lib/arm64-v8a

echo "[0/6] build loom-node daemon (embedded as libloomnode.so)"
( cd "$NODE" && CGO_ENABLED=0 GOOS=android GOARCH=arm64 \
    go build -trimpath -ldflags "-s -w" -o android/lib/arm64-v8a/libloomnode.so . )

# Bake the join origin (so the app accepts a bare code); empty ⇒ paste a full URL.
cat > res/values/config.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="join_origin">${LOOM_JOIN_ORIGIN:-}</string>
</resources>
XML

echo "[1/6] aapt2 compile resources"
"$AAPT2" compile --dir res -o build/res.zip

# Every build is strictly newer (epoch minutes, fits a 31-bit int until ~4147),
# so the system installer always accepts it as an update over the installed one.
VC=$(( $(date +%s) / 60 ))
VN="1.$VC"
echo "[2/6] aapt2 link (versionCode $VC)"
"$AAPT2" link -o build/base.apk -I "$JAR" --manifest AndroidManifest.xml \
  --java build/gen --min-sdk-version "$MINSDK" --target-sdk-version "$TARGETSDK" \
  --version-code "$VC" --version-name "$VN" build/res.zip

echo "[3/6] javac"
find src build/gen -name '*.java' > build/sources.txt
"$JAVA_HOME/bin/javac" -encoding UTF-8 -cp "$JAR" -d build/classes @build/sources.txt

echo "[4/6] d8 -> dex"
"$BT/d8" --min-api "$MINSDK" --lib "$JAR" --output build/dex $(find build/classes -name '*.class')

echo "[5/6] assemble apk (dex + native binary)"
cp build/base.apk build/unsigned.apk
( cd build/dex && zip -q ../unsigned.apk classes.dex )
zip -q -0 build/unsigned.apk lib/arm64-v8a/libloomnode.so
"$ZIPALIGN" -f -p 4 build/unsigned.apk build/aligned.apk

echo "[6/6] sign"
if [ ! -f build/loom.jks ]; then
  "$JAVA_HOME/bin/keytool" -genkeypair -keystore build/loom.jks -alias loom \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass loomnode -keypass loomnode -dname "CN=Loom Node" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks build/loom.jks --ks-pass pass:loomnode --key-pass pass:loomnode \
  --out build/loom-node.apk build/aligned.apk
"$BT/apksigner" verify build/loom-node.apk >/dev/null
echo "OK -> $APP/build/loom-node.apk"
