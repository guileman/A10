# Renders de verificación del A-10 exportado (matplotlib, algoritmo del pintor).
# Las caras vistas "de espaldas" se pintan en ROJO en las vistas exteriores: en mallas cerradas eso delata
# triángulos invertidos (o agujeros). La vista desde el ojo descarta las caras traseras como three.js (FrontSide).
import pickle, sys, os, math
import numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt

BASE = {'gunship': (0.45, 0.48, 0.47), 'gunmetal': (0.25, 0.25, 0.27), 'gear': (0.75, 0.76, 0.76), 'tire': (0.12, 0.12, 0.13),
        'glass': (0.45, 0.65, 0.8), 'cockpit': (0.22, 0.23, 0.25), 'seat': (0.3, 0.28, 0.22), 'pilot': (0.45, 0.48, 0.3),
        'weapon': (0.4, 0.45, 0.3), 'weaponw': (0.8, 0.8, 0.8)}
HILITE = {'Aileron': (0.75, 0.55, 0.3), 'Flap': (0.4, 0.6, 0.8), 'Elevator': (0.6, 0.75, 0.45), 'Rudder': (0.8, 0.5, 0.55)}
LIGHT = np.array([0.35, 0.8, 0.45]); LIGHT /= np.linalg.norm(LIGHT)

def rotm(axis, deg):
    a = np.asarray(axis, float); a /= np.linalg.norm(a); t = math.radians(deg); c, s = math.cos(t), math.sin(t); x, y, z = a
    return np.array([[c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
                     [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
                     [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])

def posed(st, pose):
    """pose: {nodo: grados} -> {nodo: V transformado}. Los hijos heredan la transformación del padre."""
    md = st['meshdata']; PIV = st['PIV']; parent = {c: p for p, cs in st['children'].items() for c in cs}
    out = {}
    def xf(nm):
        R = np.eye(3); t = np.zeros(3)
        if nm in pose and nm in PIV:
            p = np.asarray(PIV[nm]['pivot']); R = rotm(PIV[nm]['axis'], pose[nm]); t = p - R @ p
        if nm in parent:
            Rp, tp = xf(parent[nm]); return Rp @ R, Rp @ t + tp
        return R, t
    for nm, (V, F, mat) in md.items():
        R, t = xf(nm); out[nm] = V @ R.T + t
    return out

def raster(tris, cols, W, H, zbuf=None, img=None, alpha=None):
    """Rasterizador con z-buffer. tris: (n,3,3) en píxeles (x, y) + profundidad (menor = más cerca)."""
    if zbuf is None: zbuf = np.full((H, W), np.inf)
    if img is None: img = np.ones((H, W, 3)) * np.array([0.93, 0.95, 0.97])
    x0 = np.clip(np.floor(tris[:, :, 0].min(1)).astype(int), 0, W - 1); x1 = np.clip(np.ceil(tris[:, :, 0].max(1)).astype(int), 0, W - 1)
    y0 = np.clip(np.floor(tris[:, :, 1].min(1)).astype(int), 0, H - 1); y1 = np.clip(np.ceil(tris[:, :, 1].max(1)).astype(int), 0, H - 1)
    for i in range(len(tris)):
        if x1[i] < x0[i] or y1[i] < y0[i]: continue
        (ax_, ay, az), (bx, by, bz), (cx, cy, cz) = tris[i]
        den = (by - cy) * (ax_ - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12: continue
        xs = np.arange(x0[i], x1[i] + 1) + 0.5; ys = np.arange(y0[i], y1[i] + 1) + 0.5
        X, Y = np.meshgrid(xs, ys)
        l1 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / den
        l2 = ((cy - ay) * (X - cx) + (ax_ - cx) * (Y - cy)) / den
        l3 = 1 - l1 - l2
        m = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        if not m.any(): continue
        z = l1 * az + l2 * bz + l3 * cz
        zb = zbuf[y0[i]:y1[i] + 1, x0[i]:x1[i] + 1]; im = img[y0[i]:y1[i] + 1, x0[i]:x1[i] + 1]
        w = m & (z < zb)
        if alpha is None:
            zb[w] = z[w]; im[w] = cols[i]
        else:
            im[w] = im[w] * (1 - alpha) + cols[i] * alpha
    return zbuf, img

def draw(ax, st, Vs, R, persp=None, names=None, hide=(), cull=False, mark_back=True, hilite=False, title='', lim=None, px=1400):
    """R: matriz 3x3 mundo->cámara (filas: derecha, arriba, hacia la cámara). persp=(eye, f) para perspectiva.
    Z-buffer; las caras traseras visibles se pintan en ROJO (mark_back) o se descartan (cull, como FrontSide de three.js)."""
    opaque = []; glass = []
    for nm, (V0, F, mat) in st['meshdata'].items():
        if names is not None and nm not in names: continue
        if nm in hide: continue
        V = Vs[nm]
        if persp is not None: V = V - persp[0]
        P = (V @ R.T)[F]
        n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); n /= np.maximum(np.linalg.norm(n, axis=1), 1e-20)[:, None]
        wn = np.cross(Vs[nm][F][:, 1] - Vs[nm][F][:, 0], Vs[nm][F][:, 2] - Vs[nm][F][:, 0]); wn /= np.maximum(np.linalg.norm(wn, axis=1), 1e-20)[:, None]
        if persp is not None:
            d = -P[:, :, 2]; ok = (d > 0.03).all(1)
            facing = -(np.einsum('ij,ij->i', n, P.mean(1))) > 0
            uv = persp[1] * P[:, :, :2] / np.maximum(d, 1e-6)[:, :, None]; dep = d
        else:
            ok = np.ones(len(F), bool); facing = n[:, 2] > 0; uv = P[:, :, :2]; dep = -P[:, :, 2]
        base = np.array(BASE[mat])
        if hilite:
            for k, c in HILITE.items():
                if nm.startswith(k): base = np.array(c)
        sh = 0.35 + 0.65 * np.clip(np.abs(wn @ LIGHT), 0, 1)
        col = np.clip(base[None] * sh[:, None], 0, 1)
        if mat not in ('glass', 'weapon', 'weaponw'):     # vidrio y armas: materiales de doble cara
            if cull: ok &= facing
            elif mark_back: col[~facing] = (0.9, 0.05, 0.05)
        T = np.concatenate([uv, dep[:, :, None]], 2)[ok]
        (glass if mat == 'glass' else opaque).append((T, col[ok]))
    allT = np.concatenate([t for t, _ in opaque + glass])
    if lim is None:
        u = allT[:, :, 0]; v = allT[:, :, 1]; lim = (u.min() - 0.2, u.max() + 0.2, v.min() - 0.2, v.max() + 0.2)
    sc = px / (lim[1] - lim[0]); W = px; H = int(round((lim[3] - lim[2]) * sc))
    def topx(T):
        T = T.copy(); T[:, :, 0] = (T[:, :, 0] - lim[0]) * sc; T[:, :, 1] = (lim[3] - T[:, :, 1]) * sc; return T
    zb = None; img = None
    if opaque:
        T = np.concatenate([t for t, _ in opaque]); C = np.concatenate([c for _, c in opaque]); zb, img = raster(topx(T), C, W, H)
    for T, C in glass:
        T2 = topx(T); zb2 = zb.copy() if zb is not None else None
        # vidrio: mezcla alfa solo donde está delante de lo opaco (sin escribir el z-buffer)
        _, img = raster(T2, C, W, H, zbuf=zb2, img=img, alpha=0.3)
    ax.imshow(img, extent=(lim[0], lim[1], lim[2], lim[3]), interpolation='bilinear')
    ax.set_title(title, fontsize=10); ax.tick_params(labelsize=7)

def cam(yaw_deg, pitch_deg):
    """Cámara orbitando: yaw desde la proa (+x) hacia estribor, pitch hacia arriba. Devuelve filas derecha/arriba/hacia-cámara."""
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    back = np.array([math.cos(p) * math.cos(y), math.sin(p), math.cos(p) * math.sin(y)])   # de origen hacia la cámara
    right = np.cross(np.array([0, 1.0, 0]), back); right /= np.linalg.norm(right)
    up = np.cross(back, right)
    return np.array([right, up, back])

R_TOP = np.array([[0, 0, 1.0], [1.0, 0, 0], [0, 1.0, 0]])        # derecha = +z, arriba(pantalla) = proa, hacia cámara = +y
R_SIDE = np.array([[1.0, 0, 0], [0, 1.0, 0], [0, 0, 1.0]])       # desde estribor: derecha = proa
R_FRONT = np.array([[0, 0, -1.0], [0, 1.0, 0], [1.0, 0, 0]])     # desde adelante: derecha de la imagen = ala izquierda

def main(state_path, outdir):
    os.makedirs(outdir, exist_ok=True)
    st = pickle.load(open(state_path, 'rb'))
    TPL = ('AGM65', 'Mk82')
    ext = [n for n in st['meshdata'] if n not in TPL]
    V0 = posed(st, {})
    for fn, R, t, sz in (('top.png', R_TOP, 'Vista superior (proa arriba) — rojo = cara invertida visible', (12, 12)),
                         ('side.png', R_SIDE, 'Vista lateral desde estribor', (16, 6)),
                         ('front.png', R_FRONT, 'Vista frontal', (16, 6))):
        fig, ax = plt.subplots(figsize=sz); draw(ax, st, V0, R, names=ext, hilite=True, title=t)
        ax.axhline(0, color='k', lw=0.3); ax.axvline(0, color='k', lw=0.3)
        plt.tight_layout(); plt.savefig(os.path.join(outdir, fn), dpi=80); plt.close()
    fig, axs = plt.subplots(1, 2, figsize=(20, 9))
    draw(axs[0], st, V0, cam(35, 25), names=ext, title='3/4 delantera (sin resaltar)')
    draw(axs[1], st, V0, cam(-140, -20), names=ext, hilite=True, title='3/4 trasera inferior (superficies resaltadas)')
    plt.tight_layout(); plt.savefig(os.path.join(outdir, 'three_quarter.png'), dpi=75); plt.close()
    # pose: tren arriba, canopy abierto, superficies deflectadas (verifica pivotes/ejes)
    pose = {'MainGearL': 88, 'MainGearR': 88, 'NoseGear': 90, 'NoseGearDoor': 90, 'CanopyFrame': 40,
            'AileronL': -20, 'AileronR': 20, 'FlapInnerL': 40, 'FlapInnerR': 40, 'FlapOuterL': 40, 'FlapOuterR': 40,
            'ElevatorL': -25, 'ElevatorR': -25, 'RudderL': 25, 'RudderR': 25}
    Vp = posed(st, pose)
    hide = ('MainGearBraceL', 'MainGearBraceR', 'NoseGearLinks')   # se ocultan con el tren arriba (ver MESH.md)
    fig, axs = plt.subplots(2, 2, figsize=(20, 14))
    draw(axs[0, 0], st, Vp, R_SIDE, names=ext, hide=hide, hilite=True, title='Tren arriba, canopy 40°, flaps 40°, elevador −25° (borde arriba), timón +25°')
    draw(axs[0, 1], st, Vp, cam(-140, -20), names=ext, hide=hide, hilite=True, title='Misma pose, 3/4 trasera inferior (alerón izq. −20 / der. +20)')
    draw(axs[1, 0], st, Vp, R_SIDE, names=ext, hide=hide, hilite=True, title='Detalle tren principal retraído', lim=(-3, 3, -2.5, 1.5))
    draw(axs[1, 1], st, Vp, R_SIDE, names=ext, hide=hide, hilite=True, title='Detalle tren de proa retraído', lim=(1.5, 7.5, -2.5, 1.5))
    plt.tight_layout(); plt.savefig(os.path.join(outdir, 'pose_retracted.png'), dpi=65); plt.close()
    # cabina desde el ojo del piloto (sin el piloto, caras traseras descartadas como en three.js)
    eye = np.asarray(st['eye']); R = np.array([[0, 0, 1.0], [0, 1.0, 0], [-1.0, 0, 0]])   # mira hacia +x
    fig, axs = plt.subplots(1, 2, figsize=(20, 8))
    f = 1 / math.tan(math.radians(45))
    draw(axs[0], st, V0, R, persp=(eye, f), names=ext, hide=('Pilot',), cull=True, title='Desde el ojo del piloto, mirando adelante (FOV 90°)', lim=(-1.2, 1.2, -0.75, 0.75))
    # segunda vista: lateral de la cabina con piloto
    names_c = [n for n in ext if n not in ('WindshieldGlass', 'CanopyGlass')]
    Vh = {k: v for k, v in V0.items()}
    draw(axs[1], st, Vh, R_SIDE, names=names_c, mark_back=False, cull=False, title='Cabina lateral (sin vidrios; ojo = punto rojo)', lim=(2.0, 6.0, -0.6, 2.2))
    axs[1].plot([eye[0]], [eye[1]], 'ro', ms=6)
    plt.tight_layout(); plt.savefig(os.path.join(outdir, 'cockpit_eye.png'), dpi=75); plt.close()
    # carga de prueba: AGM65 en estaciones exteriores, Mk82 en las interiores (clones de las plantillas)
    if 'stations' in st:
        md = dict(st['meshdata']); Vl = dict(V0); names = list(ext)
        for sta in st['stations']:
            tp = 'Mk82' if sta['id'] in ('STA4', 'STA5', 'STA7', 'STA8') else 'AGM65'
            V, F, mat = st['meshdata'][tp]; off = np.array(sta['attach']) - np.array([0, st['lug'][tp], 0])
            k = 'load_' + sta['id']; md[k] = (V + off, F, mat); Vl[k] = V + off; names.append(k)
        st2 = dict(st); st2['meshdata'] = md
        fig, axs = plt.subplots(1, 2, figsize=(22, 7))
        draw(axs[0], st2, Vl, R_FRONT, names=names, title='Carga de prueba en las estaciones (AGM-65 exteriores, Mk-82 interiores)')
        draw(axs[1], st2, Vl, cam(-35, -25), names=names, title='3/4 inferior con carga')
        plt.tight_layout(); plt.savefig(os.path.join(outdir, 'loadout.png'), dpi=70); plt.close()
    # armas: plantillas
    fig, axs = plt.subplots(1, 2, figsize=(16, 4))
    draw(axs[0], st, V0, R_SIDE, names=['AGM65'], title='Plantilla AGM65 (x proa; origen = cruz)'); axs[0].plot(0, 0, 'k+', ms=12)
    draw(axs[1], st, V0, R_SIDE, names=['Mk82'], title='Plantilla Mk82'); axs[1].plot(0, 0, 'k+', ms=12)
    plt.tight_layout(); plt.savefig(os.path.join(outdir, 'weapons.png'), dpi=75); plt.close()
    print('renders en', outdir)

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/.cache/a10_export/export_state.pkl'),
         sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs/mesh'))
