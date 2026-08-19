// Captura de foto usando la cámara del dispositivo (input file + capture),
// con preview antes de confirmar. Funciona en navegadores móviles como PWA.
class CameraCapture {
  constructor({ inputEl, previewEl }) {
    this.inputEl = inputEl;
    this.previewEl = previewEl;
    this.file = null;
    this.inputEl.addEventListener('change', () => this._onChange());
  }

  _onChange() {
    const file = this.inputEl.files[0];
    if (!file) return;
    this.file = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      this.previewEl.src = e.target.result;
      this.previewEl.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
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
    this.previewEl.src = '';
    this.previewEl.classList.add('hidden');
  }
}
