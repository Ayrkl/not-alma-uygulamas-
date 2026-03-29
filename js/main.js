import { state } from './store.js';
import { initCamera, updateCanvas, tickCamera } from './camera.js';
import { initRenderer, renderObjects, cullObjects } from './renderer.js';
import { setupCanvasEvents } from './events.js';
import { setupUI } from './ui.js';

const canvasContainer = document.getElementById('canvas-container');
const canvasContent = document.getElementById('canvas-content');
const canvasGrid = document.getElementById('canvas-grid');
const zoomLevelEl = document.getElementById('zoom-level');
const coordXEl = document.getElementById('coord-x');
const coordYEl = document.getElementById('coord-y');

// Web Worker instance for searching
const searchWorker = new Worker('js/worker.js');

async function bootstrap() {
    // 1. İkonların Yüklenmesi
    if(window.lucide) window.lucide.createIcons();
    
    // 2. Modüllerin Başlatılması
    initCamera(canvasContainer);
    initRenderer(canvasContent);
    setupCanvasEvents(canvasContainer, canvasGrid);
    setupUI();

    // 3. Klasik Arama Çubuğunu Worker İçin Dinle
    const searchInput = document.getElementById('canvas-search');
    const searchResults = document.getElementById('search-results');
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchWorker.postMessage({ type: 'SEARCH', payload: { query: e.target.value, objects: state.objects } });
        });
        
        searchWorker.addEventListener('message', (e) => {
            if (e.data.type === 'SEARCH_RESULTS') {
                const results = e.data.payload;
                if(results.length === 0) {
                    searchResults.innerHTML = '<div class="search-result-item" style="color:#ef4444">Kayıt Bulunamadı.</div>';
                } else {
                    searchResults.innerHTML = results.map(r => `
                         <div class="search-result-item" style="cursor:pointer;" data-x="${r.x}" data-y="${r.y}">
                            <div class="result-title">${r.title}</div>
                            <div class="result-meta">${r.type.toUpperCase()}</div>
                         </div>
                    `).join('');
                    
                    // Sonuçlara tıklanınca oraya ışınlan
                    searchResults.querySelectorAll('.search-result-item').forEach(el => {
                        el.addEventListener('click', () => {
                             state.targetX = parseFloat(el.getAttribute('data-x')) + 150;
                             state.targetY = parseFloat(el.getAttribute('data-y')) + 100;
                             state.targetZ = 1.0;
                        });
                    });
                }
                searchResults.classList.add('active');
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                searchResults.classList.remove('active');
            }
        });
    }

    // 4. Electron'dan Kalıtımsal (Kayıtlı) Veriyi Al
    try {
        if (window.electronAPI && window.electronAPI.loadData) {
            const savedData = await window.electronAPI.loadData();
            if (savedData) {
                state.objects = savedData.objects || [];
                state.connections = savedData.connections || [];
                if (savedData.cam) {
                    state.targetX = savedData.cam.x; state.targetY = savedData.cam.y; state.targetZ = savedData.cam.z;
                    state.camX = savedData.cam.x; state.camY = savedData.cam.y; state.camZ = savedData.cam.z;
                }
            }
        }
    } catch(err) {
        console.warn('Lumina: State yüklenemedi. Boş bir tuval ile başlanıyor.', err);
    }
    
    // 5. İlk Çizimi Yap (Tüm dosyaları DOM'a diz)
    renderObjects();
    
    // 6. Ana requestAnimationFrame Motoru
    function animationLoop() {
        if(tickCamera()) {
            updateCanvas({ canvasContent, canvasGrid, zoomLevelEl, coordXEl, coordYEl });
            // Culling kontrolü her frame yapılır (GPU'dan binlerce divi siliyorsak burası hayat kurtarır)
            cullObjects();
        }
        requestAnimationFrame(animationLoop);
    }
    
    requestAnimationFrame(animationLoop);
}

// Tarayıcının DOM elementlerini tam yüklediğinden emin ol
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
