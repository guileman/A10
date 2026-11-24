# IGES (malla teselada) -> GLB con partes articulables. Marco modelo (x proa, y izq, z arriba) -> glTF/cuerpo (x proa, y arriba, z derecha), metros.
import numpy as np, trimesh, pyfqmr, json, sys
S=0.00418
d=np.load('/home/claude/out/igs_mesh.npz'); V=d['V'].astype(float); T=d['T']; F=d['F']
lab=np.load('/home/claude/out/lab_r03.npy'); G=lab[F]       # grupo por triángulo
ng=lab.max()+1
cent={}; 
for g in np.unique(G):
    tv=V[T[G==g]].reshape(-1,3); cent[g]=(tv.min(0),tv.max(0),(G==g).sum())
part_of={}
def setp(gs,name):
    for g in gs: part_of[g]=name
# reglas explícitas (grupos identificados en el análisis)
setp([477],'NoseWheel'); setp([458],'MainWheelR'); setp([465],'MainWheelL')
setp([498],'OutriggerWheelL'); setp([508],'OutriggerWheelR')
setp([453],'NozzleFront'); setp([454],'NozzleRear'); setp([451],'Hood')
setp([344,343,341,342,672,678],'Pylons')
setp([468,472,473],'NoseGearLeg'); setp([467,463,462,460],'MainGearLeg'); setp([491],'OutriggerLegL'); setp([500],'OutriggerLegR')
for g in cent:
    if g in part_of: continue
    lo,hi,n=cent[g]; c=(lo+hi)/2
    if c[2]<-250 and abs(c[1])<150 and 250<c[0]<600 and (hi-lo).max()<400: part_of[g]='NoseGearLeg'
    elif c[2]<-200 and abs(c[1])<250 and -520<c[0]<-150 and (hi-lo).max()<400: part_of[g]='MainGearLeg'
    elif c[2]<-150 and 480<abs(c[1])<720 and (hi-lo).max()<450: part_of[g]='OutriggerLegR' if c[1]<0 else 'OutriggerLegL'
    else: part_of[g]='Fuselage'
names=sorted(set(part_of.values()))
print({n:int(sum(cent[g][2] for g in part_of if part_of[g]==n)) for n in names})
# pivotes (unidades modelo): rueda=centro bbox; toberas=centro bbox; patas=punto de anclaje superior
def bbox_center(name):
    m=np.isin(G,[g for g in part_of if part_of[g]==name]); tv=V[T[m]].reshape(-1,3); return (tv.min(0)+tv.max(0))/2, tv.min(0), tv.max(0)
pivot={}
for n in names:
    c,lo,hi=bbox_center(n)
    if n=='Fuselage' or n=='Pylons' or n=='Hood': pivot[n]=np.zeros(3)
    elif n.endswith('Leg'): pivot[n]=np.array([c[0],c[1],hi[2]])
    else: pivot[n]=c
TARGET={'Fuselage':110000,'Hood':8000,'Pylons':6000,'NozzleFront':6000,'NozzleRear':8000,'NoseGearLeg':5000,'MainGearLeg':5000,'NoseWheel':5000,'MainWheelR':5000,'MainWheelL':5000,'OutriggerWheelL':3500,'OutriggerWheelR':3500,'OutriggerLegL':2500,'OutriggerLegR':2500}
COL={'Fuselage':(0.52,0.55,0.58),'Hood':(0.45,0.5,0.55),'Pylons':(0.4,0.42,0.45),'NozzleFront':(0.35,0.36,0.38),'NozzleRear':(0.22,0.2,0.2)}
def conv(P): # modelo -> cuerpo
    return np.stack([P[:,0],P[:,2],-P[:,1]],1)*S
scene=trimesh.Scene(); info={}
for n in names:
    m=np.isin(G,[g for g in part_of if part_of[g]==n]); tri=T[m]
    used,inv=np.unique(tri,return_inverse=True); P=V[used]; Fc=inv.reshape(-1,3)
    # soldar vértices cercanos antes de simplificar
    mesh=trimesh.Trimesh(P,Fc,process=False); mesh.merge_vertices(digits_vertex=1); 
    P2=np.asarray(mesh.vertices); F2=np.asarray(mesh.faces)
    tgt=TARGET.get(n,5000)
    if len(F2)>tgt:
        s=pyfqmr.Simplify(); s.setMesh(P2,F2.astype(np.int32)); s.simplify_mesh(target_count=tgt,aggressiveness=6,preserve_border=(n!='Fuselage'),verbose=0)
        P2,F2,_=s.getMesh()
    P2=P2-pivot[n]; Pm=conv(P2); pv=conv(pivot[n][None,:])[0]
    mesh=trimesh.Trimesh(Pm,F2,process=False); mesh.fix_normals()
    col=COL.get(n,(0.07,0.07,0.07) if 'Wheel' in n else (0.62,0.63,0.65))
    mesh.visual=trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(baseColorFactor=[*col,1],metallicFactor=0.4,roughnessFactor=0.55))
    Tm=np.eye(4); Tm[:3,3]=pv
    scene.add_geometry(mesh,node_name=n,geom_name=n,transform=Tm)
    info[n]={'tris':int(len(F2)),'pivot':[round(float(x),4) for x in pv]}
scene.export('/home/claude/work/harrier-sim/assets/harrier.glb')
json.dump(info,open('/home/claude/work/harrier-sim/assets/harrier.parts.json','w'),indent=1)
print(json.dumps(info))
import os; print('GLB KB',os.path.getsize('/home/claude/work/harrier-sim/assets/harrier.glb')//1024)
