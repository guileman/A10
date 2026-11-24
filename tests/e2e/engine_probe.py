import sys, json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':960,'height':540})
    logs=[]
    pg.on('console',lambda m: logs.append(m.type+': '+m.text[:300]))
    pg.on('pageerror',lambda e: logs.append('PAGEERROR: '+str(e)[:500]))
    pg.set_content('<html><body style="margin:0"><div id="view" style="width:960px;height:540px"></div></body></html>')
    pg.add_script_tag(path='vendor/rally-engine.js')
    r=pg.evaluate('''async()=>{
      const E=window.RallyEngine; const out={keys:Object.keys(E).length};
      const src=new E.SyntheticSource();
      const lon=-60.9,lat=-33.0; const dl=0.0035/Math.cos(lat*Math.PI/180);
      const path=[{lon:lon-dl,lat:lat},{lon:lon+dl,lat:lat}];
      const t0=performance.now();
      const aoi=await E.buildAOI(src,path,{closed:false,roadWidth:45,margin:1500,wantOSM:false});
      out.aoiMs=performance.now()-t0; out.bounds=aoi.bounds;
      const t1=performance.now();
      const w=await E.buildWorld(aoi,{seed:1,roadWidth:45,pipeline:'v2'},()=>{});
      out.worldMs=performance.now()-t1; out.wkeys=Object.keys(w).slice(0,40);
      out.h0=w.height(0,0); out.roadN=w.road&&w.road.x&&w.road.x.length;
      return out;}''')
    print(json.dumps(r,indent=1)[:1500])
    print('\n'.join(logs[:15]))
    b.close()
