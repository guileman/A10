from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':1280,'height':720}); logs=[]
    pg.on('console',lambda m: logs.append(m.type+': '+m.text[:300])); pg.on('pageerror',lambda e: logs.append('PAGEERROR: '+str(e)[:600]))
    pg.goto('file:///home/claude/work/harrier-sim/dist/harrier-sim.html'); pg.wait_for_timeout(1500)
    pg.get_by_text('Pista y ubicación').first.click(); pg.wait_for_timeout(5000)
    pg.screenshot(path='tests/e2e/menu_runway.png')
    print([l for l in logs if 'PAGE' in l or l.startswith('error')][:6])
    b.close()
