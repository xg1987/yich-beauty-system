#!/bin/sh
set -eu

MODE="${1:-apk}"
PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

export JAVA_HOME ANDROID_HOME ANDROID_SDK_ROOT
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

cd "$PROJECT_ROOT"

npm run build
npx cap sync android

if [ "$MODE" = "sync" ]; then
  exit 0
fi

cd android
./gradlew assembleDebug
cd "$PROJECT_ROOT"

mkdir -p public
cp android/app/build/outputs/apk/debug/app-debug.apk public/zhurongkftech-app.apk
echo "APK written to public/zhurongkftech-app.apk"
