/**
 * Lumina Canvas - Core Application Logic
 * Feature: Infinite Canvas, Pan/Zoom, Arbitrary Placement
 */

// --- State Management (Kamera Mantığı) ---
const state = {
    // Mevcut konum ve derinlik
    camX: 0,
    camY: 0,
    camZ: 1.0,
    
    isExporting: false,
    
    // Hedef konum ve derinlik (Pürüzsüz geçiş için)
    targetX: 0,
    targetY: 0,
    targetZ: 1.0,

    isPanning: false,
    startMouseX: 0,
    startMouseY: 0,
    startCamX: 0,
    startCamY: 0,

    currentTool: 'pan',
    objects: [],
    selectedId: null,
    selectedIds: [],
    selectedConnId: null,
    selectedConnIds: [],
    connections: [],
    connFlow: 'forward', // forward, backward, both, none
    connStyle: 'curved', // curved, straight, dashed
    settings: {
        smoothness: 0.85,
        sensitivity: 0.15
    },
    undoHistory: [], // Geri alma geçmişi

    // Multi-canvas
    workspaces: [],
    activeWorkspaceId: null,

    // Connection Dragging
    isDraggingConnEnd: false,
    dragConnId: null,
    dragConnEndType: null // 'from' or 'to'
};

// --- Utils ---
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function screenToWorld(clientX, clientY) {
    const rect = canvasContainer.getBoundingClientRect();
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;
    return {
        x: (clientX - rect.left - halfW) / state.camZ + state.camX,
        y: (clientY - rect.top - halfH) / state.camZ + state.camY
    };
}

function getObjectAt(worldX, worldY) {
    // Top-most pick
    for (let i = state.objects.length - 1; i >= 0; i--) {
        const obj = state.objects[i];
        if (obj.type === 'point') continue; // Points are too small to grab easily as connection targets
        
        const w = (obj.width === 'auto' ? 200 : obj.width);
        const h = (obj.height === 'auto' ? (obj.type === 'note' ? 180 : 100) : obj.height);
        
        if (worldX >= obj.x && worldX <= obj.x + w &&
            worldY >= obj.y && worldY <= obj.y + h) {
            return obj;
        }
    }
    return null;
}

// --- Undo (Geri Alma) ---
const MAX_UNDO_STEPS = 50;

function pushHistory() {
    const snapshot = {
        objects: JSON.parse(JSON.stringify(state.objects)),
        connections: JSON.parse(JSON.stringify(state.connections))
    };
    state.undoHistory.push(snapshot);
    if (state.undoHistory.length > MAX_UNDO_STEPS) {
        state.undoHistory.shift();
    }
    updateUndoButton();
}

function undoAction() {
    if (state.undoHistory.length === 0) return;
    const snapshot = state.undoHistory.pop();
    state.objects = snapshot.objects;
    state.connections = snapshot.connections;
    deselectAll();
    renderObjects();
    renderConnections();
    saveState();
    updateUndoButton();

    // Geri al animasyonu
    const btn = document.getElementById('undo-btn');
    if (btn) {
        btn.classList.remove('triggered');
        void btn.offsetWidth; // reflow — animasyonu sıfırla
        btn.classList.add('triggered');
        setTimeout(() => btn.classList.remove('triggered'), 400);
    }
}

function updateUndoButton() {
    const btn = document.getElementById('undo-btn');
    if (btn) {
        btn.style.opacity = state.undoHistory.length > 0 ? '1' : '0.3';
        btn.title = state.undoHistory.length > 0
            ? `Geri Al (Ctrl+Z) — ${state.undoHistory.length} adım`
            : 'Geri alınacak bir şey yok';
    }
}

// --- DOM Elements ---
const canvasContainer = document.getElementById('canvas-container');
const canvasContent = document.getElementById('canvas-content');
const canvasGrid = document.getElementById('canvas-grid');
const zoomLevelEl = document.getElementById('zoom-level');
const coordXEl = document.getElementById('coord-x');
const coordYEl = document.getElementById('coord-y');
const imageUpload = document.getElementById('image-upload');
const videoUpload = document.getElementById('video-upload');
const pdfUpload = document.getElementById('pdf-upload');
const floatingToolbar = document.getElementById('floating-toolbar');

let canvasHalfW = window.innerWidth / 2;
let canvasHalfH = window.innerHeight / 2;

// --- Initialization ---
async function init() {
    lucide.createIcons();
    
    // Cache canvas dimensions to avoid layout thrashing
    const ro = new ResizeObserver(entries => {
        for (let entry of entries) {
            canvasHalfW = entry.contentRect.width / 2;
            canvasHalfH = entry.contentRect.height / 2;
        }
    });
    if (canvasContainer) ro.observe(canvasContainer);

    setupSearchListeners();
    initIconPicker();
    setupExtraListeners();
    try {
        // Attempt to load from JSON file first
        let savedData = await window.electronAPI.loadData();
        
        // Migration: If no file data exists but localStorage has data, migrate it
        if (!savedData && localStorage.getItem('lumina_canvas_data')) {
            console.log('Migrating data from localStorage to JSON file...');
            const localData = JSON.parse(localStorage.getItem('lumina_canvas_data') || '{}');
            savedData = {
                objects: localData.objects || [],
                connections: localData.connections || [],
                cam: localData.cam || { x: 0, y: 0, z: 1 },
                settings: localData.settings
            };
            // Initial save to the file
            await window.electronAPI.saveData(savedData);
        }

        if (savedData) {
            // MULTI CANVAS MIGRATION
            if (!savedData.version || savedData.version < 2) {
                console.log('Migrating single canvas to multi-canvas format...');
                savedData = {
                    version: 2,
                    activeWorkspaceId: 'default',
                    workspaces: [
                        {
                            id: 'default',
                            name: 'Ana Kanvas',
                            data: {
                                objects: savedData.objects || [],
                                connections: savedData.connections || [],
                                cam: savedData.cam || { x: 0, y: 0, z: 1.0 },
                                settings: savedData.settings || {}
                            }
                        }
                    ]
                };
                await window.electronAPI.saveData(savedData);
            }

            state.workspaces = savedData.workspaces || [];
            state.activeWorkspaceId = savedData.activeWorkspaceId || (state.workspaces[0] ? state.workspaces[0].id : null);

            const activeWs = state.workspaces.find(w => w.id === state.activeWorkspaceId) || state.workspaces[0];
            const activeData = activeWs ? activeWs.data : {};

            state.objects = activeData.objects || [];
            state.connections = activeData.connections || [];
            if (activeData.cam) {
                state.targetX = activeData.cam.x || 0;
                state.targetY = activeData.cam.y || 0;
                state.targetZ = activeData.cam.z || 1.0;
                state.camX = state.targetX;
                state.camY = state.targetY;
                state.camZ = state.targetZ;
            }
            if (activeData.settings) {
                state.settings = { ...state.settings, ...activeData.settings };
            }
        } else {
            // First run
            state.workspaces = [{
                id: 'default',
                name: 'Ana Kanvas',
                data: { objects: [], connections: [], cam: {x:0, y:0, z:1.0}, settings: state.settings }
            }];
            state.activeWorkspaceId = 'default';
        }

        setupWorkspacesUI();

        initFocusWidget();
        renderObjects();
        renderConnections();
        setupEventListeners();
        setupSettingsListeners();
        
        updateCanvas();
        setupMiniMapListeners();
        updateMiniMap();
        
        // Start animation loop
        requestAnimationFrame(animationLoop);
    } catch (err) {
        console.error("Lumina Init Error:", err);
    }
}

// --- Persistence ---
async function saveState() {
    if (state.activeWorkspaceId) {
        const activeWs = state.workspaces.find(w => w.id === state.activeWorkspaceId);
        if (activeWs) {
            activeWs.data = {
                objects: state.objects,
                connections: state.connections,
                cam: { x: state.targetX, y: state.targetY, z: state.targetZ },
                settings: state.settings
            };
        }
    }

    const dataToSave = {
        version: 2,
        activeWorkspaceId: state.activeWorkspaceId,
        workspaces: state.workspaces
    };
    
    // Save to the persistent JSON file via Electron
    await window.electronAPI.saveData(dataToSave);
}

// --- Multi-Workspace Logic ---
function switchWorkspace(id) {
    if (state.activeWorkspaceId === id) return;
    
    saveState().then(() => {
        state.activeWorkspaceId = id;
        const activeWs = state.workspaces.find(w => w.id === id);
        if (activeWs && activeWs.data) {
            state.objects = activeWs.data.objects || [];
            state.connections = activeWs.data.connections || [];
            state.targetX = activeWs.data.cam?.x || 0;
            state.targetY = activeWs.data.cam?.y || 0;
            state.targetZ = activeWs.data.cam?.z || 1.0;
            state.settings = { ...state.settings, ...activeWs.data.settings };
        } else {
            state.objects = [];
            state.connections = [];
            state.targetX = 0; state.targetY = 0; state.targetZ = 1.0;
        }
        
        state.camX = state.targetX;
        state.camY = state.targetY;
        state.camZ = state.targetZ;
        state.undoHistory = [];
        
        deselectAll();
        
        // Temizle ve yeniden çiz
        const contentEl = document.getElementById('canvas-content');
        if (contentEl) {
            contentEl.innerHTML = `
                <svg id="connection-layer">
                    <defs>
                        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                            <polygon points="0 0, 10 3.5, 0 7" fill="var(--accent-color)" />
                        </marker>
                        <marker id="arrowstart" markerWidth="10" markerHeight="7" refX="1" refY="3.5" orient="auto">
                            <polygon points="10 0, 0 3.5, 10 7" fill="var(--accent-color)" />
                        </marker>
                    </defs>
                </svg>
            `;
        }
        
        renderObjects();
        renderConnections();
        updateCanvas();
        updateMiniMap();
        saveState();
        renderWorkspacesList();
    });
}

function createWorkspace(nameStr = null) {
    // Electron'da prompt() bazen çalışmaz/kaldırılmıştır. Bu yüzden otomatik isim veriyoruz.
    const name = nameStr || `Yeni Kanvas ${state.workspaces.length}`;
    
    const newId = 'ws-' + Date.now();
    state.workspaces.push({
        id: newId,
        name: name,
        data: {
            objects: [],
            connections: [],
            cam: { x: 0, y: 0, z: 1.0 },
            settings: { ...state.settings }
        }
    });

    switchWorkspace(newId);
}

window.deleteWorkspace = function(event, id) {
    event.stopPropagation();
    if (state.workspaces.length <= 1) {
        alert("Tek kanvas varken silinemez.");
        return;
    }
    
    if (confirm("Bu kanvası silmek istediğinize emin misiniz?")) {
        state.workspaces = state.workspaces.filter(w => w.id !== id);
        if (state.activeWorkspaceId === id) {
            switchWorkspace(state.workspaces[0].id);
        } else {
            saveState();
            renderWorkspacesList();
        }
    }
};

window.startRenameWorkspace = function(event, id, element) {
    event.stopPropagation();
    
    element.contentEditable = "true";
    element.focus();
    
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(element);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    
    const finishRename = () => {
        element.contentEditable = "false";
        element.removeEventListener('blur', finishRename);
        element.removeEventListener('keydown', keydownHandler);
        
        const newName = element.innerText.trim();
        if (newName) {
            const ws = state.workspaces.find(w => w.id === id);
            if (ws) {
                ws.name = newName;
                saveState();
            }
        }
        renderWorkspacesList();
    };
    
    const keydownHandler = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishRename();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            const ws = state.workspaces.find(w => w.id === id);
            if (ws) {
                element.innerText = ws.name;
            }
            element.contentEditable = "false";
            element.removeEventListener('blur', finishRename);
            element.removeEventListener('keydown', keydownHandler);
        }
    };
    
    element.addEventListener('blur', finishRename);
    element.addEventListener('keydown', keydownHandler);
};

window.switchWorkspace = switchWorkspace;

function renderWorkspacesList() {
    const listEl = document.getElementById('workspaces-list');
    if (!listEl) return;
    
    listEl.innerHTML = state.workspaces.map(ws => `
        <div class="workspace-item ${ws.id === state.activeWorkspaceId ? 'active-workspace' : ''}" onclick="window.switchWorkspace('${ws.id}')">
            <div class="workspace-name" title="İsim değiştirmek için çift tıkla" ondblclick="window.startRenameWorkspace(event, '${ws.id}', this)" style="outline: none;">${ws.name}</div>
            <div class="workspace-actions" onclick="event.stopPropagation();">
                <button class="workspace-action-btn edit-btn" onclick="window.startRenameWorkspace(event, '${ws.id}', this.parentElement.previousElementSibling)" title="Yeniden Adlandır">
                    <i data-lucide="edit-2"></i>
                </button>
                <button class="workspace-action-btn delete-btn" onclick="window.deleteWorkspace(event, '${ws.id}')" title="Sil">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        </div>
    `).join('');
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function setupWorkspacesUI() {
    renderWorkspacesList();

    const workspacesBtn = document.getElementById('tool-workspaces');
    const workspacesPanel = document.getElementById('workspaces-panel');
    const newWorkspaceBtn = document.getElementById('btn-new-workspace');
    
    if (workspacesBtn && workspacesPanel) {
        workspacesBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = workspacesPanel.classList.toggle('active');
            if (isActive) {
                const searchPanel = document.getElementById('search-panel');
                if (searchPanel) searchPanel.classList.remove('active');
            }
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'w' && !e.ctrlKey && !e.metaKey && 
                document.activeElement.tagName !== 'INPUT' && 
                document.activeElement.tagName !== 'TEXTAREA' &&
                document.activeElement.getAttribute('contenteditable') !== 'true') {
                e.preventDefault();
                workspacesPanel.classList.add('active');
                const searchPanel = document.getElementById('search-panel');
                if (searchPanel) searchPanel.classList.remove('active');
            }
            if (e.key === 'Escape') {
                workspacesPanel.classList.remove('active');
            }
        });
        
        const canvasContainer = document.getElementById('canvas-container');
        if (canvasContainer) {
            canvasContainer.addEventListener('mousedown', () => {
                workspacesPanel.classList.remove('active');
            });
        }
    }

    if (newWorkspaceBtn) {
        newWorkspaceBtn.addEventListener('click', () => {
            createWorkspace();
        });
    }
}

// --- Search & Navigation Logic ---
function setupSearchListeners() {
    const searchInput = document.getElementById('canvas-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            updateSearchResults(e.target.value);
        });
        
        // Clear results when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                document.getElementById('search-results').classList.remove('active');
            }
        });
    }
}

function updateSearchResults(query) {
    const resultsEl = document.getElementById('search-results');
    if (!query.trim()) {
        resultsEl.innerHTML = '';
        resultsEl.classList.remove('active');
        return;
    }

    const filtered = state.objects.filter(obj => {
        const rawContent = (obj.content || "");
        // Strip HTML tags for cleaner searching
        const cleanContent = rawContent.replace(/<[^>]*>/g, ' ');
        return cleanContent.toLowerCase().includes(query.toLowerCase());
    });

    if (filtered.length === 0) {
        resultsEl.innerHTML = '<div class="search-result-item" style="cursor:default; opacity:0.5;">Sonuç bulunamadı</div>';
    } else {
        resultsEl.innerHTML = filtered.map(obj => {
            const cleanTitle = (obj.content || "").replace(/<[^>]*>/g, ' ').trim();
            const displayTitle = cleanTitle || (obj.type === 'image' ? 'Resim Dosyası' : 'Boş Not');
            return `
                <div class="search-result-item" onclick="window.focusOnCanvasObject('${obj.id}')">
                    <div class="result-title">${displayTitle.substring(0, 35)}${displayTitle.length > 35 ? '...' : ''}</div>
                    <div class="result-meta">${obj.type}</div>
                </div>
            `;
        }).join('');
    }
    resultsEl.classList.add('active');
}

// Expose focus function to window early for onclick markers
window.focusOnCanvasObject = (id) => {
    const obj = state.objects.find(o => o.id === id);
    if (!obj) return;

    // Remove previous highlights
    document.querySelectorAll('.search-highlight').forEach(h => h.classList.remove('search-highlight'));

    // Teleport camera
    state.targetX = obj.x + 100; // Offset to center better
    state.targetY = obj.y + 50;
    state.targetZ = 1.0; // Zoom in for readability

    // Highlight
    const el = document.getElementById(`obj-${id}`);
    if (el) {
        el.classList.add('search-highlight');
        selectObject(id); // Select it too

        // Auto-remove highlight after 3 seconds
        setTimeout(() => {
            el.classList.remove('search-highlight');
        }, 3000);
    }
};

function animationLoop() {
    const s = state.settings.smoothness;
    const dX = state.targetX - state.camX;
    const dY = state.targetY - state.camY;
    const dZ = state.targetZ - state.camZ;

    // Sadece hareket varsa güncelle
    if (Math.abs(dX) > 0.01 || Math.abs(dY) > 0.01 || Math.abs(dZ) > 0.0001 || state.isDragging) {
        state.camX += dX * (1 - s);
        state.camY += dY * (1 - s);
        state.camZ += dZ * (1 - s);
        updateCanvas();
        if (state.connections.length > 0) renderConnections();
        updateMiniMap();
    }
    requestAnimationFrame(animationLoop);
}

// --- Kamera Kontrolleri ---
function updateCanvas() {
    // Kamera Formülü: Dünyayı kameranın bakış açısına göre kilitliyoruz.
    // Her şey "canvasHalfW/canvasHalfH" merkezinde zoomlanır.
    const transform = `translate(${canvasHalfW}px, ${canvasHalfH}px) scale(${state.camZ}) translate(${-state.camX}px, ${-state.camY}px)`;
    canvasContent.style.transform = transform;
    
    // Izgara Senkronizasyonu — Tema Tablolarını Dinamik Olarak Yönetiyoruz
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

    // CSS Değişkenlerini Güncelle (Artık Grid CSS'i Variables Üzerinden Çalışıyor)
    const gridSize = baseSize * density * state.camZ;
    const offsetX = canvasHalfW - state.camX * state.camZ;
    const offsetY = canvasHalfH - state.camY * state.camZ;
    
    canvasGrid.style.setProperty('--bg-grid-size', `${gridSize}px`);
    canvasGrid.style.setProperty('--bg-offset-x', `${offsetX}px`);
    canvasGrid.style.setProperty('--bg-offset-y', `${offsetY}px`);
    
    // UI Güncelleme
    zoomLevelEl.innerText = `${Math.round(state.camZ * 100)}%`;
    coordXEl.innerText = `X: ${Math.round(state.camX)}`;
    coordYEl.innerText = `Y: ${Math.round(state.camY)}`;
}

function setupEventListeners() {
    // Disable default context menu on canvas
    canvasContainer.addEventListener('contextmenu', e => e.preventDefault());

    // Middle Mouse or Space + drag to pan
    canvasContainer.addEventListener('mousedown', e => {
        if (e.target.closest('#sidebar') || e.target.closest('#controls') || e.target.closest('.glass')) return;

        // Unfocus active editors
        if (e.target === canvasContainer || e.target === canvasGrid) {
            if (document.activeElement && document.activeElement.classList.contains('note-editor')) {
                document.activeElement.blur();
                window.getSelection().removeAllRanges();
            }
        }

        // Left Click (0) -> Pan
        if (e.button === 0 && (e.target === canvasContainer || e.target === canvasGrid)) {
            state.isPanning = true;
            state.startMouseX = e.clientX;
            state.startMouseY = e.clientY;
            state.startCamX = state.targetX;
            state.startCamY = state.targetY;
            deselectAll();
            canvasContainer.classList.add('panning');
            e.preventDefault();
        } 
        // Right Click (2) -> Selection Box
        else if (e.button === 2) {
            state.isSelecting = true;
            state.selectionStartX = e.clientX;
            state.selectionStartY = e.clientY;
            
            const selectionBox = document.createElement('div');
            selectionBox.id = 'selection-box';
            document.body.appendChild(selectionBox);
            selectionBox.style.display = 'block';
            deselectAll();
            e.preventDefault();
        } 
        // Middle Click (1) -> Pan (Backup)
        else if (e.button === 1) {
            state.isPanning = true;
            state.startMouseX = e.clientX;
            state.startMouseY = e.clientY;
            state.startCamX = state.targetX;
            state.startCamY = state.targetY;
            deselectAll();
            canvasContainer.classList.add('panning');
            e.preventDefault();
        }
    });

    window.addEventListener('mousemove', e => {
        const worldCoords = screenToWorld(e.clientX, e.clientY);

        if (state.isDraggingConnEnd && state.dragConnId) {
            const conn = state.connections.find(c => c.id === state.dragConnId);
            if (conn) {
                if (state.dragConnEndType === 'from') {
                    conn.fromX = worldCoords.x;
                    conn.fromY = worldCoords.y;
                    conn.fromId = null;
                } else {
                    conn.toX = worldCoords.x;
                    conn.toY = worldCoords.y;
                    conn.toId = null;
                }
                renderConnections();
            }
        } else if (state.isPanning) {
            const dx = (e.clientX - state.startMouseX) / state.camZ;
            const dy = (e.clientY - state.startMouseY) / state.camZ;
            state.targetX = state.startCamX - dx;
            state.targetY = state.startCamY - dy;
            // Immediate partial scroll for feedback
            state.camX = state.targetX;
            state.camY = state.targetY;
            updateCanvas();
        } else if (state.isSelecting) {
            const selectionBox = document.getElementById('selection-box');
            if (selectionBox) {
                const x1 = Math.min(state.selectionStartX, e.clientX);
                const y1 = Math.min(state.selectionStartY, e.clientY);
                const x2 = Math.max(state.selectionStartX, e.clientX);
                const y2 = Math.max(state.selectionStartY, e.clientY);
                
                selectionBox.style.left = `${x1}px`;
                selectionBox.style.top = `${y1}px`;
                selectionBox.style.width = `${x2 - x1}px`;
                selectionBox.style.height = `${y2 - y1}px`;
                
                hitTestSelection(x1, y1, x2 - x1, y2 - y1);
            }
        }
        
        if (state.isDragging && state.dragTarget) {
            const dx = (e.clientX - state.dragStartX) / state.camZ;
            const dy = (e.clientY - state.dragStartY) / state.camZ;
            
            const obj = state.objects.find(o => o.id === state.dragTarget);
            if (obj) {
                if (state.isResizing) {
                    obj.width = Math.max(100, state.resizeStartWidth + dx);
                    obj.height = Math.max(50, state.resizeStartHeight + dy);
                    const el = document.getElementById(`obj-${obj.id}`);
                    if (el) {
                        el.style.width = `${obj.width}px`;
                        el.style.height = `${obj.height}px`;
                    }
                } else {
                    obj.x += dx;
                    obj.y += dy;
                    const el = document.getElementById(`obj-${obj.id}`);
                    if (el) {
                        el.style.left = `${obj.x}px`;
                        el.style.top = `${obj.y}px`;
                    }
                    state.dragStartX = e.clientX;
                    state.dragStartY = e.clientY;
                    
                    if (state.connections.length > 0) {
                        renderConnections();
                    }
                }
            }
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (state.isDraggingConnEnd && state.dragConnId) {
            const worldCoords = screenToWorld(e.clientX, e.clientY);
            const targetObj = getObjectAt(worldCoords.x, worldCoords.y);
            const conn = state.connections.find(c => c.id === state.dragConnId);
            
            if (conn) {
                if (targetObj) {
                    const offX = worldCoords.x - targetObj.x;
                    const offY = worldCoords.y - targetObj.y;
                    
                    if (state.dragConnEndType === 'from') {
                        conn.fromId = targetObj.id;
                        conn.fromOffX = offX;
                        conn.fromOffY = offY;
                        conn.fromX = null; conn.fromY = null;
                    } else {
                        conn.toId = targetObj.id;
                        conn.toOffX = offX;
                        conn.toOffY = offY;
                        conn.toX = null; conn.toY = null;
                    }
                }
                renderConnections();
                saveState();
            }
            state.isDraggingConnEnd = false;
            state.dragConnId = null;
        }

        if (state.isPanning) {
            state.isPanning = false;
            canvasContainer.classList.remove('panning');
            saveState();
        }
        if (state.isSelecting) {
            state.isSelecting = false;
            const selectionBox = document.getElementById('selection-box');
            if (selectionBox) selectionBox.remove();
        }
        if (state.isDragging) {
            state.isDragging = false;
            state.isResizing = false;
            state.dragTarget = null;
            renderConnections();
            saveState();
        }
    });

    // Sabit Merkezli Z-Kamera Zoom - Capture fazında yakalayarak çocuk elemanların (not kağıtları vb.) olayı yutmasını engelliyoruz.
    document.addEventListener('wheel', e => {
        // UI Elemanlarını Kontrol Et (Sadece Sidebar ve statik paneller üzerindeyken zoom yapma)
        const isUI = !!e.target.closest('#sidebar') || 
                     !!e.target.closest('#settings-panel') ||
                     !!e.target.closest('#search-panel') ||
                     !!e.target.closest('#focus-widget') ||
                     !!e.target.closest('#media-url-modal') ||
                     !!e.target.closest('#floating-toolbar') ||
                     !!e.target.closest('#connection-toolbar');
        
        if (isUI) return;

        // Tuval üzerindeki herhangi bir yerde (not kağıtları dahil) zoom yapılmasına izin ver
        e.preventDefault();
        
        // Sadece Z (derinlik) hedefini değiştiriyoruz, X ve Y sabit kalıyor.
        // Bu sayede zoom her zaman tam ekranın ortasına doğru yapılır.
        const sensitivity = state.settings.sensitivity || 0.15;
        const zoomDelta = Math.pow(1 + sensitivity, -e.deltaY / 120);
        state.targetZ = Math.min(Math.max(state.targetZ * zoomDelta, 0.05), 10.0);
    }, { capture: true, passive: false });

    // Tool switching
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const toolId = btn.id.replace('tool-', '');
            
            // tool-create sadece submenu tetikleyicisi — araç değiştirme
            if (btn.id === 'tool-create') return;

            if (btn.id.startsWith('tool-')) {
                document.querySelector('.tool-btn.active')?.classList.remove('active');
                btn.classList.add('active');
                state.currentTool = toolId;

                // Submenu araçlarından biri seçildiyse group-trigger'ı vurgula
                const subMenuTools = ['text', 'note', 'image', 'checklist', 'connect', 'video', 'pdf'];
                const groupTrigger = document.getElementById('tool-create');
                if (subMenuTools.includes(toolId)) {
                    groupTrigger?.classList.add('has-active');
                } else {
                    groupTrigger?.classList.remove('has-active');
                }
                
                // Immediate action for certain tools
                if (state.currentTool === 'image') {
                    imageUpload.click();
                } else if (state.currentTool === 'video' || state.currentTool === 'embed') {
                    const modal = document.getElementById('media-url-modal');
                    if (modal) {
                        modal.classList.remove('hidden');
                        const input = document.getElementById('media-url-input');
                        if (input) input.focus();
                    }
                } else if (state.currentTool === 'pdf') {
                    pdfUpload.click();
                } else if (state.currentTool === 'text' || state.currentTool === 'note' || state.currentTool === 'checklist') {
                    addObject(state.currentTool);
                    document.getElementById('tool-pan').click();
                } else if (state.currentTool === 'connect') {
                    // Hide main toolbar immediately when switching to connect tool
                    document.getElementById('floating-toolbar').classList.remove('active');
                    document.getElementById('connection-toolbar').classList.add('active');
                }
            }
        });
    });

    // Connection Toolbar Actions
    const connectionToolbar = document.getElementById('connection-toolbar');
    connectionToolbar.querySelectorAll('.toolbar-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.id === 'cancel-connection') {
                state.connectSourceId = null;
                document.querySelectorAll('.canvas-obj').forEach(o => o.classList.remove('connecting-source'));
                document.getElementById('tool-pan').click();
                connectionToolbar.classList.remove('active');
                return;
            }

            const flow = btn.getAttribute('data-flow');
            const style = btn.getAttribute('data-style');

            if (flow) {
                state.connFlow = flow;
                connectionToolbar.querySelectorAll('[data-flow]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
            if (style) {
                state.connStyle = style;
                connectionToolbar.querySelectorAll('[data-style]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
        });
    });

    // Handle paste for screenshots
    window.addEventListener('paste', e => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (const item of items) {
            if (item.type.indexOf('image') !== -1) {
                const blob = item.getAsFile();
                handleImageFile(blob);
            }
        }
    });

    // Handle Drag and Drop
    canvasContainer.addEventListener('dragover', e => {
        e.preventDefault();
        canvasContainer.classList.add('drag-over');
    });

    canvasContainer.addEventListener('dragleave', () => {
        canvasContainer.classList.remove('drag-over');
    });

    canvasContainer.addEventListener('drop', e => {
        e.preventDefault();
        canvasContainer.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            for (const file of files) {
                if (file.type.startsWith('image/')) {
                    handleImageFile(file);
                }
            }
        }
    });

    // Handle clicks on canvas to create objects
    canvasContainer.addEventListener('click', e => {
        if (e.target !== canvasContainer && e.target !== canvasGrid) return;
        
        if (state.currentTool === 'text' || state.currentTool === 'note') {
            deselectAll();
            document.getElementById('tool-pan').click();
        } else if (state.currentTool === 'connect') {
            const rect = canvasContainer.getBoundingClientRect();
            const halfW = rect.width / 2;
            const halfH = rect.height / 2;
            const x = (e.clientX - rect.left - halfW) / state.camZ + state.camX;
            const y = (e.clientY - rect.top - halfH) / state.camZ + state.camY;
            
            // Create a small anchor point when clicking empty canvas in connect mode
            const pointId = addObject('point', x, y);
            handleConnectionClick(pointId);
        }
    });

    // Image Upload
    imageUpload.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
            handleImageFile(file);
        }
    });

    // Video Upload
    videoUpload.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
            handleVideoFile(file);
        }
    });

    // PDF Upload
    pdfUpload.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
            handlePdfFile(file);
        }
    });

    // Move sidebar toggle logic here
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    sidebarToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('collapsed');
    });

    // Undo button
    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) {
        undoBtn.addEventListener('click', () => undoAction());
    }
    updateUndoButton();

    // Keyboard Shortcuts
    window.addEventListener('keydown', e => {
        const isEditing = e.target.tagName === 'INPUT' || 
                         e.target.tagName === 'TEXTAREA' || 
                         e.target.getAttribute('contenteditable') === 'true';

        const key = e.key.toLowerCase();
        
        // Ctrl+Z çalışmalı, editörde de!
        if (e.ctrlKey && key === 'z') {
            // Editör içindeyken tarayıcının kendi geri almasına izin ver
            if (isEditing) return;
            e.preventDefault();
            undoAction();
            return;
        }
        
        // If typing, only allow tool shortcuts if Ctrl is pressed or it's not a letter
        if (isEditing) {
            // Check if user is trying to delete the whole object? 
            // Usually backspace inside editor should NOT delete the object.
            return;
        }
        
        if (key === 'h') document.getElementById('tool-pan').click();
        if (key === 'v') document.getElementById('tool-select').click();
        if (key === 't') document.getElementById('tool-text').click();
        if (key === 'i') document.getElementById('tool-image').click();
        if (key === 'm') document.getElementById('tool-video').click();
        if (key === 'p') document.getElementById('tool-pdf').click();
        if (key === 'n') document.getElementById('tool-note').click();
        
        if (key === 'delete' || (key === 'backspace' && !isEditing)) {
            if (state.selectedIds && state.selectedIds.length > 0) {
                bulkRemove(state.selectedIds);
            } else if (state.selectedId) {
                removeObject(state.selectedId);
            }
            
            if (state.selectedConnIds && state.selectedConnIds.length > 0) {
                bulkRemoveConnections(state.selectedConnIds);
            } else if (state.selectedConnId) {
                removeConnection(state.selectedConnId);
            }
        }
    });

    // Centered Zoom Buttons
    const handleViewportZoom = (factor) => {
        state.targetZ = Math.min(Math.max(state.targetZ * factor, 0.05), 10.0);
        // Bu butonlar merkezli olduğu için targetX/Y değişmez, 
        // çünkü kamera zaten hedeflenen dünya noktasında duruyor.
    };

    document.getElementById('zoom-in').addEventListener('click', () => handleViewportZoom(1.2));
    document.getElementById('zoom-out').addEventListener('click', () => handleViewportZoom(1/1.2));
    
    // Search Panel Toggle
    const searchPanel = document.getElementById('search-panel');
    const searchBtn = document.getElementById('tool-search');
    
    if (searchBtn && searchPanel) {
        searchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = searchPanel.classList.toggle('active');
            if (isActive) {
                document.getElementById('canvas-search').focus();
            }
        });
        
        // Key shortcut 'f' for search
        document.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && 
                document.activeElement.tagName !== 'INPUT' && 
                document.activeElement.getAttribute('contenteditable') !== 'true') {
                e.preventDefault();
                searchPanel.classList.add('active');
                document.getElementById('canvas-search').focus();
            }
            if (e.key === 'Escape') {
                searchPanel.classList.remove('active');
            }
        });
        
        // Close search when clicking on canvas
        canvasContainer.addEventListener('mousedown', () => {
            searchPanel.classList.remove('active');
        });
    }

    // Global Floating Toolbar Actions
    floatingToolbar.querySelectorAll('.toolbar-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cmd = btn.getAttribute('data-cmd');
            const format = btn.getAttribute('data-format');
            
            if (cmd) {
                document.execCommand(cmd, false, null);
            } else if (format) {
                document.execCommand('formatBlock', false, `<${format}>`);
            } else if (btn.id === 'toolbar-delete') {
                if (state.selectedIds && state.selectedIds.length > 0) {
                    bulkRemove(state.selectedIds);
                } else if (state.selectedId) {
                    removeObject(state.selectedId);
                }
                
                if (state.selectedConnIds && state.selectedConnIds.length > 0) {
                    bulkRemoveConnections(state.selectedConnIds);
                } else if (state.selectedConnId) {
                    removeConnection(state.selectedConnId);
                }
            }
        });
    });

    // Object Alignment Actions
    document.getElementById('btn-align-left').addEventListener('click', (e) => {
        e.stopPropagation();
        pushHistory();
        alignSelectedObjects('left');
    });
    document.getElementById('btn-align-center').addEventListener('click', (e) => {
        e.stopPropagation();
        pushHistory();
        alignSelectedObjects('center');
    });
    document.getElementById('btn-align-top').addEventListener('click', (e) => {
        e.stopPropagation();
        pushHistory();
        alignSelectedObjects('top');
    });

    // Custom Font Dropdown Logic
    const fontDropdown = document.getElementById('font-dropdown');
    const dropdownSelected = fontDropdown.querySelector('.dropdown-selected');
    const dropdownOptions = fontDropdown.querySelector('.dropdown-options');

    dropdownSelected.addEventListener('click', (e) => {
        e.stopPropagation();
        fontDropdown.classList.toggle('open');
    });

    fontDropdown.querySelectorAll('.dropdown-opt').forEach(opt => {
        opt.addEventListener('click', (e) => {
            const font = opt.getAttribute('data-value');
            const label = opt.textContent;
            
            dropdownSelected.textContent = label;
            fontDropdown.classList.remove('open');
            
            if (state.selectedId) {
                const obj = state.objects.find(o => o.id === state.selectedId);
                if (obj) {
                    pushHistory();
                    obj.fontFamily = font;
                    const el = document.querySelector(`#obj-${obj.id} .note-editor`);
                    if (el) el.style.fontFamily = font;
                    saveState();
                }
            }
            document.execCommand('fontName', false, font);
        });
    });

    // Custom Font Size Dropdown Logic
    const sizeDropdown = document.getElementById('size-dropdown');
    const sizeSelected = sizeDropdown.querySelector('.dropdown-selected');
    
    sizeSelected.addEventListener('click', (e) => {
        e.stopPropagation();
        sizeDropdown.classList.toggle('open');
        fontDropdown.classList.remove('open');
    });
    
    sizeDropdown.querySelectorAll('.dropdown-opt').forEach(opt => {
        opt.addEventListener('click', (e) => {
            const size = opt.getAttribute('data-value');
            sizeSelected.textContent = size;
            sizeDropdown.classList.remove('open');
            
            if (state.selectedId) {
                const obj = state.objects.find(o => o.id === state.selectedId);
                if (obj) {
                    pushHistory();
                    obj.fontSize = size;
                    const el = document.querySelector(`#obj-${obj.id} .note-editor`);
                    if (el) el.style.fontSize = size;
                    saveState();
                }
            }
        });
    });

    // Floating Toolbar Actions - COLORS
    floatingToolbar.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.selectedId) {
                const obj = state.objects.find(o => o.id === state.selectedId);
                if (obj) {
                    pushHistory();
                    const color = btn.getAttribute('data-color');
                    obj.color = color;
                    
                    const el = document.getElementById(`obj-${obj.id}`);
                    if (el) {
                        if (color === 'default') {
                            el.style.background = '';
                        } else {
                            el.style.background = color;
                        }
                    }
                    
                    floatingToolbar.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    saveState();
                }
            }
        });
    });

    // Floating Toolbar Actions - TEXT COLORS
    floatingToolbar.querySelectorAll('.text-color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.selectedId) {
                const obj = state.objects.find(o => o.id === state.selectedId);
                if (obj) {
                    pushHistory();
                    const color = btn.getAttribute('data-color');
                    obj.textColor = color;
                    
                    const el = document.querySelector(`#obj-${obj.id} .note-editor`);
                    if (el) {
                        el.style.color = color === 'default' ? '' : color;
                    }
                    
                    floatingToolbar.querySelectorAll('.text-color-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    saveState();
                }
            }
        });
    });

    // Close dropdowns when clicking outside
    window.addEventListener('click', () => {
        if (fontDropdown) fontDropdown.classList.remove('open');
        if (sizeDropdown) sizeDropdown.classList.remove('open');
    });

    // Save button logic
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const textData = JSON.stringify({
                objects: state.objects,
                connections: state.connections,
                cam: { x: state.camX, y: state.camY, z: state.camZ }
            }, null, 2);
            
            if (window.electronAPI) {
                const success = await window.electronAPI.saveFile(textData);
                if (success) console.log('Dosya başarıyla kaydedildi.');
            } else {
                const blob = new Blob([textData], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'board_data.txt';
                a.click();
            }
        });
    }
}

// Mini-Map Logic & Interactivity
function updateMiniMap() {
    const canvas = document.getElementById('mini-map-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (canvas.width !== canvas.offsetWidth) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Bounds calculation
    let minX = state.camX - (window.innerWidth / state.camZ) / 2;
    let minY = state.camY - (window.innerHeight / state.camZ) / 2;
    let maxX = state.camX + (window.innerWidth / state.camZ) / 2;
    let maxY = state.camY + (window.innerHeight / state.camZ) / 2;
    
    state.objects.forEach(obj => {
        const w = (obj.width === 'auto' ? 200 : obj.width);
        const h = (obj.height === 'auto' ? 100 : obj.height);
        minX = Math.min(minX, obj.x);
        minY = Math.min(minY, obj.y);
        maxX = Math.max(maxX, obj.x + w);
        maxY = Math.max(maxY, obj.y + h);
    });
    
    // Add margin
    const margin = 1000;
    minX -= margin; minY -= margin; maxX += margin; maxY += margin;
    
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    state.miniMapBounds = { minX, minY, maxX, maxY };

    // Draw Objects
    ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';
    state.objects.forEach(obj => {
        const ox = ((obj.x - minX) / rangeX) * canvas.width;
        const oy = ((obj.y - minY) / rangeY) * canvas.height;
        const ow = ((obj.width === 'auto' ? 200 : obj.width) / rangeX) * canvas.width;
        const oh = ((obj.height === 'auto' ? 100 : obj.height) / rangeY) * canvas.height;
        ctx.fillRect(ox, oy, Math.max(2, ow), Math.max(2, oh));
    });

    // Draw Viewport
    const vw = window.innerWidth / state.camZ;
    const vh = window.innerHeight / state.camZ;
    const vx = ((state.camX - vw/2 - minX) / rangeX) * canvas.width;
    const vy = ((state.camY - vh/2 - minY) / rangeY) * canvas.height;
    const vsw = (vw / rangeX) * canvas.width;
    const vsh = (vh / rangeY) * canvas.height;
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, vsw, vsh);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(vx, vy, vsw, vsh);
}

function setupMiniMapListeners() {
    const canvas = document.getElementById('mini-map-canvas');
    if (!canvas) return;

    const handleNav = (e) => {
        if (!state.miniMapBounds) return;
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width;
        const my = (e.clientY - rect.top) / rect.height;
        
        const worldX = state.miniMapBounds.minX + mx * (state.miniMapBounds.maxX - state.miniMapBounds.minX);
        const worldY = state.miniMapBounds.minY + my * (state.miniMapBounds.maxY - state.miniMapBounds.minY);
        
        state.targetX = worldX;
        state.targetY = worldY;
    };

    canvas.addEventListener('mousedown', (e) => {
        state.isMiniMapNavigating = true;
        handleNav(e);
    });

    window.addEventListener('mousemove', (e) => {
        if (state.isMiniMapNavigating) handleNav(e);
    });

    window.addEventListener('mouseup', () => {
        state.isMiniMapNavigating = false;
    });
}

function alignSelectedObjects(type) {
        if (!state.selectedIds || state.selectedIds.length < 2) return;
        
        const selectedObjects = state.objects.filter(o => state.selectedIds.includes(o.id));
        
        if (type === 'left') {
            const minX = Math.min(...selectedObjects.map(o => o.x));
            selectedObjects.forEach(obj => obj.x = minX);
        } else if (type === 'top') {
            const minY = Math.min(...selectedObjects.map(o => o.y));
            selectedObjects.forEach(obj => obj.y = minY);
        } else if (type === 'center') {
            const centers = selectedObjects.map(obj => {
                const el = document.getElementById(`obj-${obj.id}`);
                const w = el ? el.offsetWidth : (obj.width === 'auto' ? 200 : obj.width);
                return obj.x + w / 2;
            });
            const avgCenter = centers.reduce((a, b) => a + b, 0) / centers.length;
            selectedObjects.forEach(obj => {
                const el = document.getElementById(`obj-${obj.id}`);
                const w = el ? el.offsetWidth : (obj.width === 'auto' ? 200 : obj.width);
                obj.x = avgCenter - w / 2;
            });
        }
        
        renderObjects();
        saveState();
    }
    


function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        const center = getCanvasCenter();
        addObject('image', center.x, center.y, event.target.result);
    };
    reader.readAsDataURL(file);
}

function handleVideoFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        const center = getCanvasCenter();
        addObject('video', center.x, center.y, event.target.result);
    };
    reader.readAsDataURL(file);
}

function handlePdfFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        const center = getCanvasCenter();
        addObject('pdf', center.x, center.y, event.target.result);
    };
    reader.readAsDataURL(file);
}

// --- Object Logic ---
function addObject(type, x, y, content = '') {
    // If coordinates are not provided, use canvas center
    if (x === undefined || y === undefined) {
        const center = getCanvasCenter();
        const w = (type === 'note' || type === 'checklist' ? 250 : (type === 'video' || type === 'pdf' || type === 'embed' ? 400 : 200));
        const h = (type === 'note' ? 180 : (type === 'checklist' ? 150 : (type === 'video' ? 225 : (type === 'pdf' ? 600 : (type === 'embed' ? 350 : 60)))));
        x = center.x - w / 2;
        y = center.y - h / 2;
    }

    pushHistory();
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    
    // Default content for checklist
    let finalContent = content;
    if (type === 'checklist' && !content) {
        finalContent = JSON.stringify([{ id: 'item-' + Date.now(), text: '', checked: false }]);
    }

    const newObj = {
        id,
        type,
        x,
        y: y + 20, // Vertical offset
        content: finalContent || '',
        width: type === 'note' || type === 'checklist' ? 250 : (type === 'image' ? 300 : (type === 'video' || type === 'pdf' || type === 'embed' ? 450 : (type === 'point' ? 8 : 200))),
        height: type === 'note' ? 180 : (type === 'checklist' ? 'auto' : (type === 'video' ? 225 : (type === 'pdf' ? 630 : (type === 'embed' ? 350 : (type === 'point' ? 8 : 'auto'))))),
        pdfPage: type === 'pdf' ? 1 : undefined,
        fontFamily: 'Inter',
        fontSize: '16px',
        color: 'default',
        textColor: 'default',
        newlyCreated: true
    };
    state.objects.push(newObj);
    renderObject(newObj);
    updateMiniMap();
    saveState();
    return id;
}

function removeObject(id) {
    pushHistory();
    state.objects = state.objects.filter(o => o.id !== id);
    // Also remove related connections
    state.connections = state.connections.filter(c => c.fromId !== id && c.toId !== id);
    
    const el = document.getElementById(`obj-${id}`);
    if (el) el.remove();
    state.selectedId = null;
    renderConnections();
    updateMiniMap();
    saveState();
}

function deselectAll() {
    state.selectedId = null;
    state.selectedIds = [];
    document.querySelectorAll('.canvas-obj').forEach(el => {
        el.classList.remove('selected', 'multi-selected');
        el.style.boxShadow = "";
    });
    floatingToolbar.classList.remove('active');
    document.getElementById('connection-toolbar').classList.remove('active');
    state.selectedConnId = null;
    state.selectedConnIds = [];
    renderConnections(); // Update UI to remove selection glow
}

function selectConnection(connId) {
    deselectAll();
    state.selectedConnId = connId;
    renderConnections();
    
    // Show the floating toolbar for the connection
    floatingToolbar.classList.add('active');
}

function removeConnection(connId) {
    pushHistory();
    state.connections = state.connections.filter(c => c.id !== connId);
    state.selectedConnId = null;
    renderConnections();
    saveState();
}

function bulkRemoveConnections(connIds) {
    pushHistory();
    state.connections = state.connections.filter(c => !connIds.includes(c.id));
    state.selectedConnIds = [];
    renderConnections();
    saveState();
}

function hitTestSelection(sx, sy, sw, sh) {
    const halfW = canvasHalfW;
    const halfH = canvasHalfH;

    // 1. Check Objects
    state.selectedIds = [];
    state.objects.forEach(obj => {
        const objEl = document.getElementById(`obj-${obj.id}`);
        const objRect = {
            x: obj.x * state.camZ + halfW - state.camX * state.camZ,
            y: obj.y * state.camZ + halfH - state.camY * state.camZ,
            w: (obj.width === 'auto' ? 200 : obj.width) * state.camZ,
            h: (obj.height === 'auto' ? (obj.type === 'note' ? 180 : 100) : obj.height) * state.camZ
        };

        if (objRect.x < sx + sw && objRect.x + objRect.w > sx &&
            objRect.y < sy + sh && objRect.y + objRect.h > sy) {
            state.selectedIds.push(obj.id);
            if (objEl) objEl.classList.add('selected');
        } else {
            if (objEl) objEl.classList.remove('selected');
        }
    });

    // 2. Check Connections (Check if both endpoints are in the box)
    state.selectedConnIds = [];
    state.connections.forEach(conn => {
        const connEl = document.getElementById(`conn-${conn.id}`);
        const fromObj = conn.fromId ? state.objects.find(o => o.id === conn.fromId) : null;
        const toObj = conn.toId ? state.objects.find(o => o.id === conn.toId) : null;

        let startX, startY, endX, endY;

        if (fromObj) {
            const fw = (fromObj.width === 'auto' ? 200 : fromObj.width);
            const fh = (fromObj.height === 'auto' ? (fromObj.type === 'note' ? 180 : 100) : fromObj.height);
            startX = fromObj.x + (fw / 2);
            startY = fromObj.y + (fh / 2);
        } else if (conn.fromX !== null) {
            startX = conn.fromX;
            startY = conn.fromY;
        }

        if (toObj) {
            const tw = (toObj.width === 'auto' ? 200 : toObj.width);
            const th = (toObj.height === 'auto' ? (toObj.type === 'note' ? 180 : 100) : toObj.height);
            endX = toObj.x + (tw / 2);
            endY = toObj.y + (th / 2);
        } else if (conn.toX !== null) {
            endX = conn.toX;
            endY = conn.toY;
        }

        if (startX !== undefined && endX !== undefined) {
            // Project world coordinates to screen
            const sX = startX * state.camZ + halfW - state.camX * state.camZ;
            const sY = startY * state.camZ + halfH - state.camY * state.camZ;
            const eX = endX * state.camZ + halfW - state.camX * state.camZ;
            const eY = endY * state.camZ + halfH - state.camY * state.camZ;

            // If start OR end is inside selection box
            const startInside = sX > sx && sX < sx + sw && sY > sy && sY < sy + sh;
            const endInside = eX > sx && eX < sx + sw && eY > sy && eY < sy + sh;
            if (startInside || endInside) {
                state.selectedConnIds.push(conn.id);
                if (connEl) connEl.classList.add('selected');
            } else {
                if (connEl) connEl.classList.remove('selected');
            }
        }
    });

    const floatingToolbar = document.getElementById('floating-toolbar');
    if (state.selectedIds.length > 0 || state.selectedConnIds.length > 0) {
        floatingToolbar.classList.add('active');
        if (state.selectedIds.length > 1) {
            floatingToolbar.classList.add('multi-select');
        } else {
            floatingToolbar.classList.remove('multi-select');
        }
    } else {
        floatingToolbar.classList.remove('active');
        floatingToolbar.classList.remove('multi-select');
    }
}

function bulkRemove(ids) {
    pushHistory();
    ids.forEach(id => {
        state.objects = state.objects.filter(o => o.id !== id);
        state.connections = state.connections.filter(c => c.fromId !== id && c.toId !== id);
        const el = document.getElementById(`obj-${id}`);
        if (el) el.remove();
    });
    deselectAll();
    renderConnections();
    updateMiniMap();
    saveState();
}

function handleConnectionClick(objId) {
    // Hide floating toolbar while connecting
    document.getElementById('floating-toolbar').classList.remove('active');

    if (!state.connectSourceId) {
        state.connectSourceId = objId;
        const el = document.getElementById(`obj-${objId}`);
        if (el) el.style.boxShadow = "0 0 15px var(--accent-color)";
    } else if (state.connectSourceId !== objId) {
        pushHistory();
        const exists = state.connections.some(c => 
            (c.fromId === state.connectSourceId && c.toId === objId) ||
            (c.fromId === objId && c.toId === state.connectSourceId)
        );
        
        if (!exists) {
            const fromObj = state.objects.find(o => o.id === state.connectSourceId);
            const toObj = state.objects.find(o => o.id === objId);
            
            let fromX = null, fromY = null, toX = null, toY = null;
            let finalFromId = state.connectSourceId;
            let finalToId = objId;

            // If source is a point, use its center coordinates and mark it for deletion
            if (fromObj && fromObj.type === 'point') {
                fromX = fromObj.x + 4;
                fromY = fromObj.y + 4;
                finalFromId = null; 
            }
            // If target is a point, use its center coordinates and mark it for deletion
            if (toObj && toObj.type === 'point') {
                toX = toObj.x + 4;
                toY = toObj.y + 4;
                finalToId = null;
            }

            state.connections.push({ 
                id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                fromId: finalFromId,
                fromX, fromY,
                toId: finalToId,
                toX, toY,
                flow: state.connFlow,
                style: state.connStyle
            });

            // Cleanup helper points after connection is stored
            if (fromObj && fromObj.type === 'point') removeObject(fromObj.id);
            if (toObj && toObj.type === 'point') removeObject(toObj.id);

            saveState();
        }
        
        const sourceEl = document.getElementById(`obj-${state.connectSourceId}`);
        if (sourceEl) sourceEl.style.boxShadow = "";
        
        state.connectSourceId = null;
        renderConnections();
    }
}

function renderObject(obj) {
    let el = document.getElementById(`obj-${obj.id}`);
    const isUpdate = !!el;

    if (!el) {
        el = document.createElement('div');
        el.id = `obj-${obj.id}`;
    }

    if (obj.type === 'point') {
        el.className = 'canvas-obj point-anchor fade-in';
        el.style.left = `${obj.x}px`;
        el.style.top = `${obj.y}px`;
        
        if (!isUpdate) {
            el.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                if (state.currentTool === 'connect') handleConnectionClick(obj.id);
                else if (state.currentTool === 'pan' || state.currentTool === 'select' || state.currentTool === '') selectObject(obj.id);
            });
        }

        if (el.parentNode !== canvasContent) {
            canvasContent.appendChild(el);
        }
        return;
    }

    el.className = `canvas-obj fade-in ${obj.type}-obj ${state.selectedId === obj.id || state.selectedIds.includes(obj.id) ? 'selected' : ''}`;
    el.style.left = `${obj.pinned ? obj.pinX : obj.x}px`;
    el.style.top = `${obj.pinned ? obj.pinY : obj.y}px`;
    el.style.width = obj.width === 'auto' ? 'auto' : `${obj.width}px`;
    el.style.height = obj.height === 'auto' ? 'auto' : `${obj.height}px`;

    if (obj.color && obj.color !== 'default') {
        el.style.background = obj.color;
    } else {
        el.style.background = ''; // Reset to default
    }

    if (!isUpdate) {
        const handle = document.createElement('div');
        handle.className = 'obj-handle';
        el.appendChild(handle);

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        el.appendChild(resizeHandle);
    }

    if (obj.type === 'image') {
        if (isUpdate && el.dataset.renderedContent === obj.content) {
            // Already rendered
        } else {
            const oldWrapper = el.querySelector('.image-wrapper');
            if (oldWrapper) oldWrapper.remove();
            
            const wrapper = document.createElement('div');
            wrapper.className = 'image-wrapper';
            wrapper.innerHTML = `<img src="${obj.content}" draggable="false">`;
            el.appendChild(wrapper);
            el.dataset.renderedContent = obj.content;
        }
    } else if (obj.type === 'checklist') {
        if (isUpdate && el.dataset.renderedContent === obj.content) {
            // Check if items changed fundamentally, otherwise leave it
        } else {
            const oldContainer = el.querySelector('.checklist-container');
            if (oldContainer) oldContainer.remove();

            const container = document.createElement('div');
            container.className = 'checklist-container';
            
            const items = JSON.parse(obj.content || '[]');
            
            const renderItems = () => {
                container.innerHTML = '';
                items.forEach((item, index) => {
                    const itemEl = document.createElement('div');
                    itemEl.className = `checklist-item ${item.checked ? 'checked' : ''}`;
                    
                    const check = document.createElement('div');
                    check.className = `check-box ${item.checked ? 'checked' : ''}`;
                    check.innerHTML = '<i data-lucide="check"></i>';
                    check.addEventListener('click', (e) => {
                        e.stopPropagation();
                        pushHistory();
                        item.checked = !item.checked;
                        obj.content = JSON.stringify(items);
                        el.dataset.renderedContent = obj.content; // Prevent re-rendering
                        itemEl.classList.toggle('checked', item.checked);
                        check.classList.toggle('checked', item.checked);
                        saveState();
                    });
                    
                    const text = document.createElement('div');
                    text.className = 'item-text';
                    text.contentEditable = 'true';
                    text.spellcheck = false;
                    text.innerText = item.text;
                    const debouncedPush = debounce(() => {
                        pushHistory();
                        saveState();
                    }, 800);

                    text.addEventListener('input', () => {
                        item.text = text.innerText;
                        obj.content = JSON.stringify(items);
                        el.dataset.renderedContent = obj.content; // Prevent re-rendering
                        debouncedPush();
                    });
                    text.addEventListener('mousedown', e => e.stopPropagation());
                    
                    // Keyboard support
                    text.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            pushHistory();
                            const newId = 'item-' + Date.now();
                            items.splice(index + 1, 0, { id: newId, text: '', checked: false });
                            obj.content = JSON.stringify(items);
                            el.dataset.renderedContent = ''; // Force re-render grid
                            renderItems();
                            setTimeout(() => {
                                const newText = container.querySelectorAll('.item-text')[index + 1];
                                if (newText) newText.focus();
                            }, 0);
                            saveState();
                        } else if (e.key === 'Backspace' && text.innerText === '' && items.length > 1) {
                            e.preventDefault();
                            pushHistory();
                            items.splice(index, 1);
                            obj.content = JSON.stringify(items);
                            el.dataset.renderedContent = ''; // Force re-render grid
                            renderItems();
                            setTimeout(() => {
                                const prevText = container.querySelectorAll('.item-text')[Math.max(0, index - 1)];
                                if (prevText) prevText.focus();
                            }, 0);
                            saveState();
                        }
                    });

                    const remove = document.createElement('div');
                    remove.className = 'remove-item';
                    remove.innerHTML = '<i data-lucide="x"></i>';
                    remove.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (items.length > 1) {
                            pushHistory();
                            items.splice(index, 1);
                            obj.content = JSON.stringify(items);
                            el.dataset.renderedContent = ''; // Force re-render
                            renderItems();
                            saveState();
                        }
                    });
                    
                    itemEl.appendChild(check);
                    itemEl.appendChild(text);
                    itemEl.appendChild(remove);
                    container.appendChild(itemEl);
                });

                const addBtn = document.createElement('div');
                addBtn.className = 'add-item-btn';
                addBtn.innerHTML = '<i data-lucide="plus"></i> Yeni Madde';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    pushHistory();
                    items.push({ id: 'item-' + Date.now(), text: '', checked: false });
                    obj.content = JSON.stringify(items);
                    el.dataset.renderedContent = ''; // Force re-render
                    renderItems();
                    setTimeout(() => {
                        const lastText = container.querySelectorAll('.item-text')[items.length - 1];
                        if (lastText) lastText.focus();
                    }, 0);
                    saveState();
                });
                container.appendChild(addBtn);
                if (typeof lucide !== 'undefined') lucide.createIcons({ root: container });
            };

            renderItems();
            el.appendChild(container);
            el.dataset.renderedContent = obj.content;
            
            if (obj.newlyCreated && !isUpdate) {
                setTimeout(() => {
                    const firstText = container.querySelector('.item-text');
                    if (firstText) firstText.focus();
                }, 100);
            }
        }

        renderItems();
        el.appendChild(container);
        
        if (obj.newlyCreated) {
            setTimeout(() => {
                const firstText = container.querySelector('.item-text');
                if (firstText) firstText.focus();
            }, 100);
            delete obj.newlyCreated;
        }
    } else if (obj.type === 'video') {
        if (isUpdate && el.dataset.renderedContent === obj.content) {
            // Content hasn't changed, don't re-render iframe/video to avoid restart
        } else {
            const oldWrapper = el.querySelector('.video-wrapper');
            if (oldWrapper) oldWrapper.remove();

            const wrapper = document.createElement('div');
            wrapper.className = 'video-wrapper';
            
            const url = obj.content || '';
            const isEmbed = url.includes('youtube.com') || url.includes('youtu.be') || url.includes('vimeo.com');

            if (isEmbed) {
                const iframe = document.createElement('iframe');
                iframe.src = parseVideoUrl(url);
                iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
                iframe.allowFullscreen = true;
                iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-forms');
                wrapper.appendChild(iframe);
            } else {
                const video = document.createElement('video');
                video.src = url;
                video.controls = true;
                video.draggable = false;
                wrapper.appendChild(video);
            }
            
            el.appendChild(wrapper);
            el.dataset.renderedContent = obj.content;
        }
    } else if (obj.type === 'pdf') {
        if (isUpdate && el.dataset.renderedContent === obj.content && el.dataset.renderedPage === String(obj.pdfPage)) {
            // Already rendered
        } else {
            const oldViewer = el.querySelector('.pdf-viewer-container');
            if (oldViewer) oldViewer.remove();

            const container = document.createElement('div');
            container.className = 'pdf-viewer-container';
            
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-canvas';
            container.appendChild(canvas);
            
            const controls = document.createElement('div');
            controls.className = 'pdf-controls';
            
            const prevBtn = document.createElement('button');
            prevBtn.className = 'pdf-nav-btn';
            prevBtn.innerHTML = '<i data-lucide="chevron-left"></i>';
            
            const pageInfo = document.createElement('span');
            pageInfo.className = 'pdf-page-info';
            pageInfo.textContent = `Sayfa ${obj.pdfPage || 1}`;
            
            const nextBtn = document.createElement('button');
            nextBtn.className = 'pdf-nav-btn';
            nextBtn.innerHTML = '<i data-lucide="chevron-right"></i>';
            
            controls.appendChild(prevBtn);
            controls.appendChild(pageInfo);
            controls.appendChild(nextBtn);
            container.appendChild(controls);
            el.appendChild(container);
            
            renderPdfPage(obj, canvas, pageInfo);
            
            prevBtn.onclick = (e) => {
                e.stopPropagation();
                if (obj.pdfPage > 1) {
                    obj.pdfPage--;
                    renderPdfPage(obj, canvas, pageInfo);
                    saveState();
                }
            };
            
            nextBtn.onclick = (e) => {
                e.stopPropagation();
                obj.pdfPage = (obj.pdfPage || 1) + 1;
                renderPdfPage(obj, canvas, pageInfo);
                saveState();
            };
            
            el.dataset.renderedContent = obj.content;
            el.dataset.renderedPage = String(obj.pdfPage);
            if (typeof lucide !== 'undefined') lucide.createIcons({ root: container });
        }
    } else if (obj.type === 'embed') {
        if (isUpdate && el.dataset.renderedContent === obj.content) {
            // Already rendered
        } else {
            const oldEmbed = el.querySelector('.embed-container');
            if (oldEmbed) oldEmbed.remove();

            el.classList.add('embed-obj');
            const container = document.createElement('iframe');
            container.className = 'embed-container';
            container.src = parseEmbedUrl(obj.content);
            container.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
            container.loading = "lazy";
            el.appendChild(container);
            el.dataset.renderedContent = obj.content;
        }
    } else {
        if (!isUpdate) {
            const editor = document.createElement('div');
            editor.className = 'note-editor';
            editor.contentEditable = 'true';
            editor.spellcheck = false;
            editor.innerHTML = obj.content || 'Buraya yazın...';
            editor.style.fontFamily = obj.fontFamily || 'Inter';
            editor.style.fontSize = obj.fontSize || '16px';
            if (obj.textColor && obj.textColor !== 'default') editor.style.color = obj.textColor;
            
            const debouncedPush = debounce(() => {
                pushHistory();
                saveState();
            }, 800);

            editor.addEventListener('input', () => {
                obj.content = editor.innerHTML;
                debouncedPush();
            });

            editor.addEventListener('focus', () => selectObject(obj.id));
            editor.addEventListener('mousedown', e => e.stopPropagation());
            
            // Zoom'un bu eleman üzerindeyken de çalışması için wheel olayını engellemiyoruz
            // (Bubbling sayesinde window'daki capturing listener yakalayacak)
            
            el.appendChild(editor);
            
            if (obj.newlyCreated) {
                setTimeout(() => {
                    editor.focus();
                    document.execCommand('selectAll', false, null);
                }, 100);
                delete obj.newlyCreated;
            }
        } else {
            // In update mode, usually we don't want to overwrite the editor contents 
            // while user is typing. Only for undo/redo situations.
            const editor = el.querySelector('.note-editor');
            if (editor && editor.innerHTML !== obj.content) {
                // Determine if we should force update (e.g. user just hit Ctrl+Z)
                // If it's not the active element, or if content is significantly different
                if (document.activeElement !== editor) {
                    editor.innerHTML = obj.content || '';
                }
            }
            if (editor) {
                editor.style.fontFamily = obj.fontFamily || 'Inter';
                editor.style.fontSize = obj.fontSize || '16px';
                if (obj.textColor && obj.textColor !== 'default') editor.style.color = obj.textColor;
            }
        }
    }

    el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        
        if (state.currentTool === 'connect') {
            handleConnectionClick(obj.id);
            return;
        }

        selectObject(obj.id);
        
        const isHandle = e.target.classList.contains('obj-handle');
        const isResize = e.target.classList.contains('resize-handle');
        
        if (isHandle || isResize) {
            pushHistory();
        }
        
        if (isHandle) {
            state.isDragging = true;
            state.dragTarget = obj.id;
            state.dragStartX = e.clientX;
            state.dragStartY = e.clientY;
        } else if (isResize) {
            state.isDragging = true;
            state.dragTarget = obj.id;
            state.dragStartX = e.clientX;
            state.dragStartY = e.clientY;
            state.isResizing = true;
            state.resizeStartWidth = el.offsetWidth;
            state.resizeStartHeight = el.offsetHeight;
        }
    });

    if (obj.pinned) {
        el.style.position = 'fixed';
        el.style.left = `${obj.pinX}px`;
        el.style.top = `${obj.pinY}px`;
        el.style.transform = 'none'; // Overrides any camera transform that might be applied by mistake
        if (el.parentNode !== document.getElementById('pinned-layer')) {
            document.getElementById('pinned-layer').appendChild(el);
        }
    } else {
        if (el.parentNode !== canvasContent) {
            canvasContent.appendChild(el);
        }
    }

    if (typeof lucide !== 'undefined' && !isUpdate) lucide.createIcons({ root: el });
}

function selectObject(id) {
    state.selectedId = id;
    const floatingToolbar = document.getElementById('floating-toolbar');
    const dropdownSelected = document.querySelector('#font-dropdown .dropdown-selected');
    const sizeSelected = document.querySelector('#size-dropdown .dropdown-selected');
    
    document.querySelectorAll('.canvas-obj').forEach(o => {
        o.classList.toggle('selected', o.id === `obj-${id}`);
    });

    if (id) {
        const obj = state.objects.find(o => o.id === id);
        if (obj && obj.fontFamily) {
            const opt = document.querySelector(`.dropdown-opt[data-value="${obj.fontFamily}"]`);
            if (opt) dropdownSelected.textContent = opt.textContent;
        }
        if (obj && obj.fontSize) sizeSelected.textContent = obj.fontSize;

        floatingToolbar.querySelectorAll('.color-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-color') === (obj.color || 'default'));
        });

        floatingToolbar.querySelectorAll('.text-color-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-color') === (obj.textColor || 'default'));
        });

        const pinBtn = document.getElementById('toolbar-pin');
        if (pinBtn) {
            if (obj.pinned) pinBtn.classList.add('active');
            else pinBtn.classList.remove('active');
        }

        floatingToolbar.classList.add('active');
        floatingToolbar.classList.remove('multi-select'); // Single select mode
        document.getElementById('connection-toolbar').classList.remove('active');
    } else if (state.selectedIds.length > 1) {
        floatingToolbar.classList.add('active');
        floatingToolbar.classList.add('multi-select'); // Multi-select mode
        document.getElementById('connection-toolbar').classList.remove('active');
    } else {
        floatingToolbar.classList.remove('active');
    }
}

function renderObjects() {
    updateMiniMap();
    
    // 1. Identify valid IDs
    const validIds = new Set(state.objects.map(o => `obj-${o.id}`));
    
    // 2. Remove stale elements from both layers
    const layers = [canvasContent, document.getElementById('pinned-layer')];
    layers.forEach(layer => {
        if (!layer) return;
        Array.from(layer.children).forEach(child => {
            if (child.id === 'connection-layer' || child.id === 'selection-box') return;
            if (child.classList.contains('canvas-obj') && !validIds.has(child.id)) {
                child.remove();
            }
        });
    });

    // 3. Render or update each object
    state.objects.forEach(renderObject);
    
    // 4. Always ensure connection layer exists
    if (!document.getElementById('connection-layer')) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.id = "connection-layer";
        // Definitions for markers (arrows)
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.setAttribute("id", "arrowhead");
        marker.setAttribute("markerWidth", "10"); marker.setAttribute("markerHeight", "7");
        marker.setAttribute("refX", "9"); marker.setAttribute("refY", "3.5");
        marker.setAttribute("orient", "auto"); marker.setAttribute("markerUnits", "strokeWidth");
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute("points", "0 0, 10 3.5, 0 7");
        poly.setAttribute("fill", "var(--accent-color)");
        marker.appendChild(poly); defs.appendChild(marker);

        const markerStart = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        markerStart.setAttribute("id", "arrowstart");
        markerStart.setAttribute("markerWidth", "10"); markerStart.setAttribute("markerHeight", "7");
        markerStart.setAttribute("refX", "1"); markerStart.setAttribute("refY", "3.5");
        markerStart.setAttribute("orient", "auto"); markerStart.setAttribute("markerUnits", "strokeWidth");
        const polyStart = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        polyStart.setAttribute("points", "10 0, 0 3.5, 10 7");
        polyStart.setAttribute("fill", "var(--accent-color)");
        markerStart.appendChild(polyStart); defs.appendChild(markerStart);
        
        svg.appendChild(defs);
        canvasContent.appendChild(svg);
    }
    
    renderConnections();
}

function renderConnectionHandle(svg, connId, x, y, type) {
    let handle = document.getElementById(`conn-handle-${type}-${connId}`);
    if (!handle) {
        handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        handle.id = `conn-handle-${type}-${connId}`;
        handle.setAttribute("class", "connection-handle");
        handle.setAttribute("r", "8");
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            state.isDraggingConnEnd = true;
            state.dragConnId = connId;
            state.dragConnEndType = type;
            pushHistory();
        });
        svg.appendChild(handle);
    }
    handle.setAttribute("cx", x);
    handle.setAttribute("cy", y);
}

function renderConnections() {
    const svg = document.getElementById('connection-layer');
    if (!svg) return;
    
    // Maintain set of active connections
    const validIds = new Set(state.connections.map(c => c.id));
    
    // Remove stale paths selectively instead of .innerHTML clearing
    const existingElements = svg.querySelectorAll('.connection-path, .connection-hitbox, .connection-handle');
    existingElements.forEach(p => {
        let idStr = p.id;
        if (idStr) {
            let actualId = idStr.replace('conn-hitbox-', '').replace('conn-handle-from-', '').replace('conn-handle-to-', '').replace('conn-', '');
            if (!validIds.has(actualId)) p.remove();
        } else {
            p.remove();
        }
    });

    state.connections.forEach(conn => {
        const fromObj = conn.fromId ? state.objects.find(o => o.id === conn.fromId) : null;
        const toObj = conn.toId ? state.objects.find(o => o.id === conn.toId) : null;
        
        let startX, startY, endX, endY;

        // Skip layout reading (.offsetWidth), calculate directly from object state
        if (fromObj) {
            const fw = (fromObj.width === 'auto' ? 200 : fromObj.width);
            const fh = (fromObj.height === 'auto' ? (fromObj.type === 'note' ? 180 : 100) : fromObj.height);
            
            if (conn.fromOffX !== undefined && conn.fromOffY !== undefined) {
                startX = fromObj.x + conn.fromOffX;
                startY = fromObj.y + conn.fromOffY;
            } else {
                startX = fromObj.x + (fw / 2);
                startY = fromObj.y + (fh / 2);
            }
        } else if (conn.fromX !== null) {
            startX = conn.fromX;
            startY = conn.fromY;
        }

        if (toObj) {
            const tw = (toObj.width === 'auto' ? 200 : toObj.width);
            const th = (toObj.height === 'auto' ? (toObj.type === 'note' ? 180 : 100) : toObj.height);
            
            if (conn.toOffX !== undefined && conn.toOffY !== undefined) {
                endX = toObj.x + conn.toOffX;
                endY = toObj.y + conn.toOffY;
            } else {
                endX = toObj.x + (tw / 2);
                endY = toObj.y + (th / 2);
            }
        } else if (conn.toX !== null) {
            endX = conn.toX;
            endY = conn.toY;
        }

        if (startX !== undefined && endX !== undefined) {
            const cpX1 = startX + (endX - startX) * 0.5;
            const cpY1 = startY;
            const cpX2 = startX + (endX - startX) * 0.5;
            const cpY2 = endY;
            const d = `M ${startX} ${startY} C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${endX} ${endY}`;

            let hitbox = document.getElementById(`conn-hitbox-${conn.id}`);
            if (!hitbox) {
                hitbox = document.createElementNS("http://www.w3.org/2000/svg", "path");
                hitbox.id = `conn-hitbox-${conn.id}`;
                hitbox.setAttribute("class", "connection-hitbox");
                hitbox.style.stroke = "transparent";
                hitbox.style.strokeWidth = "25";
                hitbox.style.fill = "none";
                hitbox.style.cursor = "pointer";
                hitbox.style.pointerEvents = "visibleStroke";
                hitbox.addEventListener('mousedown', (e) => e.stopPropagation());
                hitbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectConnection(conn.id);
                });
                svg.appendChild(hitbox);
            }
            hitbox.setAttribute("d", d);
            
            let p = document.getElementById(`conn-${conn.id}`);
            if (!p) {
                p = document.createElementNS("http://www.w3.org/2000/svg", "path");
                p.id = `conn-${conn.id}`;
                p.addEventListener('mousedown', (e) => e.stopPropagation());
                p.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectConnection(conn.id);
                });
                svg.appendChild(p);
            }
            
            let classes = "connection-path";
            if (conn.style === 'dashed') classes += " dashed";
            if (state.selectedConnId === conn.id || state.selectedConnIds.includes(conn.id)) classes += " selected";
            
            p.setAttribute("class", classes);
            p.setAttribute("d", d);
            
            if (conn.flow === 'forward' || conn.flow === 'both') p.setAttribute("marker-end", "url(#arrowhead)");
            else p.removeAttribute("marker-end");
            
            if (conn.flow === 'both') p.setAttribute("marker-start", "url(#arrowstart)");
            else p.removeAttribute("marker-start");

            // Add Handles if selected
            if (state.selectedConnId === conn.id) {
                renderConnectionHandle(svg, conn.id, startX, startY, 'from');
                renderConnectionHandle(svg, conn.id, endX, endY, 'to');
            } else {
                const hFrom = document.getElementById(`conn-handle-from-${conn.id}`);
                if (hFrom) hFrom.remove();
                const hTo = document.getElementById(`conn-handle-to-${conn.id}`);
                if (hTo) hTo.remove();
            }
        }
    });
}

function getCanvasCenter() {
    return {
        x: state.camX,
        y: state.camY
    };
}

function setupSettingsListeners() {
    const panel = document.getElementById('settings-panel');
    const openBtn = document.getElementById('open-settings');
    const closeBtn = document.getElementById('close-settings');
    const smoothInput = document.getElementById('zoom-smoothness');
    const sensInput = document.getElementById('zoom-sensitivity');
    const gridColorInput = document.getElementById('grid-color-picker');

    if (openBtn) {
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('active');
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.remove('active');
        });
    }

    panel.addEventListener('mousedown', e => e.stopPropagation());
    panel.addEventListener('click', e => e.stopPropagation());

    if (smoothInput) {
        smoothInput.addEventListener('input', () => {
            const val = parseInt(smoothInput.value);
            state.settings.smoothness = val / 100;
            smoothInput.nextElementSibling.innerText = `${val}%`;
        });
    }

    if (sensInput) {
        sensInput.addEventListener('input', () => {
            const val = parseInt(sensInput.value);
            state.settings.sensitivity = val / 100;
            sensInput.nextElementSibling.innerText = `${(val/10).toFixed(1)}x`;
        });
    }

    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
        if (state.settings.theme) {
            themeSelect.value = state.settings.theme;
            applyTheme(state.settings.theme);
        }
        
        themeSelect.addEventListener('change', (e) => {
            const newTheme = e.target.value;
            state.settings.theme = newTheme;
            applyTheme(newTheme);
            updateCanvas(); // Force redraw for base size change
            saveState();
        });
    }

    const bgOpacityInput = document.getElementById('bg-opacity');
    const bgSizeInput = document.getElementById('bg-size');

    if (bgOpacityInput) {
        if (state.settings.bgOpacity !== undefined) {
            bgOpacityInput.value = state.settings.bgOpacity;
            bgOpacityInput.nextElementSibling.innerText = `${state.settings.bgOpacity}%`;
            canvasGrid.style.setProperty('--bg-opacity', state.settings.bgOpacity / 100);
        } else {
            canvasGrid.style.setProperty('--bg-opacity', 1);
        }
        bgOpacityInput.addEventListener('input', () => {
            const val = parseInt(bgOpacityInput.value);
            state.settings.bgOpacity = val;
            bgOpacityInput.nextElementSibling.innerText = `${val}%`;
            canvasGrid.style.setProperty('--bg-opacity', val / 100);
            saveState();
        });
    }

    if (bgSizeInput) {
        if (state.settings.bgDensity !== undefined) {
            bgSizeInput.value = Math.round(state.settings.bgDensity * 100);
            bgSizeInput.nextElementSibling.innerText = `${Math.round(state.settings.bgDensity * 100)}%`;
        }
        bgSizeInput.addEventListener('input', () => {
            const val = parseInt(bgSizeInput.value);
            state.settings.bgDensity = val / 100;
            bgSizeInput.nextElementSibling.innerText = `${val}%`;
            updateCanvas(); // Force instant redraw to see density changes
            saveState();
        });
    }
}

// --- Focus Widget & Pomodoro ---
function makeDraggable(panel, handle) {
    let isDragging = false, startX, startY, initialX, initialY;
    handle.addEventListener('mousedown', e => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.left = `${initialX}px`;
        panel.style.top = `${initialY}px`;
        panel.style.transform = 'none';
        
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        let newX = initialX + dx;
        let newY = initialY + dy;
        
        // Boundaries
        const topLimit = 40; // Title bar height + padding
        newY = Math.max(topLimit, newY);
        
        // Optional: Keep inside window
        newX = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, newX));
        newY = Math.min(window.innerHeight - panel.offsetHeight, newY);

        panel.style.left = `${newX}px`;
        panel.style.top = `${newY}px`;
    });

    document.addEventListener('mouseup', () => { isDragging = false; });
}

let focusTimer = null;
let focusTimeLeft = 25 * 60; // 25:00
let isFocusTimerRunning = false;
let isBreakMode = false;

function updateFocusTimerDisplay() {
    const timeSpan = document.getElementById('time-left');
    if (!timeSpan) return;
    const m = Math.floor(focusTimeLeft / 60).toString().padStart(2, '0');
    const s = (focusTimeLeft % 60).toString().padStart(2, '0');
    timeSpan.innerText = `${m}:${s}`;
}

function getContrastColor(hexcolor) {
    if (!hexcolor) return '#ffffff';
    // If it's rgba or similar from CSS vars, we'll try to extract hex or just return white
    if (!hexcolor.startsWith('#')) return '#ffffff';
    
    const r = parseInt(hexcolor.slice(1, 3), 16);
    const g = parseInt(hexcolor.slice(3, 5), 16);
    const b = parseInt(hexcolor.slice(5, 7), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
}

function initFocusWidget() {
    const toolFocus = document.getElementById('tool-focus');
    const focusWidget = document.getElementById('focus-widget');
    const closeFocus = document.getElementById('close-focus');
    const dragHandle = document.getElementById('focus-drag-handle');
    
    if (toolFocus && focusWidget) {
        toolFocus.addEventListener('click', () => {
            focusWidget.classList.toggle('hidden');
        });
        closeFocus.addEventListener('click', () => {
            focusWidget.classList.add('hidden');
        });
        makeDraggable(focusWidget, dragHandle);
    }

    const startBtn = document.getElementById('timer-start');
    const pauseBtn = document.getElementById('timer-pause');
    const resetBtn = document.getElementById('timer-reset');
    const minutesInput = document.getElementById('focus-minutes');

    if (minutesInput) {
        // Initialize based on input
        focusTimeLeft = parseInt(minutesInput.value || 25) * 60;
        updateFocusTimerDisplay();

        const updateTimerOnInputChange = (input, isBreak) => {
            if (isFocusTimerRunning) {
                clearInterval(focusTimer);
                isFocusTimerRunning = false;
                startBtn.classList.remove('active');
                startBtn.innerHTML = '<i data-lucide="play"></i>';
                if (typeof lucide !== 'undefined') lucide.createIcons({ root: startBtn });
            }
            if (isBreakMode === isBreak) {
                focusTimeLeft = parseInt(input.value || (isBreak ? 5 : 25)) * 60;
                updateFocusTimerDisplay();
            }
        };

        minutesInput.addEventListener('change', () => updateTimerOnInputChange(minutesInput, false));
        
        const breakInput = document.getElementById('break-minutes');
        if (breakInput) {
            breakInput.addEventListener('change', () => updateTimerOnInputChange(breakInput, true));
        }
    }

    const playNotification = () => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.connect(g);
            g.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            g.gain.setValueAtTime(0, ctx.currentTime);
            g.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.1);
            g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 1);
        } catch(e) { console.error(e); }
    };

    const switchFocusMode = () => {
        isBreakMode = !isBreakMode;
        const statusLabel = document.getElementById('focus-status');
        const widget = document.getElementById('focus-widget');
        const breakInput = document.getElementById('break-minutes');
        const workInput = document.getElementById('focus-minutes');

        if (isBreakMode) {
            statusLabel.innerText = 'MOLA';
            widget.classList.add('break-mode');
            focusTimeLeft = parseInt(breakInput ? breakInput.value : 5) * 60;
        } else {
            statusLabel.innerText = 'ODAK';
            widget.classList.remove('break-mode');
            focusTimeLeft = parseInt(workInput ? workInput.value : 25) * 60;
        }
        
        updateFocusTimerDisplay();
        playNotification();
    };

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (isFocusTimerRunning) {
                // STOP LOGIC
                clearInterval(focusTimer);
                isFocusTimerRunning = false;
                startBtn.classList.remove('active');
                startBtn.innerHTML = '<i data-lucide="play"></i>';
                if (typeof lucide !== 'undefined') lucide.createIcons({ root: startBtn });
                return;
            }
            
            // START LOGIC
            if (focusTimeLeft <= 0) {
                const input = isBreakMode ? document.getElementById('break-minutes') : document.getElementById('focus-minutes');
                focusTimeLeft = parseInt(input ? input.value : 25) * 60;
            }

            isFocusTimerRunning = true;
            startBtn.classList.add('active'); 
            startBtn.innerHTML = '<i data-lucide="pause"></i>';
            if (typeof lucide !== 'undefined') lucide.createIcons({ root: startBtn });
            
            focusTimer = setInterval(() => {
                if (focusTimeLeft > 0) {
                    focusTimeLeft--;
                    updateFocusTimerDisplay();
                    if (focusTimeLeft === 0) {
                        switchFocusMode();
                    }
                }
            }, 1000);
        });
        
        resetBtn.addEventListener('click', () => {
            clearInterval(focusTimer);
            isFocusTimerRunning = false;
            isBreakMode = false;
            
            const statusLabel = document.getElementById('focus-status');
            const widget = document.getElementById('focus-widget');
            if (statusLabel) statusLabel.innerText = 'ODAK';
            if (widget) widget.classList.remove('break-mode');

            startBtn.classList.remove('active');
            startBtn.innerHTML = '<i data-lucide="play"></i>';
            if (typeof lucide !== 'undefined') lucide.createIcons({ root: startBtn });
            
            focusTimeLeft = parseInt(minutesInput ? minutesInput.value : 25) * 60;
            updateFocusTimerDisplay();
        });
    }

    // Ambient Audio Logic
    const ambientBtns = document.querySelectorAll('.ambient-btn');
    const volSlider = document.getElementById('ambient-volume');
    const activeAudios = {}; 

    // YouTube Helper
    const getYouTubeId = (url) => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    };

    // Customization Logic Variables
    const toggleSettingsBtn = document.getElementById('toggle-ambient-settings');
    const settingsPanel = document.getElementById('ambient-settings-panel');
    const saveBtn = document.getElementById('save-ambient-settings');
    const rainInput = document.getElementById('input-rain-url');
    const coffeeInput = document.getElementById('input-coffee-url');
    const lofiInput = document.getElementById('input-lofi-url');
    const timerColorInput = document.getElementById('input-timer-color');
    const accentColorInput = document.getElementById('input-accent-color');
    const fontSelect = document.getElementById('select-timer-font');
    const blurInput = document.getElementById('input-bg-blur');
    const glowInput = document.getElementById('input-text-glow');
    const volRainInput = document.getElementById('volume-rain');
    const volCoffeeInput = document.getElementById('volume-coffee');
    const volLofiInput = document.getElementById('volume-lofi');

    // Apply Theme Styles
    const applyFocusTheme = (settings) => {
        const root = document.documentElement;
        if (settings.timerColor) root.style.setProperty('--focus-timer-color', settings.timerColor);
        if (settings.accentColor) {
            root.style.setProperty('--focus-accent-color', settings.accentColor);
            root.style.setProperty('--focus-accent-contrast', getContrastColor(settings.accentColor));
        }
        if (settings.bgColor) {
            // Apply hex color with transparency (b3 = 70%)
            root.style.setProperty('--focus-bg', settings.bgColor + 'b3');
        }
        if (settings.blur !== undefined) root.style.setProperty('--focus-blur', `${settings.blur}px`);
        if (settings.textGlow !== undefined) root.style.setProperty('--focus-text-glow', `${settings.textGlow}px`);
        
        // Font - Apply to the whole widget
        const widget = document.getElementById('focus-widget');
        if (widget && settings.font) {
            widget.classList.remove('font-modern', 'font-classic', 'font-mono', 'font-retro', 'font-elegant', 'font-digital', 'font-handwriting', 'font-fira');
            widget.classList.add(`font-${settings.font}`);
        }
    };

    // Load from localStorage
    const loadAmbientSettings = () => {
        const saved = JSON.parse(localStorage.getItem('lumina-ambient-urls') || '{}');
        // Audio URLs
        if (saved.rain) {
            document.getElementById('audio-rain').setAttribute('data-src', saved.rain);
            if (rainInput) rainInput.value = saved.rain;
        }
        if (saved.coffee) {
            document.getElementById('audio-coffee').setAttribute('data-src', saved.coffee);
            if (coffeeInput) coffeeInput.value = saved.coffee;
        }
        if (saved.lofi) {
            document.getElementById('audio-lofi').setAttribute('data-src', saved.lofi);
            if (lofiInput) lofiInput.value = saved.lofi;
        }
        // Channel Volumes
        if (saved.volRain !== undefined && volRainInput) volRainInput.value = saved.volRain;
        if (saved.volCoffee !== undefined && volCoffeeInput) volCoffeeInput.value = saved.volCoffee;
        if (saved.volLofi !== undefined && volLofiInput) volLofiInput.value = saved.volLofi;
        // Theme
        if (saved.timerColor && timerColorInput) timerColorInput.value = saved.timerColor;
        if (saved.accentColor && accentColorInput) accentColorInput.value = saved.accentColor;
        if (saved.bgColor && document.getElementById('input-bg-color')) {
            document.getElementById('input-bg-color').value = saved.bgColor;
        }
        if (saved.breakMinutes && document.getElementById('break-minutes')) {
            document.getElementById('break-minutes').value = saved.breakMinutes;
        }
        if (saved.font && fontSelect) fontSelect.value = saved.font;
        if (saved.blur && blurInput) blurInput.value = saved.blur;
        if (saved.textGlow && glowInput) glowInput.value = saved.textGlow;
        
        applyFocusTheme(saved);
    };

    const getCurrentThemeSettings = () => ({
        timerColor: timerColorInput?.value,
        accentColor: accentColorInput?.value,
        bgColor: document.getElementById('input-bg-color')?.value,
        font: fontSelect?.value,
        blur: blurInput?.value,
        textGlow: glowInput?.value
    });

    [timerColorInput, accentColorInput, document.getElementById('input-bg-color'), fontSelect, blurInput, glowInput].forEach(el => {
        if (el) {
            el.addEventListener('input', () => {
                applyFocusTheme(getCurrentThemeSettings());
            });
        }
    });

    if (toggleSettingsBtn && settingsPanel) {
        toggleSettingsBtn.addEventListener('click', () => {
            settingsPanel.classList.toggle('hidden');
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const urls = {
                rain: rainInput.value.trim(),
                coffee: coffeeInput.value.trim(),
                lofi: lofiInput.value.trim(),
                timerColor: timerColorInput.value,
                accentColor: accentColorInput.value,
                bgColor: document.getElementById('input-bg-color').value,
                breakMinutes: document.getElementById('break-minutes').value,
                font: fontSelect.value,
                blur: blurInput.value,
                textGlow: glowInput.value,
                volRain: volRainInput?.value || 50,
                volCoffee: volCoffeeInput?.value || 50,
                volLofi: volLofiInput?.value || 50
            };
            
            localStorage.setItem('lumina-ambient-urls', JSON.stringify(urls));
            applyFocusTheme(urls);
            
            // Update button attributes and restart if playing
            const mapping = { 'audio-rain': urls.rain, 'audio-coffee': urls.coffee, 'audio-lofi': urls.lofi };
            Object.entries(mapping).forEach(([id, url]) => {
                if (url) {
                    const btn = document.getElementById(id);
                    btn.setAttribute('data-src', url);
                    
                    // If playing, restart with new source
                    if (activeAudios[id]) {
                        // Stop current (Audio or Iframe)
                        if (activeAudios[id] instanceof Audio) {
                            activeAudios[id].pause();
                        } else if (activeAudios[id].tagName === 'IFRAME') {
                            activeAudios[id].remove();
                        }
                        delete activeAudios[id];

                        // Start new
                        const ytId = getYouTubeId(url);
                        const channelVol = id === 'audio-rain' ? volRainInput.value : (id === 'audio-coffee' ? volCoffeeInput.value : volLofiInput.value);
                        
                        if (ytId) {
                            const container = document.getElementById('ambient-yt-container');
                            const iframe = document.createElement('iframe');
                            // enablejsapi=1 for volume control
                            iframe.src = `https://www.youtube.com/embed/${ytId}?autoplay=1&loop=1&playlist=${ytId}&enablejsapi=1`;
                            iframe.allow = "autoplay";
                            iframe.id = `iframe-${id}`;
                            if (container) container.appendChild(iframe);
                            activeAudios[id] = iframe;
                            // Set initial volume for YT (needs a slight delay for iframe load)
                            setTimeout(() => {
                                iframe.contentWindow.postMessage(JSON.stringify({event: 'command', func: 'setVolume', args: [channelVol]}), '*');
                            }, 2000);
                        } else {
                            const newAudio = new Audio(url);
                            newAudio.loop = true;
                            newAudio.volume = channelVol / 100;
                            newAudio.play().catch(e => console.error(e));
                            activeAudios[id] = newAudio;
                        }
                    }
                }
            });
            
            settingsPanel.classList.add('hidden');
        });
    }

    loadAmbientSettings();

    ambientBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const src = btn.getAttribute('data-src');
            const id = btn.id;
            
            if (btn.classList.contains('active')) {
                if (activeAudios[id]) {
                    if (activeAudios[id] instanceof Audio) {
                        activeAudios[id].pause();
                    } else {
                        activeAudios[id].remove();
                    }
                    delete activeAudios[id];
                }
                btn.classList.remove('active');
            } else {
                const ytId = getYouTubeId(src);
                const channelVolInput = id === 'audio-rain' ? volRainInput : (id === 'audio-coffee' ? volCoffeeInput : volLofiInput);
                const channelVol = channelVolInput ? channelVolInput.value : 50;

                if (ytId) {
                    const container = document.getElementById('ambient-yt-container');
                    const iframe = document.createElement('iframe');
                    iframe.src = `https://www.youtube.com/embed/${ytId}?autoplay=1&loop=1&playlist=${ytId}&enablejsapi=1`;
                    iframe.allow = "autoplay";
                    iframe.id = `iframe-${id}`;
                    if (container) container.appendChild(iframe);
                    activeAudios[id] = iframe;
                    btn.classList.add('active');
                    setTimeout(() => {
                        iframe.contentWindow.postMessage(JSON.stringify({event: 'command', func: 'setVolume', args: [channelVol]}), '*');
                    }, 2000);
                } else {
                    const audio = new Audio(src);
                    audio.loop = true;
                    audio.volume = channelVol / 100;
                    audio.play().catch(e => console.error("Auto-play engellendi:", e));
                    activeAudios[id] = audio;
                    btn.classList.add('active');
                }
            }
        });
    });

    const setupMixerListeners = () => {
        const mixerSliders = [
            { id: 'audio-rain', slider: volRainInput },
            { id: 'audio-coffee', slider: volCoffeeInput },
            { id: 'audio-lofi', slider: volLofiInput }
        ];

        mixerSliders.forEach(({ id, slider }) => {
            if (slider) {
                slider.addEventListener('input', () => {
                    const vol = slider.value;
                    const audio = activeAudios[id];
                    if (audio) {
                        if (audio instanceof Audio) {
                            audio.volume = vol / 100;
                        } else if (audio.tagName === 'IFRAME') {
                            audio.contentWindow.postMessage(JSON.stringify({event: 'command', func: 'setVolume', args: [vol]}), '*');
                        }
                    }
                });
            }
        });
    };
    setupMixerListeners();

    if (volSlider) {
        volSlider.addEventListener('input', () => {
            const vol = volSlider.value / 100;
            Object.values(activeAudios).forEach(audio => {
                audio.volume = vol;
            });
        });
    }
}

function applyTheme(themeName) {
    document.body.classList.forEach(className => {
        if (className.startsWith('theme-')) {
            document.body.classList.remove(className);
        }
    });

    if (themeName && themeName !== 'dark-grid') {
        document.body.classList.add(`theme-${themeName}`);
    }
}

// --- Extra Features (Export & Icons) ---
function setupExtraListeners() {
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.addEventListener('click', () => exportCanvas());

    const iconPickerBtn = document.getElementById('btn-icon-picker');
    const pickerPopup = document.getElementById('icon-picker-popup');
    const closePicker = document.getElementById('close-picker');

    if (iconPickerBtn && pickerPopup) {
        iconPickerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const rect = iconPickerBtn.getBoundingClientRect();
            pickerPopup.style.left = `${rect.left}px`;
            pickerPopup.style.top = `${rect.top - 380}px`; // Pencerenin üstünde aç
            pickerPopup.classList.toggle('hidden');
        });
    }

    if (closePicker) closePicker.addEventListener('click', () => pickerPopup.classList.add('hidden'));

    // Media URL Modal Listeners (Combined Video & Embed)
    const mediaModal = document.getElementById('media-url-modal');
    const closeMediaModal = document.getElementById('close-media-modal');
    const btnAddMediaUrl = document.getElementById('btn-add-media-url');
    const mediaUrlInput = document.getElementById('media-url-input');
    const btnTriggerMediaUpload = document.getElementById('btn-trigger-media-upload');

    if (closeMediaModal) {
        closeMediaModal.addEventListener('click', () => mediaModal.classList.add('hidden'));
    }

    if (btnAddMediaUrl) {
        btnAddMediaUrl.addEventListener('click', () => {
            const url = mediaUrlInput.value.trim();
            if (url) {
                const center = getCanvasCenter();
                
                // Smart detection: if it's Spotify or Maps, use 'embed', otherwise 'video'
                const isEmbedOnly = url.includes('spotify.com') || url.includes('google.com/maps') || url.includes('goo.gl/maps');
                const type = isEmbedOnly ? 'embed' : 'video';
                
                addObject(type, center.x, center.y, url);
                mediaUrlInput.value = '';
                mediaModal.classList.add('hidden');
                document.getElementById('tool-pan').click();
            }
        });
        
        mediaUrlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') btnAddMediaUrl.click();
        });
    }

    if (btnTriggerMediaUpload) {
        btnTriggerMediaUpload.addEventListener('click', () => {
            mediaModal.classList.add('hidden');
            videoUpload.click();
        });
    }

    // Pinning Listener
    const pinBtn = document.getElementById('toolbar-pin');
    if (pinBtn) {
        pinBtn.addEventListener('click', () => {
            if (state.selectedId) {
                togglePin(state.selectedId);
            }
        });
    }

    // Sayfa geneli tıklama ile kapatma
    document.addEventListener('click', (e) => {
        if (pickerPopup && !pickerPopup.classList.contains('hidden')) {
            if (!pickerPopup.contains(e.target) && e.target !== iconPickerBtn) {
                pickerPopup.classList.add('hidden');
            }
        }
        if (mediaModal && !mediaModal.classList.contains('hidden')) {
            if (!mediaModal.contains(e.target) && !e.target.closest('#tool-video') && !e.target.closest('#tool-embed')) {
                mediaModal.classList.add('hidden');
            }
        }
    });

    // Tool menu listeners for new tools
    const toolEmbed = document.getElementById('tool-embed');
    if (toolEmbed) toolEmbed.addEventListener('click', () => {
        mediaModal.classList.remove('hidden');
        mediaUrlInput.focus();
    });
}

function parseEmbedUrl(url) {
    // Spotify
    if (url.includes('spotify.com/')) {
        let embedUrl = url;
        if (url.includes('open.spotify.com/')) {
            embedUrl = url.replace('open.spotify.com/', 'open.spotify.com/embed/');
        }
        return embedUrl;
    }
    
    // Google Maps
    if (url.includes('google.com/maps') || url.includes('goo.gl/maps')) {
        // Basic conversion for maps - if it's not already an embed URL
        if (!url.includes('output=embed')) {
            const encodedUrl = encodeURIComponent(url);
            return `https://maps.google.com/maps?q=${encodedUrl}&output=embed`;
        }
        return url;
    }

    // Video conversion fallback
    return parseVideoUrl(url);
}

function togglePin(objId) {
    const obj = state.objects.find(o => o.id === objId);
    if (!obj) return;

    pushHistory();
    const el = document.getElementById(`obj-${objId}`);
    const pinnedLayer = document.getElementById('pinned-layer');
    const canvasContent = document.getElementById('canvas-content');

    if (!obj.pinned) {
        // PINNING
        // Get current screen position
        const rect = el.getBoundingClientRect();
        obj.pinned = true;
        obj.pinX = rect.left;
        obj.pinY = rect.top;

        // Move to pinned layer
        pinnedLayer.appendChild(el);
        el.style.left = `${obj.pinX}px`;
        el.style.top = `${obj.pinY}px`;
        
        document.getElementById('toolbar-pin').classList.add('active');
    } else {
        // UNPINNING
        // Calculate world coordinates from screen position
        const rect = canvasContainer.getBoundingClientRect();
        const halfW = rect.width / 2;
        const halfH = rect.height / 2;
        
        // Inverse camera transform: (screenX - halfW) / camZ + camX
        obj.x = (obj.pinX - halfW) / state.camZ + state.camX;
        obj.y = (obj.pinY - halfH) / state.camZ + state.camY;
        obj.pinned = false;

        // Move back to canvas content
        canvasContent.appendChild(el);
        el.style.left = `${obj.x}px`;
        el.style.top = `${obj.y}px`;
        
        document.getElementById('toolbar-pin').classList.remove('active');
    }
    saveState();
    renderObjects();
}

function parseVideoUrl(url) {
    // YouTube
    let videoId = '';
    if (url.includes('youtube.com/watch?v=')) {
        videoId = url.split('v=')[1].split('&')[0];
        return `https://www.youtube-nocookie.com/embed/${videoId}`;
    } else if (url.includes('youtu.be/')) {
        videoId = url.split('youtu.be/')[1].split('?')[0];
        return `https://www.youtube-nocookie.com/embed/${videoId}`;
    }
    
    // Vimeo
    if (url.includes('vimeo.com/')) {
        videoId = url.split('vimeo.com/')[1].split('?')[0];
        return `https://player.vimeo.com/video/${videoId}`;
    }
    
    return url; // Direct link
}

async function renderPdfPage(obj, canvas, pageInfoEl) {
    if (!obj.content) return;
    
    try {
        const pdfData = obj.content;
        const loadingTask = pdfjsLib.getDocument(pdfData);
        const pdf = await loadingTask.promise;
        
        const totalPages = pdf.numPages;
        if (obj.pdfPage > totalPages) obj.pdfPage = totalPages;
        if (obj.pdfPage < 1) obj.pdfPage = 1;
        
        pageInfoEl.textContent = `Sayfa ${obj.pdfPage} / ${totalPages}`;
        
        const page = await pdf.getPage(obj.pdfPage);
        const viewport = page.getViewport({ scale: 1.5 });
        
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        await page.render(renderContext).promise;
    } catch (error) {
        console.error('PDF render error:', error);
    }
}

async function exportCanvas() {
    if (state.isExporting) return;
    if (state.objects.length === 0) {
        alert("Dışa aktarılacak bir nesne bulunamadı.");
        return;
    }

    state.isExporting = true;
    const exportBtn = document.getElementById('export-btn');
    const originalHTML = exportBtn.innerHTML;
    exportBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons({ root: exportBtn });

    // 1. Alan hesapla (Bounding Box)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    const updateBounds = (x, y, w = 0, h = 0) => {
        if (x === null || x === undefined || isNaN(x)) return;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    };

    state.objects.forEach(obj => {
        const el = document.getElementById(`obj-${obj.id}`);
        const w = (obj.width === 'auto' ? (el ? el.offsetWidth : 200) : obj.width);
        const h = (obj.height === 'auto' ? (el ? el.offsetHeight : (obj.type === 'note' ? 180 : 100)) : obj.height);
        updateBounds(obj.x, obj.y, w, h);
    });

    state.connections.forEach(conn => {
        const fromObj = conn.fromId ? state.objects.find(o => o.id === conn.fromId) : null;
        const toObj = conn.toId ? state.objects.find(o => o.id === conn.toId) : null;
        const getPt = (obj, ox, oy, px, py) => {
            if (obj) {
                const w = (obj.width === 'auto' ? 200 : obj.width);
                const h = (obj.height === 'auto' ? (obj.type === 'note' ? 180 : 100) : obj.height);
                return { x: obj.x + (ox !== undefined ? ox : w/2), y: obj.y + (oy !== undefined ? oy : h/2) };
            }
            return { x: px, y: py };
        };
        const p1 = getPt(fromObj, conn.fromOffX, conn.fromOffY, conn.fromX, conn.fromY);
        const p2 = getPt(toObj, conn.toOffX, conn.toOffY, conn.toX, conn.toY);

        // GEÇERSİZ BAĞLANTI KONTROLÜ: Boyut hesaplarken yarım kalmış bağları atla
        if (!p1 || !p2 || p1.x === null || p1.y === null || p2.x === null || p2.y === null) return;
        if (isNaN(p1.x) || isNaN(p1.y) || isNaN(p2.x) || isNaN(p2.y)) return;

        updateBounds(p1.x, p1.y);
        updateBounds(p2.x, p2.y);
    });

    const padding = 100;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;

    // 2. Geçici Export Elementi Oluştur (Off-screen)
    const tempExport = document.createElement('div');
    tempExport.id = 'temp-export-container';
    // Mevcut döküman stillerini ve değişkenlerini miras alması için body'nin bir kopyası gibi davranmalı
    tempExport.style.cssText = `
        position: absolute; left: -9999px; top: -9999px;
        width: ${width}px; height: ${height}px;
        background: #0f172a;
        overflow: hidden;
        z-index: -1000;
    `;
    
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#60a5fa';
    
    // Arka plan ızgarası (Grid) ekle
    tempExport.style.setProperty('--accent-color', accentColor);
    tempExport.style.backgroundImage = `
        radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.05) 1px, transparent 0)
    `;
    tempExport.style.backgroundSize = '40px 40px';
    
    document.body.appendChild(tempExport);

    // 3. İçerikleri Klonla ve Yeniden Konumlandır
    state.objects.forEach(obj => {
        const originalEl = document.getElementById(`obj-${obj.id}`);
        if (!originalEl) return;
        const clone = originalEl.cloneNode(true);
        // Yeni (0,0) noktası minX, minY olacak şekilde ötele
        clone.style.left = (obj.x - minX + padding) + 'px';
        clone.style.top = (obj.y - minY + padding) + 'px';
        clone.style.transform = 'none';
        clone.classList.remove('selected', 'active'); // Temiz kopya
        tempExport.appendChild(clone);
    });

    // 4. Bağlantıları Klonla (SVG Layer)
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.style.cssText = `position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none;`;
    tempExport.appendChild(svg);

    state.connections.forEach(conn => {
        const fromObj = conn.fromId ? state.objects.find(o => o.id === conn.fromId) : null;
        const toObj = conn.toId ? state.objects.find(o => o.id === conn.toId) : null;
        const getPt = (obj, ox, oy, px, py) => {
            if (obj) {
                const w = (obj.width === 'auto' ? 200 : obj.width);
                const h = (obj.height === 'auto' ? (obj.type === 'note' ? 180 : 100) : obj.height);
                return { x: obj.x + (ox !== undefined ? ox : w/2), y: obj.y + (oy !== undefined ? oy : h/2) };
            }
            return { x: px, y: py };
        };
        const p1 = getPt(fromObj, conn.fromOffX, conn.fromOffY, conn.fromX, conn.fromY);
        const p2 = getPt(toObj, conn.toOffX, conn.toOffY, conn.toX, conn.toY);

        // GEÇERSİZ BAĞLANTI KONTROLÜ: Eğer bir uç boşsa veya geçersizse bu oku atla
        if (!p1 || !p2 || p1.x === null || p1.y === null || p2.x === null || p2.y === null) return;
        if (isNaN(p1.x) || isNaN(p1.y) || isNaN(p2.x) || isNaN(p2.y)) return;

        // Yeni koordinatlar (Kırpılmış alana göre)
        const sx = p1.x - minX + padding, sy = p1.y - minY + padding;
        const ex = p2.x - minX + padding, ey = p2.y - minY + padding;

        const cpX1 = sx + (ex - sx) * 0.5, cpY1 = sy;
        const cpX2 = sx + (ex - sx) * 0.5, cpY2 = ey;
        const d = `M ${sx} ${sy} C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${ex} ${ey}`;

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", accentColor);
        path.setAttribute("stroke-width", "3");
        if (conn.style === 'dashed') path.setAttribute("stroke-dasharray", "8,8");
        svg.appendChild(path);

        // BAKE MARKERS: Ok uçlarını manuel çiz (html2canvas desteği için)
        const rotateP = (px, py, angle) => ({
            x: px * Math.cos(angle) - py * Math.sin(angle),
            y: px * Math.sin(angle) + py * Math.cos(angle)
        });

        if (conn.flow === 'forward' || conn.flow === 'both') {
            const angle = Math.atan2(ey - cpY2, ex - cpX2);
            const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            const tp1 = rotateP(0, -6, angle), tp2 = rotateP(14, 0, angle), tp3 = rotateP(0, 6, angle);
            poly.setAttribute("points", `${ex+tp1.x},${ey+tp1.y} ${ex+tp2.x},${ey+tp2.y} ${ex+tp3.x},${ey+tp3.y}`);
            poly.setAttribute("fill", accentColor);
            svg.appendChild(poly);
        }
        if (conn.flow === 'both') {
            const angle = Math.atan2(sy - cpY1, sx - cpX1);
            const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            const tp1 = rotateP(0, -6, angle), tp2 = rotateP(-14, 0, angle), tp3 = rotateP(0, 6, angle);
            poly.setAttribute("points", `${sx+tp1.x},${sy+tp1.y} ${sx+tp2.x},${sy+tp2.y} ${sx+tp3.x},${sy+tp3.y}`);
            poly.setAttribute("fill", accentColor);
            svg.appendChild(poly);
        }
    });

    // 5. Fotografla ve İndir
    await new Promise(r => setTimeout(r, 1000)); // Render için bekle

    try {
        const canvas = await html2canvas(tempExport, {
            backgroundColor: '#0f172a',
            useCORS: true,
            allowTaint: true,
            scale: 2,
            width: width,
            height: height
        });
        
        const link = document.createElement('a');
        link.download = `lumina-export-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();
    } catch (err) {
        console.error('Export Error:', err);
    } finally {
        tempExport.remove();
        state.isExporting = false;
        exportBtn.innerHTML = originalHTML;
        if (typeof lucide !== 'undefined') lucide.createIcons({ root: exportBtn });
    }
}

function initIconPicker() {
    const iconsGrid = document.getElementById('icons-grid');
    const pickerPopup = document.getElementById('icon-picker-popup');
    const searchInput = document.getElementById('icon-search');
    
    const popularIcons = [
        'star', 'heart', 'flag', 'bookmark', 'alert-circle', 'check-circle', 'zap', 'bell', 'calendar', 'clock', 
        'cloud', 'coffee', 'gift', 'home', 'layers', 'map', 'moon', 'music', 'package', 'phone', 
        'play', 'printer', 'shield', 'shopping-cart', 'smile', 'sun', 'target', 'thumbs-up', 'trash-2', 'user', 
        'video', 'watch', 'wifi', 'camera', 'briefcase', 'database', 'cpu', 'hard-drive', 'mouse', 'keyboard',
        'headphones', 'monitor', 'smartphone', 'tablet', 'activity', 'anchor', 'archive', 'award', 'bar-chart', 'battery',
        'book', 'box', 'clipboard', 'compass', 'crosshair', 'download', 'edit', 'external-link', 'eye', 'file',
        'filter', 'folder', 'globe', 'image', 'info', 'link', 'lock', 'mail', 'menu', 'message-square',
        'mic', 'minus', 'paperclip', 'pause', 'pie-chart', 'plus', 'power', 'refresh-cw', 'search', 'send',
        'settings', 'share', 'shuffle', 'sliders', 'stop-circle', 'tag', 'terminal', 'tool', 'truck', 'tv',
        'type', 'umbrella', 'unlock', 'upload', 'user-plus', 'users', 'volume-2', 'wind', 'x', 'zoom-in'
    ];
    
    const renderGrid = (filter = '') => {
        if (!iconsGrid) return;
        const filteredSet = popularIcons.filter(name => name.includes(filter.toLowerCase()));
        iconsGrid.innerHTML = filteredSet.map(icon => `<div class="picker-item" data-icon="${icon}"><i data-lucide="${icon}"></i></div>`).join('');
        if (typeof lucide !== 'undefined') lucide.createIcons({ root: iconsGrid });
        attachItemListeners();
    };

    const attachItemListeners = () => {
        pickerPopup.querySelectorAll('.picker-item').forEach(item => {
            const newItem = item.cloneNode(true);
            item.parentNode.replaceChild(newItem, item);
            
            newItem.addEventListener('mousedown', (e) => e.preventDefault());
            newItem.addEventListener('click', (e) => {
                e.stopPropagation();
                const icon = newItem.getAttribute('data-icon');
                if (icon) insertAtomicIcon(icon);
                pickerPopup.classList.add('hidden');
            });
        });
    };

    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderGrid(e.target.value));
    }

    renderGrid();
}

function insertAtomicIcon(iconName) {
    pushHistory();
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const wrapper = document.createElement('span');
    wrapper.className = 'icon-wrapper';
    wrapper.contentEditable = 'false';
    wrapper.innerHTML = `<i data-lucide="${iconName}"></i>`;
    
    const space = document.createTextNode('\u00A0'); 

    // Insert order (LIFO in terms of range.insertNode): 
    // We want [wrapper][space], so insert space first, then wrapper.
    range.insertNode(space);
    range.insertNode(wrapper);

    if (typeof lucide !== 'undefined') lucide.createIcons({ root: wrapper });

    // Move caret after the space
    const newRange = document.createRange();
    newRange.setStartAfter(space);
    newRange.setEndAfter(space);
    selection.removeAllRanges();
    selection.addRange(newRange);

    const activeEditor = document.activeElement;
    if (activeEditor && (activeEditor.classList.contains('note-editor') || activeEditor.classList.contains('item-text'))) {
        const event = new Event('input', { bubbles: true });
        activeEditor.dispatchEvent(event);
    }
}

function insertTextAtCursor(text) {
    document.execCommand('insertText', false, text);
}

// Initialize the app
init();
