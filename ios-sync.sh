#!/bin/sh
# Mirrors the web assets Capacitor bundles into the iOS app (www/), then runs
# `cap sync`. GitHub Pages still serves the repo root untouched — this folder
# only exists so Capacitor has a real subdirectory to point webDir at (it
# rejects ".").
#
# Run this after ANY css/js/html change, in the same turn as the change — not
# "before opening Xcode", which is what this line used to say and is a way to
# leave Zoe testing yesterday's bundle. The webview loads a bundled copy, so the
# ?v= self-updater cannot reach it: an unsynced change is simply absent from the
# app, silently, and that is indistinguishable from a change that didn't work.
# Bump first, then sync, so the stamp the bundle carries is the one that shipped.
#
# `rm -rf www` is deliberate: it is what makes a stale file impossible, and it is
# also what cleans up a probe added to the copy on purpose (see CLAUDE.md).
set -e
cd "$(dirname "$0")"

rm -rf www
mkdir -p www
cp index.html site.webmanifest sw.js www/
cp -R css js icons www/

npx cap sync ios
