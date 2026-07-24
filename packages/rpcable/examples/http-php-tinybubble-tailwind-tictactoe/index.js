import { createComponent } from '../http-php-tinybubble-tailwind/vendor/tinybubble/dist/bubble.js';
import LobbyApp from './components/lobby/LobbyApp.js';

const root = document.getElementById('app');

if (root) {
    const app = createComponent(LobbyApp);
    app.appendTo(root);
}
