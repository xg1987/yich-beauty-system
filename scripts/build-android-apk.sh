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

APK_PATH="public/zhurongkftech-app.apk"
APK_BACKUP=""

restore_apk() {
  if [ -n "$APK_BACKUP" ] && [ -f "$APK_BACKUP" ]; then
    mkdir -p public
    mv "$APK_BACKUP" "$APK_PATH"
  fi
}

if [ -f "$APK_PATH" ]; then
  APK_BACKUP="$(mktemp "${TMPDIR:-/tmp}/zhurong-apk.XXXXXX")"
  mv "$APK_PATH" "$APK_BACKUP"
  trap restore_apk EXIT INT TERM
fi

rm -f dist/zhurongkftech-app.apk android/app/src/main/assets/public/zhurongkftech-app.apk

npm run build
npx cap sync android

if [ "$MODE" = "sync" ]; then
  exit 0
fi

if [ -n "$APK_BACKUP" ] && [ -f "$APK_BACKUP" ]; then
  rm "$APK_BACKUP"
  APK_BACKUP=""
  trap - EXIT INT TERM
fi

cd android
./gradlew assembleDebug
cd "$PROJECT_ROOT"

mkdir -p public
cp android/app/build/outputs/apk/debug/app-debug.apk "$APK_PATH"
echo "APK written to $APK_PATH"

npm run build
echo "dist refreshed with latest APK"
