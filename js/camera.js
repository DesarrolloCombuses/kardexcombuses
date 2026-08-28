// Captura de foto usando la cámara del dispositivo (input file + capture),
// con preview antes de confirmar. Funciona en navegadores móviles como PWA.
// La foto se marca con la fecha y hora en que se procesó (prácticamente la
// misma en que se tomó, ya que "capture" abre la cámara directo) para que
// quede como evidencia con el momento de la entrega, no solo el archivo.
class CameraCapture {
  // "stamp" (fecha/hora quemada en la foto) es la marca de evidencia que
  // necesita una foto de Entrega, pero no tiene sentido en una foto de
  // perfil de empleado -- ahí debe quedar limpia. Se puede desactivar acá
  // en vez de necesitar una clase aparte para ese caso.
  constructor({ inputEl, previewEl, stamp = true, filename = 'foto-receptor.jpg' }) {
    this.inputEl = inputEl;
    this.previewEl = previewEl;
    this.stamp = stamp;
    this.filename = filename;
    this.file = null;
    this._objectUrl = null;
    this.processing = false;
    this.inputEl.addEventListener('change', () => this._onChange());
  }

  async _onChange() {
    const original = this.inputEl.files[0];
    if (!original) return;
    this.processing = true;
    try {
      const stamped = await this._stampFile(original);
      this.file = stamped;

      if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = URL.createObjectURL(stamped);
      this.previewEl.src = this._objectUrl;
      this.previewEl.classList.remove('hidden');
    } finally {
      this.processing = false;
    }
  }

  async _stampFile(file) {
    const dataUrl = await this._readAsDataURL(file);
    const img = await this._loadImage(dataUrl);

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    if (this.stamp) this._drawTimestamp(ctx, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    return new File([blob], this.filename, { type: 'image/jpeg' });
  }

  _drawTimestamp(ctx, width, height) {
    // Sin dateStyle/timeStyle a propósito: así queda con el mismo formato
    // (año completo) que las fechas del resto de la app, ej. en Historial.
    const texto = new Date().toLocaleString('es-CO');
    const fontSize = Math.max(16, Math.round(width * 0.028));
    const paddingX = fontSize * 0.6;
    const paddingY = fontSize * 0.45;
    const margin = fontSize * 0.6;

    ctx.font = `700 ${fontSize}px Arial, Helvetica, sans-serif`;
    const textWidth = ctx.measureText(texto).width;
    const boxWidth = textWidth + paddingX * 2;
    const boxHeight = fontSize + paddingY * 2;
    const x = width - boxWidth - margin;
    const y = height - boxHeight - margin;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x, y, boxWidth, boxHeight);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, x + paddingX, y + boxHeight / 2);
  }

  _readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  _loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  hasPhoto() {
    return !!this.file;
  }

  getFile() {
    return this.file;
  }

  reset() {
    this.file = null;
    this.inputEl.value = '';
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
    this.previewEl.src = '';
    this.previewEl.classList.add('hidden');
  }
}
