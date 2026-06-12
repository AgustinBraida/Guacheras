import sys
path = r'c:\Users\agust\.gemini\antigravity\scratch\Guacheras_repo_version_sin_WPA\Guacheras\index.html'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace('✏️', '<i data-lucide="edit-3" class="icon-edit"></i>')
text = text.replace('<div class="chart-block-handle" title="Arrastrar para reordenar">⠿</div>', '')

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)
