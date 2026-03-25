import './styles/variables.css';
import './styles/layout.css';
import './styles/controls.css';
import './styles/panels.css';
import './styles/tree.css';

import { App } from './core/App';

const container = document.getElementById('app');
if (container) {
    new App(container);
}
