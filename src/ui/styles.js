// CSS inyectado desde JS (sin archivos ni imágenes externas). Estilo sobrio de cabina: oscuro, verde/ámbar de instrumentos.
export const CSS = `
.hz{position:absolute;inset:0;pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#d6ebdd;
  --g:#46ff9c;--gd:#1d8a55;--a:#ffb000;--r:#ff4a3d;--bg:#0a0f0c;--pn:#101713;--ln:#25352c;--tx:#d6ebdd;--mut:#8aa596;font-size:15px}
.hz *{box-sizing:border-box}
.hz-hud{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10}
.hz-screen{position:absolute;inset:0;display:none;pointer-events:auto;z-index:50;overflow:auto;
  background:radial-gradient(ellipse at 50% 0%,#14211a 0%,#0a0f0c 70%);padding:4vh 4vw}
.hz-screen.hz-dim{background:rgba(6,10,8,.82)}
.hz-screen.on{display:flex;justify-content:center;align-items:flex-start}
.hz-panel{width:min(1100px,100%);background:var(--pn);border:1px solid var(--ln);border-radius:6px;padding:22px 26px;box-shadow:0 8px 40px rgba(0,0,0,.5)}
.hz-panel.narrow{width:min(560px,100%)}
.hz h1{margin:0 0 2px;font-size:28px;letter-spacing:.16em;font-weight:600;color:var(--g);text-transform:uppercase}
.hz h2{margin:0 0 14px;font-size:18px;letter-spacing:.12em;font-weight:600;color:var(--g);text-transform:uppercase}
.hz h3{margin:18px 0 8px;font-size:12px;letter-spacing:.14em;font-weight:600;color:var(--a);text-transform:uppercase;border-bottom:1px solid var(--ln);padding-bottom:4px}
.hz .sub{color:var(--mut);margin:0 0 18px;font-size:13px;letter-spacing:.04em}
.hz-menu{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.hz-btn{font:inherit;color:var(--tx);background:#16211b;border:1px solid var(--ln);border-radius:4px;padding:11px 16px;text-align:left;cursor:pointer;
  display:flex;justify-content:space-between;align-items:baseline;gap:14px;min-height:42px}
.hz-btn small{color:var(--mut);font-size:12px}
.hz-btn:hover{border-color:var(--gd);background:#1a2820}
.hz-btn:focus-visible,.hz-btn.focus{outline:2px solid var(--g);outline-offset:1px;background:#1c2f24}
.hz-btn.primary{background:#124d2f;border-color:var(--gd);color:#eafff3;font-weight:600;letter-spacing:.08em;text-transform:uppercase;justify-content:center}
.hz-btn.warn{border-color:#7a5a10;color:var(--a)}
.hz-btn.sm{padding:6px 12px;min-height:32px;font-size:13px}
.hz-row{display:grid;grid-template-columns:230px 1fr;gap:6px 16px;align-items:center;margin:8px 0}
.hz-row>label,.hz-row>.lbl{color:var(--tx);font-size:14px}
.hz-row .hint{grid-column:2;color:var(--mut);font-size:12px;margin-top:-2px}
.hz-seg{display:inline-flex;border:1px solid var(--ln);border-radius:4px;overflow:hidden}
.hz-seg button{font:inherit;font-size:13px;color:var(--tx);background:#131c17;border:0;border-right:1px solid var(--ln);padding:8px 14px;cursor:pointer;min-width:64px}
.hz-seg button:last-child{border-right:0}
.hz-seg button[aria-checked=true]{background:#14603a;color:#eafff3;font-weight:600}
.hz-seg button:focus-visible{outline:2px solid var(--g);outline-offset:-2px}
.hz-sl{display:flex;align-items:center;gap:12px}
.hz-sl input[type=range]{flex:1;accent-color:var(--g);min-width:120px;height:28px}
.hz-sl .v{min-width:92px;text-align:right;font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--g);font-size:14px}
.hz input[type=range]:focus-visible,.hz-in:focus-visible{outline:2px solid var(--g);outline-offset:2px}
.hz-in{font:inherit;font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--g);background:#0b120e;border:1px solid var(--ln);border-radius:4px;padding:7px 9px;width:100%;min-width:0}
.hz-in.bad{border-color:var(--r);color:var(--r)}
.hz-cols{display:grid;grid-template-columns:minmax(300px,1.25fr) minmax(320px,1fr);gap:22px}
@media (max-width:900px){.hz-cols{grid-template-columns:1fr}.hz-row{grid-template-columns:1fr}.hz-row .hint{grid-column:1}}
.hz-map{position:relative;min-height:380px;height:52vh;background:#0b120e;border:1px solid var(--ln);border-radius:4px;overflow:hidden}
.hz-map .nomap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;color:var(--mut);font-size:13px}
.hz-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.hz-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:14px}
.hz-kv b{font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--g);font-weight:600}
.hz-status{margin:10px 0;padding:8px 10px;border-radius:4px;border:1px solid var(--ln);font-size:13px}
.hz-status.ok{color:var(--g);border-color:var(--gd)}
.hz-status.bad{color:var(--a);border-color:#7a5a10}
.hz-actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}
.hz-actions .hz-btn{flex:0 0 auto}
.hz-footer{margin-top:18px;color:var(--mut);font-size:12px;letter-spacing:.04em}
.hz-keys{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:6px 24px}
.hz-key{display:flex;justify-content:space-between;align-items:center;gap:10px;font:inherit;color:var(--tx);background:#121b16;border:1px solid var(--ln);border-radius:4px;padding:7px 10px;cursor:pointer;text-align:left;font-size:13px}
.hz-key:focus-visible{outline:2px solid var(--g);outline-offset:1px}
.hz-key.cap{border-color:var(--a);color:var(--a)}
.hz-kbd{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:var(--g);border:1px solid var(--gd);border-radius:3px;padding:1px 6px;margin-left:4px;background:#0b120e;white-space:nowrap}
.hz-load{position:absolute;inset:0;z-index:70;display:none;pointer-events:auto;background:#070b09;align-items:center;justify-content:center;flex-direction:column;gap:14px}
.hz-load.on{display:flex}
.hz-load .msg{color:var(--tx);font-size:15px;min-height:1.4em}
.hz-bar{width:min(480px,80vw);height:10px;border:1px solid var(--gd);border-radius:2px;background:#0b120e;overflow:hidden}
.hz-bar i{display:block;height:100%;width:0;background:var(--g);transition:width .12s linear}
.hz-toasts{position:absolute;left:0;right:0;bottom:90px;display:flex;flex-direction:column;align-items:center;gap:6px;z-index:60;pointer-events:none}
.hz-toast{background:rgba(8,14,11,.9);border:1px solid var(--gd);color:var(--tx);padding:7px 14px;border-radius:4px;font-size:14px}
.hz p{line-height:1.5;margin:6px 0}
.hz table{border-collapse:collapse;width:100%;font-size:13px}.hz td,.hz th{padding:4px 8px;border-bottom:1px solid var(--ln);text-align:left}
.hz th{color:var(--a);font-weight:600;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.hz svg.rwy{width:100%;height:auto;display:block;background:#0b120e;border:1px solid var(--ln);border-radius:4px}
`;
