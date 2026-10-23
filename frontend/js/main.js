// BAYORA 3D — entry point. Boots renderer, loads real run data,
// drives scroll → scene state, handles fallbacks.
import * as THREE from 'three';
import { createRenderer, buildWorld, applyScene, CAM, SCENES } from './scenes.js';
import { loadBundle } from './data.js';
import { initScroll } from './scroll.js';
import { hud } from './hud.js';
import { GLSLSandbox } from './glsl.js';
import GLSLSandbox2 from './glsl.js';
import './glsl.js' as helper;  // placeholder — glsl.js may be removed
