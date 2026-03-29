import { state, pushHistory, saveState } from './store.js';
import { generateId } from './utils.js';
import { renderObjects } from './renderer.js';

export function setupUI() {
    // 1. Zoom Butonları
    const zoomIn = document.getElementById('zoom-in');
    const zoomOut = document.getElementById('zoom-out');
    
    if (zoomIn) zoomIn.addEventListener('click', () => { state.targetZ = Math.min(10.0, state.targetZ * 1.25); });
    if (zoomOut) zoomOut.addEventListener('click', () => { state.targetZ = Math.max(0.05, state.targetZ / 1.25); });

    // 2. Sidebar Toggle
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    if (sidebar && toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // 3. Tool Seçimi
    document.querySelectorAll('.tool-btn').forEach(btn => {
        // Zaten işleri olanları atla
        if (btn.id === 'tool-create' || btn.id === 'undo-btn' || btn.id === 'save-btn' || btn.id.includes('zoom') || btn.id === 'open-settings' || btn.id === 'sidebar-toggle') return;

        btn.addEventListener('click', () => {
            document.querySelector('.tool-btn.active')?.classList.remove('active');
            btn.classList.add('active');
            
            const toolId = btn.id.replace('tool-', '');
            state.currentTool = toolId;
            
            // Eğer Yeni Ekleme ise doğrudan tetikle
            if (['text', 'note', 'checklist'].includes(toolId)) {
                pushHistory();
                state.objects.push({
                    id: generateId(),
                    type: toolId,
                    x: state.targetX,
                    y: state.targetY,
                    content: '',
                    width: 'auto',
                    height: 'auto',
                    newlyCreated: true
                });
                renderObjects();
                saveState();
                
                // Geri Pan moduna geç
                document.getElementById('tool-pan')?.click();
            }
        });
    });

    // 4. Focus Widget Toggle
    const focusBtn = document.getElementById('tool-focus');
    const focusWidget = document.getElementById('focus-widget');
    const closeFocus = document.getElementById('close-focus');
    if (focusBtn && focusWidget) {
        focusBtn.addEventListener('click', () => {
            focusWidget.classList.toggle('hidden');
        });
        if(closeFocus) closeFocus.addEventListener('click', () => focusWidget.classList.add('hidden'));
    }

    // 5. Ayarlar Paneli
    const settingsPanel = document.getElementById('settings-panel');
    const openSettings = document.getElementById('open-settings');
    const closeSettings = document.getElementById('close-settings');
    
    if (openSettings && settingsPanel) {
        openSettings.addEventListener('click', () => settingsPanel.classList.toggle('active'));
        if(closeSettings) closeSettings.addEventListener('click', () => settingsPanel.classList.remove('active'));
    }
}
