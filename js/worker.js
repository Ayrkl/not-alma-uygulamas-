// Web Worker - Omuzlayan Arka Plan İşçisi
// Ana thread (işlemci) dondurmadan ağır işlemleri yapar.

self.addEventListener('message', (e) => {
    const { type, payload } = e.data;

    // 1. Ağır Arama Motoru
    if (type === 'SEARCH') {
        const { query, objects } = payload;
        
        if (!query.trim()) {
            self.postMessage({ type: 'SEARCH_RESULTS', payload: [] });
            return;
        }

        const q = query.toLowerCase();
        
        // Tüm objeler üzerinde arama yap (Culling devredeyken bile her şeyi tarar)
        const results = objects
            .filter(obj => {
                if (obj.type === 'note' && obj.content && obj.content.toLowerCase().includes(q)) return true;
                if (obj.type === 'checklist' && obj.items && obj.items.some(i => i.text.toLowerCase().includes(q))) return true;
                return false;
            })
            .map(obj => {
                let text = obj.type === 'note' ? obj.content : (obj.items[0] ? obj.items[0].text : 'Liste');
                // HTML taglarını temizle
                text = text.replace(/<[^>]*>?/gm, '');
                
                return {
                    id: obj.id,
                    title: text.substring(0, 35) + (text.length > 35 ? '...' : ''),
                    type: obj.type,
                    x: obj.x,
                    y: obj.y
                };
            });
            
        self.postMessage({ type: 'SEARCH_RESULTS', payload: results });
    }
    
    // 2. Asenkron JSON Parsingleme / Stringify
    // Binlerce obje olduğunda JSON.stringify UI'yi kitleyebilir. Bunu worker'a devrettik.
    if (type === 'PREPARE_SAVE') {
        try {
            // Stringleştirme asenkron değildir ancak worker içinde olduğu için UI'yi (kamera kaymasını) kasmaz.
            const dataStr = JSON.stringify(payload);
            self.postMessage({ type: 'SAVE_READY', payload: dataStr });
        } catch (err) {
            self.postMessage({ type: 'SAVE_ERROR', payload: err.message });
        }
    }
});
