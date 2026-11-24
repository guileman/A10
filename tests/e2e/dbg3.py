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
    r=pg.evaluate("""()=>{const g=window.__harrier,sim=g.sim;g.paused=true;
      const c={pitch:0,roll:0,yaw:0,throttle:1,nozzleDeg:0,flaps:1,gearDown:true,brake:0,parkingBrake:false,airbrake:false,waterInjection:false,assist:{}};
      const log=[];let rot=false;
      for(let i=0;i<60*70;i++){const s=sim.getState();
        if(s.air.iasKt>125&&!rot){rot=true;}
        c.pitch=rot?0.35:0; if(s.air.altAglM>60) c.gearDown=false;
        sim.step(1/60,c);
        if(i%300===0){const t=sim.getState();log.push([+(i/60).toFixed(1),+t.air.iasKt.toFixed(0),+t.air.altAglM.toFixed(1),+t.att.pitchDeg.toFixed(1),+t.att.headingDeg.toFixed(0),t.flags.onGround,t.gear.state,+t.engine.fuelKg.toFixed(0)]);}}
      return log}""")
    for r_ in r: print(r_)
    b.close()
