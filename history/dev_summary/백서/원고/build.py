"""Assemble the whitepaper HTML and render a PDF in two passes (second pass fills TOC page numbers)."""
import glob, html, os, re, subprocess, sys
import pdfplumber

D = os.path.dirname(os.path.abspath(__file__))
OUT_PDF = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(D, 'book.pdf')

chapters = sorted(glob.glob(os.path.join(D, 'ch[0-9]_*.html')))
body_chapters = ''.join(open(p, encoding='utf-8').read() for p in chapters)
front = open(os.path.join(D, 'front.html'), encoding='utf-8').read()
N_LESSONS = sum(len(re.findall(r'^## L-', open(p, encoding='utf-8').read(), re.M)) for p in glob.glob(os.path.join(D, 'lessons_W*.md')))
N_PRINCIPLES = body_chapters.count('class="principle"')
front = front.replace('{{LESSONS}}', str(N_LESSONS)).replace('{{PRINCIPLES}}', str(N_PRINCIPLES))

# TOC entries from chapter markup
entries = []
for m in re.finditer(r'<div class="ch-num">(.*?)</div>\s*<h1>(.*?)</h1>|<h2><span class="sec-num">(.*?)</span>\s*(.*?)</h2>', body_chapters, re.S):
    if m.group(1):
        entries.append(('ch', re.sub('<.*?>', '', m.group(1)).strip(), re.sub('<.*?>', '', m.group(2)).strip()))
    else:
        entries.append(('sec', re.sub('<.*?>', '', m.group(3)).strip(), re.sub('<.*?>', '', m.group(4)).strip()))

def toc_html(pages):
    rows = []
    for (kind, num, title), pg in zip(entries, pages):
        cls = 'toc-ch' if kind == 'ch' else 'toc-sec'
        label = f'{num} {title}' if kind == 'ch' else f'{num} {title}'
        rows.append(f'<div class="{cls}"><span class="lbl">{html.escape(html.unescape(label))}</span><span class="toc-dots"></span><span class="toc-pg">{pg}</span></div>')
    return '\n'.join(rows)

colophon = f'''<section class="colophon"><p><b>그럴듯하게 틀리는 것들 — AI 상담 챗봇 현장 백서</b><br>제1판 · 2026년 10월</p>
<p>작은 팀이 6주 동안 AI 세무 상담 챗봇을 만들며 남긴 개발 기록에서 교훈 {N_LESSONS}개를 뽑아,<br>여섯 직무의 원칙 {N_PRINCIPLES}개로 다시 묶었다.</p>
<p>자매편: 「조용히 틀리는 것들 — 게임 개발 현장 백서」</p></section>'''

def assemble(pages):
    doc = front.replace('<!--TOC-->', toc_html(pages))
    return f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>그럴듯하게 틀리는 것들</title>
<link rel="stylesheet" href="book.css"></head><body>{doc}{body_chapters}{colophon}</body></html>'''

def render(html_text, pdf_path):
    hp = os.path.join(D, 'book_full.html')
    open(hp, 'w', encoding='utf-8').write(html_text)
    subprocess.run(['node', os.path.join(D, 'render.mjs'), hp, pdf_path], check=True, cwd=r'C:\Users\user\Neo-Luddite')

def norm(s): return re.sub(r'\s+', '', s)

# pass 1 with placeholder page numbers
render(assemble(['00'] * len(entries)), OUT_PDF)
with pdfplumber.open(OUT_PDF) as pdf:
    texts = [norm(p.extract_text() or '') for p in pdf.pages]
toc_pages = 3  # cover + preface + toc page(s) — skip front matter when searching
pages = []; start = 0
for kind, num, title in entries:
    key = norm(num + title)[:22]
    found = '–'
    for i in range(max(start, toc_pages), len(texts)):
        hit = texts[i].startswith(key) if kind == 'ch' else key in texts[i]
        if key and hit:
            found = str(i + 1); start = i; break
    pages.append(found)
render(assemble(pages), OUT_PDF)
print('entries', len(entries), 'missing', pages.count('–'), 'pages', len(texts))
