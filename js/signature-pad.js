// Componente de firma electrónica sobre <canvas>, soporta mouse y touch/pen.
class SignaturePad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.drawing = false;
    this.hasStroke = false;
    this._resize();
    this._bindEvents();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const ratio = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const prev = this.hasStroke ? this.toDataURL() : null;
    this.canvas.width = rect.width * ratio;
    this.canvas.height = rect.height * ratio;
    this.ctx.scale(ratio, ratio);
    this.ctx.lineWidth = 2;
    this.ctx.lineCap = 'round';
    this.ctx.strokeStyle = '#111827';
    if (prev) this._drawImageFromDataUrl(prev);
  }

  _drawImageFromDataUrl(dataUrl) {
    const img = new Image();
    img.onload = () => this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
    img.src = dataUrl;
  }

  _pointFromEvent(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const point = evt.touches ? evt.touches[0] : evt;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }

  _bindEvents() {
    const start = (evt) => {
      evt.preventDefault();
      this.drawing = true;
      this.hasStroke = true;
      const { x, y } = this._pointFromEvent(evt);
      this.ctx.beginPath();
      this.ctx.moveTo(x, y);
    };
    const move = (evt) => {
      if (!this.drawing) return;
      evt.preventDefault();
      const { x, y } = this._pointFromEvent(evt);
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
    };
    const end = () => {
      this.drawing = false;
    };

    this.canvas.addEventListener('mousedown', start);
    this.canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);

    this.canvas.addEventListener('touchstart', start, { passive: false });
    this.canvas.addEventListener('touchmove', move, { passive: false });
    this.canvas.addEventListener('touchend', end);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.hasStroke = false;
  }

  isEmpty() {
    return !this.hasStroke;
  }

  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }

  toBlob() {
    return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
  }
}
