// Start: bygger spelet och kopplar startknappen.
import { Game } from './game.js';

const canvas = document.getElementById('gl');
let game = null;

try {
  game = new Game(canvas);
  window.DASHH = game;               // praktiskt för felsökning i konsolen
} catch (err) {
  console.error(err);
  document.getElementById('overlay').innerHTML =
    `<div class="screen"><div class="goTitle">GRAFIKFEL</div>
     <p id="loadErr">${err.message}<br><br>
     Spelet kräver WebGL2. Prova en uppdaterad Chrome, Edge, Firefox eller Safari 15+,
     och kontrollera att hårdvaruacceleration är påslaget.</p></div>`;
}

if (game) {
  game.showMenu();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.pause();
  });

  game.run();
}
