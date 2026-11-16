import { startApp } from './ui/app';

/** Any failure must be visible on the page: a silent blank canvas helps nobody. */
function report(error: unknown): void {
  console.error(error);
  const boot = document.getElementById('boot');
  if (boot) {
    boot.hidden = false;
    boot.textContent = `Le jeu a rencontré une erreur : ${error instanceof Error ? error.message : String(error)}`;
  }
}

window.addEventListener('error', (event) => report(event.error ?? event.message));
startApp().catch(report);
