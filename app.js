/**
 * Lumina Canvas - Core Application Logic
 * Feature: Infinite Canvas, Pan/Zoom, Arbitrary Placement
 */

// --- State Management ---
const state = {
    zoom: 1.0,
    panX: 0,
    panY: 0,
    isPanning: false,
    startPanX: 0,
    startPanY: 0,
    currentTool: 'pan', // pan, text, image, note
    objects: [], // { id, type, x, y, content, width, height }
    selectedId: null,
    isDragging: false,
    isResizing: false,
    dragTarget: null,
    dragStartX: 0,
    dragStartY: 0,
    resizeStartWidth: 0,
    resizeStartHeight: 0
};

// --- DOM Elements ---
const canvasContainer = document.getElementById('canvas-container');
const canvasContent = document.getElementById('canvas-content');
const canvasGrid = document.getElementById('canvas-grid');
const zoomLevelEl = document.getElementById('zoom-level');
const coordXEl = document.getElementById('coord-x');
const coordYEl = document.getElementById('coord-y');
const imageUpload = document.getElementById('image-upload');

// Initialize Icons
lucide.createIcons();

// --- Initialization ---
function init() {
    loadState();
    renderObjects();
    setupEventListeners();
    updateCanvas();
}

// --- Persistence ---
function saveState() {
    localStorage.setItem('lumina_canvas_data', JSON.stringify({
        objects: state.objects,
        pan: { x: state.panX, y: state.panY },
        zoom: state.zoom
    }));
}

function loadState() {
    const data = localStorage.getItem('lumina_canvas_data');
    if (data) {
        const parsed = JSON.parse(data);
        state.objects = parsed.objects || [];
        state.panX = parsed.pan.x || 0;
        state.panY = parsed.pan.y || 0;
        state.zoom = parsed.zoom || 1.0;
    }
}

// --- Canvas Controls ---
function updateCanvas() {
    // Apply transform to content
    canvasContent.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    
    // Grid follows pan (subtly)
    canvasGrid.style.transform = `translate(${state.panX % (50 * state.zoom)}px, ${state.panY % (50 * state.zoom)}px) scale(${state.zoom})`;
    
    // UI Update
    zoomLevelEl.innerText = `${Math.round(state.zoom * 100)}%`;
    coordXEl.innerText = `X: ${Math.round(state.panX)}`;
    coordYEl.innerText = `Y: ${Math.round(state.panY)}`;
}

function setupEventListeners() {
    // Middle Mouse or Space + drag to pan
    canvasContainer.addEventListener('mousedown', e => {
        // Unfocus active editors when starting to pan on empty canvas
        if (e.target === canvasContainer || e.target === canvasGrid) {
            if (document.activeElement && document.activeElement.classList.contains('note-editor')) {
                document.activeElement.blur();
                window.getSelection().removeAllRanges();
            }
        }

        if (state.currentTool === 'pan' || e.button === 1 || (e.button === 0 && e.target === canvasContainer)) {
            state.isPanning = true;
            state.startPanX = e.clientX - state.panX;
            state.startPanY = e.clientY - state.panY;
            canvasContainer.classList.add('panning');
            e.preventDefault();
        }
    });

    window.addEventListener('mousemove', e => {
        if (state.isPanning) {
            state.panX = e.clientX - state.startPanX;
            state.panY = e.clientY - state.startPanY;
            updateCanvas();
        }
        
        if (state.isDragging && state.dragTarget) {
            const dx = (e.clientX - state.dragStartX) / state.zoom;
            const dy = (e.clientY - state.dragStartY) / state.zoom;
            
            const obj = state.objects.find(o => o.id === state.dragTarget);
            if (obj) {
                if (state.isResizing) {
                    // Resize logic
                    obj.width = Math.max(100, state.resizeStartWidth + dx);
                    obj.height = Math.max(50, state.resizeStartHeight + dy);
                    const el = document.getElementById(`obj-${obj.id}`);
                    if (el) {
                        el.style.width = `${obj.width}px`;
                        el.style.height = `${obj.height}px`;
                    }
                } else {
                    // Drag logic
                    obj.x += dx;
                    obj.y += dy;
                    const el = document.getElementById(`obj-${obj.id}`);
                    if (el) {
                        el.style.left = `${obj.x}px`;
                        el.style.top = `${obj.y}px`;
                    }
                    state.dragStartX = e.clientX;
                    state.dragStartY = e.clientY;
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
        if (state.isDragging) {
            state.isDragging = false;
            state.isResizing = false;
            state.dragTarget = null;
            saveState();
        }
    });

    // Zoom
    canvasContainer.addEventListener('wheel', e => {
        e.preventDefault();
        const delta = -e.deltaY;
        const factor = 1.1;
        const zoomChange = delta > 0 ? factor : 1/factor;
        
        const rect = canvasContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Zoom centered on mouse
        const oldZoom = state.zoom;
        state.zoom = Math.min(Math.max(state.zoom * zoomChange, 0.1), 5.0);
        
        const zoomDelta = state.zoom / oldZoom;
        state.panX = mouseX - (mouseX - state.panX) * zoomDelta;
        state.panY = mouseY - (mouseY - state.panY) * zoomDelta;
        
        updateCanvas();
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
                    const center = getCanvasCenter();
                    const w = state.currentTool === 'note' ? 250 : 200;
                    const h = state.currentTool === 'note' ? 180 : 60;
                    addObject(state.currentTool, center.x - w/2, center.y - h/2);
                    // Switch back to pan tool for immediate movement
                    document.getElementById('tool-pan').click();
                }
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
            const rect = canvasContainer.getBoundingClientRect();
            const x = (e.clientX - state.panX - rect.left) / state.zoom;
            const y = (e.clientY - state.panY - rect.top) / state.zoom;
            
            const w = state.currentTool === 'note' ? 250 : 200;
            const h = state.currentTool === 'note' ? 180 : 60;
            addObject(state.currentTool, x - w/2, y - h/2);
            // Reset to pan tool
            document.getElementById('tool-pan').click();
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
        
        if (key === 'h' || key === 'v') document.getElementById('tool-pan').click();
        if (key === 't') document.getElementById('tool-text').click();
        if (key === 'i') document.getElementById('tool-image').click();
        if (key === 'n') document.getElementById('tool-note').click();
        if (key === 'delete' || (key === 'backspace' && !isEditing)) {
            if (state.selectedId) {
                removeObject(state.selectedId);
            }
        }
    });

    // Zoom Buttons
    document.getElementById('zoom-in').addEventListener('click', () => {
        state.zoom *= 1.2;
        updateCanvas();
    });
    document.getElementById('zoom-out').addEventListener('click', () => {
        state.zoom /= 1.2;
        updateCanvas();
    });
    
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
                if (state.selectedId) removeObject(state.selectedId);
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
    const id = Date.now().toString();
    const newObj = {
        id,
        type,
        x,
        y,
        content: content || (type === 'text' ? '' : ''),
        width: type === 'note' ? 250 : (type === 'image' ? 300 : 200),
        height: type === 'note' ? 180 : 'auto',
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
    const el = document.getElementById(`obj-${id}`);
    if (el) el.remove();
    state.selectedId = null;
    saveState();
}

function renderObject(obj) {
    const el = document.createElement('div');
    el.id = `obj-${obj.id}`;
    el.className = `canvas-obj fade-in ${obj.type}-obj`;
    el.style.left = `${obj.x}px`;
    el.style.top = `${obj.y}px`;
    el.style.width = obj.width === 'auto' ? 'auto' : `${obj.width}px`;
    el.style.height = obj.height === 'auto' ? 'auto' : `${obj.height}px`;

    if (obj.color && obj.color !== 'default') {
        el.style.background = obj.color;
        // Auto-fix text visibility if user hasn't set a custom text color
        if (obj.textColor === 'default') {
            obj.textColor = '#0f172a'; // Dark blue/black for better contrast on colored notes
        }
    }

    // Drag Handle
    const handle = document.createElement('div');
    handle.className = 'obj-handle';
    el.appendChild(handle);

    // Resize Handle
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
        if (obj.textColor && obj.textColor !== 'default') {
            editor.style.color = obj.textColor;
        }
        
        editor.addEventListener('input', () => {
            obj.content = editor.innerHTML;
            saveState();
        });

        // Toggle toolbar on focus
        editor.addEventListener('focus', () => {
            selectObject(obj.id);
        });

        // Prevent dragging when typing
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

    // Event Listeners for Object
    el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        selectObject(obj.id);
        
        const isHandle = e.target.classList.contains('obj-handle');
        const isResize = e.target.classList.contains('resize-handle');
        
        if (isHandle) {
            state.isDragging = true;
            state.dragTarget = obj.id;
            state.dragStartX = e.clientX;
            state.dragStartY = e.clientY;
        } else if (isResize) {
            state.isDragging = true; // Still using drag logic for resize move
            state.dragTarget = obj.id;
            state.dragStartX = e.clientX;
            state.dragStartY = e.clientY;
            state.isResizing = true;
            state.resizeStartWidth = el.offsetWidth;
            state.resizeStartHeight = el.offsetHeight;
        } else {
            // Clicked padding or background
            const editor = el.querySelector('.note-editor');
            if (editor) editor.focus();
        }
    });

    canvasContent.appendChild(el);
    lucide.createIcons();
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
            // Update custom dropdown label
            const opt = document.querySelector(`.dropdown-opt[data-value="${obj.fontFamily}"]`);
            if (opt) dropdownSelected.textContent = opt.textContent;
        }
        if (obj && obj.fontSize) {
            sizeSelected.textContent = obj.fontSize;
        }

        // Update Color Selection UI
        floatingToolbar.querySelectorAll('.color-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-color') === (obj.color || 'default'));
        });

        // Update Text Color Selection UI
        floatingToolbar.querySelectorAll('.text-color-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-color') === (obj.textColor || 'default'));
        });

        floatingToolbar.classList.add('active');
    } else {
        floatingToolbar.classList.remove('active');
    }
}

function renderObjects() {
    canvasContent.innerHTML = '';
    state.objects.forEach(renderObject);
}

function getCanvasCenter() {
    const rect = canvasContainer.getBoundingClientRect();
    return {
        x: (rect.width / 2 - state.panX) / state.zoom,
        y: (rect.height / 2 - state.panY) / state.zoom
    };
}

// Initialize the app
init();
