#!/usr/bin/env python3
"""Plays every level's intended solution in the real game with real key events
(tools/drive.mjs) and reports the outcome. Needs the preview server on port 4317."""
import os
import glob, re, subprocess
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = sorted(glob.glob(f'{ROOT}/src/levels/*.txt'))


def run(args):
    index, path = args
    text = open(path).read()
    solution = re.search(r'^solution:\s*(\S+)', text, re.M).group(1)
    probe = "eval:parahydox.outcome()+' steps='+parahydox.steps()+' card='+!document.getElementById('win').hidden+' '+document.getElementById('win-stars').textContent"
    out = subprocess.run(['node', f'{ROOT}/tools/drive.mjs', f'unlock&debug&steps&level={index}', 'wait:1800', f'play:{solution}', 'wait:1000', probe],
                         capture_output=True, text=True, timeout=240).stdout
    return index, path.split('/')[-1], ' '.join(line for line in out.strip().split('\n') if not line.startswith('shot'))


with ThreadPoolExecutor(max_workers=2) as pool:
    results = sorted(pool.map(run, [(i + 1, f) for i, f in enumerate(files)]))

bad = 0
for index, name, summary in results:
    ok = 'won' in summary and 'card=true' in summary and '★★★' in summary and 'no page errors' in summary
    bad += 0 if ok else 1
    print(f"{'ok ' if ok else 'BAD'} {name:<34} {summary}")
print(f'\n{len(results)} levels played, {bad} not clean')
