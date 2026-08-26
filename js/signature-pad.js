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
    const rect = this.canvas.getBoundingClientRect();
    // Si el paso de firma está oculto (otro paso del asistente activo), el
    // canvas mide 0x0. Redimensionar igual borraría la firma ya dibujada
    // (canvas.width = 0) aunque hasStroke siga en true, y luego toBlob()
    // devolvería null al enviar. El resize real ya se dispara al entrar
    // al paso 3 (ver _goToStep en salida.js), así que aquí basta con
    // ignorar los resize mientras esté oculto.
    if (rect.width === 0 || rect.height === 0) return;
    const ratio = window.devicePixelRatio || 1;
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

  // Público para poder recalcular el tamaño del canvas justo cuando su
  // paso del asistente se hace visible (mientras está oculto mide 0x0 y
  // no se puede firmar sobre él).
  resize() {
    this._resize();
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
