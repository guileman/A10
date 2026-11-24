import sys, json, time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':1280,'height':720})
    logs=[]; pg.on('console',lambda m: logs.append(m.type+': '+m.text[:300])); pg.on('pageerror',lambda e: logs.append('PAGEERROR: '+str(e)[:600]))
    pg.goto('file:///home/claude/work/harrier-sim/dist/harrier-sim.html'); pg.wait_for_timeout(1000)
    pg.evaluate('''()=>{const c=window.__harrierDev.getConfig(); c.extentKm=1.5; c.camera='chase'; c.quality='bajo'; window.__harrierDev.start(c);}''')
    for _ in range(100):
        pg.wait_for_timeout(2000)
        if pg.evaluate('()=>!!window.__harrier'): break
    pg.wait_for_timeout(3000)
    print(json.dumps(pg.evaluate("""()=>{const g=window.__harrier,rf=g.rf,w=g.world;const out=[];
      for(const s of [0,50,100,200,300,600,1000,1400]){const row=[];for(const o of [-30,-22,-15,0,15,22,30]){const x=rf.thr1[0]+rf.ux*s-rf.uz*o,z=rf.thr1[1]+rf.uz*s+rf.ux*o;row.push(+w.height(x,z).toFixed(2));}out.push([s,row]);}
      const ri=g.world.roadInfo; const q={};const x=rf.thr1[0]+rf.ux*100,z=rf.thr1[1]+rf.uz*100; ri(x,z,q); return {out,q,hw:g.world.road.halfWidth,keys:Object.keys(g.world.road)}}""")))
    b.close()
