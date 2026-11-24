import sys, json, time
from playwright.sync_api import sync_playwright
cam=sys.argv[1] if len(sys.argv)>1 else 'chase'; start=sys.argv[2] if len(sys.argv)>2 else 'parked'
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':1280,'height':720})
    logs=[]
    pg.on('console',lambda m: logs.append(m.type+': '+m.text[:300]))
    pg.on('pageerror',lambda e: logs.append('PAGEERROR: '+str(e)[:600]))
    pg.goto('file:///home/claude/work/harrier-sim/dist/harrier-sim.html')
    pg.wait_for_timeout(1500)
    pg.screenshot(path='tests/e2e/menu.png')
    cfg=pg.evaluate('()=>JSON.stringify(window.__harrierDev.getConfig())'); print('cfg',cfg[:600])
    pg.evaluate('''([cam,start])=>{const c=window.__harrierDev.getConfig(); c.extentKm=1.5; c.camera=cam; c.start=start; c.quality='bajo'; c.source='demo'; window.__harrierDev.start(c);}''',[cam,start])
    t0=time.time()
    while time.time()-t0<240:
        pg.wait_for_timeout(2000)
        ok=pg.evaluate('()=>!!window.__harrier')
        if ok: break
    print('loaded',ok, round(time.time()-t0,1),'s')
    pg.wait_for_timeout(4000)
    st=pg.evaluate('()=>{const g=window.__harrier;if(!g)return null;const s=g.sim.getState();return {pos:s.pos,iasKt:s.air.iasKt,onGround:s.flags.onGround,gear:s.gear.state,t:g.t,frames:g.frames,cg:g.sim.cg,missing:g.model.missing}}')
    print(json.dumps(st))
    pg.screenshot(path=f'tests/e2e/fly_{cam}_{start}.png')
    print('\n'.join(l for l in logs if 'error' in l.lower() or 'PAGE' in l)[:3000])
    b.close()
