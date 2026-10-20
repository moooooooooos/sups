/**
 * SUPS Official — CAD Studio & 3D Ring Customizer Engine V2
 * Full 2D Unwrap Workbench, Precise Millimeter Rulers, Rich Typography Engine,
 * Multi-layer Stack, Symbol Library & Realtime 3D Three.js Viewport
 */

(function () {
  'use strict';

  // --- CATALOG CONFIGURATION ---
  const ringModels = {
    ring_flat_6:    { id: 'ring_flat_6', name: 'Кольцо Плоское (6 мм)', widthMm: 6.0, basePrice: 8500 },
    ring_classic_4: { id: 'ring_classic_4', name: 'Кольцо Классическое (4 мм)', widthMm: 4.0, basePrice: 7900 },
    ring_wide_8:    { id: 'ring_wide_8', name: 'Кольцо Широкое (8 мм)', widthMm: 8.0, basePrice: 9200 }
  };

  const metalTypes = {
    silver: { color: 0xefefef, bgHex: '#ebebee', engColor: '#111111', metalness: 0.65, roughness: 0.32, name: 'Медицинская сталь (серебро)' },
    gold:   { color: 0xffd700, bgHex: '#ebebee', engColor: '#111111', metalness: 0.65, roughness: 0.32, name: 'Золотое покрытие 18K' },
    rose:   { color: 0xe0a899, bgHex: '#ebebee', engColor: '#111111', metalness: 0.65, roughness: 0.32, name: 'Розовое золото' },
    black:  { color: 0x1a1a1a, bgHex: '#222226', engColor: '#ffffff', metalness: 0.55, roughness: 0.42, name: 'Черный PVD' }
  };

  // --- STATE ---
  const state = {
    model: ringModels.ring_flat_6,
    metal: 'silver',
    size: '16.5',
    side: 'out', // 'out' (лицевая) or 'in' (внутренняя)
    removeWatermark: false, // +500 ₽ if true
    activeTool: 'select', // 'select', 'pan', 'text'
    snapGrid: true,

    // Canvas view transform (Pan & Zoom)
    viewZoom: 1.0,
    panX: 0,
    panY: 0,

    // Layers: Outer and Inner
    layers: {
      out: [
        {
          id: 'layer_1',
          type: 'text',
          name: 'Текст 1',
          text: 'SUPS STEEL',
          fontFamily: 'Montserrat',
          fontSize: 8,
          fontWeight: '700',
          fontStyle: 'normal',
          textTransform: 'none',
          textAlign: 'center',
          letterSpacing: 1,
          lineHeight: 1.2,
          arc: false,
          arcRadius: 60,
          stroke: false,
          strokeWidth: 2,
          x: 0,
          y: 0,
          rotation: 0,
          scale: 1.0,
          visible: true,
          locked: false
        }
      ],
      in: []
    },

    selectedLayerId: 'layer_1',
    history: [],
    historyIndex: -1
  };

  // Pixels per millimeter on the CAD canvas at 100% zoom
  const MM_TO_PX = 8.0;

  // Global references
  let editorCanvas, editorCtx;
  let rulerTop, rulerLeft;
  let threeScene, threeCamera, threeRenderer, threeControls, threeRingGroup;
  let outerTexCanvas, outerTexCtx, outerCanvasTexture;
  let innerTexCanvas, innerTexCtx, innerCanvasTexture;

  // Interaction tracking
  let isDraggingLayer = false;
  let isPanningCanvas = false;
  let isRotatingLayer = false;
  let isScalingLayer = false;
  let dragStartPos = { x: 0, y: 0 };
  let layerStartProps = {};

  // --- SYMBOLS LIBRARY ---
  const symbolLibrary = [
    '♥', '♡', '💖', '❦', '∞', '★', '✦', '✧', '☾', '☀', '🪐',
    '💎', '⬡', '◊', '❖', '✝', '☥', '✞', '👑', '⚡', '⛰', '〰',
    '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓',
    'ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ', 'ᛁ', 'ᛃ',
    'ᛇ', 'ᛈ', 'ᛉ', 'ᛋ', 'ᛏ', 'ᛒ', 'ᛖ', 'ᛗ', 'ᛚ', 'ᛜ', 'ᛞ', 'ᛟ',
    '○', '△', '□', '✕', '⊕', '☯', '☘', '✿', '🕊', '🐺', '🦅', '🦁'
  ];

  // =========================================================================
  // RESPONSIVE WIREFRAME LAYOUT SYNC (Mobile vs Desktop)
  // =========================================================================
  function syncResponsiveLayout() {
    const isMobile = window.innerWidth <= 980;
    const box3d = document.getElementById('cad-3d-box');
    const canvasViewport = document.getElementById('cad-canvas-viewport');
    const rightSidebar = document.querySelector('.cad-right-sidebar');
    const bottomBar = document.querySelector('.cad-canvas-bottom-bar');
    const canvasArea = document.querySelector('.cad-canvas-area');
    const layersCol = document.querySelector('.cad-layers-column');
    const workspaceGrid = document.querySelector('.cad-workspace-grid');

    if (isMobile) {
      // 1. Move 3D box into canvas viewport (top-right corner thumbnail)
      if (box3d && canvasViewport && box3d.parentElement !== canvasViewport) {
        canvasViewport.appendChild(box3d);
      }
      // 2. Move canvas-bottom-bar right after canvas-area (before layers column)
      if (bottomBar && workspaceGrid && layersCol && bottomBar.parentElement !== workspaceGrid) {
        workspaceGrid.insertBefore(bottomBar, layersCol);
      }
    } else {
      // Desktop: Restore original hierarchy
      if (box3d && rightSidebar && box3d.parentElement !== rightSidebar) {
        rightSidebar.insertBefore(box3d, rightSidebar.firstChild);
        box3d.classList.remove('fullscreen-mobile');
      }
      if (bottomBar && canvasArea && bottomBar.parentElement !== canvasArea) {
        canvasArea.appendChild(bottomBar);
      }
    }

    setTimeout(() => {
      onThreeResize();
      resize2DCanvas();
      redrawCanvas();
    }, 60);
  }

  // =========================================================================
  // INITIALIZATION
  // =========================================================================
  function init() {
    setup2DEditor();
    setup3DViewport();
    setupRulers();
    bindEvents();
    renderLayersList();
    syncInspectorWithSelectedLayer();
    updatePrice();
    saveHistoryState();
    syncResponsiveLayout();
    window.addEventListener('resize', syncResponsiveLayout);

    // Initial draw
    redrawCanvas();
    update3DTextures();
  }

  // =========================================================================
  // 2D CAD CANVAS ENGINE
  // =========================================================================
  function setup2DEditor() {
    editorCanvas = document.getElementById('cad-editor-canvas');
    if (!editorCanvas) return;
    editorCtx = editorCanvas.getContext('2d');
    resize2DCanvas();
    window.addEventListener('resize', () => {
      resize2DCanvas();
      redrawCanvas();
    });

    // Setup mouse/touch interactions on canvas
    editorCanvas.addEventListener('pointerdown', onCanvasPointerDown);
    editorCanvas.addEventListener('pointermove', onCanvasPointerMove);
    window.addEventListener('pointerup', onCanvasPointerUp);
    editorCanvas.addEventListener('wheel', onCanvasWheel, { passive: false });
    editorCanvas.addEventListener('dblclick', onCanvasDblClick);
  }

  function resize2DCanvas() {
    const viewport = document.getElementById('cad-canvas-viewport');
    if (!viewport || !editorCanvas) return;
    const rect = viewport.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    editorCanvas.width = rect.width * dpr;
    editorCanvas.height = rect.height * dpr;
    editorCanvas.style.width = rect.width + 'px';
    editorCanvas.style.height = rect.height + 'px';

    if (editorCtx) {
      editorCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    updateRulers();
  }

  // Calculate ring flat workpiece dimensions (Circumference x Width in pixels)
  function getWorkpieceDimensions() {
    const sizeNum = parseFloat(state.size) || 16.5;
    const circumferenceMm = Math.PI * sizeNum;
    const widthMm = state.model.widthMm;

    return {
      wMm: circumferenceMm,
      hMm: widthMm,
      wPx: circumferenceMm * MM_TO_PX,
      hPx: widthMm * MM_TO_PX
    };
  }

  function redrawCanvas() {
    if (!editorCtx || !editorCanvas) return;
    const w = editorCanvas.clientWidth;
    const h = editorCanvas.clientHeight;

    editorCtx.save();
    editorCtx.clearRect(0, 0, w, h);

    // Dark technical workbench background
    editorCtx.fillStyle = '#1c1c21';
    editorCtx.fillRect(0, 0, w, h);

    // Apply Viewport Pan & Zoom
    editorCtx.translate(w / 2 + state.panX, h / 2 + state.panY);
    editorCtx.scale(state.viewZoom, state.viewZoom);

    // 1. Draw Millimeter CAD Grid
    drawCADGrid(editorCtx, w, h);

    // 2. Draw Ring Workpiece Band
    const wp = getWorkpieceDimensions();
    const wpX = -wp.wPx / 2;
    const wpY = -wp.hPx / 2;

    // Outer workpiece band
    const metalCfg = metalTypes[state.metal];
    editorCtx.fillStyle = state.metal === 'black' ? '#27272c' : '#ffffff';
    editorCtx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    editorCtx.shadowBlur = 20;
    editorCtx.shadowOffsetY = 4;
    editorCtx.fillRect(wpX, wpY, wp.wPx, wp.hPx);
    editorCtx.shadowColor = 'transparent';

    // Workpiece border & inner safe-margin
    editorCtx.strokeStyle = '#0066ff';
    editorCtx.lineWidth = 1.5 / state.viewZoom;
    editorCtx.strokeRect(wpX, wpY, wp.wPx, wp.hPx);

    // Safe engraving inner boundary (dashed)
    const margin = 0.5 * MM_TO_PX;
    editorCtx.strokeStyle = 'rgba(0, 102, 255, 0.35)';
    editorCtx.setLineDash([4 / state.viewZoom, 4 / state.viewZoom]);
    editorCtx.strokeRect(wpX + margin, wpY + margin, wp.wPx - margin * 2, wp.hPx - margin * 2);
    editorCtx.setLineDash([]);

    // Central crosshairs
    editorCtx.strokeStyle = 'rgba(0, 102, 255, 0.2)';
    editorCtx.lineWidth = 1 / state.viewZoom;
    editorCtx.beginPath();
    editorCtx.moveTo(-wp.wPx / 2, 0);
    editorCtx.lineTo(wp.wPx / 2, 0);
    editorCtx.moveTo(0, -wp.hPx / 2);
    editorCtx.lineTo(0, wp.hPx / 2);
    editorCtx.stroke();

    // 3. Draw Watermark Stamp on Inner side if applicable
    if (state.side === 'in' && !state.removeWatermark) {
      drawWatermarkOn2D(editorCtx, 0, 0);
    }

    // 4. Draw Active Layers for current side
    const currentLayers = state.layers[state.side];
    currentLayers.forEach((layer) => {
      if (!layer.visible) return;
      drawLayer(editorCtx, layer, layer.id === state.selectedLayerId);
    });

    editorCtx.restore();

    // Sync Rulers
    updateRulers();
  }

  function drawCADGrid(ctx, screenW, screenH) {
    const stepMm = 10 * MM_TO_PX; // 10mm major lines
    const minStepMm = 2 * MM_TO_PX; // 2mm minor lines

    const extent = 1600;
    ctx.lineWidth = 1 / state.viewZoom;

    // Minor grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.beginPath();
    for (let x = -extent; x <= extent; x += minStepMm) {
      ctx.moveTo(x, -extent);
      ctx.lineTo(x, extent);
    }
    for (let y = -extent; y <= extent; y += minStepMm) {
      ctx.moveTo(-extent, y);
      ctx.lineTo(extent, y);
    }
    ctx.stroke();

    // Major grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    for (let x = -extent; x <= extent; x += stepMm) {
      ctx.moveTo(x, -extent);
      ctx.lineTo(x, extent);
    }
    for (let y = -extent; y <= extent; y += stepMm) {
      ctx.moveTo(-extent, y);
      ctx.lineTo(extent, y);
    }
    ctx.stroke();
  }

  function drawWatermarkOn2D(ctx, cx, cy) {
    const wp = getWorkpieceDimensions();
    ctx.save();
    ctx.font = '600 9px Jost, sans-serif';
    ctx.fillStyle = state.metal === 'black' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Draw on opposite ends (180° opposite to center front)
    ctx.fillText('💎 САПС | Уникальность в деталях', -wp.wPx / 2 + 75, 0);
    ctx.fillText('💎 САПС | Уникальность в деталях', wp.wPx / 2 - 75, 0);
    ctx.restore();
  }

  function drawLayer(ctx, layer, isSelected) {
    ctx.save();
    ctx.translate(layer.x, layer.y);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.scale(layer.scale, layer.scale);

    const engColor = state.metal === 'black' ? '#ffffff' : '#111111';

    if (layer.type === 'text') {
      // Setup Font
      const style = layer.fontStyle === 'italic' ? 'italic' : 'normal';
      let weight = layer.fontWeight || '400';
      const size = layer.fontSize;
      ctx.font = `${style} ${weight} ${size}px "${layer.fontFamily}", sans-serif`;
      ctx.textAlign = layer.textAlign || 'center';
      ctx.textBaseline = 'middle';

      let renderText = layer.text;
      if (layer.textTransform === 'uppercase') renderText = renderText.toUpperCase();

      ctx.fillStyle = engColor;
      ctx.strokeStyle = engColor;

      if (layer.arc) {
        drawTextOnArc(ctx, renderText, layer.arcRadius, layer.letterSpacing, layer.stroke, layer.strokeWidth);
      } else {
        // Draw with custom letter spacing if needed
        if (layer.letterSpacing && layer.letterSpacing !== 0) {
          drawTextWithSpacing(ctx, renderText, layer.letterSpacing, layer.stroke, layer.strokeWidth);
        } else {
          if (layer.stroke) {
            ctx.lineWidth = layer.strokeWidth;
            ctx.strokeText(renderText, 0, 0);
          } else {
            ctx.fillText(renderText, 0, 0);
          }
        }
      }
    } else if (layer.type === 'image' && layer.img) {
      const iw = layer.img.width;
      const ih = layer.img.height;
      const maxDim = 60;
      const scaleFactor = maxDim / Math.max(iw, ih);
      const dw = iw * scaleFactor;
      const dh = ih * scaleFactor;

      ctx.save();
      if (layer.flip) ctx.scale(-1, 1);
      ctx.drawImage(layer.img, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }

    // Draw Selection Bounding Box & Handles if layer is selected
    if (isSelected) {
      drawSelectionBox(ctx, layer);
    }

    ctx.restore();
  }

  function drawTextWithSpacing(ctx, text, spacing, stroke, strokeWidth) {
    const chars = text.split('');
    let totalWidth = 0;
    const widths = chars.map((ch) => {
      const w = ctx.measureText(ch).width;
      totalWidth += w + spacing;
      return w;
    });
    totalWidth -= spacing;

    let curX = -totalWidth / 2;
    chars.forEach((ch, i) => {
      if (stroke) {
        ctx.lineWidth = strokeWidth;
        ctx.strokeText(ch, curX + widths[i] / 2, 0);
      } else {
        ctx.fillText(ch, curX + widths[i] / 2, 0);
      }
      curX += widths[i] + spacing;
    });
  }

  function drawTextOnArc(ctx, text, radius, spacing, stroke, strokeWidth) {
    const chars = text.split('');
    const charAngles = [];
    let totalAngle = 0;

    chars.forEach((ch) => {
      const w = ctx.measureText(ch).width + spacing;
      const angle = w / radius;
      charAngles.push(angle);
      totalAngle += angle;
    });

    let currentAngle = -totalAngle / 2;
    chars.forEach((ch, i) => {
      const midAngle = currentAngle + charAngles[i] / 2;
      ctx.save();
      ctx.translate(Math.sin(midAngle) * radius, -Math.cos(midAngle) * radius + radius);
      ctx.rotate(midAngle);
      if (stroke) {
        ctx.lineWidth = strokeWidth;
        ctx.strokeText(ch, 0, 0);
      } else {
        ctx.fillText(ch, 0, 0);
      }
      ctx.restore();
      currentAngle += charAngles[i];
    });
  }

  function getLayerBounds(layer) {
    if (layer.type === 'text') {
      editorCtx.save();
      editorCtx.font = `${layer.fontWeight || '400'} ${layer.fontSize}px "${layer.fontFamily}", sans-serif`;
      const m = editorCtx.measureText(layer.text);
      editorCtx.restore();
      const w = m.width + Math.max(0, (layer.text.length - 1) * (layer.letterSpacing || 0)) + 12;
      const h = layer.fontSize * 1.3;
      return { w, h };
    } else {
      return { w: 60, h: 60 };
    }
  }

  function drawSelectionBox(ctx, layer) {
    const bounds = getLayerBounds(layer);
    const hw = bounds.w / 2;
    const hh = bounds.h / 2;

    ctx.save();
    ctx.strokeStyle = '#0066ff';
    ctx.lineWidth = 1.5 / state.viewZoom;
    ctx.setLineDash([3 / state.viewZoom, 3 / state.viewZoom]);
    ctx.strokeRect(-hw, -hh, bounds.w, bounds.h);
    ctx.setLineDash([]);

    // Top Rotation Handle with stem
    const handleSize = 6 / state.viewZoom;
    const rotDist = 18 / state.viewZoom;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0066ff';
    ctx.lineWidth = 1.5 / state.viewZoom;

    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(0, -hh - rotDist);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -hh - rotDist, handleSize / 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  // =========================================================================
  // MILLIMETER RULERS
  // =========================================================================
  function setupRulers() {
    rulerTop = document.getElementById('cad-ruler-top');
    rulerLeft = document.getElementById('cad-ruler-left');
    updateRulers();
  }

  function updateRulers() {
    if (!rulerTop || !rulerLeft || !editorCanvas) return;
    const w = editorCanvas.clientWidth;
    const h = editorCanvas.clientHeight;

    const zeroX = w / 2 + state.panX;
    const zeroY = h / 2 + state.panY;
    const pxPerMm = MM_TO_PX * state.viewZoom;

    // Top horizontal ruler
    let topSvg = '';
    const startMmX = Math.floor(-zeroX / pxPerMm);
    const endMmX = Math.ceil((w - zeroX) / pxPerMm);

    for (let mm = startMmX; mm <= endMmX; mm++) {
      const x = zeroX + mm * pxPerMm;
      if (mm % 10 === 0) {
        topSvg += `<line x1="${x}" y1="12" x2="${x}" y2="24" stroke="#888" stroke-width="1"/>`;
        topSvg += `<text x="${x + 2}" y="10" fill="#8e8e93" font-size="9" font-family="monospace">${mm}</text>`;
      } else if (mm % 5 === 0) {
        topSvg += `<line x1="${x}" y1="16" x2="${x}" y2="24" stroke="#555" stroke-width="1"/>`;
      } else if (pxPerMm > 4) {
        topSvg += `<line x1="${x}" y1="20" x2="${x}" y2="24" stroke="#333" stroke-width="0.8"/>`;
      }
    }
    rulerTop.innerHTML = topSvg;

    // Left vertical ruler
    let leftSvg = '';
    const startMmY = Math.floor(-zeroY / pxPerMm);
    const endMmY = Math.ceil((h - zeroY) / pxPerMm);

    for (let mm = startMmY; mm <= endMmY; mm++) {
      const y = zeroY + mm * pxPerMm;
      if (mm % 10 === 0) {
        leftSvg += `<line x1="16" y1="${y}" x2="32" y2="${y}" stroke="#888" stroke-width="1"/>`;
        leftSvg += `<text x="2" y="${y - 2}" fill="#8e8e93" font-size="9" font-family="monospace">${-mm}</text>`;
      } else if (mm % 5 === 0) {
        leftSvg += `<line x1="22" y1="${y}" x2="32" y2="${y}" stroke="#555" stroke-width="1"/>`;
      } else if (pxPerMm > 4) {
        leftSvg += `<line x1="26" y1="${y}" x2="32" y2="${y}" stroke="#333" stroke-width="0.8"/>`;
      }
    }
    rulerLeft.innerHTML = leftSvg;
  }

  // =========================================================================
  // CANVAS POINTER INTERACTIONS (Select, Move, Rotate, Zoom)
  // =========================================================================
  function getCanvasLocalPoint(e) {
    const rect = editorCanvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const w = editorCanvas.clientWidth;
    const h = editorCanvas.clientHeight;

    // Inverse transform
    const x = (clientX - (w / 2 + state.panX)) / state.viewZoom;
    const y = (clientY - (h / 2 + state.panY)) / state.viewZoom;

    return { x, y, clientX, clientY };
  }

  function hitTestLayer(layer, pt) {
    // Transform point to layer's local space
    const rad = (-layer.rotation * Math.PI) / 180;
    const dx = pt.x - layer.x;
    const dy = pt.y - layer.y;
    const lx = (dx * Math.cos(rad) - dy * Math.sin(rad)) / layer.scale;
    const ly = (dx * Math.sin(rad) + dy * Math.cos(rad)) / layer.scale;

    const bounds = getLayerBounds(layer);
    const hw = bounds.w / 2;
    const hh = bounds.h / 2;

    // Check rotation handle
    const rotDist = 20 / state.viewZoom;
    const handleRadius = 10 / state.viewZoom;
    if (Math.hypot(lx - 0, ly - (-hh - rotDist)) <= handleRadius) {
      return 'rotate';
    }

    // Check inside bounds
    if (lx >= -hw && lx <= hw && ly >= -hh && ly <= hh) {
      return 'move';
    }

    return null;
  }

  function onCanvasPointerDown(e) {
    if (state.activeTool === 'pan' || e.button === 1 || e.spaceKey) {
      isPanningCanvas = true;
      dragStartPos = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      document.getElementById('cad-canvas-viewport').classList.add('panning');
      return;
    }

    const pt = getCanvasLocalPoint(e);
    const currentLayers = state.layers[state.side];

    // Check currently selected layer first for rotation or move
    const activeLayer = currentLayers.find((l) => l.id === state.selectedLayerId);
    if (activeLayer) {
      const hit = hitTestLayer(activeLayer, pt);
      if (hit === 'rotate') {
        isRotatingLayer = true;
        dragStartPos = { x: pt.x, y: pt.y };
        layerStartProps = { rotation: activeLayer.rotation, x: activeLayer.x, y: activeLayer.y };
        return;
      } else if (hit === 'move') {
        isDraggingLayer = true;
        dragStartPos = { x: pt.x, y: pt.y };
        layerStartProps = { x: activeLayer.x, y: activeLayer.y };
        return;
      }
    }

    // Otherwise test all layers in reverse order (top to bottom)
    let foundLayer = null;
    for (let i = currentLayers.length - 1; i >= 0; i--) {
      const l = currentLayers[i];
      if (!l.visible || l.locked) continue;
      if (hitTestLayer(l, pt)) {
        foundLayer = l;
        break;
      }
    }

    if (foundLayer) {
      selectLayer(foundLayer.id);
      isDraggingLayer = true;
      dragStartPos = { x: pt.x, y: pt.y };
      layerStartProps = { x: foundLayer.x, y: foundLayer.y };
    } else {
      // Start panning if clicked on empty background
      isPanningCanvas = true;
      dragStartPos = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      document.getElementById('cad-canvas-viewport').classList.add('panning');
    }
  }

  function onCanvasPointerMove(e) {
    if (isPanningCanvas) {
      state.panX = e.clientX - dragStartPos.x;
      state.panY = e.clientY - dragStartPos.y;
      redrawCanvas();
      return;
    }

    const pt = getCanvasLocalPoint(e);
    const activeLayer = state.layers[state.side].find((l) => l.id === state.selectedLayerId);
    if (!activeLayer) return;

    if (isDraggingLayer) {
      let newX = layerStartProps.x + (pt.x - dragStartPos.x);
      let newY = layerStartProps.y + (pt.y - dragStartPos.y);

      // Snap to Center Guidelines if enabled
      if (state.snapGrid) {
        if (Math.abs(newX) < 4) newX = 0;
        if (Math.abs(newY) < 4) newY = 0;
      }

      activeLayer.x = Math.round(newX);
      activeLayer.y = Math.round(newY);

      redrawCanvas();
      update3DTextures();
    } else if (isRotatingLayer) {
      const angleRad = Math.atan2(pt.y - activeLayer.y, pt.x - activeLayer.x);
      let angleDeg = Math.round((angleRad * 180) / Math.PI + 90);
      if (angleDeg < 0) angleDeg += 360;

      activeLayer.rotation = angleDeg;
      const rotSlider = document.getElementById('slider-rotation');
      const rotVal = document.getElementById('val-rotation');
      if (rotSlider) rotSlider.value = angleDeg;
      if (rotVal) rotVal.textContent = angleDeg + '°';

      redrawCanvas();
      update3DTextures();
    }
  }

  function onCanvasPointerUp() {
    if (isDraggingLayer || isRotatingLayer) {
      saveHistoryState();
    }
    isDraggingLayer = false;
    isRotatingLayer = false;
    isPanningCanvas = false;
    const vp = document.getElementById('cad-canvas-viewport');
    if (vp) vp.classList.remove('panning');
  }

  function onCanvasWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(Math.max(state.viewZoom * zoomFactor, 0.4), 3.0);

    state.viewZoom = newZoom;
    document.querySelectorAll('.cad-zoom-btn').forEach((btn) => {
      btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.zoom) - newZoom) < 0.1);
    });

    redrawCanvas();
  }

  function onCanvasDblClick(e) {
    const pt = getCanvasLocalPoint(e);
    const currentLayers = state.layers[state.side];

    for (let i = currentLayers.length - 1; i >= 0; i--) {
      const l = currentLayers[i];
      if (!l.visible || l.locked) continue;
      if (hitTestLayer(l, pt)) {
        selectLayer(l.id);
        if (l.type === 'text') {
          const txtInput = document.getElementById('cad-text-input');
          if (txtInput) {
            txtInput.focus();
            txtInput.select();
            txtInput.style.borderColor = '#0066ff';
            txtInput.style.boxShadow = '0 0 0 3px rgba(0, 102, 255, 0.25)';
            setTimeout(() => {
              txtInput.style.borderColor = '';
              txtInput.style.boxShadow = '';
            }, 800);
          }
        }
        break;
      }
    }
  }

  // =========================================================================
  // 3D THREE.JS RING VIEWPORT
  // =========================================================================
  function setup3DViewport() {
    const holder = document.getElementById('cad-three-viewport');
    if (!holder) return;

    // Create 4K Offscreen Texture Canvases (4096 x 1024)
    outerTexCanvas = document.createElement('canvas');
    outerTexCanvas.width = 4096;
    outerTexCanvas.height = 1024;
    outerTexCtx = outerTexCanvas.getContext('2d');

    innerTexCanvas = document.createElement('canvas');
    innerTexCanvas.width = 4096;
    innerTexCanvas.height = 1024;
    innerTexCtx = innerTexCanvas.getContext('2d');

    // 1. Scene
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x111113);
    threeRingGroup = new THREE.Group();
    threeScene.add(threeRingGroup);

    // 2. Camera
    const w = holder.clientWidth || 380;
    const h = holder.clientHeight || 270;
    threeCamera = new THREE.PerspectiveCamera(38, w / h, 0.1, 1000);
    threeCamera.position.set(0, 8, 34);

    // 3. Renderer
    threeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    threeRenderer.setSize(w, h);
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    threeRenderer.toneMappingExposure = 1.0;
    holder.appendChild(threeRenderer.domElement);

    // 4. Studio Lighting
    threeScene.add(new THREE.AmbientLight(0xffffff, 1.2));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(20, 30, 25);
    threeScene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.7);
    rimLight.position.set(-20, -15, -20);
    threeScene.add(rimLight);

    const topSoftLight = new THREE.DirectionalLight(0xffffff, 0.8);
    topSoftLight.position.set(0, 30, 0);
    threeScene.add(topSoftLight);

    // 5. Controls
    threeControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
    threeControls.enableDamping = true;
    threeControls.dampingFactor = 0.05;
    threeControls.minDistance = 15;
    threeControls.maxDistance = 60;
    threeControls.target.set(0, 0, 0);

    // 6. Build Geometry
    rebuild3DRingMesh();

    // 7. Render Loop
    let clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      threeRingGroup.position.y = Math.sin(elapsed * 1.5) * 0.12;

      // Gentle auto-rotation when thumbnail is in canvas on mobile
      const box = document.getElementById('cad-3d-box');
      if (window.innerWidth <= 980 && box && !box.classList.contains('fullscreen-mobile')) {
        threeRingGroup.rotation.y += 0.005;
      }

      threeControls.update();
      threeRenderer.render(threeScene, threeCamera);
    }
    animate();

    window.addEventListener('resize', onThreeResize);
  }

  function onThreeResize() {
    const holder = document.getElementById('cad-three-viewport');
    if (!holder || !threeRenderer || !threeCamera) return;
    const w = holder.clientWidth;
    const h = holder.clientHeight;
    threeCamera.aspect = w / h;
    threeCamera.updateProjectionMatrix();
    threeRenderer.setSize(w, h);
  }

  function update3DTextures() {
    if (!outerTexCtx || !innerTexCtx) return;

    const metalCfg = metalTypes[state.metal];
    const isBlack = state.metal === 'black';
    const bgHex = isBlack ? '#1a1a1a' : '#efefef';
    const engColor = isBlack ? '#ffffff' : '#111111';

    // 1. Draw Outer Texture Map
    outerTexCtx.fillStyle = bgHex;
    outerTexCtx.fillRect(0, 0, outerTexCanvas.width, outerTexCanvas.height);

    renderLayersOntoTexture(outerTexCtx, state.layers.out, outerTexCanvas.width, outerTexCanvas.height, engColor);

    // 2. Draw Inner Texture Map (Watermark stamp)
    innerTexCtx.fillStyle = bgHex;
    innerTexCtx.fillRect(0, 0, innerTexCanvas.width, innerTexCanvas.height);

    if (!state.removeWatermark) {
      drawInsideWatermarkStamp(innerTexCtx, innerTexCanvas.width, innerTexCanvas.height, isBlack);
    }
    renderLayersOntoTexture(innerTexCtx, state.layers.in, innerTexCanvas.width, innerTexCanvas.height, engColor);

    if (outerCanvasTexture) outerCanvasTexture.needsUpdate = true;
    if (innerCanvasTexture) innerCanvasTexture.needsUpdate = true;
  }

  function renderLayersOntoTexture(ctx, layers, texW, texH, defaultColor) {
    const wp = getWorkpieceDimensions();
    const scaleFactorX = texW / wp.wPx;
    const scaleFactorY = texH / wp.hPx;

    // Correct for cylindrical texture stretch:
    // Texture is 4096x1024 (aspect 4:1), but 3D ring cylinder is (2*PI*R)/H (~10.5:1).
    // aspectCorrectionX scales horizontal text down so on the 3D ring it is un-stretched and matches 2D 1:1!
    const outerRadius = 10;
    const ringHeight = state.model.widthMm || 6;
    const physAspect = (2 * Math.PI * outerRadius) / ringHeight;
    const texAspect = texW / texH;
    const aspectCorrectionX = texAspect / physAspect;

    layers.forEach((layer) => {
      if (!layer.visible) return;

      ctx.save();
      const cx = texW / 2 + layer.x * scaleFactorX;
      const cy = texH / 2 + layer.y * scaleFactorY;

      ctx.translate(cx, cy);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.scale(aspectCorrectionX * (layer.scale || 1.0), 1.0 * (layer.scale || 1.0));

      if (layer.type === 'text') {
        const scaledSize = layer.fontSize * scaleFactorY * 1.05;
        const style = layer.fontStyle === 'italic' ? 'italic' : 'normal';
        ctx.font = `${style} ${layer.fontWeight || '400'} ${scaledSize}px "${layer.fontFamily}", sans-serif`;
        ctx.fillStyle = defaultColor;
        ctx.strokeStyle = defaultColor;
        ctx.textAlign = layer.textAlign || 'center';
        ctx.textBaseline = 'middle';

        let text = layer.text;
        if (layer.textTransform === 'uppercase') text = text.toUpperCase();

        if (layer.stroke) {
          ctx.lineWidth = layer.strokeWidth * scaleFactorY;
          ctx.strokeText(text, 0, 0);
        } else {
          ctx.fillText(text, 0, 0);
        }
      } else if (layer.type === 'image' && layer.img) {
        const iw = layer.img.width;
        const ih = layer.img.height;
        const maxDim = 60 * scaleFactorY * layer.scale;
        const scale = maxDim / Math.max(iw, ih);
        const dw = iw * scale;
        const dh = ih * scale;

        ctx.save();
        if (layer.flip) ctx.scale(-1, 1);
        ctx.drawImage(layer.img, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      }

      ctx.restore();
    });
  }

  function drawInsideWatermarkStamp(ctx, w, h, isBlack) {
    const innerRadius = 8.8;
    const ringHeight = state.model.widthMm || 6;
    const physAspect = (2 * Math.PI * innerRadius) / ringHeight;
    const texAspect = w / h;
    const aspectCorrectionX = texAspect / physAspect;

    ctx.save();
    const color = isBlack ? '#999999' : '#111111';
    ctx.fillStyle = color;
    ctx.font = '700 84px Jost, Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Positioned opposite to outer front text (180° away from front center)
    // with aspect ratio correction so it is larger, crisp, and properly proportioned
    [0, w].forEach((xPos) => {
      ctx.save();
      ctx.translate(xPos, h / 2);
      ctx.scale(aspectCorrectionX, 1.0);
      ctx.fillText('💎 САПС | Уникальность в деталях', 0, 0);
      ctx.restore();
    });

    ctx.restore();
  }

  function rebuild3DRingMesh() {
    while (threeRingGroup.children.length > 0) {
      threeRingGroup.remove(threeRingGroup.children[0]);
    }

    update3DTextures();

    const maxAnisotropy = threeRenderer ? threeRenderer.capabilities.getMaxAnisotropy() : 8;

    outerCanvasTexture = new THREE.CanvasTexture(outerTexCanvas);
    outerCanvasTexture.wrapS = THREE.ClampToEdgeWrapping;
    outerCanvasTexture.wrapT = THREE.ClampToEdgeWrapping;
    outerCanvasTexture.minFilter = THREE.LinearMipmapLinearFilter;
    outerCanvasTexture.magFilter = THREE.LinearFilter;
    outerCanvasTexture.anisotropy = maxAnisotropy;

    innerCanvasTexture = new THREE.CanvasTexture(innerTexCanvas);
    innerCanvasTexture.wrapS = THREE.RepeatWrapping;
    innerCanvasTexture.wrapT = THREE.ClampToEdgeWrapping;
    innerCanvasTexture.minFilter = THREE.LinearMipmapLinearFilter;
    innerCanvasTexture.magFilter = THREE.LinearFilter;
    innerCanvasTexture.anisotropy = maxAnisotropy;
    innerCanvasTexture.repeat.x = -1;
    innerCanvasTexture.offset.x = 1;

    const metalCfg = metalTypes[state.metal];
    const outerMaterial = new THREE.MeshStandardMaterial({
      color: metalCfg.color,
      metalness: metalCfg.metalness,
      roughness: metalCfg.roughness,
      map: outerCanvasTexture
    });

    const capMaterial = new THREE.MeshStandardMaterial({
      color: metalCfg.color,
      metalness: metalCfg.metalness,
      roughness: metalCfg.roughness
    });

    const innerMaterial = new THREE.MeshStandardMaterial({
      color: metalCfg.color,
      metalness: metalCfg.metalness,
      roughness: metalCfg.roughness,
      map: innerCanvasTexture,
      side: THREE.BackSide
    });

    const height = state.model.widthMm;
    const outerRadius = 10;
    const innerRadius = 8.8;

    // 1. Outer Cylinder
    const outerGeo = new THREE.CylinderGeometry(outerRadius, outerRadius, height, 128, 1, true);
    outerGeo.rotateY(Math.PI);
    const outerMesh = new THREE.Mesh(outerGeo, outerMaterial);
    threeRingGroup.add(outerMesh);

    // 2. Inner Cylinder
    const innerGeo = new THREE.CylinderGeometry(innerRadius, innerRadius, height, 128, 1, true);
    innerGeo.rotateY(Math.PI);
    const innerMesh = new THREE.Mesh(innerGeo, innerMaterial);
    threeRingGroup.add(innerMesh);

    // 3. Bevel Caps
    const capThickness = (outerRadius - innerRadius) / 2;
    const capRadius = innerRadius + capThickness;

    const topCapGeo = new THREE.TorusGeometry(capRadius, capThickness, 16, 128);
    topCapGeo.rotateX(Math.PI / 2);
    topCapGeo.translate(0, height / 2, 0);
    threeRingGroup.add(new THREE.Mesh(topCapGeo, capMaterial));

    const bottomCapGeo = new THREE.TorusGeometry(capRadius, capThickness, 16, 128);
    bottomCapGeo.rotateX(Math.PI / 2);
    bottomCapGeo.translate(0, -height / 2, 0);
    threeRingGroup.add(new THREE.Mesh(bottomCapGeo, capMaterial));

    threeRingGroup.rotation.set(0.45, 0, 0);
  }

  // =========================================================================
  // LAYERS MANAGEMENT
  // =========================================================================
  function renderLayersList() {
    const listEl = document.getElementById('cad-layers-list');
    const countEl = document.getElementById('cad-layers-count');
    if (!listEl) return;

    const currentLayers = state.layers[state.side];
    if (countEl) countEl.textContent = currentLayers.length;

    listEl.innerHTML = currentLayers
      .map((l) => {
        const isActive = l.id === state.selectedLayerId;
        const icon = l.type === 'text' ? 'T' : '🖼';
        const eyeIcon = l.visible ? '👁' : '✕';

        return `
        <div class="cad-layer-card ${isActive ? 'active' : ''}" data-layer-id="${l.id}">
          <div class="cad-layer-icon">${icon}</div>
          <div class="cad-layer-name">${l.name}</div>
          <button class="cad-layer-btn-icon js-toggle-vis ${!l.visible ? 'hidden-layer' : ''}" data-layer-id="${l.id}" title="Видимость">${eyeIcon}</button>
          <button class="cad-layer-btn-icon js-del-layer" data-layer-id="${l.id}" title="Удалить">&times;</button>
        </div>
      `;
      })
      .join('');

    // Bind layer item events
    listEl.querySelectorAll('.cad-layer-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.js-toggle-vis') || e.target.closest('.js-del-layer')) return;
        selectLayer(card.dataset.layerId);
      });
    });

    listEl.querySelectorAll('.js-toggle-vis').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = currentLayers.find((l) => l.id === btn.dataset.layerId);
        if (layer) {
          layer.visible = !layer.visible;
          renderLayersList();
          redrawCanvas();
          update3DTextures();
        }
      });
    });

    listEl.querySelectorAll('.js-del-layer').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteLayer(btn.dataset.layerId);
      });
    });
  }

  function selectLayer(id) {
    state.selectedLayerId = id;
    renderLayersList();
    syncInspectorWithSelectedLayer();
    redrawCanvas();
  }

  function addNewTextLayer(text = 'НОВАЯ НАДПИСЬ') {
    const currentLayers = state.layers[state.side];
    const newId = 'layer_' + Date.now();
    const newLayer = {
      id: newId,
      type: 'text',
      name: `Текст ${currentLayers.length + 1}`,
      text: text,
      fontFamily: 'Montserrat',
      fontSize: 8,
      fontWeight: '700',
      fontStyle: 'normal',
      textTransform: 'none',
      textAlign: 'center',
      letterSpacing: 0,
      lineHeight: 1.2,
      arc: false,
      arcRadius: 60,
      stroke: false,
      strokeWidth: 2,
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1.0,
      visible: true,
      locked: false
    };

    currentLayers.push(newLayer);
    selectLayer(newId);
    saveHistoryState();
    redrawCanvas();
    update3DTextures();
  }

  function addNewImageLayer(img, name = 'Рисунок') {
    const currentLayers = state.layers[state.side];
    const newId = 'layer_' + Date.now();
    const newLayer = {
      id: newId,
      type: 'image',
      name: name,
      img: img,
      scale: 1.0,
      rotation: 0,
      x: 0,
      y: 0,
      flip: false,
      invert: false,
      visible: true,
      locked: false
    };

    currentLayers.push(newLayer);
    selectLayer(newId);
    saveHistoryState();
    redrawCanvas();
    update3DTextures();
  }

  function deleteLayer(id) {
    const currentLayers = state.layers[state.side];
    const index = currentLayers.findIndex((l) => l.id === id);
    if (index === -1) return;

    currentLayers.splice(index, 1);
    if (state.selectedLayerId === id) {
      state.selectedLayerId = currentLayers.length > 0 ? currentLayers[currentLayers.length - 1].id : null;
    }

    renderLayersList();
    syncInspectorWithSelectedLayer();
    saveHistoryState();
    redrawCanvas();
    update3DTextures();
  }

  // =========================================================================
  // INSPECTOR & TYPOGRAPHY SYNCHRONIZATION
  // =========================================================================
  function syncInspectorWithSelectedLayer() {
    const currentLayers = state.layers[state.side];
    const layer = currentLayers.find((l) => l.id === state.selectedLayerId);

    const textSettings = document.getElementById('cad-text-settings');
    const imgSettings = document.getElementById('cad-image-settings');
    const titleEl = document.getElementById('cad-inspector-title');

    if (!layer) {
      if (textSettings) textSettings.style.display = 'none';
      if (imgSettings) imgSettings.style.display = 'none';
      if (titleEl) titleEl.textContent = 'Нет активного слоя';
      return;
    }

    if (layer.type === 'text') {
      if (textSettings) textSettings.style.display = 'block';
      if (imgSettings) imgSettings.style.display = 'none';
      if (titleEl) titleEl.textContent = `Настройки: ${layer.name}`;

      // Inputs
      const txtInput = document.getElementById('cad-text-input');
      const fontSel = document.getElementById('cad-text-font');
      const fontSizeSlider = document.getElementById('slider-font-size');
      const fontSizeVal = document.getElementById('val-font-size');
      const letterSpaceSlider = document.getElementById('slider-letter-spacing');
      const letterSpaceVal = document.getElementById('val-letter-spacing');
      const lineHeightSlider = document.getElementById('slider-line-height');
      const lineHeightVal = document.getElementById('val-line-height');
      const arcCheck = document.getElementById('cad-toggle-arc');
      const arcGroup = document.getElementById('group-arc-radius');
      const arcRadiusSlider = document.getElementById('slider-arc-radius');
      const arcRadiusVal = document.getElementById('val-arc-radius');
      const strokeCheck = document.getElementById('cad-toggle-stroke');
      const strokeGroup = document.getElementById('group-stroke-width');
      const strokeWidthSlider = document.getElementById('slider-stroke-width');
      const strokeWidthVal = document.getElementById('val-stroke-width');
      const rotSlider = document.getElementById('slider-rotation');
      const rotVal = document.getElementById('val-rotation');

      if (txtInput) txtInput.value = layer.text;
      if (fontSel) fontSel.value = layer.fontFamily;
      if (fontSizeSlider) fontSizeSlider.value = layer.fontSize;
      if (fontSizeVal) fontSizeVal.textContent = layer.fontSize + ' pt';
      if (letterSpaceSlider) letterSpaceSlider.value = layer.letterSpacing;
      if (letterSpaceVal) letterSpaceVal.textContent = layer.letterSpacing + ' px';
      if (lineHeightSlider) lineHeightSlider.value = layer.lineHeight;
      if (lineHeightVal) lineHeightVal.textContent = layer.lineHeight;

      // Arc
      if (arcCheck) arcCheck.checked = layer.arc;
      if (arcGroup) arcGroup.style.display = layer.arc ? 'flex' : 'none';
      if (arcRadiusSlider) arcRadiusSlider.value = layer.arcRadius;
      if (arcRadiusVal) arcRadiusVal.textContent = layer.arcRadius;

      // Stroke
      if (strokeCheck) strokeCheck.checked = layer.stroke;
      if (strokeGroup) strokeGroup.style.display = layer.stroke ? 'flex' : 'none';
      if (strokeWidthSlider) strokeWidthSlider.value = layer.strokeWidth;
      if (strokeWidthVal) strokeWidthVal.textContent = layer.strokeWidth + ' px';

      // Rotation
      if (rotSlider) rotSlider.value = layer.rotation;
      if (rotVal) rotVal.textContent = layer.rotation + '°';

      // Buttons
      document.getElementById('typo-bold')?.classList.toggle('active', layer.fontWeight === '700' || layer.fontWeight === '800');
      document.getElementById('typo-italic')?.classList.toggle('active', layer.fontStyle === 'italic');
      document.getElementById('typo-upper')?.classList.toggle('active', layer.textTransform === 'uppercase');

      document.getElementById('typo-align-left')?.classList.toggle('active', layer.textAlign === 'left');
      document.getElementById('typo-align-center')?.classList.toggle('active', layer.textAlign === 'center');
      document.getElementById('typo-align-right')?.classList.toggle('active', layer.textAlign === 'right');
    } else if (layer.type === 'image') {
      if (textSettings) textSettings.style.display = 'none';
      if (imgSettings) imgSettings.style.display = 'block';
      if (titleEl) titleEl.textContent = `Настройки: ${layer.name}`;

      const scaleSlider = document.getElementById('slider-img-scale');
      const scaleVal = document.getElementById('val-img-scale');
      const rotSlider = document.getElementById('slider-img-rot');
      const rotVal = document.getElementById('val-img-rot');
      const flipCheck = document.getElementById('cad-img-flip');

      if (scaleSlider) scaleSlider.value = layer.scale;
      if (scaleVal) scaleVal.textContent = layer.scale + 'x';
      if (rotSlider) rotSlider.value = layer.rotation;
      if (rotVal) rotVal.textContent = layer.rotation + '°';
      if (flipCheck) flipCheck.checked = layer.flip;
    }
  }

  // =========================================================================
  // EVENT BINDINGS
  // =========================================================================
  function bindEvents() {
    // Toolbar: Select tool
    document.getElementById('tool-select')?.addEventListener('click', () => {
      setActiveTool('select');
    });

    // Toolbar: Pan tool
    document.getElementById('tool-pan')?.addEventListener('click', () => {
      setActiveTool('pan');
    });

    // Toolbar: Text tool
    document.getElementById('tool-text')?.addEventListener('click', () => {
      addNewTextLayer();
    });

    document.getElementById('btn-add-text-quick')?.addEventListener('click', () => {
      addNewTextLayer();
    });

    // Toolbar: Delete active layer
    document.getElementById('tool-delete-layer')?.addEventListener('click', () => {
      if (state.selectedLayerId) deleteLayer(state.selectedLayerId);
    });

    // Toolbar: Zoom Fit
    document.getElementById('tool-zoom-fit')?.addEventListener('click', () => {
      state.viewZoom = 1.0;
      state.panX = 0;
      state.panY = 0;
      redrawCanvas();
    });

    // File Upload (Images/Logos)
    const fileHandler = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (re) => {
        const img = new Image();
        img.onload = () => addNewImageLayer(img, file.name.substring(0, 10));
        img.src = re.target.result;
      };
      reader.readAsDataURL(file);
    };
    document.getElementById('cad-file-upload')?.addEventListener('change', fileHandler);
    document.getElementById('cad-file-upload-quick')?.addEventListener('change', fileHandler);

    // Symbols Library Modal
    const modal = document.getElementById('cad-symbols-modal');
    document.getElementById('tool-symbols')?.addEventListener('click', () => {
      openSymbolsModal();
    });
    document.getElementById('btn-add-symbol-quick')?.addEventListener('click', () => {
      openSymbolsModal();
    });
    document.getElementById('btn-close-symbols')?.addEventListener('click', () => {
      if (modal) modal.style.display = 'none';
    });
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });

    // Side switcher: Лицевая / Внутренняя
    const btnSideOut = document.getElementById('btn-side-out');
    const btnSideIn = document.getElementById('btn-side-in');
    const labelSide = document.getElementById('cad-active-side-label');

    btnSideOut?.addEventListener('click', () => {
      state.side = 'out';
      btnSideOut.classList.add('active');
      btnSideIn?.classList.remove('active');
      if (labelSide) labelSide.textContent = 'Лицевая сторона кольца (снаружи)';
      state.selectedLayerId = state.layers.out[0]?.id || null;
      renderLayersList();
      syncInspectorWithSelectedLayer();
      redrawCanvas();
    });

    btnSideIn?.addEventListener('click', () => {
      state.side = 'in';
      btnSideIn.classList.add('active');
      btnSideOut?.classList.remove('active');
      if (labelSide) labelSide.textContent = 'Внутренняя сторона кольца (гравировка внутри)';
      state.selectedLayerId = state.layers.in[0]?.id || null;
      renderLayersList();
      syncInspectorWithSelectedLayer();
      redrawCanvas();
    });

    // Zoom Buttons
    document.querySelectorAll('.cad-zoom-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cad-zoom-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.viewZoom = parseFloat(btn.dataset.zoom);
        redrawCanvas();
      });
    });

    // Model Selector
    document.getElementById('cad-ring-model')?.addEventListener('change', (e) => {
      const selected = ringModels[e.target.value];
      if (selected) {
        state.model = selected;
        rebuild3DRingMesh();
        redrawCanvas();
        updatePrice();
      }
    });

    // Metal Swatches
    document.querySelectorAll('.cad-swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        document.querySelectorAll('.cad-swatch').forEach((s) => s.classList.remove('active'));
        sw.classList.add('active');
        state.metal = sw.dataset.color;
        rebuild3DRingMesh();
        redrawCanvas();
      });
    });

    // Size Selector
    document.getElementById('cad-ring-size')?.addEventListener('change', (e) => {
      state.size = e.target.value;
      redrawCanvas();
    });

    // Watermark Toggle (+500 ₽)
    document.getElementById('cad-watermark-toggle')?.addEventListener('change', (e) => {
      state.removeWatermark = e.target.checked;
      updatePrice();
      update3DTextures();
      redrawCanvas();
    });

    // Typography Controls
    const getActiveLayer = () => state.layers[state.side].find((l) => l.id === state.selectedLayerId);

    document.getElementById('cad-text-input')?.addEventListener('input', (e) => {
      const layer = getActiveLayer();
      if (layer) {
        layer.text = e.target.value;
        redrawCanvas();
        update3DTextures();
      }
    });

    document.getElementById('cad-text-font')?.addEventListener('change', (e) => {
      const layer = getActiveLayer();
      if (layer) {
        layer.fontFamily = e.target.value;
        redrawCanvas();
        update3DTextures();
      }
    });

    // Bold Toggle
    document.getElementById('typo-bold')?.addEventListener('click', () => {
      const layer = getActiveLayer();
      if (layer) {
        layer.fontWeight = layer.fontWeight === '700' ? '400' : '700';
        document.getElementById('typo-bold').classList.toggle('active', layer.fontWeight === '700');
        redrawCanvas();
        update3DTextures();
      }
    });

    // Italic Toggle
    document.getElementById('typo-italic')?.addEventListener('click', () => {
      const layer = getActiveLayer();
      if (layer) {
        layer.fontStyle = layer.fontStyle === 'italic' ? 'normal' : 'italic';
        document.getElementById('typo-italic').classList.toggle('active', layer.fontStyle === 'italic');
        redrawCanvas();
        update3DTextures();
      }
    });

    // Uppercase Toggle
    document.getElementById('typo-upper')?.addEventListener('click', () => {
      const layer = getActiveLayer();
      if (layer) {
        layer.textTransform = layer.textTransform === 'uppercase' ? 'none' : 'uppercase';
        document.getElementById('typo-upper').classList.toggle('active', layer.textTransform === 'uppercase');
        redrawCanvas();
        update3DTextures();
      }
    });

    // Alignments
    ['left', 'center', 'right'].forEach((align) => {
      document.getElementById(`typo-align-${align}`)?.addEventListener('click', () => {
        const layer = getActiveLayer();
        if (layer) {
          layer.textAlign = align;
          ['left', 'center', 'right'].forEach((a) => {
            document.getElementById(`typo-align-${a}`)?.classList.toggle('active', a === align);
          });
          redrawCanvas();
          update3DTextures();
        }
      });
    });

    // Font Size Slider
    document.getElementById('slider-font-size')?.addEventListener('input', (e) => {
      const layer = getActiveLayer();
      if (layer) {
        layer.fontSize = parseFloat(e.target.value);
        document.getElementById('val-font-size').textContent = layer.fontSize + ' pt';
        redrawCanvas();
        update3DTextures();
      }
    });

    // Letter Spacing Slider
    document.getElementById('slider-letter-spacing')?.addEventListener('input', (e) => {
      const layer = getActiveLayer();
      if (layer) {
        layer.letterSpacing = parseFloat(e.target.value);
        document.getElementById('val-letter-spacing').textContent = layer.letterSpacing + ' px';
        redrawCanvas();
        update3DTextures();
      }
    });

    // Line Height Slider
    document.getElementById('slider-line-height')?.addEventListener('input', (e) => {
      const layer = getActiveLayer();
      if (layer) {
        layer.lineHeight = parseFloat(e.target.value);
        document.getElementById('val-line-height').textContent = layer.lineHeight;
        redrawCanvas();
        update3DTextures();
      }
    });

    // Arc Checkbox & Slider
    document.getElementById('cad-toggle-arc')?.addEventListener('change', (e) => {
      const layer = getActiveLayer();
      if (layer) {
        layer.arc = e.target.checked;
        document.getElementById('group-arc-radius').style.display = e.target.checked ? 'flex' : 'none';
        redrawCanvas();
        update3DTextures();
      }
    });

    document.getElementById('slider-arc-radius')?.addEventListener('input', (e) => {
      const layer = getActiveLayer();
      if (layer) {
        layer.arcRadius = parseFloat(e.target.value);
        document.getElementById('val-arc-radius').textContent = layer.arcRadius;
        redrawCanvas();
        update3DTextures();
      }
    });

    // Stroke Checkbox & Slider
    document.getElementById('cad-toggle-stroke')?.addEventListener('change', (e) => {
      const layer = getActiveLayer();
      if (layer) {
        layer.stroke = e.target.checked;
        document.getElementById('group-stroke-width').style.display = e.target.checked ? 'flex' : 'none';
        redrawCanvas();
        update3DTextures();
      }
    });

    document.getElementById('slider-stroke-width')?.addEventListener('input', (e) => {
      const layer = getActiveLayer();
      if (layer) {
        layer.strokeWidth = parseFloat(e.target.value);
        document.getElementById('val-stroke-width').textContent = layer.strokeWidth + ' px';
        redrawCanvas();
        update3DTextures();
      }
    });

    // Rotation Slider
    document.getElementById('slider-rotation')?.addEventListener('input', (e) => {
      const layer = getActiveLayer();
      if (layer) {
        layer.rotation = parseFloat(e.target.value);
        document.getElementById('val-rotation').textContent = layer.rotation + '°';
        redrawCanvas();
        update3DTextures();
      }
    });

    // Image Inspector Sliders
    document.getElementById('slider-img-scale')?.addEventListener('input', (e) => {
      const layer = getActiveLayer();
      if (layer && layer.type === 'image') {
        layer.scale = parseFloat(e.target.value);
        document.getElementById('val-img-scale').textContent = layer.scale + 'x';
        redrawCanvas();
        update3DTextures();
      }
    });

    document.getElementById('slider-img-rot')?.addEventListener('input', (e) => {
      const layer = getActiveLayer();
      if (layer && layer.type === 'image') {
        layer.rotation = parseFloat(e.target.value);
        document.getElementById('val-img-rot').textContent = layer.rotation + '°';
        redrawCanvas();
        update3DTextures();
      }
    });

    document.getElementById('cad-img-flip')?.addEventListener('change', (e) => {
      const layer = getActiveLayer();
      if (layer && layer.type === 'image') {
        layer.flip = e.target.checked;
        redrawCanvas();
        update3DTextures();
      }
    });

    // Duplicate Layer
    document.getElementById('cad-btn-duplicate')?.addEventListener('click', () => {
      const layer = getActiveLayer();
      if (!layer) return;
      const copy = JSON.parse(JSON.stringify(layer));
      copy.id = 'layer_' + Date.now();
      copy.name = layer.name + ' (Копия)';
      copy.x += 10;
      copy.y += 5;
      if (layer.img) copy.img = layer.img;
      state.layers[state.side].push(copy);
      selectLayer(copy.id);
      saveHistoryState();
      redrawCanvas();
      update3DTextures();
    });

    // 3D Viewport tools
    document.getElementById('btn-reset-3d-cam')?.addEventListener('click', () => {
      threeCamera.position.set(0, 8, 34);
      threeControls.target.set(0, 0, 0);
      threeControls.update();
    });

    // Mobile tap on 3D thumbnail -> open fullscreen view
    const box3dEl = document.getElementById('cad-3d-box');
    box3dEl?.addEventListener('click', (e) => {
      if (window.innerWidth <= 980 && !box3dEl.classList.contains('fullscreen-mobile')) {
        if (!e.target.closest('.cad-3d-tool-btn') && !e.target.closest('.cad-3d-close-btn')) {
          box3dEl.classList.add('fullscreen-mobile');
          document.body.classList.add('cad-3d-fullscreen-active');
          setTimeout(onThreeResize, 100);
        }
      }
    });

    document.getElementById('btn-close-3d-fullscreen')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const box = document.getElementById('cad-3d-box');
      if (box) {
        box.classList.remove('fullscreen-mobile');
        document.body.classList.remove('cad-3d-fullscreen-active');
        setTimeout(onThreeResize, 100);
      }
    });

    document.getElementById('btn-toggle-3d-fullscreen')?.addEventListener('click', () => {
      const box = document.getElementById('cad-3d-box');
      if (box) {
        const isFs = box.classList.toggle('fullscreen-mobile');
        document.body.classList.toggle('cad-3d-fullscreen-active', isFs);
        setTimeout(onThreeResize, 100);
      }
    });

    document.getElementById('btn-toggle-3d-size')?.addEventListener('click', () => {
      const box = document.getElementById('cad-3d-box');
      const btn = document.getElementById('btn-toggle-3d-size');
      if (box) {
        const isExp = box.classList.toggle('expanded-3d');
        box.classList.toggle('expanded-mobile');
        if (btn) {
          btn.textContent = isExp ? '↕ Свернуть 3D' : '↕ Увеличить 3D';
        }
        setTimeout(onThreeResize, 100);
        setTimeout(onThreeResize, 320);
      }
    });

    // Undo / Redo
    document.getElementById('btn-undo')?.addEventListener('click', undo);
    document.getElementById('btn-redo')?.addEventListener('click', redo);

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        redo();
      }
    });

    // Add to Cart
    document.getElementById('btn-add-to-cart')?.addEventListener('click', onAddToCart);
  }

  function setActiveTool(tool) {
    state.activeTool = tool;
    document.querySelectorAll('.cad-tool-btn').forEach((b) => b.classList.remove('active'));
    document.getElementById(`tool-${tool}`)?.classList.add('active');
  }

  function openSymbolsModal() {
    const modal = document.getElementById('cad-symbols-modal');
    const grid = document.getElementById('cad-symbols-grid');
    if (!modal || !grid) return;

    grid.innerHTML = symbolLibrary
      .map((s) => `<button class="cad-symbol-item" data-sym="${s}">${s}</button>`)
      .join('');

    grid.querySelectorAll('.cad-symbol-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        addNewTextLayer(btn.dataset.sym);
        modal.style.display = 'none';
      });
    });

    modal.style.display = 'flex';
  }

  // =========================================================================
  // HISTORY (UNDO / REDO)
  // =========================================================================
  function saveHistoryState() {
    // Truncate future states if we were in the middle
    state.history = state.history.slice(0, state.historyIndex + 1);

    const snapshot = JSON.stringify({
      layers: state.layers,
      side: state.side,
      selectedLayerId: state.selectedLayerId
    });

    state.history.push(snapshot);
    if (state.history.length > 30) state.history.shift();
    state.historyIndex = state.history.length - 1;

    updateHistoryButtons();
  }

  function undo() {
    if (state.historyIndex > 0) {
      state.historyIndex--;
      restoreHistoryState(state.history[state.historyIndex]);
    }
  }

  function redo() {
    if (state.historyIndex < state.history.length - 1) {
      state.historyIndex++;
      restoreHistoryState(state.history[state.historyIndex]);
    }
  }

  function restoreHistoryState(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      state.layers = data.layers;
      state.side = data.side;
      state.selectedLayerId = data.selectedLayerId;

      renderLayersList();
      syncInspectorWithSelectedLayer();
      redrawCanvas();
      update3DTextures();
      updateHistoryButtons();
    } catch (e) {}
  }

  function updateHistoryButtons() {
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    if (btnUndo) btnUndo.disabled = state.historyIndex <= 0;
    if (btnRedo) btnRedo.disabled = state.historyIndex >= state.history.length - 1;
  }

  // =========================================================================
  // PRICE & CART
  // =========================================================================
  function updatePrice() {
    const priceEl = document.getElementById('cad-total-price');
    if (!priceEl) return;
    const finalPrice = state.model.basePrice + (state.removeWatermark ? 500 : 0);
    priceEl.textContent = `${finalPrice.toLocaleString('ru-RU')} ₽`;
  }

  function onAddToCart() {
    threeRenderer.render(threeScene, threeCamera);
    const previewDataUrl = threeRenderer.domElement.toDataURL('image/png');

    const metalCfg = metalTypes[state.metal];
    const finalPrice = state.model.basePrice + (state.removeWatermark ? 500 : 0);
    const title = `Кастомное кольцо: ${state.model.name}`;

    // Collect engraving summary
    const outTexts = state.layers.out.map((l) => l.text || l.name).join(', ');
    const inTexts = state.layers.in.map((l) => l.text || l.name).join(', ');
    let summary = `Модель: ${state.model.name}, Металл: ${metalCfg.name}, Размер: ${state.size} р-р.`;
    if (outTexts) summary += ` Лицевая сторона: "${outTexts}".`;
    if (inTexts) summary += ` Внутренняя сторона: "${inTexts}".`;
    if (state.removeWatermark) summary += ` Без вотермарки САПС (+500 ₽).`;

    if (window.SupsCart || window.cart) {
      const cartInstance = window.SupsCart || window.cart;
      cartInstance.addItem({
        id: 'custom-' + Date.now(),
        title: title,
        price: finalPrice,
        image: previewDataUrl,
        size: state.size,
        is_custom: true,
        model_id: state.model.id,
        remove_logo: !!state.removeWatermark,
        custom_details: summary,
        quantity: 1
      });
      if (cartInstance.open) cartInstance.open();
    }

    // Notify the shop via our server (bot token stays server-side)
    fetch('/api/custom/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: previewDataUrl,
        model: state.model.name,
        metal: metalCfg.name,
        size: state.size,
        outTexts,
        inTexts,
        removeWatermark: !!state.removeWatermark,
        price: finalPrice
      })
    }).catch(() => {});
  }

  // --- BOOTSTRAP ON LOAD ---
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 50);
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
