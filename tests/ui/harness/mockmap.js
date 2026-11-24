// MapView simulado (solo pruebas / capturas): cuadrícula con la polilínea del camino.
export class MockMapView {
  constructor(container, source, cb = {}) {
    this.cb = cb; this.path = []; this.center = { lon: -60.78, lat: -32.9, zoom: 14 };
    this.canvas = document.createElement('canvas'); this.canvas.style.cssText = 'width:100%;height:100%;display:block';
    container.appendChild(this.canvas); this.container = container; this.draw();
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect(), s = 0.00002;
      const lon = this.center.lon + (e.clientX - r.left - r.width / 2) * s, lat = this.center.lat - (e.clientY - r.top - r.height / 2) * s;
      this.path.push({ lon, lat }); this.draw(); cb.onChange && cb.onChange(this.path);
    });
  }
  setCenter(lon, lat, zoom) { this.center = { lon, lat, zoom }; this.draw(); }
  getCenter() { return this.center; }
  getPath() { return this.path.map((p) => ({ ...p })); }
  setPath(p) { this.path = p.map((q) => ({ ...q })); this.draw(); }
  clear() { this.path = []; this.draw(); }
  fitPath() { if (this.path.length) { const n = this.path.length; this.center = { ...this.center, lon: this.path.reduce((a, p) => a + p.lon, 0) / n, lat: this.path.reduce((a, p) => a + p.lat, 0) / n }; this.draw(); } }
  dispose() { this.canvas.remove(); }
  draw() {
    const c = this.canvas, w = (c.width = c.clientWidth || 600), h = (c.height = c.clientHeight || 400), g = c.getContext('2d');
    g.fillStyle = '#1c2a22'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2a3d31'; for (let x = 0; x < w; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y < h; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const s = 0.00002, pts = this.path.map((p) => [w / 2 + (p.lon - this.center.lon) / s, h / 2 - (p.lat - this.center.lat) / s]);
    g.strokeStyle = '#ffb000'; g.lineWidth = 3; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
    pts.forEach((p, i) => { g.fillStyle = '#46ff9c'; g.beginPath(); g.arc(p[0], p[1], 6, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillText('U' + (i + 1), p[0] + 9, p[1] - 9); });
    g.fillStyle = '#8aa596'; g.fillText('MapView simulado (solo pruebas)', 10, h - 10);
  }
}
