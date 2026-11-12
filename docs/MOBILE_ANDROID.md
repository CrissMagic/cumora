# Cumora Android

For a Windows PC hosting the service and a physical phone on the same LAN, use
[LOCAL_PC_TRIAL.md](LOCAL_PC_TRIAL.md). It also covers login without configuring
an OAuth provider and keeps existing Cumora instances separate.

The existing Capacitor shell uses the shared mobile UI. Android 7.0 (API 24)
or newer is required; a current Android System WebView is recommended.

## Build a debug APK

Install Node.js 24, JDK 21, and Android Studio with Android SDK Platform 36,
Build Tools 36.0.0 and platform-tools. Accept the Android SDK licenses. Point
`ANDROID_HOME` at the SDK or set `sdk.dir` in `android/local.properties`
(use forward slashes on Windows). Keep local.properties out of Git.

From the repository root, in PowerShell:

```powershell
# Use a JDK 21 installation for this process only.
$env:JAVA_HOME = 'C:\path\to\jdk-21'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:ANDROID_HOME = 'C:\path\to\Android\Sdk'
# Use your service's HTTPS origin, without /api or a trailing slash.
$env:VITE_CUMORA_API_BASE = 'https://api.example.com'
npm ci
npm run android:build
```

On macOS/Linux, set the same environment variables in your shell before running
the npm commands. `android:build` builds the web UI, syncs only Android and runs
the checked-in Gradle wrapper. `android:sync` performs the first two steps when
working in Android Studio. The older `mobile:android` commands remain available.

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Install it with:

```powershell
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`versionName` comes from the root package.json. By default, `versionCode` is
`major * 1000000 + minor * 1000 + patch` (minor/patch must be <= 999). An operator
can supply `-PcumoraVersionCode=<positive integer>` to Gradle when a different
monotonically increasing store code is needed. Debug builds use Android's debug
signing key; production signing and store distribution require separate setup.

## Service, login and push

A native bundle requires an absolute API origin; relative `/api` calls target the
WebView instead of the backend. Configure `VITE_CUMORA_API_BASE` before building.
Use HTTPS: the release shell disallows mixed content. See the existing debug-only
network configuration when testing a LAN service. OAuth must allow the callback
`cumora://auth` through the server's `CUMORA_AUTH_RETURN_ALLOWLIST`.

Basic chat and login can build without Firebase. For FCM push, register
`io.cumora.app` in your Firebase project and put its Android configuration in
`android/app/google-services.json` (ignored by Git). Configure the backend as in
[PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md). Never commit service-account keys.

The Android app registers a guarded `PushNotifications` adapter. Without an
initialized default Firebase app, requesting permission, registering and
unregistering return `PUSH_NOT_CONFIGURED` to the existing push error UI. They
must not throw on Capacitor's native plugin thread. This also protects an
upgrade where the user already granted notification permission in an older
build. JavaScript `try/catch` alone cannot catch that native-thread exception.

For a debug LAN build, pass an absolute `http://<PC-IP>:<port>` through
`VITE_CUMORA_API_BASE` for both the web build and Gradle. Gradle generates a debug
network configuration allowing that exact HTTP host; the debug activity permits
the WebView's mixed-content connection, including WebSockets. The release variant
keeps HTTPS restrictions. A phone cannot reach the PC through `localhost` or
the emulator-only `10.0.2.2` address.

## Verification

The Android workflow compiles a debug APK on PRs affecting the app and supports
manual runs. Set the repository variable `CUMORA_ANDROID_API_BASE` for a
self-hosted service; its fallback is the existing public Cumora API. The workflow
does not publish a release or upload an APK.

On an emulator or device, verify these before distributing an installation:

- Launch, select the expected backend, sign in, and complete OAuth back into the app.
- Open a conversation, send/receive text and attachments, and reconnect after a network interruption.
- Open and close the keyboard, use the Android back button, and switch apps without losing the draft.
- With Firebase configured, test permission denial as well as foreground/background notifications and opening the intended conversation.

Compilation establishes packaging only; device, backend and provider checks
require their corresponding environments and must be reported separately.

## Root navigation regression

Project setup belongs to the computer UI: create projects, associate computers,
and bind/change/remove local directories from **Me → Projects** on the computer.
The mobile project overview is read-only. The mobile Me page has no directory
settings. This is a client workflow boundary; server APIs continue to enforce
workspace membership, administrator role and computer ownership.

On mobile, tap the conversation-list title to switch among **All conversations**
and existing projects. The bottom sheet shows each project's computer, directory
and conversation count. Picking a project filters the conversation list; picking
an overview card opens that same scoped list. The selected project and computer
state remain visible above the conversations. New conversation creation fixes
that existing project and offers only agents on its ready, online computers.
When All conversations is selected, **+** first asks which existing project to
use. Offline/pending/error projects can still be selected to view their history.
Project creation and directory editing are not offered in either mobile entry.
Android Back closes the project switcher or conversation picker; closing the
switcher restores focus to its trigger. Other root sections (Documents, Boards
and Calendar) retain their existing behavior.

The list/host/folder/conversation organization was informed by
[dsh-Go's workspace screen](https://github.com/ccch1mneyyy/dsh-Go/blob/708bdc3256ddbecdb90891c41f5dbdce4326b610/app/lib/ui/workspace/workspaces_page.dart)
and its workspace golden screenshots. Cumora uses its existing React components,
theme, project/authorization model and outbound computer connection.

Root tabs switch immediately, without whole-page fades. Each screen mounts on
its first visit and stays mounted while hidden, preserving search, filters,
library selection, forms and scroll position. Hidden roots are removed from
layout and keyboard navigation. Workspace/user changes still remount the
authenticated shell; cached screens are not shared across accounts. Detail
push/pop and swipe-back transitions remain independent of root navigation.

After installing and signing in to a debug APK, forward the **app's** WebView
debugging socket and run the read-only navigation check with Node 22+:

```powershell
$adb = Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
$device = 'emulator-5580' # replace with the intended adb serial
$appPid = (& $adb -s $device shell pidof io.cumora.app).Trim()
& $adb -s $device forward tcp:9223 "localabstract:webview_devtools_remote_$appPid"
node scripts/check-android-navigation.mjs 9223
```

The check samples rendered frames during repeated tab switches, checks for a
single opaque root screen, then verifies retained search, filter, library
selection and settings scroll state. It performs no API writes. Re-forward the
socket after an app restart. Run against a dedicated emulator/test session:
the check changes local UI selection and briefly opens search/keyboard.

Also inspect light/dark appearance, narrow screens, creation dialogs, chat
detail/back navigation and keyboard dismissal on the target device. Frame
opacity measurements catch the fade regression; they do not establish a device
frame-rate or prove the absence of every rendering artifact.

For a build **without Firebase**, also exercise all three notification grant
states on a dedicated, already-authenticated Android 13+ emulator:

```powershell
foreach ($permission in @('Granted', 'Denied', 'Prompt')) {
    pwsh.exe -NoProfile -File scripts/check-android-startup.ps1 -DeviceSerial emulator-5580 -Permission $permission
    if ($LASTEXITCODE -ne 0) { throw "Startup failed: $permission" }
}
```

This changes only the named emulator's notification permission, force-stops
and cold-starts the app, waits for asynchronous login restoration, checks the
native crash buffer and then runs the authenticated navigation regression.
It rejects physical-device serials and checks that an unconfigured push build
does not show an unusable permission prompt. The original defect was a native
`IllegalStateException` in `PushNotificationsPlugin.register` with permission
already granted; checking only install success or the initial launch PID misses
the delayed crash. FCM delivery still requires separately configured credentials
and a delivery test.
