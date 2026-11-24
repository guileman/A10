import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'])
    pg=b.new_page(viewport={'width':1280,'height':720}); logs=[]
    pg.on('console',lambda m: logs.append(m.type+': '+m.text[:300])); pg.on('pageerror',lambda e: logs.append('PAGEERROR: '+str(e)[:600]))
    pg.goto('file:///home/claude/work/harrier-sim/dist/harrier-sim.html'); pg.wait_for_timeout(1000)
    pg.evaluate('''()=>{const c=window.__harrierDev.getConfig(); c.extentKm=1.0; c.camera='pilot'; c.quality='bajo'; c.start='hover'; window.__harrierDev.start(c);}''')
    for _ in range(100):
        pg.wait_for_timeout(2000)
        if pg.evaluate('()=>!!window.__harrier'): break
    pg.wait_for_timeout(3000)
    print('btn display', pg.evaluate("()=>[...document.querySelectorAll('button')].filter(b=>b.textContent==='Entrar en VR').map(b=>b.style.display)"))
    # emula las partes sin visor: cámara dentro del dolly + presenting
    pg.evaluate("""()=>{const g=window.__harrier; g.vr.prepare(); const cam=g.scene.camera; g.vr.dolly.add(cam); cam.position.set(0,0,0); cam.quaternion.identity(); cam.near=0.1; cam.fov=90; cam.updateProjectionMatrix(); g.vr.presenting=true; g.rig.mode='vr'; g.scene.setQuality({viewDistance:2200,treeDensity:0.3,grassDensity:0,grassDistance:0,lodK:1.0,detail:0.6,tree3D:30,rock3D:20,buildBudget:1}); g.model.setLite(true);}""")
    f0=pg.evaluate('()=>window.__harrier.frames')
    for _ in range(40):
        pg.wait_for_timeout(1000)
        if pg.evaluate('()=>window.__harrier.frames')>=f0+3: break
    pg.screenshot(path='tests/e2e/vr_sim_view.png', timeout=150000)
    print(json.dumps(pg.evaluate('()=>window.__harrier.scene.getStats()')))
    print(json.dumps(pg.evaluate('()=>{const g=window.__harrier,s=g.sim.getState();return {frames:g.frames,pitch:s.att.pitchDeg,head:g.focus.toArray(),eye:g.model.group.position.toArray()}}')))
    print([l for l in logs if 'PAGE' in l or l.startswith('error') or l.startswith('warning')][:6])
    b.close()
