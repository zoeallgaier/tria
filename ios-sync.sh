#!/bin/sh
# Mirrors the web assets Capacitor bundles into the iOS app (www/), then runs
# `cap sync`. GitHub Pages still serves the repo root untouched — this folder
# only exists so Capacitor has a real subdirectory to point webDir at (it
# rejects "."). Run this after any css/js/html change, before opening Xcode.
set -e
cd "$(dirname "$0")"

rm -rf www
mkdir -p www
cp index.html site.webmanifest sw.js www/
cp -R css js icons www/

npx cap sync ios
