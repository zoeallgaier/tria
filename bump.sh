#!/usr/bin/env bash
# Bump the ?v= cache stamp on ALL asset lines in index.html together.
#
# The ?v= stamp does two jobs: it busts HTTP caches on deploy, and it drives the
# self-updater in js/app.js (which refetches index.html and reloads the app when
# the app.js?v= number changes). All five asset lines must carry the SAME number,
# so bump them together with this rather than by hand.
#
# Usage:
#   ./bump.sh        # increment by 1
#   ./bump.sh 70     # set an explicit number
set -euo pipefail
cd "$(dirname "$0")"

cur=$(grep -o 'app\.js?v=[0-9]\+' index.html | head -1 | grep -o '[0-9]\+')
if [ -z "$cur" ]; then echo "Couldn't find a ?v= stamp in index.html" >&2; exit 1; fi

if [ $# -ge 1 ]; then next=$1; else next=$((cur + 1)); fi

# Every ?v=<cur> in the file shares one number; \b keeps us from matching a prefix.
perl -pi -e "s/\\?v=${cur}\\b/?v=${next}/g" index.html

echo "Bumped ?v=: ${cur} -> ${next}"
grep -n '\.css?v=\|\.js?v=' index.html
