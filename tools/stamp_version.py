#!/usr/bin/env python3
"""Stamp a build id into index.html so a phone never mixes old and new files.
GitHub Pages serves everything with max-age=600 and no content hashing."""
import re, subprocess, datetime, pathlib
p = pathlib.Path(__file__).resolve().parent.parent / 'index.html'
try:
    rev = subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD'], cwd=p.parent, stderr=subprocess.DEVNULL).decode().strip()
except Exception:
    rev = 'nogit'
bid = datetime.datetime.now().strftime('%Y%m%d-%H%M') + '-' + rev
s = p.read_text()
s = re.sub(r"window\.__BUILD__ = '[^']*'", f"window.__BUILD__ = '{bid}'", s)
s = re.sub(r'\?v=[^"]*"', f'?v={bid}"', s)
p.write_text(s)
print(bid)
