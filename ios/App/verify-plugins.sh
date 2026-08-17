#!/bin/sh
# Every plugin named in packageClassList must actually BE in the linked binary.
#
# Capacitor loads its plugins by looking each name in `packageClassList` up in
# the Objective-C runtime. A class that was never compiled into the app simply
# isn't found, and the only trace is one line in the device log at the moment the
# reader taps the thing:
#
#     Error loading plugin PushNotifications for call. Check that the pluginId is correct
#
# Nothing fails at build time. The build succeeds, the archive uploads, review
# passes, and the feature is just absent — which reads to everyone, including the
# people who wrote it, as "the code is broken" rather than "the code is missing".
#
# That is not hypothetical. `CapacitorPushNotifications` was added to
# CapApp-SPM's Package.swift on 2026-07-29. The package graph cached in
# DerivedData was already a day old and Xcode never re-planned it, so the target
# was never compiled: no PushNotificationsPlugin.o, no build intermediate, no
# class in the binary. Every build after that — including the archive that
# shipped as 1.0 and the one that shipped as 1.1 — linked Browser and Haptics and
# silently dropped Push. iOS notifications could not have worked in any of them,
# and three weeks were spent looking for the bug in the Swift, the AppDelegate
# forwards and the .p8 key, all of which were correct the whole time.
#
# The remedy is deleting DerivedData. The point of this script is that nobody has
# to guess that, because the build says it.
#
# Deliberately fails the build. A warning here would be one more thing to scroll
# past, and scrolling past it is the entire failure mode being fixed. Anything
# this script can't answer (no binary yet, no config, no nm) exits clean instead
# — the check is for a missing class, not for an unusual build.
set -e

CONFIG="${SRCROOT}/App/capacitor.config.json"

if [ ! -f "$CONFIG" ]; then
  echo "warning: verify-plugins: no capacitor.config.json at $CONFIG; skipping the plugin check"
  exit 0
fi

# The block from "packageClassList" to its closing bracket, reduced to the bare
# class names. `cap sync` writes this list from package.json, so it is the
# authoritative answer to "which plugins is this app supposed to have".
CLASSES=$(
  awk '/"packageClassList"/ { inlist = 1 } inlist { print } inlist && /\]/ { exit }' "$CONFIG" \
    | grep -o '"[A-Za-z_][A-Za-z0-9_]*"' \
    | tr -d '"' \
    | grep -v '^packageClassList$'
)

if [ -z "$CLASSES" ]; then
  echo "warning: verify-plugins: packageClassList is empty or unreadable; skipping the plugin check"
  exit 0
fi

# Debug builds put the Swift code in a side dylib and leave a stub executable, so
# the classes are in App.debug.dylib rather than App. Release has only the one.
# Scan whatever is actually there.
BINARIES=""
for candidate in \
  "${TARGET_BUILD_DIR}/${EXECUTABLE_PATH}" \
  "${TARGET_BUILD_DIR}/${CONTENTS_FOLDER_PATH}/${PRODUCT_NAME}.debug.dylib"
do
  [ -f "$candidate" ] && BINARIES="$BINARIES $candidate"
done

if [ -z "$BINARIES" ]; then
  echo "warning: verify-plugins: found no linked binary to scan; skipping the plugin check"
  exit 0
fi

# Every Objective-C class name the binaries define, one per line. Capacitor
# plugins are @objc-exposed, so an unqualified name is the right thing to look
# for — the Swift module doesn't namespace it.
FOUND=$(
  for bin in $BINARIES; do
    nm -a "$bin" 2>/dev/null | sed -n 's/.*_OBJC_CLASS_\$_\([A-Za-z0-9_]*\)$/\1/p'
  done | sort -u
)

MISSING=""
for class in $CLASSES; do
  echo "$FOUND" | grep -qx "$class" || MISSING="$MISSING $class"
done

if [ -n "$MISSING" ]; then
  for class in $MISSING; do
    echo "error: $class is in packageClassList but is not in the built binary. Capacitor will fail every call to it at runtime, with no build-time error and no crash."
  done
  # Name the exact folder rather than an App-* wildcard. There are several Xcode
  # projects called "App" on this machine and their DerivedData folders differ
  # only by hash, so a glob here is an instruction to delete other projects'
  # caches. BUILD_ROOT is <DerivedData>/<App-hash>/Build/Products.
  DERIVED=$(dirname "$(dirname "${BUILD_ROOT:-}")")
  echo "error: this is almost always a stale Swift package graph in DerivedData. Quit Xcode, delete ${DERIVED:-the DerivedData folder for this project}, reopen and build again."
  exit 1
fi

echo "verify-plugins: all Capacitor plugins present —$(echo "$CLASSES" | tr '\n' ' ')"
