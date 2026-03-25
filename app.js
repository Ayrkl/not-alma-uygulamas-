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
    }
};

// --- DOM Elements ---
const canvasContainer = document.getElementById('canvas-container');
const canvasContent = document.getElementById('canvas-content');
const canvasGrid = document.getElementById('canvas-grid');
const zoomLevelEl = document.getElementById('zoom-level');
const coordXEl = document.getElementById('coord-x');
const coordYEl = document.getElementById('coord-y');
const imageUpload = document.getElementById('image-upload');

// --- Initialization ---
function init() {
    lucide.createIcons();
    setupSearchListeners();
    try {
        loadState();
        renderObjects();
        renderConnections();
        setupEventListeners();
        setupSettingsListeners();
        
        // Sync camera targets
        state.targetZ = state.camZ;
        state.targetX = state.camX;
        state.targetY = state.camY;
        
        updateCanvas();
        
        // Start animation loop
        requestAnimationFrame(animationLoop);
    } catch (err) {
        console.error("Lumina Init Error:", err);
    }
}

// --- Persistence ---
function saveState() {
    localStorage.setItem('lumina_canvas_data', JSON.stringify({
        objects: state.objects,
        connections: state.connections,
        cam: { x: state.camX, y: state.camY, z: state.camZ }
    }));
}

function loadState() {
    const data = localStorage.getItem('lumina_canvas_data');
    if (data) {
        try {
            const parsed = JSON.parse(data);
            state.objects = parsed.objects || [];
            state.connections = parsed.connections || [];
            if (parsed.cam) {
                state.camX = parsed.cam.x || 0;
                state.camY = parsed.cam.y || 0;
                state.camZ = parsed.cam.z || 1.0;
            }
            
            // Migration: Ensure all connections have IDs
            state.connections.forEach(conn => {
                if (!conn.id) {
                    conn.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
                }
            });
        } catch (e) {
            console.error("Data Load Error:", e);
        }
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
    }
    requestAnimationFrame(animationLoop);
}

// --- Kamera Kontrolleri ---
function updateCanvas() {
    const rect = canvasContainer.getBoundingClientRect();
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;

    // Kamera Formülü: Dünyayı kameranın bakış açısına göre kilitliyoruz.
    // Her şey "halfW/halfH" merkezinde zoomlanır.
    const transform = `translate(${halfW}px, ${halfH}px) scale(${state.camZ}) translate(${-state.camX}px, ${-state.camY}px)`;
    canvasContent.style.transform = transform;
    
    // Izgara Senkronizasyonu — kamera pozisyonuyla tam kilitli
    const gridSize = 50 * state.camZ;
    const offsetX = halfW - state.camX * state.camZ;
    const offsetY = halfH - state.camY * state.camZ;
    canvasGrid.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    canvasGrid.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
    
    // UI Güncelleme
    zoomLevelEl.innerText = `${Math.round(state.camZ * 100)}%`;
    coordXEl.innerText = `X: ${Math.round(state.camX)}`;
    coordYEl.innerText = `Y: ${Math.round(state.camY)}`;
}

function setupEventListeners() {
    // Middle Mouse or Space + drag to pan
    canvasContainer.addEventListener('mousedown', e => {
        if (e.target.closest('#sidebar') || e.target.closest('#controls') || e.target.closest('.glass')) return;

        // Unfocus active editors when starting to pan on empty canvas
        if (e.target === canvasContainer || e.target === canvasGrid) {
            if (document.activeElement && document.activeElement.classList.contains('note-editor')) {
                document.activeElement.blur();
                window.getSelection().removeAllRanges();
            }
        }

        if (state.currentTool === 'pan' || e.button === 1) {
            state.isPanning = true;
            state.startMouseX = e.clientX;
            state.startMouseY = e.clientY;
            state.startCamX = state.targetX;
            state.startCamY = state.targetY;
            deselectAll();
            canvasContainer.classList.add('panning');
            e.preventDefault();
        } else if (state.currentTool === 'select' && e.button === 0) {
            state.isSelecting = true;
            state.selectionStartX = e.clientX;
            state.selectionStartY = e.clientY;
            
            const selectionBox = document.createElement('div');
            selectionBox.id = 'selection-box';
            document.body.appendChild(selectionBox);
            selectionBox.style.display = 'block';
            deselectAll();
        } else if (e.target === canvasGrid || e.target === canvasContainer) {
            deselectAll();
        }
    });

    window.addEventListener('mousemove', e => {
        if (state.isPanning) {
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

    window.addEventListener('mouseup', () => {
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

    // Sabit Merkezli Z-Kamera Zoom
    canvasContainer.addEventListener('wheel', e => {
        e.preventDefault();
        
        // Sadece Z (derinlik) hedefini değiştiriyoruz, X ve Y sabit kalıyor.
        // Bu sayede zoom her zaman tam ekranın ortasına doğru yapılır.
        const sensitivity = state.settings.sensitivity || 0.15;
        const zoomDelta = Math.pow(1 + sensitivity, -e.deltaY / 120);
        state.targetZ = Math.min(Math.max(state.targetZ * zoomDelta, 0.05), 10.0);
    }, { passive: false });

    // Tool switching
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const toolId = btn.id.replace('tool-', '');
            
            // For theme toggle, it's a special action
            if (btn.id === 'theme-toggle') {
                toggleTheme();
                return;
            }

            if (btn.id.startsWith('tool-')) {
                document.querySelector('.tool-btn.active')?.classList.remove('active');
                btn.classList.add('active');
                state.currentTool = toolId;
                
                // Immediate action for certain tools
                if (state.currentTool === 'image') {
                    imageUpload.click();
                } else if (state.currentTool === 'text' || state.currentTool === 'note') {
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
            const reader = new FileReader();
            reader.onload = (event) => {
                const center = getCanvasCenter();
                addObject('image', center.x, center.y, event.target.result);
            };
            reader.readAsDataURL(file);
        }
    });

    // Move sidebar toggle logic here
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    sidebarToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('collapsed');
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', e => {
        const isEditing = e.target.tagName === 'INPUT' || 
                         e.target.tagName === 'TEXTAREA' || 
                         e.target.getAttribute('contenteditable') === 'true';

        const key = e.key.toLowerCase();
        
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
    const floatingToolbar = document.getElementById('floating-toolbar');
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
        // Close other dropdowns
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
                    
                    // Update UI selection
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
                    const color = btn.getAttribute('data-color');
                    obj.textColor = color;
                    
                    const el = document.querySelector(`#obj-${obj.id} .note-editor`);
                    if (el) {
                        el.style.color = color === 'default' ? '' : color;
                    }
                    
                    // Update UI selection
                    floatingToolbar.querySelectorAll('.text-color-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    saveState();
                }
            }
        });
    });

    // Close dropdowns when clicking outside
    window.addEventListener('click', () => {
        fontDropdown.classList.remove('open');
        sizeDropdown.classList.remove('open');
    });

    // Deselect logic when clicking empty canvas
    canvasContainer.addEventListener('mousedown', (e) => {
        if (e.target === canvasContainer || e.target === canvasGrid) {
            selectObject(null);
        }
    });
    
    // Save button (Direct storage in Electron or Download in Browser)
    document.getElementById('save-btn').addEventListener('click', async () => {
        const textData = JSON.stringify(state.objects, null, 2);
        
        if (window.electronAPI) {
            // Electron Mode
            const success = await window.electronAPI.saveFile(textData);
            if (success) console.log('Dosya başarıyla kaydedildi.');
        } else {
            // Web Browser Mode
            const blob = new Blob([textData], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'board_data.txt';
            a.click();
        }
    });
}

function toggleTheme() {
    const body = document.body;
    const isDark = body.classList.contains('dark-theme');
    const icon = document.querySelector('#theme-toggle i');
    
    if (isDark) {
        body.classList.replace('dark-theme', 'light-theme');
        icon.setAttribute('data-lucide', 'sun');
    } else {
        body.classList.replace('light-theme', 'dark-theme');
        icon.setAttribute('data-lucide', 'moon');
    }
    lucide.createIcons();
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

// --- Object Logic ---
function addObject(type, x, y, content = '') {
    // If coordinates are not provided, use canvas center
    if (x === undefined || y === undefined) {
        const center = getCanvasCenter();
        const w = (type === 'note' ? 250 : 200);
        const h = (type === 'note' ? 180 : 60);
        x = center.x - w / 2;
        y = center.y - h / 2;
    }

    const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    const newObj = {
        id,
        type,
        x,
        y: y + 20, // Vertical offset
        content: content || '',
        width: type === 'note' ? 250 : (type === 'image' ? 300 : (type === 'point' ? 8 : 200)),
        height: type === 'note' ? 180 : (type === 'point' ? 8 : 'auto'),
        fontFamily: 'Inter',
        fontSize: '16px',
        color: 'default',
        textColor: 'default',
        newlyCreated: true
    };
    
    state.objects.push(newObj);
    renderObject(newObj);
    saveState();
    return id;
}

function removeObject(id) {
    state.objects = state.objects.filter(o => o.id !== id);
    // Also remove related connections
    state.connections = state.connections.filter(c => c.fromId !== id && c.toId !== id);
    
    const el = document.getElementById(`obj-${id}`);
    if (el) el.remove();
    state.selectedId = null;
    renderConnections();
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
    const floatingToolbar = document.getElementById('floating-toolbar');
    floatingToolbar.classList.add('active');
}

function removeConnection(connId) {
    state.connections = state.connections.filter(c => c.id !== connId);
    state.selectedConnId = null;
    renderConnections();
    saveState();
}

function bulkRemoveConnections(connIds) {
    state.connections = state.connections.filter(c => !connIds.includes(c.id));
    state.selectedConnIds = [];
    renderConnections();
    saveState();
}

function hitTestSelection(sx, sy, sw, sh) {
    const rect = canvasContainer.getBoundingClientRect();
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;

    // 1. Check Objects
    state.selectedIds = [];
    state.objects.forEach(obj => {
        const objEl = document.getElementById(`obj-${obj.id}`);
        const objRect = {
            x: obj.x * state.camZ + halfW - state.camX * state.camZ,
            y: obj.y * state.camZ + halfH - state.camY * state.camZ,
            w: (obj.width === 'auto' ? 200 : obj.width) * state.camZ,
            h: (obj.height === 'auto' ? 100 : obj.height) * state.camZ
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
        const fromEl = conn.fromId ? document.getElementById(`obj-${conn.fromId}`) : null;
        const toEl = conn.toId ? document.getElementById(`obj-${conn.toId}`) : null;

        let startX, startY, endX, endY;

        if (fromObj && fromEl) {
            const fw = fromEl.offsetWidth || (fromObj.width === 'auto' ? 200 : fromObj.width);
            const fh = fromEl.offsetHeight || (fromObj.height === 'auto' ? 100 : fromObj.height);
            startX = fromObj.x + (fw / 2);
            startY = fromObj.y + (fh / 2);
        } else if (conn.fromX !== null) {
            startX = conn.fromX;
            startY = conn.fromY;
        }

        if (toObj && toEl) {
            const tw = toEl.offsetWidth || (toObj.width === 'auto' ? 200 : toObj.width);
            const th = toEl.offsetHeight || (toObj.height === 'auto' ? 100 : toObj.height);
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

            // If start AND end are inside selection box
            if (sX > sx && sX < sx + sw && sY > sy && sY < sy + sh &&
                eX > sx && eX < sx + sw && eY > sy && eY < sy + sh) {
                state.selectedConnIds.push(conn.id);
                if (connEl) connEl.classList.add('selected');
            } else {
                if (connEl) connEl.classList.remove('selected');
            }
        }
    });

    if (state.selectedIds.length > 0 || state.selectedConnIds.length > 0) {
        document.getElementById('floating-toolbar').classList.add('active');
    } else {
        document.getElementById('floating-toolbar').classList.remove('active');
    }
}

function bulkRemove(ids) {
    ids.forEach(id => {
        state.objects = state.objects.filter(o => o.id !== id);
        state.connections = state.connections.filter(c => c.fromId !== id && c.toId !== id);
        const el = document.getElementById(`obj-${id}`);
        if (el) el.remove();
    });
    deselectAll();
    renderConnections();
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
    if (obj.type === 'point') {
        const el = document.createElement('div');
        el.id = `obj-${obj.id}`;
        el.className = 'canvas-obj point-anchor fade-in';
        el.style.left = `${obj.x}px`;
        el.style.top = `${obj.y}px`;
        
        el.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (state.currentTool === 'connect') handleConnectionClick(obj.id);
            else if (state.currentTool === 'pan' || state.currentTool === 'select' || state.currentTool === '') selectObject(obj.id);
        });

        canvasContent.appendChild(el);
        return;
    }

    const el = document.createElement('div');
    el.id = `obj-${obj.id}`;
    el.className = `canvas-obj fade-in ${obj.type}-obj`;
    el.style.left = `${obj.x}px`;
    el.style.top = `${obj.y}px`;
    el.style.width = obj.width === 'auto' ? 'auto' : `${obj.width}px`;
    el.style.height = obj.height === 'auto' ? 'auto' : `${obj.height}px`;

    if (obj.color && obj.color !== 'default') {
        el.style.background = obj.color;
        if (obj.textColor === 'default') obj.textColor = '#0f172a';
    }

    const handle = document.createElement('div');
    handle.className = 'obj-handle';
    el.appendChild(handle);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    el.appendChild(resizeHandle);

    if (obj.type === 'image') {
        const wrapper = document.createElement('div');
        wrapper.className = 'image-wrapper';
        wrapper.innerHTML = `<img src="${obj.content}" draggable="false">`;
        el.appendChild(wrapper);
    } else {
        const editor = document.createElement('div');
        editor.className = 'note-editor';
        editor.contentEditable = 'true';
        editor.innerHTML = obj.content || 'Buraya yazın...';
        editor.style.fontFamily = obj.fontFamily || 'Inter';
        editor.style.fontSize = obj.fontSize || '16px';
        if (obj.textColor && obj.textColor !== 'default') editor.style.color = obj.textColor;
        
        editor.addEventListener('input', () => {
            obj.content = editor.innerHTML;
            saveState();
        });

        editor.addEventListener('focus', () => selectObject(obj.id));
        editor.addEventListener('mousedown', e => e.stopPropagation());
        
        el.appendChild(editor);
        
        if (obj.newlyCreated) {
            setTimeout(() => {
                editor.focus();
                document.execCommand('selectAll', false, null);
            }, 100);
            delete obj.newlyCreated;
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

    canvasContent.appendChild(el);
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

        floatingToolbar.classList.add('active');
        document.getElementById('connection-toolbar').classList.remove('active');
    } else {
        floatingToolbar.classList.remove('active');
    }
}

function renderObjects() {
    canvasContent.innerHTML = '';
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "connection-layer";
    
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "arrowhead");
    marker.setAttribute("markerWidth", "10");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "3.5");
    marker.setAttribute("orient", "auto");
    marker.setAttribute("markerUnits", "strokeWidth");
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("points", "0 0, 10 3.5, 0 7");
    polygon.setAttribute("fill", "var(--accent-color)");
    marker.appendChild(polygon);
    defs.appendChild(marker);

    const markerStart = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    markerStart.setAttribute("id", "arrowstart");
    markerStart.setAttribute("markerWidth", "10");
    markerStart.setAttribute("markerHeight", "7");
    markerStart.setAttribute("refX", "1");
    markerStart.setAttribute("refY", "3.5");
    markerStart.setAttribute("orient", "auto");
    markerStart.setAttribute("markerUnits", "strokeWidth");
    const polygonStart = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygonStart.setAttribute("points", "10 0, 0 3.5, 10 7");
    polygonStart.setAttribute("fill", "var(--accent-color)");
    markerStart.appendChild(polygonStart);
    defs.appendChild(markerStart);
    
    svg.appendChild(defs);
    canvasContent.appendChild(svg);
    
    state.objects.forEach(renderObject);
    renderConnections();
}

function renderConnections() {
    const svg = document.getElementById('connection-layer');
    if (!svg) return;
    
    // Tam Temizlik: Hem çizgileri hem de görünmez vuruş alanlarını temizle
    const paths = svg.querySelectorAll('.connection-path, .connection-hitbox');
    paths.forEach(p => p.remove());
    
    state.connections.forEach(conn => {
        const fromObj = conn.fromId ? state.objects.find(o => o.id === conn.fromId) : null;
        const toObj = conn.toId ? state.objects.find(o => o.id === conn.toId) : null;
        const fromEl = conn.fromId ? document.getElementById(`obj-${conn.fromId}`) : null;
        const toEl = conn.toId ? document.getElementById(`obj-${conn.toId}`) : null;
        
        let startX, startY, endX, endY;

        // Determine Start Point
        if (fromObj && fromEl) {
            const fw = fromEl.offsetWidth || (fromObj.width === 'auto' ? 200 : fromObj.width);
            const fh = fromEl.offsetHeight || (fromObj.height === 'auto' ? 100 : fromObj.height);
            startX = fromObj.x + (fw / 2);
            startY = fromObj.y + (fh / 2);
        } else if (conn.fromX !== null) {
            startX = conn.fromX;
            startY = conn.fromY;
        }

        // Determine End Point
        if (toObj && toEl) {
            const tw = toEl.offsetWidth || (toObj.width === 'auto' ? 200 : toObj.width);
            const th = toEl.offsetHeight || (toObj.height === 'auto' ? 100 : toObj.height);
            endX = toObj.x + (tw / 2);
            endY = toObj.y + (th / 2);
        } else if (conn.toX !== null) {
            endX = conn.toX;
            endY = conn.toY;
        }

        if (startX !== undefined && endX !== undefined) {
            // Robust Curved Logic (Z-Curve)
            const cpX1 = startX + (endX - startX) * 0.5;
            const cpY1 = startY;
            const cpX2 = startX + (endX - startX) * 0.5;
            const cpY2 = endY;
            const d = `M ${startX} ${startY} C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${endX} ${endY}`;

            // 1. Görünmez Hitbox (Daha geniş tıklama alanı için)
            const hitbox = document.createElementNS("http://www.w3.org/2000/svg", "path");
            hitbox.setAttribute("class", "connection-hitbox");
            hitbox.setAttribute("d", d);
            hitbox.style.stroke = "transparent";
            hitbox.style.strokeWidth = "25";
            hitbox.style.fill = "none";
            hitbox.style.cursor = "pointer";
            hitbox.style.pointerEvents = "visibleStroke";
            
            // 2. Görünür Çizgi (Estetik kısım)
            const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
            p.id = `conn-${conn.id}`; // Add ID for faster selection lookup
            let classes = "connection-path";
            if (conn.style === 'dashed') classes += " dashed";
            if (state.selectedConnId === conn.id || state.selectedConnIds.includes(conn.id)) classes += " selected";
            p.setAttribute("class", classes);
            p.setAttribute("d", d);
            
            // Oku Seçme Mantığı (Hem hitbox hem çizgi için)
            [hitbox, p].forEach(el => {
                el.addEventListener('mousedown', (e) => {
                    e.stopPropagation(); 
                });
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectConnection(conn.id);
                });
            });
            
            if (conn.flow === 'forward' || conn.flow === 'both') p.setAttribute("marker-end", "url(#arrowhead)");
            if (conn.flow === 'both') p.setAttribute("marker-start", "url(#arrowstart)");
            
            svg.appendChild(hitbox);
            svg.appendChild(p);
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
}

// Initialize the app
init();
