import { state, pushHistory, saveState } from './store.js';
import { debounce } from './utils.js';

let canvasContent = null;
let connectionLayer = null;

export function initRenderer(contentNode) {
    canvasContent = contentNode;
}

// ==========================================
// VIEWPORT CULLING ALGORITHM
// Ekranda olmayan binlerce notu render işleminden çıkarır
// ==========================================
export function cullObjects() {
    if (!canvasContent || state.objects.length < 50) return; // Az not varsa zahmete girme

    const viewW = window.innerWidth / state.camZ;
    const viewH = window.innerHeight / state.camZ;
    const cw = viewW / 2;
    const ch = viewH / 2;
    
    // Kameranın ekrana sığan koordinatlarına tolerans (padding) ekliyoruz
    const padding = 300 / state.camZ;
    const minX = state.camX - cw - padding;
    const maxX = state.camX + cw + padding;
    const minY = state.camY - ch - padding;
    const maxY = state.camY + ch + padding;
    
    for (let i = 0; i < state.objects.length; i++) {
        const obj = state.objects[i];
        const el = document.getElementById(`obj-${obj.id}`);
        if (!el) continue;
        if (obj.pinned) continue; // Ekrana sabitlenenler asla culling'e girmez
        
        const w = typeof obj.width === 'number' ? obj.width : 300;
        const h = typeof obj.height === 'number' ? obj.height : 300;
        
        // 2 Boyutlu Çarpışma Testi (AABB Collision)
        const isVisible = (obj.x < maxX && obj.x + w > minX && obj.y < maxY && obj.y + h > minY);
        
        if (isVisible) {
            // Eğer daha önceden gizlendiyse geri getir
            if (el.style.display === 'none') {
                el.style.display = '';
                // Tekrar görünürlüğe girdiğinde animasyon tetikleyebiliriz
                el.classList.add('fade-in'); 
            }
        } else {
            // Görüşten çıktıysa DOM Layout'tan çıkar (GPU rahatlasın)
            if (el.style.display !== 'none') {
                el.style.display = 'none';
                el.classList.remove('fade-in');
            }
        }
    }
}

// ==========================================
// RENDER MOTORU (Vanilla DOM Juggling)
// ==========================================
export function renderObjects() {
    if(!canvasContent) return;
    updateMiniMap(); // Aslında ui.js'in işi ama geçici buraya bağlıyoruz
    
    const validIds = new Set(state.objects.map(o => `obj-${o.id}`));
    const pinnedLayer = document.getElementById('pinned-layer');
    
    const layers = [canvasContent, pinnedLayer];
    layers.forEach(layer => {
        if (!layer) return;
        Array.from(layer.children).forEach(child => {
            if (child.id === 'connection-layer' || child.id === 'selection-box') return;
            if (child.classList.contains('canvas-obj') && !validIds.has(child.id)) {
                child.remove();
            }
        });
    });

    state.objects.forEach(renderObject);
    
    if (!document.getElementById('connection-layer')) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.id = "connection-layer";
        
        // Ok ucu tanımlamaları
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

        svg.appendChild(defs);
        canvasContent.appendChild(svg);
        connectionLayer = svg;
    } else {
        connectionLayer = document.getElementById('connection-layer');
    }
    
    renderConnections();
    cullObjects(); // Çizim biter bitmez viewportu filtrele
}

function renderObject(obj) {
    let el = document.getElementById(`obj-${obj.id}`);
    const isUpdate = !!el;

    if (!el) {
        el = document.createElement('div');
        el.id = `obj-${obj.id}`;
    }

    el.className = `canvas-obj fade-in ${obj.type}-obj ${state.selectedId === obj.id || state.selectedIds.includes(obj.id) ? 'selected' : ''}`;
    // Pinned mantığı
    el.style.left = `${obj.pinned ? obj.pinX : obj.x}px`;
    el.style.top = `${obj.pinned ? obj.pinY : obj.y}px`;
    el.style.width = obj.width === 'auto' ? 'auto' : `${obj.width}px`;
    el.style.height = obj.height === 'auto' ? 'auto' : `${obj.height}px`;

    if (obj.color && obj.color !== 'default') {
        el.style.background = obj.color;
    } else {
        el.style.background = '';
    }

    if (!isUpdate) {
        const handle = document.createElement('div');
        handle.className = 'obj-handle';
        el.appendChild(handle);

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        el.appendChild(resizeHandle);
    }

    if (obj.type === 'note' || obj.type === 'text') {
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

            editor.addEventListener('mousedown', e => e.stopPropagation());
            el.appendChild(editor);
        } else {
            const editor = el.querySelector('.note-editor');
            if (editor && document.activeElement !== editor && editor.innerHTML !== obj.content) {
                editor.innerHTML = obj.content || '';
            }
            if (editor) {
                editor.style.fontFamily = obj.fontFamily || 'Inter';
                editor.style.fontSize = obj.fontSize || '16px';
                if (obj.textColor && obj.textColor !== 'default') editor.style.color = obj.textColor;
            }
        }
    } else if (obj.type === 'image') {
        if (!isUpdate || el.dataset.renderedContent !== obj.content) {
            const oldWrapper = el.querySelector('.image-wrapper');
            if (oldWrapper) oldWrapper.remove();
            
            const wrapper = document.createElement('div');
            wrapper.className = 'image-wrapper';
            wrapper.innerHTML = `<img src="${obj.content}" draggable="false">`;
            el.appendChild(wrapper);
            el.dataset.renderedContent = obj.content;
        }
    } else if (obj.type === 'checklist') {
        // Liste yapısı için hafif render mantığı
        if (!isUpdate || el.dataset.renderedContent !== obj.content) {
            const oldContainer = el.querySelector('.checklist-container');
            if (oldContainer) oldContainer.remove();

            const container = document.createElement('div');
            container.className = 'checklist-container';
            const items = JSON.parse(obj.content || '[]');
            
            items.forEach((item) => {
                const itemEl = document.createElement('div');
                itemEl.className = `checklist-item ${item.checked ? 'checked' : ''}`;
                itemEl.innerHTML = `
                    <div class="check-box ${item.checked ? 'checked' : ''}"></div>
                    <div class="item-text" contenteditable="true" spellcheck="false">${item.text}</div>
                `;
                
                // Eventleri burada kısadan bağlıyoruz
                itemEl.querySelector('.check-box').addEventListener('click', (e) => {
                    e.stopPropagation();
                    item.checked = !item.checked;
                    itemEl.classList.toggle('checked');
                    itemEl.querySelector('.check-box').classList.toggle('checked');
                    obj.content = JSON.stringify(items);
                    saveState();
                });
                
                container.appendChild(itemEl);
            });
            el.appendChild(container);
            el.dataset.renderedContent = obj.content;
        }
    } else if (obj.type === 'video') {
       if (!isUpdate || el.dataset.renderedContent !== obj.content) {
            const oldWrapper = el.querySelector('.video-wrapper');
            if (oldWrapper) oldWrapper.remove();
            const wrapper = document.createElement('div');
            wrapper.className = 'video-wrapper';
            wrapper.innerHTML = `<video src="${obj.content}" controls draggable="false"></video>`;
            el.appendChild(wrapper);
            el.dataset.renderedContent = obj.content;
       }
    } else if (obj.type === 'embed') {
        if (!isUpdate || el.dataset.renderedContent !== obj.content) {
            const oldEmbed = el.querySelector('.embed-container');
            if (oldEmbed) oldEmbed.remove();

            el.classList.add('embed-obj');
            const iframe = document.createElement('iframe');
            iframe.className = 'embed-container';
            iframe.src = obj.content;
            iframe.allow = "autoplay; encrypted-media; picture-in-picture";
            el.appendChild(iframe);
            el.dataset.renderedContent = obj.content;
        }
    }

    if (!isUpdate) {
        const layer = obj.pinned ? document.getElementById('pinned-layer') : canvasContent;
        if(layer) layer.appendChild(el);
    }
}

export function renderConnections() {
    if (!connectionLayer || state.connections.length === 0) return;
    
    const validIds = new Set(state.connections.map(c => c.id));
    const paths = connectionLayer.querySelectorAll('.connection-path');
    paths.forEach(p => {
        let actualId = p.id.replace('conn-', '');
        if (!validIds.has(actualId)) p.remove();
    });

    state.connections.forEach(conn => {
        const fromObj = state.objects.find(o => o.id === conn.fromId);
        const toObj = state.objects.find(o => o.id === conn.toId);

        let startX = fromObj ? fromObj.x + (typeof fromObj.width === 'number' ? fromObj.width/2 : 100) : conn.fromX;
        let startY = fromObj ? fromObj.y + (typeof fromObj.height === 'number' ? fromObj.height/2 : 100) : conn.fromY;
        let endX = toObj ? toObj.x + (typeof toObj.width === 'number' ? toObj.width/2 : 100) : conn.toX;
        let endY = toObj ? toObj.y + (typeof toObj.height === 'number' ? toObj.height/2 : 100) : conn.toY;
        
        if (startX !== undefined && endX !== undefined) {
             const cpX1 = startX + (endX - startX) * 0.5;
             const d = `M ${startX} ${startY} C ${cpX1} ${startY}, ${cpX1} ${endY}, ${endX} ${endY}`;
             
             let p = document.getElementById(`conn-${conn.id}`);
             if (!p) {
                 p = document.createElementNS("http://www.w3.org/2000/svg", "path");
                 p.id = `conn-${conn.id}`;
                 p.setAttribute("class", "connection-path");
                 connectionLayer.appendChild(p);
             }
             p.setAttribute("d", d);
             if(conn.flow === 'forward') p.setAttribute("marker-end", "url(#arrowhead)");
        }
    });
}

function updateMiniMap() {
    // Mini-map fonksiyonu global boş şablon
}
