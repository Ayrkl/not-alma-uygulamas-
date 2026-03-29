export const state = {
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
    undoHistory: []
};

// Undo Logic
const MAX_UNDO_STEPS = 50;

export function pushHistory() {
    const snapshot = {
        objects: JSON.parse(JSON.stringify(state.objects)),
        connections: JSON.parse(JSON.stringify(state.connections))
    };
    state.undoHistory.push(snapshot);
    if (state.undoHistory.length > MAX_UNDO_STEPS) {
        state.undoHistory.shift();
    }
}

export async function saveState() {
    const dataToSave = {
        objects: state.objects,
        connections: state.connections,
        cam: { x: state.targetX, y: state.targetY, z: state.targetZ },
        settings: state.settings
    };
    
    if (window.electronAPI && window.electronAPI.saveData) {
        await window.electronAPI.saveData(dataToSave);
    }
}
