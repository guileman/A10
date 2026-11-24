// Modo de realidad virtual (WebXR inmersivo): cabina con seguimiento de cabeza, HUD en el parabrisas y mandos Touch.
import { Group, Mesh, BoxGeometry, PlaneGeometry, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, PerspectiveCamera, Vector3, Quaternion } from 'three';
import { createHud } from '../ui/hud.js';
import { applyXRInput } from './mapping.js';

export const ROT_Y_M90 = new Quaternion(0, -Math.SQRT1_2, 0, Math.SQRT1_2);  // cámara (−Z adelante) -> cuerpo (+X adelante)

export function createVR({ renderer, scene, camera, input, hudOptions }) {
  const vr = { presenting: false, supported: false, session: null };
  const dolly = new Group(); dolly.name = 'vr-dolly'; scene.add(dolly);
  const lod = new PerspectiveCamera(100, 1, 0.1, 6000);
  const tmpV = new Vector3(), tmpQ = new Quaternion();
  const prevBtn = {};
  let hudAcc = 0, hudN = 0, saved = null, hudPlane = null, hudTex = null, hud = null, controllers = [];

  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');

  function buildHud() {
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720;
    hud = createHud({ canvas: cv, options: { ...hudOptions, noPanels: true } });
    hud.resize(1280, 720, 1); hud.setMode('pilot');
    hudTex = new CanvasTexture(cv); hudTex.colorSpace = SRGBColorSpace;
    const m = new MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    hudPlane = new Mesh(new PlaneGeometry(4.2, 2.36), m); hudPlane.renderOrder = 999; hudPlane.frustumCulled = false;
    hudPlane.position.set(0, 0.04, -4.0);        // en ejes de cámara-dolly: −Z es hacia proa
    dolly.add(hudPlane);
  }
  function buildControllers() {
    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i);
      const body = new Mesh(new BoxGeometry(0.035, 0.035, 0.13), new MeshBasicMaterial({ color: 0x20262c, fog: false }));
      const tip = new Mesh(new BoxGeometry(0.02, 0.02, 0.02), new MeshBasicMaterial({ color: i ? 0x39d98a : 0xffb020, fog: false }));
      body.position.z = 0.04; tip.position.z = -0.03; c.add(body, tip); c.visible = false;
      c.addEventListener('connected', () => { c.visible = true; }); c.addEventListener('disconnected', () => { c.visible = false; });
      dolly.add(c); controllers.push(c);
    }
  }

  vr.prepare = () => { if (!hud) { buildHud(); buildControllers(); } };
  vr.checkSupport = async () => {
    try { vr.supported = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch { vr.supported = false; }
    return vr.supported;
  };

  /** Debe llamarse desde un gesto del usuario (clic en «Entrar en VR»). */
  vr.enter = async (game) => {
    if (vr.presenting || vr.entering || !navigator.xr) return false;
    vr.entering = true;
    let session = null;
    try {
      vr.prepare();
      try { const gl = renderer.getContext(); if (gl && gl.makeXRCompatible) await gl.makeXRCompatible(); } catch (e0) { console.warn('makeXRCompatible', e0); }
      try {
        session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      } catch (e1) {
        // algunos runtimes rechazan las características opcionales: se reintenta con la configuración mínima
        if (!(e1 && e1.name === 'NotSupportedError')) throw e1;
        let sup = false; try { sup = await navigator.xr.isSessionSupported('immersive-vr'); } catch {}
        try { session = await navigator.xr.requestSession('immersive-vr'); }
        catch (e2) { const err = new Error(e2.message + ' [diagnóstico: isSessionSupported(immersive-vr)=' + sup + ']'); err.name = e2.name; throw err; }
      }
      session.addEventListener('end', () => vr._onEnd(game));   // primero: así cualquier falla posterior libera la sesión
      // Perfil liviano solo en la Quest (visor autónomo); con una PC (Rift S, etc.) se mantiene la calidad elegida
      vr.lite = /OculusBrowser|Quest/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('lite');
      saved = { shadows: renderer.shadowMap.enabled, sunShadow: game.scene.sun.castShadow, near: camera.near, far: camera.far, q: { ...game.scene._q } };
      if (vr.lite) {
        // (apagar sombras obliga a recompilar todos los shaders: en la PC se mantienen para no congelar la página al entrar)
        renderer.shadowMap.enabled = false; game.scene.sun.castShadow = false;
        try {
          game.scene.setQuality({ viewDistance: 1600, treeDensity: Math.min(saved.q.treeDensity || 1, 0.35), grassDensity: 0, grassDistance: 0, lodK: 1.0, detail: 0.6, tree3D: 30, rock3D: 20, buildBudget: 1 });
        } catch (e) { console.warn('VR quality', e); }
        game.model.setLite && game.model.setLite(true);
      }
      renderer.xr.setFramebufferScaleFactor(vr.lite ? 0.75 : 1.0);
      camera.near = 0.1; camera.updateProjectionMatrix();
      dolly.add(camera); camera.position.set(0, 0, 0); camera.quaternion.identity();
      await renderer.xr.setSession(session);
      try { renderer.xr.setFoveation(vr.lite ? 1 : 0.5); } catch {}
      vr.session = session; vr.presenting = true; hudPlane.visible = true; dolly.visible = true;
      return true;
    } catch (e) {
      try { if (session) await session.end(); } catch {}
      try { vr._onEnd(game); } catch {}
      throw e;
    } finally { vr.entering = false; }
  };
  vr._onEnd = (game) => {
    vr.presenting = false; vr.session = null;
    dolly.remove(camera); camera.position.set(0, 5, 0); camera.quaternion.identity();
    if (saved) {
      renderer.shadowMap.enabled = saved.shadows; game.scene.sun.castShadow = saved.sunShadow; camera.near = saved.near;
      try { game.scene.setQuality(saved.q); } catch (e) { console.warn(e); }
      camera.far = saved.far; game.model.setLite && game.model.setLite(false); saved = null;
    }
    camera.updateProjectionMatrix(); hudPlane.visible = false; input.setExternal({});
    try { game.scene._resize(); } catch {}
  };
  vr.exit = () => { if (vr.session) vr.session.end(); };

  /** Cámara auxiliar para que el motor decida LOD/vegetación con la posición real de la cabeza. */
  vr.lodCamera = (far) => {
    camera.getWorldPosition(tmpV); camera.getWorldQuaternion(tmpQ);
    lod.position.copy(tmpV); lod.quaternion.copy(tmpQ); lod.far = far; lod.updateProjectionMatrix(); lod.updateMatrixWorld(true);
    return lod;
  };
  vr.headWorld = (out) => camera.getWorldPosition(out);

  /** Un cuadro en VR: coloca el dolly en el ojo del piloto, lee los mandos y actualiza el HUD. */
  vr.update = (dt, state, controls, model) => {
    const eye = tmpV.copy(model.eyeLocal); model.group.localToWorld(eye);
    dolly.position.copy(eye);
    dolly.quaternion.copy(model.group.quaternion).multiply(ROT_Y_M90);
    dolly.updateMatrixWorld(true);
    const pads = {};
    if (vr.session) for (const src of vr.session.inputSources) if (src.gamepad && src.handedness) pads[src.handedness] = src.gamepad;
    const xr = applyXRInput(pads, prevBtn, dt, input, { onAction: vr.onAction });
    vr.gun = !!xr.gun;
    hudAcc += dt;
    if (hud && (++hudN & 1) === 0) { hud.update(state, controls, hudAcc, vr.extra); hudAcc = 0; hudTex.needsUpdate = true; }
  };
  vr.dolly = dolly; vr.gun = false; vr.extra = null; vr.onAction = null;
  return vr;
}
