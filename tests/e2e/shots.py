import sys, json
from playwright.sync_api import sync_playwright
start=sys.argv[1] if len(sys.argv)>1 else 'hover'
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':1280,'height':720})
    logs=[]; pg.on('console',lambda m: logs.append(m.type+': '+m.text[:300])); pg.on('pageerror',lambda e: logs.append('PAGEERROR: '+str(e)[:600]))
    pg.goto('file:///home/claude/work/harrier-sim/dist/harrier-sim.html'); pg.wait_for_timeout(1000)
    pg.evaluate('''(st)=>{const c=window.__harrierDev.getConfig(); c.extentKm=1.5; c.camera='chase'; c.quality='bajo'; c.start=st; window.__harrierDev.start(c);}''',start)
    for _ in range(100):
        pg.wait_for_timeout(2000)
        if pg.evaluate('()=>!!window.__harrier'): break
    for cam in ['chase','pilot','world']:
        pg.evaluate('(m)=>{const g=window.__harrier;g.rig.setMode(m);window.__harrierDev.ui.hud.setMode(m);}',cam)
        f0=pg.evaluate('()=>window.__harrier.frames||0')
        for _ in range(30):
            pg.wait_for_timeout(1000)
            if pg.evaluate('()=>window.__harrier.frames')>=f0+3: break
        pg.screenshot(path=f'tests/e2e/{start}_{cam}.png')
    print(json.dumps(pg.evaluate('()=>{const s=window.__harrier.sim.getState();return {pos:s.pos,ias:s.air.iasKt,pitch:s.att.pitchDeg,noz:s.nozzles.angleDeg,agl:s.air.altAglM,vs:s.air.vsMs,t:window.__harrier.t}}')))
    print([l for l in logs if 'PAGE' in l or l.startswith('error')][:5])
    b.close()
