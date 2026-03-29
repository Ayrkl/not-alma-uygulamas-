import { state, saveState } from './store.js';

export function setupCanvasEvents(container, grid) {
    if(!container) return;

    // Sağ tıklama menüsünü iptal et
    container.addEventListener('contextmenu', e => e.preventDefault());

    container.addEventListener('mousedown', e => {
        // UI alanına tıklayınca pan (kaydırma) yapma
        if (e.target.closest('#sidebar') || e.target.closest('#controls') || e.target.closest('.glass')) return;

        // Varsa açık notlardan imleci çek
        if (document.activeElement && document.activeElement.classList.contains('note-editor')) {
            document.activeElement.blur();
            window.getSelection().removeAllRanges();
        }

        if (e.button === 0 && (e.target === container || e.target === grid)) {
            state.isPanning = true;
            state.startMouseX = e.clientX;
            state.startMouseY = e.clientY;
            state.startCamX = state.targetX;
            state.startCamY = state.targetY;
            container.classList.add('panning');
            e.preventDefault();
        }
    });

    document.addEventListener('mousemove', e => {
        if (state.isPanning) {
            const dx = (e.clientX - state.startMouseX) / state.camZ;
            const dy = (e.clientY - state.startMouseY) / state.camZ;
            state.targetX = state.startCamX - dx;
            state.targetY = state.startCamY - dy;
            e.preventDefault();
        }
    });

    document.addEventListener('mouseup', () => {
        if (state.isPanning) {
            state.isPanning = false;
            container.classList.remove('panning');
            saveState(); // Tuvali kaydırdıktan sonra yeni koordinatları json'a yazmak üzere Worker'ı uyar
        }
    });

    // Capture fazında zoom olayını yakala ki yazılan notlarda sayfa kaymasın
    document.addEventListener('wheel', e => {
        const isUI = !!e.target.closest('.glass') || !!e.target.closest('#sidebar');
        if (isUI) return;

        e.preventDefault();
        const sensitivity = state.settings.sensitivity || 0.15;
        const zoomDelta = Math.pow(1 + sensitivity, -e.deltaY / 120);
        state.targetZ = Math.min(Math.max(state.targetZ * zoomDelta, 0.05), 10.0);
    }, { capture: true, passive: false });
    
    // Temel klavye kısayolları
    document.addEventListener('keydown', e => {
        if(e.ctrlKey && e.key === 'z') {
            const undo = document.getElementById('undo-btn');
            if (undo) undo.click();
        }
    });
}
