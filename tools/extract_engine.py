# Extrae el motor del mundo del bundle del rally: script completo menos módulos pesados de coches y main.js.
import re, sys, json
SRC='/mnt/user-data/uploads/SIMRALLY/simulador-rally-v2-e.html'
b=open(SRC,'rb').read().decode('utf8')
s0=b.index('<script>(() => {')+len('<script>')
s1=b.index('\n  // src/main.js\n')
body=b[s0:s1]
# partir en regiones por marcadores "  // path"
parts=re.split(r'(?m)^(  // (?:src|node_modules)/\S+)\n',body)
head=parts[0]; regs=[(parts[i][5:],parts[i+1]) for i in range(1,len(parts),2)]
DROP=('src/car/meshcar_draco_data.js','src/car/bovsamples_data.js','src/car/liftsamples_data.js',
      'src/car/defaultcar_data.js','src/car/bundledcars_data.js')
out=[head]; dropped=0
for n,t in regs:
    if n in DROP: dropped+=len(t); out.append(f'  // {n} (omitido)\n'); continue
    out.append(f'  // {n}\n'+t)
open('/home/claude/work/harrier-sim/vendor/engine_body.js','w').write(''.join(out))
print('dropped',dropped//1024,'KB; total',sum(map(len,out))//1024,'KB; regions',len(regs))

# ---- ensamblado: vendor/rally-engine.js ----
three_names=set()
for n,t in regs:
    if n.startswith('node_modules/three'):
        for m_ in re.finditer(r'(?m)^  (?:var|let|const|function|class) ([A-Za-z_]\w*)',t): three_names.add(m_.group(1))
        for m_ in re.finditer(r'(?m)^  var ([A-Za-z_]\w*(?:, [A-Za-z_]\w*)+);',t):
            for x in m_.group(1).split(', '): three_names.add(x)
eng=['buildAOI','buildWorld','RallyScene','SyntheticSource','TileSource','MapView','Pacer','QUALITY_PRESETS',
     'TIME_OF_DAY_PRESETS','SURF','LocalFrame']
allnames=sorted(set(eng)|{x for x in three_names if re.match(r'^[A-Z][A-Za-z0-9]*$',x) or x.isupper()})
txt=''.join(out)
defined=set(re.findall(r'(?m)^  (?:var|let|const|function|async function|class) ([A-Za-z_]\w*)',txt))
for m_ in re.finditer(r'(?m)^  var ([A-Za-z_]\w*(?:, [A-Za-z_]\w*)+);',txt): defined.update(m_.group(1).split(', '))
allnames=[x for x in allnames if x in defined]
epi='\n  return {'+', '.join(allnames)+'};\n})();\n'
js='/* Motor de mundo extraído de simulador-rally-v2-e.html (three r187 incluido, sin coches). */\nwindow.RallyEngine = '+txt.replace('(() => {','(() => {',1)+epi
# txt empieza con "(() => {" ; el cierre "})();" lo aportamos nosotros
open('/home/claude/work/harrier-sim/vendor/rally-engine.js','w').write(js)
print('names',len(allnames),'size KB',len(js)//1024)
