#!/usr/bin/env bash
# Generates sample documents used to smoke-test the sidecar.
# Output is gitignored; re-run any time with: ./scripts/make-fixtures.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FX="$ROOT/assets/fixtures"
PY="$ROOT/service/.venv/bin/python"
mkdir -p "$FX"

cat > "$FX/sample.txt" <<'EOF'
Quarterly Report

Revenue grew 12% this quarter, driven by strong enterprise adoption.
Headcount remained flat at 240 employees.
EOF

cat > "$FX/sample.html" <<'EOF'
<!doctype html>
<html><head><title>Release Notes</title></head>
<body>
  <h1>Release Notes</h1>
  <p>Version <strong>2.4</strong> ships three fixes.</p>
  <ul><li>Faster startup</li><li>Fixed export bug</li><li>New icon</li></ul>
  <table><tr><th>Fix</th><th>Ticket</th></tr><tr><td>Startup</td><td>#812</td></tr></table>
</body></html>
EOF

cat > "$FX/sample.csv" <<'EOF'
region,revenue,growth
North,412000,0.12
South,288000,0.07
EMEA,530000,0.19
EOF

cat > "$FX/sample.json" <<'EOF'
{"product":"Widget","versions":[{"tag":"2.4","released":"2026-01-08"}],"active":true}
EOF

cat > "$FX/sample.xml" <<'EOF'
<?xml version="1.0"?>
<catalog><book id="1"><title>Dune</title><author>Herbert</author></book></catalog>
EOF

cat > "$FX/rich.html" <<'EOF'
<!doctype html>
<html><head><title>Field Notes</title></head><body>
<h1>Field Notes on Document Conversion</h1>
<p>Converting a document is mostly an exercise in <strong>deciding what to throw away</strong>.
Layout, fonts and colour carry meaning on screen, but almost none of it survives
the trip to plain text, and pretending otherwise produces noise.</p>
<h2>What survives</h2>
<p>Structure survives. Headings, lists and tables map cleanly onto Markdown, which
is why they are worth preserving carefully.</p>
<ul><li>Headings become <code>#</code> levels</li><li>Lists stay lists</li><li>Tables become pipe tables</li></ul>
<h2>What does not</h2>
<ol><li>Page geometry and column breaks</li><li>Fonts, sizes and colour</li><li>Floating text boxes</li></ol>
<blockquote><p>The best conversion is the one you do not notice, because the result
reads as though it had been written as text all along.</p></blockquote>
<h3>Measured results</h3>
<table>
<tr><th>Format</th><th>Fidelity</th><th>Typical time</th></tr>
<tr><td>HTML</td><td>Excellent</td><td>6ms</td></tr>
<tr><td>Word</td><td>Very good</td><td>8ms</td></tr>
<tr><td>PDF</td><td>Varies</td><td>120ms</td></tr>
<tr><td>Slides</td><td>Text only</td><td>8ms</td></tr>
</table>
<h3>Using the output</h3>
<pre><code>from markitdown import MarkItDown
md = MarkItDown(enable_plugins=False)
print(md.convert("report.pdf").markdown)</code></pre>
<p>See the <a href="https://github.com/microsoft/markitdown">project repository</a> for details.</p>
<hr>
<p>Scanned pages are the hard case: without OCR there is no text to recover at all.</p>
</body></html>
EOF

# DOCX via macOS textutil
textutil -convert docx "$FX/sample.txt" -output "$FX/sample.docx"

# PDF via macOS cupsfilter (writes progress to stderr; that's fine)
cupsfilter "$FX/sample.txt" > "$FX/sample.pdf" 2>/dev/null

"$PY" - "$FX" <<'EOF'
import sys, zipfile
from pathlib import Path
fx = Path(sys.argv[1])

from openpyxl import Workbook
wb = Workbook(); ws = wb.active; ws.title = "Q1"
ws.append(["region", "revenue", "growth"])
ws.append(["North", 412000, 0.12]); ws.append(["EMEA", 530000, 0.19])
wb.save(fx / "sample.xlsx")

from pptx import Presentation
from pptx.util import Inches
prs = Presentation(); slide = prs.slides.add_slide(prs.slide_layouts[1])
slide.shapes.title.text = "Roadmap"
slide.placeholders[1].text = "Ship the desktop app\nAdd Windows build"
prs.save(fx / "sample.pptx")

from PIL import Image
Image.new("RGB", (320, 200), (61, 90, 128)).save(fx / "sample.png")

with zipfile.ZipFile(fx / "sample.zip", "w") as z:
    z.write(fx / "sample.csv", "sample.csv")
    z.write(fx / "sample.html", "sample.html")
EOF

echo "fixtures written to $FX"
ls -la "$FX"
