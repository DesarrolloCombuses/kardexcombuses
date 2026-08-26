Router.register('ayuda', {
  title: 'Ayuda',

  onEnter() {
    if (this._bound) return;
    document.querySelectorAll('#ayuda-quicklinks a').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById(a.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    this._bound = true;
  },
});
