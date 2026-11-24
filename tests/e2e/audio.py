import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'])
    pg=b.new_page(viewport={'width':1280,'height':720}); logs=[]
    pg.on('console',lambda m: logs.append(m.type+': '+m.text[:300])); pg.on('pageerror',lambda e: logs.append('PAGEERROR: '+str(e)[:600]))
    pg.goto('file:///home/claude/work/harrier-sim/dist/harrier-sim.html'); pg.wait_for_timeout(1000)
    pg.evaluate('''()=>{const c=window.__harrierDev.getConfig(); c.extentKm=1.0; c.camera='chase'; c.quality='bajo'; c.start='hover'; window.__harrierDev.start(c);}''')
    for _ in range(100):
        pg.wait_for_timeout(2000)
        if pg.evaluate('()=>!!window.__harrier'): break
    r=pg.evaluate("""async()=>{const g=window.__harrier,A=window.__harrierDev.audio;g.paused=true;
      const an=A.analyser;const buf=new Float32Array(an.fftSize),fb=new Float32Array(an.frequencyBinCount);
      const out={state:A.ctx.state};
      const meas=async(name,mode,ms,fn)=>{const t0=performance.now();let last=t0;
        while(performance.now()-t0<ms){const now=performance.now();const dt=(now-last)/1000;last=now;g.sim.step(1/60,fn?fn():ctrl);const s=g.sim.getState();A.update(s,ctrl,Math.max(dt,0.016),{mode,camPos:[s.pos[0]+300,s.pos[1]+5,s.pos[2]]});await new Promise(r=>setTimeout(r,30));}
        an.getFloatTimeDomainData(buf);let e=0;for(const v of buf)e+=v*v;an.getFloatFrequencyData(fb);let wsum=0,sum=0;for(let i=1;i<fb.length;i++){const m=Math.pow(10,fb[i]/20);wsum+=m*i;sum+=m}
        out[name]={rms:+Math.sqrt(e/buf.length).toFixed(4),centroidHz:Math.round(wsum/sum*(A.ctx.sampleRate/2/fb.length))};};
      const ctrl={pitch:0,roll:0,yaw:0,throttle:0.8,nozzleDeg:85,flaps:2,gearDown:true,brake:0,parkingBrake:false,airbrake:false,waterInjection:false,assist:{}};
      A.setVolume(0.7);
      await meas('hover_chase','chase',2500);
      await meas('hover_pilot','pilot',2000);
      await meas('hover_world','world',2000);
      ctrl.throttle=0.2; ctrl.nozzleDeg=0; await meas('idleish_chase','chase',2500);
      A.setMuted(true); await new Promise(r=>setTimeout(r,400)); await meas('muted','chase',600); A.setMuted(false);
      return out}""")
    print(json.dumps(r,indent=1))
    print([l for l in logs if 'PAGE' in l or l.startswith('error')][:6])
    b.close()
