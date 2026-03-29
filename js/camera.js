import { state } from './store.js';

let canvasHalfW = window.innerWidth / 2;
let canvasHalfH = window.innerHeight / 2;

export function initCamera(container) {
    const ro = new ResizeObserver(entries => {
        for (let entry of entries) {
            canvasHalfW = entry.contentRect.width / 2;
            canvasHalfH = entry.contentRect.height / 2;
        }
    });
    if (container) ro.observe(container);
}

export function getCanvasCenter() {
    return { w: canvasHalfW, h: canvasHalfH };
}

export function updateCanvas({ canvasContent, canvasGrid, zoomLevelEl, coordXEl, coordYEl }) {
    if(!canvasContent) return;
    
    // Yüksek performanslı transform
    const transform = `translate(${canvasHalfW}px, ${canvasHalfH}px) scale(${state.camZ}) translate(${-state.camX}px, ${-state.camY}px)`;
    canvasContent.style.transform = transform;
    
    // Izgara Senkronizasyonu (CSS Değişkenleri üzerinden)
    const themeSizes = {
        'dark-grid': 50,
        'light-grid': 50,
        'corkboard': 60,
        'dot-grid': 30,
        'chalkboard': 50,
        'space': 400,
        'blueprint': 100
    };
    const theme = state.settings.theme || 'dark-grid';
    const baseSize = themeSizes[theme] || 50;
    const density = state.settings.bgDensity || 1.0;

    const gridSize = baseSize * density * state.camZ;
    const offsetX = canvasHalfW - state.camX * state.camZ;
    const offsetY = canvasHalfH - state.camY * state.camZ;
    
    if(canvasGrid) {
        // Will-change transform olan bu element GPU'da doğrudan güncellenir.
        canvasGrid.style.setProperty('--bg-grid-size', `${gridSize}px`);
        canvasGrid.style.setProperty('--bg-offset-x', `${offsetX}px`);
        canvasGrid.style.setProperty('--bg-offset-y', `${offsetY}px`);
    }

    if(zoomLevelEl) zoomLevelEl.innerText = `${Math.round(state.camZ * 100)}%`;
    if(coordXEl) coordXEl.innerText = `X: ${Math.round(state.camX)}`;
    if(coordYEl) coordYEl.innerText = `Y: ${Math.round(state.camY)}`;
}

// Fizik formülü: yumuşak kaydırma için hedefe yakınsıyoruz (interpolation)
export function tickCamera() {
    const s = state.settings.smoothness || 0.85;
    const dX = state.targetX - state.camX;
    const dY = state.targetY - state.camY;
    const dZ = state.targetZ - state.camZ;

    let changed = false;
    // Eğer kamerada hareket potansiyeli varsa
    if (Math.abs(dX) > 0.01 || Math.abs(dY) > 0.01 || Math.abs(dZ) > 0.0001 || state.isPanning || state.isDragging) {
        state.camX += dX * (1 - s);
        state.camY += dY * (1 - s);
        state.camZ += dZ * (1 - s);
        changed = true;
    }
    return changed;
}
