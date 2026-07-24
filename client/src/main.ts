import { createComponent } from 'tinybubble';
import { router } from './router';
import App from './App.bub.js';
import './styles.css';

const mount = document.getElementById('app');
if (!mount) {
  throw new Error('Missing #app mount point');
}

router.start();
createComponent(App).appendTo(mount);
