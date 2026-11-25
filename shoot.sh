#!/bin/sh
# Capture the dashboard's views from out/ with headless Chrome (1440x900, the model view 1440x1680): ./shoot.sh <dir>
dir=${1:-screenshots}
mkdir -p "$dir"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
url="file://$PWD/out/dashboard/index.html"
shot() { "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1440,${3:-900} --screenshot="$dir/$1" "$url$2" 2>/dev/null; }
shot 1-board.png '#board'
shot 2-detail.png '#p/curvance'
shot 3-filtered.png '#board?call=farm&tvl=10000000&sort=ratio&dir=desc'
shot 4-model.png '#model' 1680
ls -l "$dir"
