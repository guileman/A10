# A-10 Thunderbolt II: STEP -> assets/a10.glb + assets/a10.parts.json + src/physics/a10.geometry.json + docs/mesh/*.png
#
# Uso:  python3 tools/a10_export.py [--no-render]
#   Insumos (solo lectura):
#     /mnt/user-data/uploads/A10_thunderbolt_2.STEP        modelo base (cuerpo, cabina, tren, cañón)
#     /mnt/user-data/uploads/8b180f4f-a10_warthog.stp      solo para las plantillas AGM-65 y Mk-82
#   La teselación (OCP) se guarda en caché en ~/.cache/a10_export/*.pkl (borrarla para re-teselar).
#
# Marco del archivo STEP (verificado): x = IZQUIERDA (babor), y = arriba, z = proa; terna derecha.
#   (la cabina y el cañón están en +z; el cañón está en +x = izquierda y la rueda de proa en −x = derecha, como en el A-10 real)
# Marco modelo/cuerpo del simulador: x = proa, y = arriba, z = derecha  =>  cuerpo = (z, y, −x) · escala − origen(CG)
import os, sys, json, pickle, struct, math, time
import numpy as np

THUNDER = '/mnt/user-data/uploads/A10_thunderbolt_2.STEP'
WARTHOG = '/mnt/user-data/uploads/8b180f4f-a10_warthog.stp'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.expanduser('~/.cache/a10_export')
OUT_GLB = os.path.join(ROOT, 'assets/a10.glb')
OUT_PARTS = os.path.join(ROOT, 'assets/a10.parts.json')
OUT_GEOM = os.path.join(ROOT, 'src/physics/a10.geometry.json')
OUT_DOC = os.path.join(ROOT, 'docs/mesh')

# Datos reales de referencia (A-10A/C)
REAL = dict(spanM=17.53, lengthM=16.26, heightM=4.47, wingAreaM2=47.0, macM=3.04,
            agm65=dict(lengthM=2.49, diamM=0.305), mk82=dict(lengthM=2.21, diamM=0.273))
CG_FRAC_MAC = 0.27          # CG supuesto al 27 % de la CMA
CREASE_DEG = 35.0           # ángulo de quiebre de normales

# ----------------------------------------------------------------------------------------------------------
# 1) Teselación con índice de cara B-rep y de sólido por triángulo
# ----------------------------------------------------------------------------------------------------------
def tessellate(path, defl=0.08, ang=0.35):
    from OCP.STEPCAFControl import STEPCAFControl_Reader
    from OCP.TDocStd import TDocStd_Document
    from OCP.XCAFApp import XCAFApp_Application
    from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.TDF import TDF_Label
    from OCP.OCP.collections import Sequence_TDF_Label as Seq
    from OCP.TDataStd import TDataStd_Name
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED, TopAbs_SOLID
    from OCP.BRep import BRep_Tool
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopoDS import TopoDS
    app = XCAFApp_Application.GetApplication_s()
    doc = TDocStd_Document(TCollection_ExtendedString('XmlOcaf')); app.InitDocument(doc)
    rd = STEPCAFControl_Reader(); rd.SetNameMode(True); rd.ReadFile(path); rd.Transfer(doc)
    st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    def name(l):
        n = TDataStd_Name(); return n.Get().ToExtString() if l.FindAttribute(TDataStd_Name.GetID_s(), n) else ''
    leaves = []
    def walk(l, loc, p):
        nm = name(l)
        if st.IsAssembly_s(l):
            c = Seq(); XCAFDoc_ShapeTool.GetComponents_s(l, c)
            for i in range(1, c.Length() + 1):
                ref = TDF_Label()
                if XCAFDoc_ShapeTool.GetReferredShape_s(c.Value(i), ref):
                    walk(ref, loc.Multiplied(XCAFDoc_ShapeTool.GetLocation_s(c.Value(i))), p + [nm])
        else:
            leaves.append((p + [nm], XCAFDoc_ShapeTool.GetShape_s(l).Moved(loc)))
    fl = Seq(); st.GetFreeShapes(fl)
    for i in range(1, fl.Length() + 1): walk(fl.Value(i), TopLoc_Location(), [])
    res = []
    for pth, shp in leaves:
        BRepMesh_IncrementalMesh(shp, defl, False, ang, True)
        solid_of = {}; es = TopExp_Explorer(shp, TopAbs_SOLID); si = 0
        while es.More():
            ef = TopExp_Explorer(es.Current(), TopAbs_FACE)
            while ef.More(): solid_of.setdefault(ef.Current().__hash__(), si); ef.Next()
            si += 1; es.Next()
        V = []; F = []; FID = []; SID = []; off = 0; fi = 0
        ex = TopExp_Explorer(shp, TopAbs_FACE)
        while ex.More():
            face = TopoDS.Face(ex.Current()); loc = TopLoc_Location()
            tri = BRep_Tool.Triangulation_s(face, loc)
            if tri is not None:
                tr = loc.Transformation(); n = tri.NbNodes()
                P = np.array([[q.X(), q.Y(), q.Z()] for q in (tri.Node(i).Transformed(tr) for i in range(1, n + 1))])
                T = np.array([tri.Triangle(i).Get() for i in range(1, tri.NbTriangles() + 1)], dtype=np.int64) - 1
                if face.Orientation() == TopAbs_REVERSED: T = T[:, [0, 2, 1]]
                V.append(P); F.append(T + off); FID.append(np.full(len(T), fi))
                SID.append(np.full(len(T), solid_of.get(ex.Current().__hash__(), -1))); off += n
            fi += 1; ex.Next()
        res.append(dict(name=pth[-1], path=' / '.join(pth), V=np.vstack(V).astype(np.float64), F=np.vstack(F).astype(np.int64),
                        fid=np.concatenate(FID).astype(np.int32), sid=np.concatenate(SID).astype(np.int32), nsolids=si))
    return res

def load_cached(path, tag):
    os.makedirs(CACHE, exist_ok=True)
    pk = os.path.join(CACHE, tag + '.pkl')
    if os.path.exists(pk) and os.path.getmtime(pk) > os.path.getmtime(path): return pickle.load(open(pk, 'rb'))
    t0 = time.time(); r = tessellate(path); pickle.dump(r, open(pk, 'wb'))
    print(f'teselado {tag}: {len(r)} piezas, {sum(len(x["F"]) for x in r)} tri, {time.time()-t0:.0f} s', flush=True)
    return r

# ----------------------------------------------------------------------------------------------------------
# utilidades de malla
# ----------------------------------------------------------------------------------------------------------
def sub(V, F):
    """Submalla compacta."""
    u, inv = np.unique(F.ravel(), return_inverse=True)
    return V[u].copy(), inv.reshape(-1, 3)

def weld(V, F, tol=1e-3):
    q = np.round(V / tol).astype(np.int64)
    _, idx, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel(); F2 = inv[F]
    ok = (F2[:, 0] != F2[:, 1]) & (F2[:, 1] != F2[:, 2]) & (F2[:, 0] != F2[:, 2])
    return V[idx], F2[ok]

def drop_degenerate(V, F, eps=1e-12):
    P = V[F]; a = np.linalg.norm(np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]), axis=1)
    return F[a > eps]

def decimate(V, F, target):
    V, F = weld(V, F)
    if len(F) > target:
        # pyfqmr (quadric) con bordes preservados: los bordes abiertos (cortes de superficies, huecos de cabina) no se comen
        import pyfqmr
        sm = pyfqmr.Simplify(); sm.setMesh(V, F.astype(np.int32))
        sm.simplify_mesh(target_count=int(target), aggressiveness=5, preserve_border=True, verbose=0)
        V2, F2, _ = sm.getMesh(); V, F = np.asarray(V2, np.float64), np.asarray(F2, np.int64)
    F = drop_degenerate(V, F)
    V, F = sub(V, F)
    return V, F

def crease_normals(V, F, angle_deg=CREASE_DEG):
    """Normales suaves con ángulo de quiebre: duplica vértices en aristas vivas. Devuelve (V, N, F)."""
    P = V[F]; fn = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); area = np.linalg.norm(fn, axis=1)
    fnu = fn / np.maximum(area, 1e-20)[:, None]
    cosl = math.cos(math.radians(angle_deg))
    nF = len(F); corner_v = F.ravel(); corner_f = np.repeat(np.arange(nF), 3)
    order = np.argsort(corner_v, kind='stable')
    outV = []; outN = []; newidx = np.empty(nF * 3, np.int64)
    cv = corner_v[order]; cf = corner_f[order]
    bounds = np.flatnonzero(np.diff(cv)) + 1; starts = np.r_[0, bounds]; ends = np.r_[bounds, len(cv)]
    cnt = 0
    for s, e in zip(starts, ends):
        fs = cf[s:e]; v = cv[s]
        if e - s == 1:
            outV.append(V[v]); outN.append(fnu[fs[0]]); newidx[order[s]] = cnt; cnt += 1; continue
        nn = fnu[fs]; sim = nn @ nn.T >= cosl
        # agrupar caras que comparten normal "parecida" (componentes conexas del grafo de similitud)
        lab = -np.ones(len(fs), int); g = 0
        for i in range(len(fs)):
            if lab[i] >= 0: continue
            stack = [i]; lab[i] = g
            while stack:
                k = stack.pop()
                for j in np.flatnonzero(sim[k] & (lab < 0)): lab[j] = g; stack.append(j)
            g += 1
        for gi in range(g):
            m = lab == gi; n = (fn[fs[m]]).sum(0); ln = np.linalg.norm(n)
            n = n / ln if ln > 0 else nn[m][0]
            outV.append(V[v]); outN.append(n)
            newidx[order[s:e][m]] = cnt; cnt += 1
    Fn = newidx.reshape(-1, 3)
    return np.array(outV), np.array(outN, dtype=np.float64), Fn

# ----------------------------------------------------------------------------------------------------------
# 2) Cargar y clasificar
# ----------------------------------------------------------------------------------------------------------
T = load_cached(THUNDER, 'thunder')
W = load_cached(WARTHOG, 'warthog')
by = {}
for r in T: by.setdefault(r['name'], []).append(r)
body = by['thunderbolt body'][0]

SPAN_U = body['V'][:, 0].max() - body['V'][:, 0].min()
S = REAL['spanM'] / SPAN_U                      # m por unidad del archivo
def to_body_raw(P): return np.stack([P[:, 2], P[:, 1], -P[:, 0]], 1) * S

def faces(r, mask): return r['F'][mask]
bF = body['F']; bV = body['V']; bC = bV[bF].mean(1); bsid = body['sid']; bfid = body['fid']

# --- superficies de control: sólidos separados del cuerpo (verificado con renders de sólidos) ---
def solid_center(s): return bV[bF[bsid == s]].reshape(-1, 3).mean(0)
SURF = {}
for s in range(body['nsolids']):
    c = solid_center(s); m = bsid == s; P = bV[bF[m]].reshape(-1, 3); lo, hi = P.min(0), P.max(0)
    side = 'L' if c[0] > 0 else 'R'
    if s == 14: continue
    if hi[1] < 25 and lo[2] < -90: SURF[s] = 'FIXED'                     # varillas/carenados bajo las derivas
    elif hi[1] > 25 and lo[2] < -125: SURF[s] = 'Rudder' + side            # aleta móvil, z −130..−106
    elif hi[1] > 25: SURF[s] = 'FIN' + side                              # deriva fija
    elif lo[2] < -36 and hi[2] < -20 and abs(c[0]) > 82: SURF[s] = 'Aileron' + side
    elif lo[2] < -36 and hi[2] < -20 and abs(c[0]) > 36.15: SURF[s] = 'FlapOuter' + side
    elif lo[2] < -36 and hi[2] < -20: SURF[s] = 'FlapInner' + side
    else: SURF[s] = 'FIXED'                                              # varillas/carenados de bisagra del timón
print('sólidos del cuerpo:', {k: v for k, v in SURF.items()})

# --- timón de profundidad: caras del sólido principal detrás de la línea de bisagra (z < −118.25) en el estabilizador ---
main = bsid == 14
fcz = {}; fbb = {}
for f in np.unique(bfid[main]):
    Q = bV[bF[bfid == f]].reshape(-1, 3); fbb[f] = (Q.min(0), Q.max(0)); fcz[f] = Q.mean(0)
ELEV_HINGE_Z = -118.25
elev_f = [f for f, (lo, hi) in fbb.items() if fcz[f][2] < ELEV_HINGE_Z and hi[2] < -114.5 and lo[2] < -118.4
          and 5.3 < abs(fcz[f][0]) < 37.6 and -7.5 < lo[1] and hi[1] < -1.5]
elev_mask = np.isin(bfid, elev_f) & main
# Las pieles superior/inferior del estabilizador EXTERIOR (|x| 21..37.5) son una sola cara B-rep que incluye el elevador:
# se cortan con el plano de la bisagra (z = −118.42, la misma recta que separa las caras del elevador interior).
ELEV_CUT_Z = -118.42
def split_plane(V, F, axis, val):
    """Corta triángulos por el plano V[:,axis] = val. Devuelve (V2, F_menor, F_mayor) conservando la orientación."""
    V = list(map(tuple, V)); lo = []; hi = []
    Vn = [np.array(v) for v in V]
    def inter(a, b):
        pa, pb = Vn[a], Vn[b]; t = (val - pa[axis]) / (pb[axis] - pa[axis]); Vn.append(pa + t * (pb - pa)); return len(Vn) - 1
    for tri in F:
        sd = [Vn[i][axis] - val for i in tri]
        if all(x <= 0 for x in sd): lo.append(tri); continue
        if all(x >= 0 for x in sd): hi.append(tri); continue
        sg = [x > 0 for x in sd]
        k = [i for i in range(3) if sum(sg) == 1 and sg[i] or sum(sg) == 2 and not sg[i]][0]   # vértice solitario
        a, b, c = tri[k], tri[(k + 1) % 3], tri[(k + 2) % 3]
        pab, pac = inter(a, b), inter(a, c)
        one, two = (hi, lo) if sg[k] else (lo, hi)
        one.append([a, pab, pac]); two.append([pab, b, c]); two.append([pab, c, pac])
    return np.array(Vn), np.array(lo, np.int64).reshape(-1, 3), np.array(hi, np.int64).reshape(-1, 3)
outer_skin = [f for f, (lo, hi) in fbb.items() if lo[2] < ELEV_CUT_Z - 2 and hi[2] > -100 and 20.5 < abs(fcz[f][0]) < 38
              and lo[1] > -7.5 and hi[1] < -1.5 and (hi[0] - lo[0]) > 10]
skin_mask = np.isin(bfid, outer_skin) & main
Vs_, Flo_, Fhi_ = split_plane(bV, bF[skin_mask], 2, ELEV_CUT_Z)
print('pieles de estabilizador cortadas:', outer_skin, 'tri', skin_mask.sum(), '->', len(Flo_), '+', len(Fhi_))
# --- tablero / consola delantera de cabina: caras completas dentro de la caja de la cabina ---
cock_f = [f for f, (lo, hi) in fbb.items() if lo[2] > 59.0 and hi[2] < 77.5 and lo[0] > -7.6 and hi[0] < 7.6 and lo[1] > -1 and hi[1] < 15.5]
cock_mask = np.isin(bfid, cock_f) & main
print('caras elevador', len(elev_f), 'tri', elev_mask.sum(), '| tablero', len(cock_f), 'tri', cock_mask.sum())

parts = {}   # name -> dict(V (unidades archivo), F, mat, target)
def add(name, V, F, mat, target):
    if name in parts:  # concatenar
        p = parts[name]; F = F + len(p['V']); p['V'] = np.vstack([p['V'], V]); p['F'] = np.vstack([p['F'], F])
    else: parts[name] = dict(V=V, F=F, mat=mat, target=target)

body_mask = main & ~elev_mask & ~cock_mask & ~skin_mask
for s, nm in SURF.items():
    if nm in ('FIXED',) or nm.startswith('FIN'): body_mask |= bsid == s
add('Body', *sub(bV, bF[body_mask]), 'gunship', 62000)
add('Body', *sub(Vs_, Fhi_), 'gunship', 62000)        # parte delantera de las pieles cortadas (z > corte)
add('CockpitPanel', *sub(bV, bF[cock_mask]), 'cockpit', 9000)
for s, nm in SURF.items():
    if nm == 'FIXED' or nm.startswith('FIN'): continue
    add(nm, *sub(bV, bF[bsid == s]), 'gunship', 1800 if 'Rudder' in nm else 1200)
for side, sg in (('L', 1), ('R', -1)):
    m = elev_mask & (np.sign(bC[:, 0]) == sg)
    add('Elevator' + side, *sub(bV, bF[m]), 'gunship', 1600)
    Fl = Flo_[np.sign(Vs_[Flo_].mean(1)[:, 0]) == sg]
    add('Elevator' + side, *sub(Vs_, Fl), 'gunship', 1600)

# cabina, canopy
add('PilotSeat', *sub(by['lightening pilot seat'][0]['V'], by['lightening pilot seat'][0]['F']), 'seat', 8000)
add('Pilot', *sub(by['lightening pilot'][0]['V'], by['lightening pilot'][0]['F']), 'pilot', 14000)
add('WindshieldFrame', *sub(by['thunderbolt canopy front'][0]['V'], by['thunderbolt canopy front'][0]['F']), 'gunship', 2500)
add('WindshieldGlass', *sub(by['thunderbolt canopy front glass'][0]['V'], by['thunderbolt canopy front glass'][0]['F']), 'glass', 1000)
add('CanopyFrame', *sub(by['thunderbolt canopy back'][0]['V'], by['thunderbolt canopy back'][0]['F']), 'gunship', 2500)
add('CanopyGlass', *sub(by['thunderbolt canopy back glass'][0]['V'], by['thunderbolt canopy back glass'][0]['F']), 'glass', 1400)
gun = by['thunderbolt canon'][0]
add('Gun', *sub(gun['V'], gun['F']), 'gunmetal', 8000)

# tren principal: 2 sólidos (x>0 = izquierdo). Rueda = caras completamente dentro del cilindro del neumático.
def split_wheel(r, mask, side_sign):
    Fm = r['F'][mask]; fid = r['fid'][mask]; P = r['V'][Fm]
    ylow = P[:, :, 1].min()
    tire = np.unique(fid[P[:, :, 1].min(1) < ylow + 0.6])        # caras que tocan el fondo del neumático
    Q = r['V'][Fm[np.isin(fid, tire)]].reshape(-1, 3)
    xs = (Q[:, 0].min(), Q[:, 0].max()); zc = (Q[:, 2].min() + Q[:, 2].max()) / 2
    R = zc - Q[:, 2].min(); yc = ylow + R
    wheel_f = []
    for f in np.unique(fid):
        q = r['V'][Fm[fid == f]].reshape(-1, 3)
        rr = np.hypot(q[:, 2] - zc, q[:, 1] - yc)
        if rr.max() <= R + 0.08 and q[:, 0].min() >= xs[0] - 0.08 and q[:, 0].max() <= xs[1] + 0.08: wheel_f.append(f)
    wm = np.isin(fid, wheel_f)
    return Fm[wm], Fm[~wm], dict(axleFile=np.array([(xs[0] + xs[1]) / 2, yc, zc]), radiusU=R, widthU=xs[1] - xs[0])
ww = by['thunderbolt wing wheel rh'][0]
WHEEL = {}
for sd in range(ww['nsolids']):
    m = ww['sid'] == sd; side = 'L' if ww['V'][ww['F'][m]][:, :, 0].mean() > 0 else 'R'
    fw, fl, info = split_wheel(ww, m, 1 if side == 'L' else -1)
    add('MainWheel' + side, *sub(ww['V'], fw), 'tire', 3000)
    add('MainGear' + side, *sub(ww['V'], fl), 'gear', 3500)
    WHEEL['main' + side] = info
for stt in by['thunderbolt wing wheel strut']:
    side = 'L' if stt['V'][:, 0].mean() > 0 else 'R'
    add('MainGearBrace' + side, *sub(stt['V'], stt['F']), 'gear', 600)
fwr = by['thunderbolt front wheel'][0]
# brazos/compuerta trasera del tren de proa (detrás de la pata, z < 56.3, por encima de la rueda): no se pliegan bien -> nodo aparte
link_f = [f for f in np.unique(fwr['fid']) if (lambda Q: Q[:, 2].max() < 56.3 and Q[:, 1].min() > -25.5)(fwr['V'][fwr['F'][fwr['fid'] == f]].reshape(-1, 3))]
link_m = np.isin(fwr['fid'], link_f)
fw, fl, info = split_wheel(fwr, ~link_m, -1)
add('NoseWheel', *sub(fwr['V'], fw), 'tire', 2500)
add('NoseGear', *sub(fwr['V'], fl), 'gear', 3500)
add('NoseGearLinks', *sub(fwr['V'], fwr['F'][link_m]), 'gear', 1200)
WHEEL['nose'] = info
fd = by['thunderbolt front wheel flap'][0]
add('NoseGearDoor', *sub(fd['V'], fd['F']), 'gunship', 600)

# cargas originales del modelo base -> estaciones (NO se exportan)
loads = [r for r in T if any(k in r['name'] for k in ('missile', 'bomb', 'rocket'))]

# ----------------------------------------------------------------------------------------------------------
# 3) Geometría derivada (unidades archivo -> cuerpo)
# ----------------------------------------------------------------------------------------------------------
# planform del ala: borde de ataque (sólido principal) y de fuga (flaps/alerones) por rebanadas
def slice_z(V, F, x):
    P = V[F]; Z = []; Y = []
    for a, c in ((0, 1), (1, 2), (2, 0)):
        A = P[:, a]; B = P[:, c]; d = B[:, 0] - A[:, 0]; ok = np.abs(d) > 1e-9
        t = (x - A[ok, 0]) / d[ok]; k = (t >= 0) & (t <= 1); Q = A[ok][k] + t[k, None] * (B[ok][k] - A[ok][k])
        Z += list(Q[:, 2]); Y += list(Q[:, 1])
    return np.array(Z), np.array(Y)
wing_band = main & (bV[bF][:, :, 1].max(1) < 6) & (bV[bF][:, :, 1].min(1) > -9) & (bV[bF][:, :, 2].min(1) > -45) & (bV[bF][:, :, 2].max(1) < 30)
te_mask = np.isin(bsid, [s for s, n in SURF.items() if n.startswith(('Flap', 'Aileron'))])
xs = np.arange(0.0, SPAN_U / 2 - 0.5, 1.0); LE = []; TE = []
for x in xs:
    z, _ = slice_z(bV, bF[wing_band], x); LE.append(z.max() if len(z) else np.nan)
    z2, _ = slice_z(bV, bF[te_mask], x)
    if len(z2): TE.append(z2.min())
    else:
        z3, _ = slice_z(bV, bF[wing_band], x); TE.append(z3.min() if len(z3) else np.nan)
LE = np.array(LE); TE = np.array(TE)
# en la góndola del tren (x 31..44) y en el fuselaje (x<11) el borde de ataque/fuga se interpola (lo tapan carenados)
cs_le = LE[(xs >= 15) & (xs <= 29)].mean()
LE[xs <= 30] = cs_le
gap = (xs > 30) & (xs < 45); LE[gap] = np.interp(xs[gap], xs[~gap & ~np.isnan(LE)], LE[~gap & ~np.isnan(LE)])
TE[xs < 11] = TE[(xs >= 12) & (xs <= 20)].mean()
TE = np.where(np.isnan(TE), np.nanmean(TE), TE)
ch = LE - TE
area_u = 2 * np.trapezoid(ch, xs)
mac_u = np.trapezoid(ch ** 2, xs) / np.trapezoid(ch, xs)
le_mac_u = np.trapezoid(ch * LE, xs) / np.trapezoid(ch, xs)
y_mac_u = np.trapezoid(ch * xs, xs) / np.trapezoid(ch, xs)
cg_z_u = le_mac_u - CG_FRAC_MAC * mac_u
# altura del CG: mitad de la sección del fuselaje (|x|<1.5) en esa estación
def slice_plane_z(V, F, z):
    P = V[F]; out = []
    for a, c in ((0, 1), (1, 2), (2, 0)):
        A = P[:, a]; B = P[:, c]; d = B[:, 2] - A[:, 2]; ok = np.abs(d) > 1e-9
        t = (z - A[ok, 2]) / d[ok]; k = (t >= 0) & (t <= 1); out.append(A[ok][k] + t[k, None] * (B[ok][k] - A[ok][k]))
    return np.vstack(out)
Q = slice_plane_z(bV, bF[main], cg_z_u)
fus_top = Q[np.abs(Q[:, 0]) < 1.0][:, 1].max()
fus_bot = Q[(np.abs(Q[:, 0]) < 9.0)][:, 1].min()         # panza (a esta altura el fuselaje se funde con el ala)
cg_y_u = (fus_top + fus_bot) / 2
CG_FILE = np.array([0.0, cg_y_u, cg_z_u])
ORIGIN = to_body_raw(CG_FILE[None])[0]             # origen del modelo (en m, antes de trasladar)
def to_body(P): return to_body_raw(np.atleast_2d(P)) - ORIGIN
def tb(p): return [round(float(v), 4) for v in to_body(np.asarray(p, float))[0]]
print(f'fuselaje en CG: techo {fus_top:.2f} panza {fus_bot:.2f}');print(f'escala {S:.6f} m/u  área {area_u*S*S:.2f} m²  CMA {mac_u*S:.3f} m  LE_CMA z={le_mac_u:.2f}u  y_CMA {y_mac_u*S:.2f} m  CG(file) {CG_FILE.round(2)}')

allV = np.vstack([p['V'] for n, p in parts.items()] + [gun['V']])
lo_all, hi_all = allV.min(0), allV.max(0)
dims = dict(spanM=(hi_all[0] - lo_all[0]) * S, lengthM=(hi_all[2] - lo_all[2]) * S, lengthNoGunM=(bV[:, 2].max() - bV[:, 2].min()) * S,
            heightM=(hi_all[1] - lo_all[1]) * S)
print('dimensiones', {k: round(v, 3) for k, v in dims.items()})

# ----------------------------------------------------------------------------------------------------------
# 4) Pivotes y ejes (marco cuerpo, m)
# ----------------------------------------------------------------------------------------------------------
def body_pts(name): return to_body(parts[name]['V'])
def hinge_line(name, span_axis):
    """Bisagra = borde de ataque de la superficie (máximo x cuerpo) en sus dos extremos de envergadura."""
    P = body_pts(name); a = P[:, span_axis]; out = []
    for end in (a.min(), a.max()):
        E = P[np.abs(a - end) < 0.06]
        if len(E) < 3: E = P[np.argsort(np.abs(a - end))[:20]]
        fr = E[E[:, 0] > E[:, 0].max() - 0.03]
        out.append(fr.mean(0))
    A, B = out; ax = B - A; ax /= np.linalg.norm(ax)
    return A, B, ax
PIV = {}   # name -> dict(pivot, axis, range, note)
for nm in list(parts):
    if nm.startswith(('Aileron', 'FlapInner', 'FlapOuter', 'Elevator')):
        A, B, ax = hinge_line(nm, 2)
        if ax[2] < 0: ax = -ax      # eje hacia estribor: ángulo + = borde de fuga ABAJO
        rng = {'Aileron': [-25, 25], 'FlapInner': [0, 40], 'FlapOuter': [0, 40], 'Elevator': [-30, 20]}[nm.rstrip('LR').replace('Outer', 'Outer')]
        PIV[nm] = dict(pivot=(A + B) / 2, axis=ax, range=rng, note='ángulo + = borde de fuga abajo (regla de la mano derecha sobre el eje)')
    elif nm.startswith('Rudder'):
        A, B, ax = hinge_line(nm, 1)
        if ax[1] < 0: ax = -ax      # eje hacia arriba: ángulo + = borde de fuga a la DERECHA (proa a la derecha)
        PIV[nm] = dict(pivot=(A + B) / 2, axis=ax, range=[-30, 30], note='ángulo + = borde de fuga a la derecha (guiñada a la derecha)')
for k in ('ElevatorL', 'ElevatorR'):   # el estabilizador del A-10 no tiene diedro: bisagra común exactamente lateral
    PIV[k]['axis'] = np.array([0.0, 0.0, 1.0])
for k in ('FlapInnerL', 'FlapInnerR', 'FlapOuterL', 'FlapOuterR'):
    if k in PIV: PIV[k]['range'] = [0, 40]
for k in ('AileronL', 'AileronR'): PIV[k]['range'] = [-25, 25]
# Nota: en el A-10 real los alerones son "decelerones" (se abren en tijera como aerofreno); el modelo trae una sola hoja.

# tren
for side in 'LR':
    inf = WHEEL['main' + side]; ax_b = to_body(inf['axleFile'])[0]
    leg = body_pts('MainGear' + side)
    tube = leg[(np.abs(leg[:, 0] - ax_b[0]) < 0.12) & (leg[:, 1] > leg[:, 1].max() - 0.15)]
    top = np.array([ax_b[0], leg[:, 1].max() - 0.10, tube[:, 2].mean() if len(tube) else ax_b[2]])
    PIV['MainGear' + side] = dict(pivot=top, axis=np.array([0.0, 0.0, 1.0]), range=[0, 88],
                                  note='retracción: 0 = abajo, +88° = arriba (la pata gira hacia ADELANTE dentro de la góndola, la rueda queda semi-expuesta)')
    PIV['MainWheel' + side] = dict(pivot=ax_b, axis=np.array([0.0, 0.0, 1.0]), range=None, parent='MainGear' + side,
                                   note='giro de la rueda alrededor de z local (eje del eje); rodar hacia adelante = rotación NEGATIVA en z')
    br = body_pts('MainGearBrace' + side); up = br[br[:, 0].argmax()]
    PIV['MainGearBrace' + side] = dict(pivot=up, axis=np.array([0.0, 0.0, 1.0]), range=[0, 0],
                                       note='riostra plegable: no se modela el pliegue; ocultarla cuando la extensión del tren < 0.6')
inf = WHEEL['nose']; ax_n = to_body(inf['axleFile'])[0]
nl = body_pts('NoseGear')
strut = nl[(np.abs(nl[:, 0] - ax_n[0]) < 0.15) & (np.abs(nl[:, 2] - ax_n[2]) < 0.2)]
ntop = np.array([ax_n[0], nl[:, 1].max() - 0.10, ax_n[2]])
PIV['NoseGear'] = dict(pivot=ntop, axis=np.array([0.0, 0.0, 1.0]), range=[0, 90], note='retracción hacia ADELANTE: 0 = abajo, +90° = arriba')
PIV['NoseWheel'] = dict(pivot=ax_n, axis=np.array([0.0, 0.0, 1.0]), range=None, parent='NoseGear',
                        steerAxis=[0.0, 1.0, 0.0], steerRange=[-60, 60],
                        note='giro alrededor de z local; dirección alrededor de y local (la rueda está bajo el eje de la pata)')
nk = body_pts('NoseGearLinks'); up = nk[nk[:, 1].argmax()]
PIV['NoseGearLinks'] = dict(pivot=up, axis=np.array([0.0, 0.0, 1.0]), range=[0, 0],
                            note='brazos de arrastre/compuerta trasera del tren de proa: no se modela el pliegue; ocultar cuando la extensión < 0.6')
dr = body_pts('NoseGearDoor'); hinge = dr[dr[:, 1] > dr[:, 1].max() - 0.02]
PIV['NoseGearDoor'] = dict(pivot=np.array([dr[:, 0].mean(), dr[:, 1].max(), hinge[:, 2].mean()]), axis=np.array([1.0, 0.0, 0.0]), range=[0, 90],
                           note='0 = abierta (como en el CAD, tren abajo), +90° = cerrada (gira hacia el centro del avión)')
cf = body_pts('CanopyFrame')
rear = cf[cf[:, 0] < cf[:, 0].min() + 0.10]
PIV['CanopyFrame'] = dict(pivot=np.array([rear[:, 0].mean(), cf[:, 1].min() + 0.05, 0.0]), axis=np.array([0.0, 0.0, 1.0]), range=[0, 40],
                          note='bisagra trasera: + = abre hacia arriba-atrás')
PIV['CanopyGlass'] = dict(pivot=PIV['CanopyFrame']['pivot'], axis=PIV['CanopyFrame']['axis'], range=[0, 40], parent='CanopyFrame',
                          note='hija de CanopyFrame (se abre con ella)')

# cañón: boca
gB = to_body(gun['V']); tip = gB[gB[:, 0] > gB[:, 0].max() - 0.01]
muzzle = np.array([gB[:, 0].max(), (tip[:, 1].min() + tip[:, 1].max()) / 2, (tip[:, 2].min() + tip[:, 2].max()) / 2])
# eje del cañón: centroide de la sección de la boca vs. sección 0.5 m más atrás
back = gB[np.abs(gB[:, 0] - (muzzle[0] - 0.5)) < 0.02]
gun_axis = np.array([1.0, 0, 0])
if len(back) > 10:
    c2 = np.array([back[:, 0].mean(), (back[:, 1].min() + back[:, 1].max()) / 2, (back[:, 2].min() + back[:, 2].max()) / 2])
    gun_axis = muzzle - c2; gun_axis /= np.linalg.norm(gun_axis)

# ojo del piloto: casco = vértices del piloto en los 0.30 m superiores
# (el tubo de oxígeno sobresale hacia adelante: se usa el casquete superior del casco para hallar su centro)
pB = body_pts('Pilot'); ytop = pB[:, 1].max(); cap = pB[pB[:, 1] > ytop - 0.08]
hc = np.array([(cap[:, 0].min() + cap[:, 0].max()) / 2, ytop - 0.14, (cap[:, 2].min() + cap[:, 2].max()) / 2])
eye = hc + np.array([0.07, 0.0, 0.0])      # ojos ≈ 7 cm delante del centro del casco y 14 cm bajo su tope

# toberas TF34: anillo trasero de cada góndola
EXH = {}
for side, sg in (('L', 1), ('R', -1)):
    m = main & (bC[:, 1] > 6) & (sg * bC[:, 0] > 5) & (sg * bC[:, 0] < 30) & (bC[:, 2] < -20)
    Q = bV[bF[m]].reshape(-1, 3); zmin = Q[:, 2].min(); ring = Q[Q[:, 2] < zmin + 1.0]
    c = np.array([(ring[:, 0].min() + ring[:, 0].max()) / 2, (ring[:, 1].min() + ring[:, 1].max()) / 2, ring[:, 2].mean()])
    # radio de la boca: máximo radio de la cáscara de la góndola a 1.5 u de la salida
    sh = Q[np.abs(Q[:, 2] - (zmin + 1.5)) < 0.5]; rad = np.hypot(sh[:, 0] - c[0], sh[:, 1] - c[1]).max()
    EXH[side] = dict(pos=tb(c), axis=[-1.0, 0.0, 0.0], radiusM=round(float(rad * S), 3))
    # toma de aire: punto más adelantado de la góndola
    # toma de aire: punto más adelantado de la góndola, solo cerca de su eje (excluye el pilón que la une al fuselaje)
    nac = Q[np.hypot(Q[:, 0] - c[0], Q[:, 1] - c[1]) < 1.15 * (rad + 1e-9) / 1.0]
    zmax = nac[:, 2].max()
    EXH[side]['intake'] = tb([c[0], c[1], zmax])

# estaciones de pilón: posición de las cargas originales del modelo base; enganche = cara inferior del pilón sobre la carga
STA = []
for r in loads:
    Q = r['V']; c = (Q.min(0) + Q.max(0)) / 2; top = Q[:, 1].max()
    near = main & (np.abs(bC[:, 0] - c[0]) < 1.2) & (np.abs(bC[:, 2] - c[2]) < 6) & (bC[:, 1] > top - 0.3) & (bC[:, 1] < top + 4)
    py = bV[bF[near]][:, :, 1].min() if near.any() else top
    STA.append(dict(fileX=float(c[0]), attach=[c[0], py, c[2]], loadTop=top, orig=r['name'], lenU=Q[:, 2].max() - Q[:, 2].min()))
STA.sort(key=lambda s: -s['fileX'])   # de punta de ala izquierda a derecha
# Numeración real del A-10: 1..11 desde la punta izquierda, 6 = línea central (aquí no hay carga central)
real_ids = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]
stations = []
for i, s in enumerate(STA):
    stations.append(dict(id=f'STA{real_ids[i]}', attach=tb(s['attach']), originalLoad=s['orig'], pylonGapM=round(float((s['attach'][1] - s['loadTop']) * S), 3)))

# puntos de contacto con el suelo / colisión
tipL = bV[bV[:, 0] > bV[:, 0].max() - 0.3]; tipR = bV[bV[:, 0] < bV[:, 0].min() + 0.3]
tail = bV[bV[:, 2] < bV[:, 2].min() + 0.3]
finsP = np.vstack([bV[bF[bsid == s]].reshape(-1, 3) for s, n in SURF.items() if n.startswith(('FIN', 'Rudder'))])
aft = bV[(bV[:, 2] < -60) & (np.abs(bV[:, 0]) < 8)]
nose = bV[bV[:, 2] > bV[:, 2].max() - 0.5]
Zc, Yc = slice_z(bV, bF[main], 0.0)                       # corte por el plano de simetría (x archivo = 0)
def lowest(zlo, zhi):
    k = (Zc > zlo) & (Zc < zhi); i = np.argmin(np.where(k, Yc, np.inf)); return [0.0, Yc[i], Zc[i]]
hard = [
    dict(id='gunMuzzle', pos=[round(float(v), 4) for v in muzzle]),
    dict(id='noseTip', pos=tb([nose[:, 0].mean(), nose[:, 1].mean(), nose[:, 2].max()])),
    dict(id='noseBottom', pos=tb(lowest(75, 200))),
    dict(id='bellyFwd', pos=tb(lowest(20, 75))),
    dict(id='bellyMid', pos=tb(lowest(-30, 20))),
    dict(id='bellyAft', pos=tb(lowest(-75, -30))),
    dict(id='tailBumper', pos=tb(lowest(-200, -75))),
    dict(id='tailcone', pos=tb(tail[tail[:, 1].argmin()])),
    dict(id='finBottomL', pos=tb(finsP[finsP[:, 0] > 0][finsP[finsP[:, 0] > 0][:, 1].argmin()])),
    dict(id='finBottomR', pos=tb(finsP[finsP[:, 0] < 0][finsP[finsP[:, 0] < 0][:, 1].argmin()])),
    dict(id='finTopL', pos=tb(finsP[finsP[:, 0] > 0][finsP[finsP[:, 0] > 0][:, 1].argmax()])),
    dict(id='finTopR', pos=tb(finsP[finsP[:, 0] < 0][finsP[finsP[:, 0] < 0][:, 1].argmax()])),
    dict(id='wingtipL', pos=tb(tipL[tipL[:, 1].argmin()])),
    dict(id='wingtipR', pos=tb(tipR[tipR[:, 1].argmin()])),
]

# ----------------------------------------------------------------------------------------------------------
# 5) Plantillas de armas (warthog): AGM-65 y Mk-82, origen en el centro, x = proa, escala real
# ----------------------------------------------------------------------------------------------------------
def weapon_template(name, real):
    r = next(x for x in W if x['name'] == name)
    V = r['V'].astype(float); c0 = V.mean(0)
    # eje largo por PCA
    u, s_, vt = np.linalg.svd(V - c0, full_matrices=False); ax = vt[0]
    t = (V - c0) @ ax; L = t.max() - t.min()
    # proa = extremo SIN aletas (menor extensión radial en el 12 % extremo)
    rad = np.linalg.norm((V - c0) - np.outer(t, ax), axis=1)
    e0 = rad[t < t.min() + 0.12 * L].max(); e1 = rad[t > t.max() - 0.12 * L].max()
    if e1 > e0: ax = -ax          # el extremo con aletas grandes es la cola
    t = (V - c0) @ ax
    # base ortonormal: x = ax, y = arriba del archivo warthog (z) proyectado
    up = np.array([0, 0, 1.0]); up = up - ax * (up @ ax); up /= np.linalg.norm(up); zz = np.cross(ax, up)
    mid = (t.max() + t.min()) / 2
    Lc = np.stack([(V - c0) @ ax - mid, (V - c0) @ up, (V - c0) @ zz], 1)
    # centrar en el eje del cuerpo (mediana radial del tramo medio) y escalar por el largo real
    midsec = np.abs(Lc[:, 0]) < 0.15 * L
    cy = (np.percentile(Lc[midsec, 1], 2) + np.percentile(Lc[midsec, 1], 98)) / 2
    cz = (np.percentile(Lc[midsec, 2], 2) + np.percentile(Lc[midsec, 2], 98)) / 2
    Lc[:, 1] -= cy; Lc[:, 2] -= cz
    k = real['lengthM'] / L; Lc *= k
    rr = np.hypot(Lc[:, 1], Lc[:, 2]); body_d0 = 2 * np.median(rr[np.abs(Lc[:, 0]) < 0.1 * real['lengthM']])
    # escala radial (y, z) para llevar el diámetro del cuerpo al real (el modelo fuente es más delgado/grueso)
    kr = real['diamM'] / body_d0; Lc[:, 1:] *= kr
    rr = np.hypot(Lc[:, 1], Lc[:, 2]); body_d = 2 * np.median(rr[np.abs(Lc[:, 0]) < 0.1 * real['lengthM']])
    return Lc, r['F'], dict(scaleMPerUnit=k, radialScale=float(kr), sourceDiamM=float(body_d0), lengthM=float(np.ptp(Lc[:, 0])), bodyDiamM=float(body_d),
                            spanMaxM=float(2 * rr.max()), realDiamM=real['diamM'])
TEMPL = {}
for nm, src, real in (('AGM65', 'AGM-65', REAL['agm65']), ('Mk82', 'Mk-82', REAL['mk82'])):
    V, F, info = weapon_template(src, real); TEMPL[nm] = (V, F, info)
    print(nm, {k: round(v, 3) if isinstance(v, float) else v for k, v in info.items()})

# ----------------------------------------------------------------------------------------------------------
# 6) Mallas finales (marco cuerpo, relativas al pivote), simplificación, normales
# ----------------------------------------------------------------------------------------------------------
MATS = {   # baseColorFactor en espacio LINEAL (glTF)
    'gunship': dict(c=[0.078, 0.089, 0.086, 1], m=0.25, r=0.62),      # FS 36118 Gunship Gray ≈ sRGB #4E5452
    'gunmetal': dict(c=[0.05, 0.05, 0.055, 1], m=0.8, r=0.35),
    'gear': dict(c=[0.55, 0.56, 0.56, 1], m=0.5, r=0.45),
    'tire': dict(c=[0.018, 0.018, 0.02, 1], m=0.0, r=0.9),
    'glass': dict(c=[0.55, 0.65, 0.62, 0.22], m=0.0, r=0.05, blend=True),
    'cockpit': dict(c=[0.035, 0.038, 0.04, 1], m=0.1, r=0.7),          # tablero/consola: gris muy oscuro
    'seat': dict(c=[0.06, 0.06, 0.055, 1], m=0.1, r=0.75),
    'pilot': dict(c=[0.13, 0.14, 0.08, 1], m=0.0, r=0.85),             # traje de vuelo verde oliva
    'weapon': dict(c=[0.10, 0.12, 0.07, 1], m=0.2, r=0.6, double=True),   # verde oliva
    'weaponw': dict(c=[0.55, 0.57, 0.58, 1], m=0.2, r=0.55, double=True), # gris claro (Maverick); aletas = superficies de una cara -> doble cara
}
NODE_ORDER = ['Body', 'Gun', 'CockpitPanel', 'PilotSeat', 'Pilot', 'WindshieldFrame', 'WindshieldGlass', 'CanopyFrame', 'CanopyGlass',
              'AileronL', 'AileronR', 'FlapInnerL', 'FlapInnerR', 'FlapOuterL', 'FlapOuterR', 'ElevatorL', 'ElevatorR', 'RudderL', 'RudderR',
              'NoseGear', 'NoseWheel', 'NoseGearLinks', 'NoseGearDoor', 'MainGearL', 'MainWheelL', 'MainGearBraceL', 'MainGearR', 'MainWheelR', 'MainGearBraceR']
INTERIOR = {'CockpitPanel', 'PilotSeat', 'Pilot'}
assert set(NODE_ORDER) == set(parts), (set(parts) ^ set(NODE_ORDER))
final = {}
for nm in NODE_ORDER:
    p = parts[nm]
    V, F = decimate(p['V'], p['F'], p['target'])
    Vb = to_body(V)
    piv = PIV.get(nm, {}).get('pivot', np.zeros(3))
    final[nm] = dict(V=Vb, F=F, mat=p['mat'], pivot=np.asarray(piv, float))
for nm, (V, F, info) in TEMPL.items():
    V2, F2 = decimate(V, F, 2500)
    final[nm] = dict(V=V2, F=F2, mat='weaponw' if nm == 'AGM65' else 'weapon', pivot=np.zeros(3), template=info)

# ----------------------------------------------------------------------------------------------------------
# 7) Escritor glTF 2.0 binario (sin dependencias)
# ----------------------------------------------------------------------------------------------------------
class GLB:
    def __init__(s): s.bin = bytearray(); s.views = []; s.acc = []; s.meshes = []; s.nodes = []; s.mats = []; s.matidx = {}
    def _view(s, data, target):
        while len(s.bin) % 4: s.bin += b'\0'
        off = len(s.bin); s.bin += data; s.views.append(dict(buffer=0, byteOffset=off, byteLength=len(data), target=target)); return len(s.views) - 1
    def _acc(s, arr, ctype, typ, target, minmax=False):
        v = s._view(arr.tobytes(), target); a = dict(bufferView=v, componentType=ctype, count=int(arr.shape[0]), type=typ)
        if minmax: a['min'] = [float(x) for x in arr.min(0)]; a['max'] = [float(x) for x in arr.max(0)]
        s.acc.append(a); return len(s.acc) - 1
    def mat(s, key):
        if key in s.matidx: return s.matidx[key]
        d = MATS[key]; m = dict(name=key, pbrMetallicRoughness=dict(baseColorFactor=d['c'], metallicFactor=d['m'], roughnessFactor=d['r']))
        if d.get('blend'): m['alphaMode'] = 'BLEND'; m['doubleSided'] = True
        if d.get('double'): m['doubleSided'] = True
        s.mats.append(m); s.matidx[key] = len(s.mats) - 1; return s.matidx[key]
    def mesh(s, name, V, N, F, matkey):
        pos = s._acc(V.astype(np.float32), 5126, 'VEC3', 34962, True)
        nor = s._acc(N.astype(np.float32), 5126, 'VEC3', 34962)
        idx = s._acc(F.astype(np.uint32 if len(V) > 65535 else np.uint16).ravel(), 5125 if len(V) > 65535 else 5123, 'SCALAR', 34963)
        s.meshes.append(dict(name=name, primitives=[dict(attributes=dict(POSITION=pos, NORMAL=nor), indices=idx, material=s.mat(matkey))]))
        return len(s.meshes) - 1
    def node(s, name, t=None, mesh=None, children=None, extras=None):
        n = dict(name=name)
        if t is not None and np.any(np.abs(t) > 0): n['translation'] = [float(x) for x in t]
        if mesh is not None: n['mesh'] = mesh
        if children: n['children'] = children
        if extras: n['extras'] = extras
        s.nodes.append(n); return len(s.nodes) - 1
    def write(s, path, roots, extras):
        js = dict(asset=dict(version='2.0', generator='a10_export.py'), scene=0, scenes=[dict(name='Scene', nodes=roots, extras=extras)],
                  nodes=s.nodes, meshes=s.meshes, materials=s.mats, accessors=s.acc, bufferViews=s.views, buffers=[dict(byteLength=len(s.bin))])
        jb = json.dumps(js, separators=(',', ':')).encode()
        while len(jb) % 4: jb += b' '
        while len(s.bin) % 4: s.bin += b'\0'
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(s.bin)))
            f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
            f.write(struct.pack('<II', len(s.bin), 0x004E4942)); f.write(s.bin)

g = GLB(); tri_count = {}; meshdata = {}
def build_node(nm, parent_pivot):
    d = final[nm]; Vl = d['V'] - d['pivot']
    Vn, Nn, Fn = crease_normals(Vl, d['F'])
    meshdata[nm] = (Vn + d['pivot'], Fn, d['mat'])
    tri_count[nm] = len(Fn)
    mi = g.mesh(nm, Vn, Nn, Fn, d['mat'])
    return mi, d['pivot'] - parent_pivot
children_of = {'MainGearL': ['MainWheelL'], 'MainGearR': ['MainWheelR'], 'NoseGear': ['NoseWheel'], 'CanopyFrame': ['CanopyGlass']}
child_set = {c for v in children_of.values() for c in v}
root_children = []
def make(nm, parent_pivot=np.zeros(3)):
    mi, t = build_node(nm, parent_pivot)
    kids = [make(c, final[nm]['pivot']) for c in children_of.get(nm, [])]
    ex = {}
    if nm in PIV:
        pv = PIV[nm]; ex = dict(axis=[round(float(x), 5) for x in pv['axis']], range=pv['range'])
    if nm in INTERIOR: ex['interior'] = True
    return g.node(nm, t, mi, kids, ex or None)
for nm in NODE_ORDER:
    if nm in child_set: continue
    root_children.append(make(nm))
# estaciones (nodos vacíos) y plantillas ocultas
sta_nodes = [g.node(s['id'], np.array(s['attach']), extras=dict(station=True, originalLoad=s['originalLoad'])) for s in stations]
root_children.append(g.node('Stations', children=sta_nodes))
tn = []
for nm in TEMPL:
    mi, _ = build_node(nm, np.zeros(3))
    inf = final[nm]['template']
    tn.append(g.node(nm, None, mi, extras=dict(template=True, lugOffsetM=round(inf['bodyDiamM'] / 2, 4))))
root_children.append(g.node('Templates', children=tn, extras=dict(hidden=True, note='plantillas: ocultar; clonar y colgar en Stations/STAn')))
root = g.node('A10', children=root_children, extras=dict(frame='body: x proa, y arriba, z derecha; metros; origen = CG supuesto'))
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
g.write(OUT_GLB, [root], dict(scaleMPerFileUnit=S))
ext_tris = sum(v for k, v in tri_count.items() if k not in INTERIOR and k not in TEMPL)
int_tris = sum(tri_count[k] for k in INTERIOR)
print(f'GLB {os.path.getsize(OUT_GLB)//1024} KB  exterior {ext_tris} tri, interior {int_tris} tri, plantillas {sum(tri_count[k] for k in TEMPL)} tri')

# ----------------------------------------------------------------------------------------------------------
# 8) parts.json y geometry.json
# ----------------------------------------------------------------------------------------------------------
def r4(v): return [round(float(x), 4) for x in v]
partsj = dict(_note='Marco modelo = marco cuerpo (x proa, y arriba, z derecha), metros, origen en el CG supuesto. '
              'pivot = posición ABSOLUTA del origen del nodo en marco modelo; el nodo glTF hijo guarda su traslación relativa al padre. '
              'axis = eje de rotación (marco modelo); ángulos en grados; signo por regla de la mano derecha.',
              scaleMPerFileUnit=S, cgFile=r4(CG_FILE), dims={k: round(v, 3) for k, v in dims.items()},
              triangles=dict(exterior=ext_tris, interior=int_tris, templates=sum(tri_count[k] for k in TEMPL)), nodes={})
for nm in NODE_ORDER + list(TEMPL):
    Vb, Fn, mat = meshdata[nm]
    e = dict(tris=int(tri_count[nm]), material=mat, bbox=[r4(Vb.min(0)), r4(Vb.max(0))], pivot=r4(final[nm]['pivot']))
    for c, ks in children_of.items():
        if nm in ks: e['parent'] = c
    if nm in PIV:
        pv = PIV[nm]; e['axis'] = r4(pv['axis']); e['rangeDeg'] = pv['range']; e['note'] = pv.get('note', '')
        if 'steerAxis' in pv: e['steerAxis'] = pv['steerAxis']; e['steerRangeDeg'] = pv['steerRange']
    if nm in INTERIOR: e['interior'] = True
    if nm in TEMPL:
        inf = final[nm]['template']; e['template'] = True; e['parent'] = 'Templates'
        e.update(lengthM=round(inf['lengthM'], 3), bodyDiamM=round(inf['bodyDiamM'], 3), finSpanM=round(inf['spanMaxM'], 3),
                 lugOffsetM=round(inf['bodyDiamM'] / 2, 4), note='origen en el centro, x = proa; colgar con su +y tocando el pilón: pos = estación − (0, lugOffsetM, 0)')
    partsj['nodes'][nm] = e
partsj['stations'] = stations
json.dump(partsj, open(OUT_PARTS, 'w'), indent=1, ensure_ascii=False)

def wheel_geom(key, nm):
    inf = WHEEL[key]; ax = to_body(inf['axleFile'])[0]; R = inf['radiusU'] * S
    return ax, R, inf['widthU'] * S
gn_ax, gn_R, gn_W = wheel_geom('nose', 'NoseWheel')
gl_ax, gl_R, gl_W = wheel_geom('mainL', 'MainWheelL')
gr_ax, gr_R, gr_W = wheel_geom('mainR', 'MainWheelR')
geom = dict(
    _note='A-10 Thunderbolt II. Marco modelo = marco cuerpo del contrato (x proa, y arriba, z derecha), metros, origen = CG supuesto '
          f'(27 % de la CMA, en la línea media del fuselaje). Escala {S:.6f} m/unidad STEP (envergadura forzada a 17,53 m). '
          'Valores marcados ESTIMADO: supuestos, ver docs/MESH.md.',
    frame='body', scaleMPerFileUnit=round(S, 7),
    lengthM=round(dims['lengthM'], 3), spanM=round(dims['spanM'], 3), heightM=round(dims['heightM'], 3),
    wing=dict(refAreaM2=REAL['wingAreaM2'], macM=REAL['macM'], spanM=REAL['spanM'],
              measured=dict(areaM2=round(area_u * S * S, 2), macM=round(mac_u * S, 3), macLeadingEdgeX=tb([0, 0, le_mac_u])[0],
                            macSpanStationM=round(y_mac_u * S, 3), _status='medido sobre la planta del modelo (incluye la parte dentro del fuselaje)')),
    cgModel=[0.0, 0.0, 0.0],
    cgNote=f'origen = CG supuesto al {int(CG_FRAC_MAC*100)} % de la CMA medida (x = {tb([0,0,le_mac_u])[0]:.3f} − {CG_FRAC_MAC}·{mac_u*S:.3f} m); ESTIMADO',
    eyeModel=r4(eye), eyeLocal=r4(eye),
    gun=dict(muzzle=r4(muzzle), axis=r4(gun_axis), lateralOffsetM=round(float(muzzle[2]), 3),
             _status='boca medida del modelo (pieza "thunderbolt canon"); z < 0 = a la izquierda de la línea central'),
    gear=dict(
        nose=dict(axle=r4(gn_ax), contact=r4(gn_ax - [0, gn_R, 0]), wheelRadius=round(gn_R, 3), tireWidth=round(gn_W, 3), tireCount=1,
                  attach=r4(PIV['NoseGear']['pivot']), steerAxis=[0.0, 1.0, 0.0], steerPivot=r4(gn_ax), strokeM=0.30, steerMaxDeg=60,
                  _status='eje y radio medidos; carrera del amortiguador ESTIMADA; rueda de proa desplazada a la derecha como en el A-10 real'),
        main=dict(axle=r4((gl_ax + gr_ax) / 2), tireOffsets=[round(float(gl_ax[2]), 3), round(float(gr_ax[2]), 3)], wheelRadius=round((gl_R + gr_R) / 2, 3),
                  tireWidth=round((gl_W + gr_W) / 2, 3), tireCount=2, attach=r4((PIV['MainGearL']['pivot'] + PIV['MainGearR']['pivot']) / 2), strokeM=0.36,
                  _status='eje y radio medidos; carrera ESTIMADA (A-10 real ≈ 0,3–0,4 m)'),
        mainL=dict(axle=r4(gl_ax), contact=r4(gl_ax - [0, gl_R, 0]), attach=r4(PIV['MainGearL']['pivot'])),
        mainR=dict(axle=r4(gr_ax), contact=r4(gr_ax - [0, gr_R, 0]), attach=r4(PIV['MainGearR']['pivot'])),
    ),
    engines=dict(L=dict(exhaust=EXH['L']['pos'], exhaustAxis=EXH['L']['axis'], exhaustRadiusM=EXH['L']['radiusM'], intake=EXH['L']['intake']),
                 R=dict(exhaust=EXH['R']['pos'], exhaustAxis=EXH['R']['axis'], exhaustRadiusM=EXH['R']['radiusM'], intake=EXH['R']['intake']),
                 _status='centro de la salida trasera de cada góndola TF34 (medido); dirección del chorro = −x'),
    stations=stations,
    hardpoints=hard,
    controlSurfaces={k: dict(hingeMid=r4(v['pivot']), axis=r4(v['axis']), rangeDeg=v['range']) for k, v in PIV.items()
                     if k.startswith(('Aileron', 'Flap', 'Elevator', 'Rudder'))},
)
json.dump(geom, open(OUT_GEOM, 'w'), indent=1, ensure_ascii=False)
print('eye', r4(eye), 'muzzle', r4(muzzle), 'gunAxis', r4(gun_axis))
print('stations', [(s['id'], s['attach']) for s in stations])
pickle.dump(dict(meshdata=meshdata, eye=eye, stations=stations, lug={k: final[k]['template']['bodyDiamM'] / 2 for k in TEMPL}, PIV=PIV, final_pivots={k: v['pivot'] for k, v in final.items()}, children=children_of),
            open(os.path.join(CACHE, 'export_state.pkl'), 'wb'))
if '--no-render' not in sys.argv:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import a10_render; a10_render.main(os.path.join(CACHE, 'export_state.pkl'), OUT_DOC)
