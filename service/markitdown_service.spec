# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the MarkItDown Desktop sidecar.

The interesting part is `collect_all`. Several of markitdown's dependencies
carry data files that PyInstaller's static analysis cannot see, and each one
fails only at runtime, in the packaged build, with a confusing error:

  * magika      - bundles an ONNX model + config. It is a CORE markitdown
                  dependency used to sniff file types, so without its data
                  files *every single conversion* fails.
  * onnxruntime - native libraries backing magika.
  * pdfminer    - CMap tables needed for text extraction from many PDFs.
  * mammoth /
    pptx /
    openpyxl    - bundled XML/document templates.

This is why `scripts/test-sidecar.py --binary ...` must be run against the
packaged output, not just the venv: the venv has these files on disk anyway and
will happily pass tests that the shipped app would fail.
"""

from PyInstaller.utils.hooks import collect_all, collect_submodules

datas, binaries, hiddenimports = [], [], []

# Packages whose data files / native libs must be collected wholesale.
for package in (
    "magika",
    "onnxruntime",
    "markitdown",
    "pdfminer",
    "pdfplumber",
    "pypdfium2",
    "pptx",
    "mammoth",
    "openpyxl",
    "xlrd",
    "markdownify",
    "youtube_transcript_api",
    "charset_normalizer",
    "defusedxml",
):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

# numpy lazily imports parts of numpy._core, which static analysis misses; the
# packaged build then dies with "No module named 'numpy._core._exceptions'" on
# the first spreadsheet. Collecting submodules explicitly is the belt to the
# built-in hook's braces. (Their test suites are dropped via `excludes` below.)
hiddenimports += collect_submodules("numpy")
hiddenimports += collect_submodules("pandas")

# Trimming what markitdown never touches. Keeps the download smaller.
excludes = [
    "numpy.tests",
    "numpy.f2py",
    "pandas.tests",
    "tkinter",
    "matplotlib",
    "IPython",
    "jupyter",
    "notebook",
    "pytest",
    "sphinx",
    "setuptools._distutils",
    "PIL.ImageQt",
    "PyQt5",
    "PyQt6",
    "PySide2",
    "PySide6",
    "wx",
]

a = Analysis(
    ["main.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="markitdown-service",
    debug=False,
    bootloader_ignore_signals=False,
    # strip/UPX both corrupt signed Mach-O binaries on macOS - leave them off.
    strip=False,
    upx=False,
    console=True,  # stdio service; no terminal appears when spawned by Electron
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch="arm64",
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="markitdown-service",
)
