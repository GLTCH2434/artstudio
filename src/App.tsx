import { useCallback, useEffect, useRef, useState } from 'react';

type Layer = { id: string; name: string; visible: boolean; opacity: number; blend: GlobalCompositeOperation; dataUrl?: string };
type Tool = 'brush' | 'eraser';
type SavedProject = { version: 1; width: number; height: number; layers: Layer[]; savedAt: number };
const DB_NAME = 'artstudio-db';
const STORE = 'projects';
const PROJECT_KEY = 'current-project';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readProject(): Promise<SavedProject | undefined> {
  try { const db = await openDb(); return await new Promise((resolve, reject) => { const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(PROJECT_KEY); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); } catch { return undefined; }
}
async function writeProject(project: SavedProject): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(project, PROJECT_KEY); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}
const makeLayer = (n: number): Layer => ({ id: crypto.randomUUID(), name: `Layer ${n}`, visible: true, opacity: 1, blend: 'source-over' });

export default function App() {
  const [layers, setLayers] = useState<Layer[]>([makeLayer(1)]);
  const [activeId, setActiveId] = useState('');
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#25252b');
  const [size, setSize] = useState(12);
  const [opacity, setOpacity] = useState(1);
  const [stabilization, setStabilization] = useState(0.18);
  const [canvasSize, setCanvasSize] = useState({ width: 2048, height: 2048 });
  const [zoom, setZoom] = useState(100);
  const [status, setStatus] = useState('Ready');
  const [showLayers, setShowLayers] = useState(true);
  const [showBrush, setShowBrush] = useState(true);
  const [projectName, setProjectName] = useState('Untitled Artwork');
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const loadedDataRef = useRef<Record<string, string>>({});
  const stageRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef<{x:number;y:number}|null>(null);
  const smoothPoint = useRef<{x:number;y:number}|null>(null);
  const undoRef = useRef<Record<string, ImageData[]>>({});
  const redoRef = useRef<Record<string, ImageData[]>>({});
  const activeLayer = layers.find(layer => layer.id === activeId) ?? layers[layers.length - 1];

  useEffect(() => { if (!activeId && layers.length) setActiveId(layers[layers.length - 1].id); }, [activeId, layers]);

  const drawComposite = useCallback(() => {
    // The visible layer canvases are stacked in DOM order, so the browser composites them directly.
  }, []);

  const setupCanvas = useCallback((layer: Layer, canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const sameCanvasAndSize = canvasRefs.current[layer.id] === canvas && canvas.width === canvasSize.width && canvas.height === canvasSize.height;
    if (sameCanvasAndSize) {
      if (layer.dataUrl && loadedDataRef.current[layer.id] !== layer.dataUrl) { const image = new Image(); image.onload = () => canvas.getContext('2d')?.drawImage(image, 0, 0); image.src = layer.dataUrl; loadedDataRef.current[layer.id] = layer.dataUrl; }
      return;
    }
    canvasRefs.current[layer.id] = canvas;
    canvas.width = canvasSize.width; canvas.height = canvasSize.height;
    if (layer.dataUrl) { const image = new Image(); image.onload = () => canvas.getContext('2d')?.drawImage(image, 0, 0); image.src = layer.dataUrl; loadedDataRef.current[layer.id] = layer.dataUrl; }
  }, [canvasSize]);

  useEffect(() => {
    let cancelled = false;
    readProject().then(project => {
      if (cancelled || !project) return;
      setCanvasSize({ width: project.width, height: project.height });
      setLayers(project.layers.length ? project.layers : [makeLayer(1)]);
      setActiveId(project.layers.at(-1)?.id ?? '');
      setStatus('Recovered autosave');
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (announce = true) => {
    const serialized = layers.map(layer => ({ ...layer, dataUrl: canvasRefs.current[layer.id]?.toDataURL('image/png') ?? layer.dataUrl }));
    try {
      await writeProject({ version: 1, width: canvasSize.width, height: canvasSize.height, layers: serialized, savedAt: Date.now() });
      if (announce) { setStatus('Saved locally'); window.setTimeout(() => setStatus('Ready'), 1800); }
    } catch { setStatus('Could not autosave — export a backup'); }
  }, [layers, canvasSize]);

  useEffect(() => { const timer = window.setTimeout(() => { void save(false); }, 1200); return () => window.clearTimeout(timer); }, [layers, canvasSize, save]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvasSize.width / rect.width), y: (event.clientY - rect.top) * (canvasSize.height / rect.height), pressure: event.pressure || 0.5 };
  };
  const getContext = () => activeLayer ? canvasRefs.current[activeLayer.id]?.getContext('2d') : null;
  const beginStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeLayer || !activeLayer.visible) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const canvas = canvasRefs.current[activeLayer.id]; const ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    (undoRef.current[activeLayer.id] ??= []).push(snapshot); if (undoRef.current[activeLayer.id].length > 20) undoRef.current[activeLayer.id].shift();
    redoRef.current[activeLayer.id] = [];
    const p = pointFromEvent(event); isDrawing.current = true; lastPoint.current = {x:p.x,y:p.y}; smoothPoint.current = {x:p.x,y:p.y};
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = opacity; ctx.lineWidth = size * (event.pointerType === 'pen' ? Math.max(0.12, p.pressure) : 1);
    ctx.beginPath(); ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
  };
  const moveStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || !activeLayer) return;
    event.preventDefault(); const ctx = getContext(); if (!ctx || !lastPoint.current) return;
    const p = pointFromEvent(event); const previous = smoothPoint.current ?? lastPoint.current;
    const t = Math.max(0.05, 1 - stabilization);
    const smoothed = { x: previous.x + (p.x - previous.x) * t, y: previous.y + (p.y - previous.y) * t };
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'; ctx.strokeStyle = color; ctx.globalAlpha = opacity; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = size * (event.pointerType === 'pen' ? Math.max(0.12, p.pressure || 0.5) : 1);
    ctx.beginPath(); ctx.moveTo(lastPoint.current.x, lastPoint.current.y); ctx.lineTo(smoothed.x, smoothed.y); ctx.stroke();
    lastPoint.current = smoothed; smoothPoint.current = smoothed;
  };
  const endStroke = () => { if (!isDrawing.current) return; isDrawing.current = false; lastPoint.current = null; smoothPoint.current = null; void save(false); };

  const undo = () => { if (!activeLayer) return; const canvas = canvasRefs.current[activeLayer.id]; const ctx = canvas?.getContext('2d'); const stack = undoRef.current[activeLayer.id]; if (!canvas || !ctx || !stack?.length) return; (redoRef.current[activeLayer.id] ??= []).push(ctx.getImageData(0,0,canvas.width,canvas.height)); ctx.putImageData(stack.pop()!,0,0); void save(false); };
  const redo = () => { if (!activeLayer) return; const canvas = canvasRefs.current[activeLayer.id]; const ctx = canvas?.getContext('2d'); const stack = redoRef.current[activeLayer.id]; if (!canvas || !ctx || !stack?.length) return; (undoRef.current[activeLayer.id] ??= []).push(ctx.getImageData(0,0,canvas.width,canvas.height)); ctx.putImageData(stack.pop()!,0,0); void save(false); };
  const addLayer = () => { const layer = makeLayer(layers.length + 1); setLayers(prev => [...prev, layer]); setActiveId(layer.id); };
  const removeLayer = (id: string) => { if (layers.length < 2) { setStatus('Keep at least one layer'); return; } const next = layers.filter(layer => layer.id !== id); setLayers(next); if (activeId === id) setActiveId(next[next.length - 1].id); delete canvasRefs.current[id]; };
  const updateLayer = (id: string, patch: Partial<Layer>) => setLayers(prev => prev.map(layer => layer.id === id ? { ...layer, ...patch } : layer));
  const moveLayer = (id: string, direction: -1 | 1) => setLayers(prev => { const from = prev.findIndex(layer => layer.id === id); const to = from + direction; if (from < 0 || to < 0 || to >= prev.length) return prev; const next = [...prev]; [next[from], next[to]] = [next[to], next[from]]; return next; });

  const exportPng = () => {
    const out = document.createElement('canvas'); out.width = canvasSize.width; out.height = canvasSize.height; const ctx = out.getContext('2d'); if (!ctx) return;
    layers.forEach(layer => { const source = canvasRefs.current[layer.id]; if (source && layer.visible) { ctx.globalAlpha = layer.opacity; ctx.globalCompositeOperation = layer.blend; ctx.drawImage(source, 0, 0); } });
    const link = document.createElement('a'); link.download = `${projectName.trim().replace(/[^a-z0-9-_]+/gi, '-') || 'artwork'}.png`; link.href = out.toDataURL('image/png'); link.click(); setStatus('PNG exported');
  };
  const exportProject = async () => { const serialized = layers.map(layer => ({ ...layer, dataUrl: canvasRefs.current[layer.id]?.toDataURL('image/png') ?? layer.dataUrl })); const blob = new Blob([JSON.stringify({ format: 'artstudio-project', version: 1, width: canvasSize.width, height: canvasSize.height, layers: serialized }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${projectName.replace(/[^a-z0-9-_]+/gi, '-') || 'artwork'}.artstudio.json`; link.click(); URL.revokeObjectURL(url); setStatus('Project exported'); };
  const importProject = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const project = JSON.parse(String(reader.result)); if (project.format !== 'artstudio-project' || !Array.isArray(project.layers)) throw new Error('Unsupported project'); setCanvasSize({width: project.width, height: project.height}); setLayers(project.layers); setActiveId(project.layers.at(-1)?.id ?? ''); setProjectName(file.name.replace(/\.artstudio\.json$/i, '')); setStatus('Project imported'); } catch { setStatus('Invalid ArtStudio project file'); } }; reader.readAsText(file); };
  const clearLayer = () => { const canvas = activeLayer ? canvasRefs.current[activeLayer.id] : null; const ctx = canvas?.getContext('2d'); if (canvas && ctx && confirm('Clear the active layer?')) { ctx.clearRect(0,0,canvas.width,canvas.height); void save(false); } };
  const setPreset = (value: string) => { const [w,h] = value.split('x').map(Number); setCanvasSize({width:w,height:h}); setLayers(prev => prev.map(layer => ({...layer, dataUrl: undefined}))); canvasRefs.current = {}; setStatus(`New ${w} × ${h} canvas`); };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">✦</div><div><strong>ArtStudio</strong><small>DRAWING WORKSPACE</small></div></div>
      <input className="project-title" aria-label="Project name" value={projectName} onChange={e => setProjectName(e.target.value)} />
      <div className="top-actions"><button onClick={undo} title="Undo">↶ <span>Undo</span></button><button onClick={redo} title="Redo">↷ <span>Redo</span></button><button className="save-button" onClick={() => void save()}>Save</button><button className="primary-button" onClick={exportPng}>Export PNG</button><button className="icon-button" title="Export editable project" onClick={() => void exportProject()}>⇩</button><label className="icon-button import-button" title="Import editable project">⇧<input type="file" accept=".json,.artstudio.json,application/json" onChange={e => importProject(e.target.files?.[0])} /></label></div>
    </header>
    <div className="workspace">
      <aside className={`brush-panel ${showBrush ? '' : 'collapsed'}`}>
        <button className="panel-heading" onClick={() => setShowBrush(!showBrush)}><span>TOOLS & BRUSH</span><b>{showBrush ? '−' : '+'}</b></button>
        {showBrush && <>
          <div className="tool-grid"><button className={tool === 'brush' ? 'tool active' : 'tool'} onClick={() => setTool('brush')}><span>✎</span>Brush</button><button className={tool === 'eraser' ? 'tool active' : 'tool'} onClick={() => setTool('eraser')}><span>⌫</span>Eraser</button></div>
          <div className="control-block"><div className="label-row"><label htmlFor="brush-size">Size</label><output>{size}px</output></div><input id="brush-size" type="range" min="1" max="180" value={size} onChange={e => setSize(Number(e.target.value))} /></div>
          <div className="control-block"><div className="label-row"><label htmlFor="brush-opacity">Opacity</label><output>{Math.round(opacity*100)}%</output></div><input id="brush-opacity" type="range" min="0.05" max="1" step="0.05" value={opacity} onChange={e => setOpacity(Number(e.target.value))} /></div>
          <div className="control-block"><div className="label-row"><label htmlFor="stabilizer">Stabilization</label><output>{Math.round(stabilization*100)}%</output></div><input id="stabilizer" type="range" min="0" max="0.8" step="0.02" value={stabilization} onChange={e => setStabilization(Number(e.target.value))} /></div>
          <div className="control-block color-block"><label htmlFor="brush-color">Color</label><div className="color-picker-wrap"><input id="brush-color" type="color" value={color} onChange={e => setColor(e.target.value)} /><code>{color.toUpperCase()}</code></div><div className="swatches">{['#25252b','#ffffff','#ff5d73','#ffb347','#ffe66d','#53d6a5','#55b8ff','#8d78ff','#d88cff','#8b5e3c'].map(c => <button key={c} aria-label={`Set color ${c}`} style={{background:c}} onClick={() => setColor(c)} />)}</div></div>
          <div className="control-block"><label htmlFor="canvas-preset">Canvas size</label><select id="canvas-preset" value={`${canvasSize.width}x${canvasSize.height}`} onChange={e => setPreset(e.target.value)}><option value="1024x1024">1024 × 1024</option><option value="2048x2048">2048 × 2048</option><option value="4096x4096">4096 × 4096</option><option value="8192x8192">8192 × 8192 (memory intensive)</option><option value="1920x1080">1920 × 1080</option><option value="1080x1920">1080 × 1920</option></select><p className="hint">Canvas dimensions: {canvasSize.width} × {canvasSize.height}px</p></div>
          <button className="secondary full-width" onClick={clearLayer}>Clear active layer</button>
        </>}
      </aside>
      <main className="canvas-area">
        <div className="canvas-toolbar"><div className="breadcrumbs"><span>Gallery</span><i>/</i><strong>{projectName || 'Untitled Artwork'}</strong></div><div className="canvas-actions"><button onClick={() => setZoom(z => Math.max(10,z-10))}>−</button><span>{zoom}%</span><button onClick={() => setZoom(z => Math.min(200,z+10))}>+</button><button onClick={() => setZoom(100)}>Fit</button></div></div>
        <div className="canvas-viewport" ref={stageRef}><div className="canvas-stack" style={{width:`${zoom}%`, aspectRatio:`${canvasSize.width}/${canvasSize.height}`, maxWidth: zoom <= 100 ? '100%' : 'none', maxHeight: zoom <= 100 ? '100%' : 'none'}}>
          {layers.map(layer => <canvas key={layer.id} ref={canvas => setupCanvas(layer, canvas)} className={`paint-layer ${layer.visible ? '' : 'hidden-layer'} ${activeId === layer.id ? 'active-paint-layer' : ''}`} style={{opacity:layer.opacity,mixBlendMode:layer.blend === 'source-over' ? 'normal' : layer.blend as any,pointerEvents:activeId === layer.id && layer.visible ? 'auto' : 'none'}} onPointerDown={beginStroke} onPointerMove={moveStroke} onPointerUp={endStroke} onPointerCancel={endStroke} />)}
        </div></div>
        <footer className="statusbar"><span><i className="status-dot" />{status}</span><span>{canvasSize.width} × {canvasSize.height}px</span><span>{layers.length} layer{layers.length===1?'':'s'}</span><span className="status-note">Local-first · Works offline after first load</span></footer>
      </main>
      <aside className={`layers-panel ${showLayers ? '' : 'collapsed'}`}><div className="layers-heading"><button className="panel-heading" onClick={() => setShowLayers(!showLayers)}><span>LAYERS</span><b>{showLayers ? '−' : '+'}</b></button>{showLayers && <button className="add-layer" onClick={addLayer} title="Add layer">＋</button>}</div>
        {showLayers && <><div className="layer-list">{[...layers].reverse().map(layer => <div key={layer.id} className={`layer-row ${activeId===layer.id?'selected':''}`} onClick={() => setActiveId(layer.id)}><button className={`visibility ${layer.visible?'':'muted'}`} aria-label="Toggle layer visibility" onClick={e => {e.stopPropagation();updateLayer(layer.id,{visible:!layer.visible});}}>◉</button><div className="layer-thumb"><span>▧</span></div><div className="layer-meta"><input aria-label="Layer name" value={layer.name} onClick={e=>e.stopPropagation()} onChange={e=>updateLayer(layer.id,{name:e.target.value})}/><small>{Math.round(layer.opacity*100)}% · {layer.blend==='source-over'?'Normal':layer.blend}</small></div><button className="layer-menu" title="Move layer up" onClick={e=>{e.stopPropagation();moveLayer(layer.id,1)}}>⋮</button></div>)}</div>
          <div className="layer-options"><label>Opacity <output>{Math.round((activeLayer?.opacity ?? 1)*100)}%</output></label><input type="range" min="0" max="1" step="0.05" value={activeLayer?.opacity ?? 1} onChange={e=>activeLayer&&updateLayer(activeLayer.id,{opacity:Number(e.target.value)})}/><label>Blend mode</label><select value={activeLayer?.blend ?? 'source-over'} onChange={e=>activeLayer&&updateLayer(activeLayer.id,{blend:e.target.value as GlobalCompositeOperation})}><option value="source-over">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="darken">Darken</option><option value="lighten">Lighten</option><option value="difference">Difference</option></select><div className="layer-buttons"><button className="secondary" onClick={() => activeLayer && moveLayer(activeLayer.id,-1)}>↓ Lower</button><button className="secondary" onClick={() => activeLayer && moveLayer(activeLayer.id,1)}>↑ Raise</button><button className="danger" onClick={() => activeLayer && removeLayer(activeLayer.id)}>Delete</button></div></div></>}
      </aside>
    </div>
    <div className="mobile-bottom"><button onClick={()=>setShowBrush(v=>!v)}>✎ Tools</button><button onClick={()=>setShowLayers(v=>!v)}>▤ Layers</button><button onClick={undo}>↶ Undo</button><button onClick={exportPng}>⇩ Export</button></div>
    <div className="toast" aria-live="polite">{status !== 'Ready' ? status : ''}</div>
  </div>;
}
