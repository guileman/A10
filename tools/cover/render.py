# Renderiza dist/cover.html en Chrome sin pantalla y guarda las imágenes. Uso: python3 tools/cover/render.py [query] [salida]
import sys, base64, os
from playwright.sync_api import sync_playwright
q = sys.argv[1] if len(sys.argv) > 1 else ''
out = sys.argv[2] if len(sys.argv) > 2 else 'dist/cover'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 400, 'height': 300}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:400])); pg.on('console', lambda m: errs.append(m.text[:300]) if m.type == 'error' else None)
    pg.goto('file://' + os.path.abspath('dist/cover.html') + '?' + q)
    pg.wait_for_function('window.__done === true', timeout=300000)
    o = pg.evaluate('window.__out')
    for k in ('clean', 'title'):
        open(f'{out}-{k}.jpg', 'wb').write(base64.b64decode(o[k].split(',')[1]))
    print('ok', errs[:5]); b.close()
