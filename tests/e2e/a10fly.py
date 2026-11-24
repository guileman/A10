import json, sys, time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':1280,'height':720}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)[:300])); pg.on('console',lambda m: errs.append('console '+m.text[:200]) if m.type=='error' else None)
    pg.goto('file:///home/claude/work/a10-sim/dist/a10-sim.html'); pg.wait_for_timeout(1500)
    pg.evaluate('''()=>{const c=window.__a10Dev.getConfig(); c.source='demo'; c.quality='bajo'; c.camera=%s; c.extentKm=2; c.mission=Object.assign({},c.mission||{},{startDistanceKm:3, startAltFt:2000}); window.__a10Dev.start(c);}''' % json.dumps(sys.argv[1] if len(sys.argv)>1 else 'chase'))
    t=time.time()
    while time.time()-t<240:
        pg.wait_for_timeout(2000)
        if pg.evaluate('()=>!!(window.__a10&&window.__a10.frames>2)'): break
    print('listo', round(time.time()-t), 's', errs[:5])
    print(pg.evaluate('''()=>{const g=window.__a10,s=g.sim.getState();return {ias:s.air.iasKt|0, agl:s.air.altAglM|0, hdg:s.att.headingDeg|0, warn:s.warnings, convoy:g.convoy.vehicles.map(v=>v.type+':'+v.state).join(' '), mav:g.weapons.missilesLeft(), pylons:g.model.pylonMeshes.length}}'''))
    pg.screenshot(path='tests/e2e/a10_1.png', timeout=120000)
    # disparar: bloquear y lanzar + cañón
    print(pg.evaluate('''()=>{const g=window.__a10; const s=g.sim.getState(); const v=g.weapons.lock(s,g.convoy.vehicles); return v?('lock '+v.type):'sin bloqueo'}'''))
    pg.keyboard.down('Space'); pg.wait_for_timeout(6000); pg.keyboard.up('Space')
    print(pg.evaluate('()=>({ammo:window.__a10.weapons.ammo, frames:window.__a10.frames})'))
    pg.screenshot(path='tests/e2e/a10_2.png', timeout=120000)
    print('errores', errs[:8])
    b.close()
