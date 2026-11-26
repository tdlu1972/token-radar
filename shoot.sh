#!/bin/sh
# Capture the dashboard's views from out/ with headless Chrome at 1440 wide: ./shoot.sh <dir>
dir=${1:-screenshots}
mkdir -p "$dir"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
url="file://$PWD/out/dashboard/index.html"
shot() { "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1440,$3 --screenshot="$dir/$1" "$url$2" 2>/dev/null; }
shot 1-board.png '#board' 1440
shot 2-detail.png '#p/marginfi-lending' 1200
shot 3-filtered.png '#board?call=farm&sum=0&open=marginfi-lending&sort=hour&dir=desc' 1440
shot 4-model.png '#model' 1000
# Quantize to 256 colours (Pillow) so four captures stay well inside the dossier's 1.5 MiB.
${PY:-python3} -I - "$dir"/*.png <<'PY'
import sys
from PIL import Image
for f in sys.argv[1:]:
    Image.open(f).convert('RGB').quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(f, optimize=True)
PY
ls -l "$dir"
