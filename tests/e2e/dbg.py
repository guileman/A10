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
    print(json.dumps(pg.evaluate('''()=>{const g=window.__harrier; const rw=g.scene.scene.children.find(o=>o.name==='runway');
      const out={rw:!!rw,n:rw&&rw.children.length, rf:g.rf};
      if(rw){const m=rw.children[0]; m.geometry.computeBoundingBox(); out.bb=m.geometry.boundingBox; out.vis=m.visible; out.mat=m.material.type; out.ntri=m.geometry.index.count/3;}
      const s=g.sim.getState(); out.pos=s.pos; out.hgt=g.world.height(s.pos[0],s.pos[2]);
      out.cam=g.scene.camera.position.toArray(); return out}''')))
    print([l for l in logs if 'rror' in l or 'arn' in l][:6])
    b.close()
