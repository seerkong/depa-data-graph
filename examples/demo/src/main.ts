import './style.css';

import { createDemoRuntime } from './app/runtime';
import { mountVanillaView } from './views/vanilla/mountVanillaView';
import { mountVueView } from './views/vue/mountVueView';
import { mountReactView } from './views/react/mountReactView';
import { mountSolidView } from './views/solid/mountSolidView';
import { mountGraphPanel } from './views/vanilla/mountGraphPanel';
import { mountActorLog } from './views/vanilla/mountActorLog';
import { mountAIChatDemo } from './views/vanilla/mountAIChatDemo';

const runtime = createDemoRuntime();

mountVanillaView(document.querySelector('#vanilla-root')!, runtime);
mountVueView(document.querySelector('#vue-root')!, runtime);
mountReactView(document.querySelector('#react-root')!, runtime);
mountSolidView(document.querySelector('#solid-root')!, runtime);

mountAIChatDemo(document.querySelector('#chat-root')!);
mountGraphPanel(document.querySelector('#graph-root')!, runtime);
mountActorLog(document.querySelector('#log-root')!, runtime);
