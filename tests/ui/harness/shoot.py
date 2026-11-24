import sys, asyncio
from playwright.sync_api import sync_playwright
BASE='file:///home/claude/work/harrier-sim/tests/ui/harness/index.html'
OUT='/home/claude/work/harrier-sim/tests/ui/shots/'
jobs = [a.split(',') for a in sys.argv[1:]]  # name,query,WxH
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--allow-file-access-from-files'])
    for name, query, size in jobs:
        w,h = map(int,size.split('x'))
        pg = b.new_page(viewport={'width':w,'height':h})
        logs=[]
        pg.on('console', lambda m: logs.append(m.text))
        pg.on('pageerror', lambda e: logs.append('PAGEERR '+str(e)))
        pg.goto(BASE+'?'+query)
        try: pg.wait_for_function('window.__ready===true', timeout=30000)
        except Exception as e: logs.append('timeout')
        pg.screenshot(path=OUT+name+'.png')
        print(name, [l for l in logs if 'GPU' not in l and 'WebGL' not in l][:5])
        pg.close()
    b.close()
