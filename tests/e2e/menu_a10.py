import time, sys
from playwright.sync_api import sync_playwright
OUT='tests/e2e/'
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':1280,'height':720}); errs=[]
    pg.on('pageerror',lambda e:errs.append('PAGEERROR '+str(e)[:300])); pg.on('console',lambda m: errs.append('console '+m.text[:200]) if m.type=='error' else None)
    pg.goto('file://'+__import__('os').path.abspath('dist/a10-sim.html')+''); pg.wait_for_timeout(2000)
    pg.screenshot(path=OUT+'m1_main.png')
    pg.get_by_text('Ruta del convoy').first.click(); pg.wait_for_timeout(1500)
    pg.get_by_text('Demo (sintético)').first.click(); pg.wait_for_timeout(3000)
    pg.screenshot(path=OUT+'m2_route.png')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(800)
    pg.screenshot(path=OUT+'m3_back.png')
    pg.get_by_text('Volar', exact=True).first.click(); pg.wait_for_timeout(1000)
    pg.screenshot(path=OUT+'m4_fly.png', full_page=True)
    pg.get_by_text('Iniciar vuelo').first.click()
    t=time.time()
    while time.time()-t<300:
        pg.wait_for_timeout(2000)
        if pg.evaluate('()=>!!(window.__a10&&window.__a10.frames>2)'): break
    print('listo', round(time.time()-t),'s')
    pg.wait_for_timeout(3000)
    pg.screenshot(path=OUT+'m5_flight.png', timeout=120000)
    pg.keyboard.press('KeyL'); pg.wait_for_timeout(2500)
    pg.screenshot(path=OUT+'m6_lock.png', timeout=120000)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(1500)
    pg.keyboard.down('Space'); pg.wait_for_timeout(3000); pg.keyboard.up('Space')
    print(pg.evaluate('()=>{const g=window.__a10;return {ammo:g.weapons.ammo, mav:g.weapons.missilesLeft(), frames:g.frames, conv:g.convoy.vehicles.map(v=>v.state).join(",")}}'))
    pg.screenshot(path=OUT+'m7_fire.png', timeout=120000)
    pg.keyboard.press('KeyC'); pg.wait_for_timeout(1500); pg.screenshot(path=OUT+'m8_chase.png', timeout=120000)
    pg.keyboard.press('KeyP'); pg.wait_for_timeout(800); pg.screenshot(path=OUT+'m9_pause.png', timeout=120000)
    print('errores', errs[:10])
    b.close()
