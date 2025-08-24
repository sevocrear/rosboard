"use strict";

class Multi3DViewer extends Space3DViewer {
  onCreate() {
    super.onCreate();

    this.layers = {}; // topicName -> layer config and data
    this.pcdLayers = {}; // PCD file layers
    this.pcdCounter = 0; // Counter for unique PCD IDs

    const controls = $('<div></div>')
      .css({display:"flex", gap:"8px", alignItems:"center", padding:"6px", flexWrap:"wrap"})
      .appendTo(this.card.content);

    // Topic selector (dropdown populated from available topics)
    this.topicSelect = $('<select></select>').css({minWidth:"220px"}).appendTo(controls);
    this.addBtn = $('<button class="mdl-button mdl-js-button mdl-button--raised">Add</button>')
      .click(()=> this._addSelectedTopic())
      .appendTo(controls);

    // Base frame for all layers
    $('<span>Base frame</span>').appendTo(controls);
    this.baseSelect = $('<select></select>').css({minWidth:"160px"}).append('<option value="">(none)</option>').appendTo(controls);

    // PCD file loading controls
    $('<div style="width: 100%; height: 1px; background: #404040; margin: 8px 0;"></div>').appendTo(controls);

    // File input for PCD files
    this.fileInput = $('<input type="file" accept=".pcd" style="display: none;">').appendTo(controls);

    // Load PCD button
    this.loadPcdBtn = $('<button class="mdl-button mdl-js-button mdl-button--raised mdl-button--colored">Load PCD</button>')
      .click(() => this.fileInput.click())
      .appendTo(controls);

    // Clear PCD button
    this.clearPcdBtn = $('<button class="mdl-button mdl-js-button mdl-button--raised">Clear PCD</button>')
      .click(() => this._clearAllPcdLayers())
      .appendTo(controls);

    this._rebuildTopics();
    this._populateFrames();

    this._topicsRefreshInterval = setInterval(()=>this._rebuildTopics(), 1000);
    this._tfRefreshInterval = setInterval(()=>this._populateFrames(), 1000);

    // Layers list UI
    this.layersContainer = $('<div></div>')
      .css({padding:"6px", display:"flex", flexDirection:"column", gap:"6px"})
      .appendTo(this.card.content);

    // Set title and remove spinner since this viewer doesn't wait for a single topic
    this.card.title.text("Multi 3D");
    setTimeout(()=>{ if(this.loaderContainer){ this.loaderContainer.remove(); this.loaderContainer = null; } }, 0);

    // Auto-add the bound topic (the one used to create this card) if it's a supported type
    this._autoAddBoundTopic();

    // Set up file input event handler for PCD files
    this.fileInput.on('change', (e) => this._handlePcdFileSelect(e));

    // Restore PCD layers from localStorage after everything is initialized
    // Use a small delay to ensure the viewer is fully ready
    setTimeout(() => {
      this._restorePcdLayersFromStorage();
      // Force a render after restoration to ensure everything is displayed
      if (this._render) {
        this._render();
      }
    }, 200);
  }

  serializeState(){
    try {
      const baseFrame = (this.baseSelect && this.baseSelect.val()) || "";
      const cam = (typeof Space3DViewer !== 'undefined' && Space3DViewer.prototype.serializeState) ? (Space3DViewer.prototype.serializeState.call(this) || {}) : {};
      const layers = [];
      for(const [topic, layer] of Object.entries(this.layers||{})){
        layers.push({
          topic: topic,
          type: layer.type,
          color: layer.color,
          size: typeof layer.size === 'number' ? layer.size : 2.5,
          visible: !!layer.visible,
          baseFrame: layer.baseFrame || baseFrame || "",
          occShowOccupied: !!layer.occShowOccupied,
          occShowFree: !!layer.occShowFree,
          occShowUnknown: !!layer.occShowUnknown,
          occOccupiedThreshold: layer.occOccupiedThreshold,
          occStride: layer.occStride,
        });
      }

      // Serialize PCD layers - only save file paths and metadata, not the actual point data
      const pcdLayers = [];
      for(const [layerId, pcdLayer] of Object.entries(this.pcdLayers||{})){
        pcdLayers.push({
          id: pcdLayer.id,
          name: pcdLayer.name,
          color: pcdLayer.color,
          visible: pcdLayer.visible,
          pointSize: pcdLayer.pointSize,
          // Save file path instead of point data
          filePath: pcdLayer.filePath || null,
          // Save metadata for display
          pointCount: pcdLayer.pointCount,
          zmin: pcdLayer.zmin,
          zmax: pcdLayer.zmax
        });
      }

      // Don't save to localStorage during serialization - this should only happen during normal operation
      // The PCD file paths will be included in the layout export/import

      return Object.assign({}, cam, { baseFrame, layers, pcdLayers });
    } catch(e) {
      console.error('Error serializing Multi3DViewer state:', e);
      return null;
    }
  }

  applyState(state){
    try {
      if(!state) return;
      // Restore camera first (if present)
      try { if(typeof Space3DViewer !== 'undefined' && Space3DViewer.prototype.applyState) Space3DViewer.prototype.applyState.call(this, state); } catch(e){}
      const baseFrame = (state.baseFrame||"");
      if(this.baseSelect) this.baseSelect.val(baseFrame);
      // Clear current layers UI
      try { if(this.layersContainer) this.layersContainer.empty(); } catch(e){}
      this.layers = {};
      const arr = state.layers || [];
      for(const it of arr){
        if(!it || !it.topic || !it.type) continue;
        const cfg = {
          type: it.type,
          color: (it.color && it.color.length===4) ? it.color.slice() : [1,1,1,1],
          size: typeof it.size === 'number' ? it.size : 2.5,
          visible: (it.visible !== false),
          lastMsg: null,
          baseFrame: it.baseFrame || baseFrame || "",
          _occCache: null,
          occShowOccupied: (it.occShowOccupied !== false),
          occShowFree: !!it.occShowFree,
          occShowUnknown: !!it.occShowUnknown,
          occOccupiedThreshold: typeof it.occOccupiedThreshold==='number'?it.occOccupiedThreshold:65,
          occStride: Math.max(1, parseInt(it.occStride||1)),
        };
        this.layers[it.topic] = cfg;
        // ensure subscription
        try { currentTransport.subscribe({topicName: it.topic, maxUpdateRate: 24.0}); } catch(e){}
        this._renderLayerRow(it.topic, cfg);
      }

      // Restore PCD layers from file paths (for layout import)
      if (state.pcdLayers && state.pcdLayers.length > 0) {
        console.log('Restoring PCD layers from file paths:', state.pcdLayers.length);
        this.pcdLayers = {};
        this.pcdCounter = 0;

        // Restore each PCD layer from file path
        state.pcdLayers.forEach(pcdData => {
          if (pcdData.filePath) {
            // Use the new restoration method that creates placeholders
            this._restorePcdFromPath(pcdData.filePath, pcdData);
          } else {
            console.warn('PCD layer missing file path:', pcdData.name);
          }
        });

        // Update topic selector to include restored PCD layers
        this._rebuildTopics();
      }

      this._render();
    } catch(e){}
  }

  _autoAddBoundTopic() {
    const tname = this.topicName;
    const ttype = this.topicType;
    if(!tname || !ttype) return;
    const supported = (
      ttype.endsWith("/PointCloud2") || ttype.endsWith("/msg/PointCloud2") ||
      ttype.endsWith("/PointCloud") || ttype.endsWith("/msg/PointCloud") ||
      ttype.endsWith("/MarkerArray") || ttype.endsWith("/msg/MarkerArray") ||
      ttype.endsWith("/OccupancyGrid") || ttype.endsWith("/msg/OccupancyGrid")
    );
    if(!supported) return;
    if(this.layers[tname]) return;
    // Do not subscribe here; the card creation already subscribed
    const layer = {
      type: ttype,
      color: [1,1,1,1],
      size: 2.5, // slightly larger default for readability
      visible: true,
      lastMsg: null,
      baseFrame: this.baseSelect.val() || "",
      _occCache: null,
      // OccupancyGrid controls
      occShowOccupied: true,
      occShowFree: false,
      occShowUnknown: false,
      occOccupiedThreshold: 65,
      occStride: 1,
    };
    this.layers[tname] = layer;
    this._renderLayerRow(tname, layer);
  }

  destroy() {
    if(this._topicsRefreshInterval) clearInterval(this._topicsRefreshInterval);
    if(this._tfRefreshInterval) clearInterval(this._tfRefreshInterval);
    // unsubscribe layers
    if(window.currentTransport) {
      for(const t in this.layers) { try { currentTransport.unsubscribe({topicName: t}); } catch(e){} }
    }
    super.destroy();
  }

  _rebuildTopics() {
    // fill topicSelect from global currentTopics
    if(typeof currentTopics === 'undefined') return;
    const prev = this.topicSelect.val();

    // Get ROS topics
    const rosEntries = Object.entries(currentTopics).filter(([name, type]) => {
      return type && (
        type.endsWith("/PointCloud2") || type.endsWith("/PointCloud") ||
        type.endsWith("/MarkerArray") || type.endsWith("/OccupancyGrid") ||
        type.endsWith("/msg/PointCloud2") || type.endsWith("/msg/PointCloud") ||
        type.endsWith("/msg/MarkerArray") || type.endsWith("/msg/OccupancyGrid")
      );
    });

    // Get PCD layers
    const pcdEntries = Object.entries(this.pcdLayers || {}).map(([layerId, pcdLayer]) => [
      layerId,
      `PCD: ${pcdLayer.name}`
    ]);

    // Combine and sort all entries
    const allEntries = [...rosEntries, ...pcdEntries].sort((a,b)=> a[0].localeCompare(b[0]));

    const nextStr = allEntries.map(e=>e[0]).join(',');
    const prevStr = Array.from(this.topicSelect.find('option')).map(o=>o.value).join(',');

    if(nextStr !== prevStr) {
      this.topicSelect.empty();
      allEntries.forEach(([n,t])=> this.topicSelect.append(`<option value="${n}">${n} (${t.split('/').pop()})</option>`));
      if(prev) this.topicSelect.val(prev);
    }
  }

  _populateFrames() {
    if(!window.ROSBOARD_TF) return;
    const frames = window.ROSBOARD_TF.getFrames();
    const current = this.baseSelect.val();
    const prevOptions = Array.from(this.baseSelect.find('option')).map(o=>o.value).join(',');
    const nextOptions = [''].concat(frames).join(',');
    if(prevOptions !== nextOptions) {
      this.baseSelect.empty();
      this.baseSelect.append('<option value="">(none)</option>');
      frames.forEach(f => this.baseSelect.append(`<option value="${f}">${f}</option>`));
      if(current) this.baseSelect.val(current);
    }
  }

  _addSelectedTopic() {
    const topic = this.topicSelect.val();
    if(!topic || this.layers[topic]) return;

    // Check if this is a PCD layer
    if (this.pcdLayers && this.pcdLayers[topic]) {
      const pcdLayer = this.pcdLayers[topic];
      const layer = {
        type: "PCD_FILE",
        color: pcdLayer.color || [1,1,1,1],
        size: pcdLayer.pointSize || 2.5,
        visible: pcdLayer.visible !== false,
        lastMsg: null,
        baseFrame: this.baseSelect.val() || "",
        _occCache: null,
        // PCD-specific properties
        pcdData: pcdLayer,
        // OccupancyGrid controls (not used for PCD)
        occShowOccupied: true,
        occShowFree: false,
        occShowUnknown: false,
        occOccupiedThreshold: 65,
        occStride: 1,
      };
      this.layers[topic] = layer;
      // add UI row
      this._renderLayerRow(topic, layer);
      return;
    }

    // Handle ROS topics
    const type = currentTopics[topic];
    const layer = {
      type,
      color: [1,1,1,1],
      size: 2.5,
      visible: true,
      lastMsg: null,
      baseFrame: this.baseSelect.val() || "",
      _occCache: null,
      // OccupancyGrid controls
      occShowOccupied: true,
      occShowFree: false,
      occShowUnknown: false,
      occOccupiedThreshold: 65,
      occStride: 1,
    };
    this.layers[topic] = layer;
    // subscribe
    try { currentTransport.subscribe({topicName: topic, maxUpdateRate: 24.0}); } catch(e){}
    // add UI row
    this._renderLayerRow(topic, layer);
  }

  _renderLayerRow(topic, layer) {
    const row = $('<div></div>')
      .css({display:"flex", gap:"6px", alignItems:"center"})
      .appendTo(this.layersContainer);
    $('<span></span>').text(topic).css({flex:"1 1 auto", fontSize:"10px", color:"#ccc"}).appendTo(row);
    const vis = $('<input type="checkbox"/>').prop('checked', !!layer.visible).change(()=>{ layer.visible = vis.is(':checked'); }).appendTo(row);
    const color = $('<input type="color"/>').val((()=>{ try { const r=Math.max(0,Math.min(255,Math.round((layer.color&&layer.color[0]||1)*255))); const g=Math.max(0,Math.min(255,Math.round((layer.color&&layer.color[1]||1)*255))); const b=Math.max(0,Math.min(255,Math.round((layer.color&&layer.color[2]||1)*255))); return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0'); } catch(e){ return '#ffffff'; } })()).change(()=>{
      const hex = color.val().replace('#','');
      layer.color = [parseInt(hex.substr(0,2),16)/255.0, parseInt(hex.substr(2,2),16)/255.0, parseInt(hex.substr(4,2),16)/255.0, 1.0];
    }).appendTo(row);
    // This slider controls point size for point layers and edge thickness for boxes (via point sprites)
    const size = $('<input type="range" min="1" max="12" step="0.5"/>').val(layer.size).on('input change', ()=>{ layer.size = parseFloat(size.val()); }).appendTo(row);
    const removeBtn = $('<button class="mdl-button mdl-js-button">Remove</button>').click(()=>{
      try { currentTransport.unsubscribe({topicName: topic}); } catch(e){}
      delete this.layers[topic];
      row.remove();
    }).appendTo(row);

    // OccupancyGrid-specific compact controls
    if(layer.type.endsWith('/OccupancyGrid') || layer.type.endsWith('/msg/OccupancyGrid')){
      const occRow = $('<div></div>').css({display:'flex', gap:'6px', alignItems:'center', width:'100%', marginLeft:'12px', marginTop:'4px'});
      const chkOcc = $('<label style="font-size:10px;color:#ccc;"><input type="checkbox" checked/> occupied</label>');
      const chkFree = $('<label style="font-size:10px;color:#ccc;"><input type="checkbox"/> free</label>');
      const chkUnk = $('<label style="font-size:10px;color:#ccc;"><input type="checkbox"/> unknown</label>');
      const thrWrap = $('<span style="font-size:10px;color:#ccc;">thr</span>');
      const thr = $('<input type="range" min="1" max="100" step="1"/>').val(layer.occOccupiedThreshold);
      const strideWrap = $('<span style="font-size:10px;color:#ccc;">stride</span>');
      const stride = $('<input type="number" min="1" max="10" step="1" style="width:48px;"/>').val(layer.occStride);
      chkOcc.find('input').prop('checked', layer.occShowOccupied).on('change', ()=>{ layer.occShowOccupied = chkOcc.find('input').is(':checked'); this._render(); });
      chkFree.find('input').prop('checked', layer.occShowFree).on('change', ()=>{ layer.occShowFree = chkFree.find('input').is(':checked'); this._render(); });
      chkUnk.find('input').prop('checked', layer.occShowUnknown).on('change', ()=>{ layer.occShowUnknown = chkUnk.find('input').is(':checked'); this._render(); });
      thr.on('input change', ()=>{ layer.occOccupiedThreshold = parseInt(thr.val()); this._render(); });
      stride.on('change', ()=>{ const v = Math.max(1, Math.min(10, parseInt(stride.val()||'1'))); layer.occStride = v; stride.val(v); this._render(); });
      occRow.append(chkOcc, chkFree, chkUnk, thrWrap, thr, strideWrap, stride);
      this.layersContainer.append(occRow);
    }
  }

  _applyTFPoints(points, src, dst) {
    if(!dst || !src || !window.ROSBOARD_TF) return points;
    const T = window.ROSBOARD_TF.getTransform(src, dst);
    if(!T) return points;
    return window.ROSBOARD_TF.transformPoints(T, points);
  }

  _quatConjugate(q){ return [-q[0], -q[1], -q[2], q[3]]; }
  _quatMultiply(a,b){
    const ax=a[0], ay=a[1], az=a[2], aw=a[3];
    const bx=b[0], by=b[1], bz=b[2], bw=b[3];
    return [
      aw*bx + ax*bw + ay*bz - az*by,
      aw*by - ax*bz + ay*bw + az*bx,
      aw*bz + ax*by - ay*bx + az*bw,
      aw*bw - ax*bx - ay*by - az*bz,
    ];
  }
  _quatRotateVec(q, v) {
    const qv = [v[0], v[1], v[2], 0];
    const t = this._quatMultiply(this._quatMultiply(q, qv), this._quatConjugate(q));
    return [t[0], t[1], t[2]];
  }

  _buildLineMeshFromPoints(pointsFlat, color) {
    // pointsFlat: Float32Array of vertices [x0,y0,z0,x1,y1,z1,...]
    const vertices = Array.from(pointsFlat);
    const colors = [];
    for(let i=0;i<vertices.length/3;i++) colors.push(color[0],color[1],color[2],color[3]);
    return GL.Mesh.load({vertices: vertices, colors: colors});
  }

  _sampleEdgePoints(a, b, step = 0.05) {
    // a, b: [x,y,z]; returns Float32Array of samples including endpoints
    const dx = b[0]-a[0], dy = b[1]-a[1], dz = b[2]-a[2];
    const L = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const n = Math.max(2, Math.ceil(L/step)+1);
    const out = new Float32Array(n*3);
    for(let i=0;i<n;i++){
      const t = i/(n-1);
      out[3*i] = a[0] + t*dx;
      out[3*i+1] = a[1] + t*dy;
      out[3*i+2] = a[2] + t*dz;
    }
    return out;
  }

  _render() {
    const drawObjects = [];
    // grid and axes always drawn by Space3DViewer

    for(const topic in this.layers) {
      const layer = this.layers[topic];
      if(!layer.visible || !layer.lastMsg) continue;
      const msg = layer.lastMsg;
      const type = layer.type;
      const dst = layer.baseFrame || this.baseSelect.val() || "";

      if(type.endsWith("/PointCloud2") || type.endsWith("/msg/PointCloud2")) {
        // use the same compressed or raw decoding as PointCloud2Viewer
        let points = null;
        if(msg.__comp && msg._data_uint16) {
          const bounds = msg._data_uint16.bounds;
          const data = this._base64decode(msg._data_uint16.points);
          const dv = new DataView(data);
          points = new Float32Array(Math.round(data.byteLength / 2));
          const xrange = bounds[1]-bounds[0], xmin=bounds[0];
          const yrange = bounds[3]-bounds[2], ymin=bounds[2];
          const zrange = bounds[5]-bounds[4], zmin=bounds[4];
          for(let i=0;i<data.byteLength/6;i++){
            const off=i*6;
            points[3*i] = (dv.getUint16(off, true)/65535)*xrange + xmin;
            points[3*i+1] = (dv.getUint16(off+2, true)/65535)*yrange + ymin;
            points[3*i+2] = (dv.getUint16(off+4, true)/65535)*zrange + zmin;
          }
        } else if(msg.data) {
          const fields = {};
          (msg.fields||[]).forEach(f=>fields[f.name]=f);
          if(!(fields["x"]) || !(fields["y"])) {
            // can't decode this point cloud; skip
            continue;
          }
          const data = this._base64decode(msg.data || "");
          if(!data || !msg.point_step || !msg.width || !msg.height) {
            continue;
          }
          if(!(msg.point_step * msg.width * msg.height === data.byteLength)) {
            continue;
          }
          const dv = new DataView(data);
          const little = !msg.is_bigendian;
          const xOff = fields["x"].offset;
          const yOff = fields["y"].offset;
          const zOff = fields["z"]?fields["z"].offset:-1;
          points = new Float32Array(Math.round(data.byteLength / msg.point_step * 3));
          for(let i=0;i<data.byteLength/msg.point_step-1;i++){
            const off=i*msg.point_step;
            points[3*i] = dv.getFloat32(off + xOff, little);
            points[3*i+1] = dv.getFloat32(off + yOff, little);
            points[3*i+2] = zOff>=0 ? dv.getFloat32(off + zOff, little) : 0.0;
          }
        }
        const src = (msg.header && msg.header.frame_id) ? msg.header.frame_id : "";
        const transformed = this._applyTFPoints(points, src, dst);
        drawObjects.push({type:"points", data: transformed, colorMode:"fixed", colorUniform: layer.color, pointSize: layer.size});
      }

      else if(type.endsWith("/PointCloud") || type.endsWith("/msg/PointCloud")) {
        // sensor_msgs/PointCloud (not PointCloud2)
        const pts = msg.points || [];
        const arr = new Float32Array(pts.length*3);
        for(let i=0;i<pts.length;i++){ arr[3*i]=pts[i].x; arr[3*i+1]=pts[i].y; arr[3*i+2]=pts[i].z; }
        const src = (msg.header && msg.header.frame_id) ? msg.header.frame_id : "";
        const transformed = this._applyTFPoints(arr, src, dst);
        drawObjects.push({type:"points", data: transformed, colorMode:"fixed", colorUniform: layer.color, pointSize: layer.size});
      }

      else if(type.endsWith("/MarkerArray") || type.endsWith("/msg/MarkerArray")) {
        // visualize common marker types
        const markers = msg.markers || [];
        for(let m=0;m<markers.length;m++){
          const mk = markers[m];
          const src = mk.header && mk.header.frame_id || "";
          const col = mk.color ? [mk.color.r||0, mk.color.g||0, mk.color.b||0, (mk.color.a!=null?mk.color.a:1.0)] : layer.color;
          const scale = mk.scale && (mk.scale.x || mk.scale.y || mk.scale.z) ? Math.max(mk.scale.x||1.0, mk.scale.y||1.0, mk.scale.z||1.0) : layer.size;
          if(mk.type === 7 /*POINTS*/ || mk.type === 6 /*SPHERE_LIST*/){
            const pts = mk.points || [];
            const arr = new Float32Array(pts.length*3);
            for(let i=0;i<pts.length;i++){ arr[3*i]=pts[i].x; arr[3*i+1]=pts[i].y; arr[3*i+2]=pts[i].z; }
            const transformed = this._applyTFPoints(arr, src, dst);
            drawObjects.push({type:"points", data: transformed, colorMode:"fixed", colorUniform: col, pointSize: scale});
          } else if(mk.type === 8 /*LINE_STRIP*/){
            const pts = mk.points || [];
            if(pts.length >= 2){
              const arr = new Float32Array(pts.length*3);
              for(let i=0;i<pts.length;i++){ arr[3*i]=pts[i].x; arr[3*i+1]=pts[i].y; arr[3*i+2]=pts[i].z; }
              const transformed = this._applyTFPoints(arr, src, dst);
              const mesh = this._buildLineMeshFromPoints(transformed, col);
              drawObjects.push({type:"lines", mesh: mesh, colorUniform: col});
            }
          } else if(mk.type === 9 /*LINE_LIST*/){
            const pts = mk.points || [];
            if(pts.length >= 2){
              const arr = new Float32Array(pts.length*3);
              for(let i=0;i<pts.length;i++){ arr[3*i]=pts[i].x; arr[3*i+1]=pts[i].y; arr[3*i+2]=pts[i].z; }
              const transformed = this._applyTFPoints(arr, src, dst);
              const mesh = this._buildLineMeshFromPoints(transformed, col);
              drawObjects.push({type:"lines", mesh: mesh, colorUniform: col});
            }
          } else if(mk.type === 1 /*CUBE*/){
            // render edges as dense points so layer.size controls thickness
            const p = mk.pose && mk.pose.position ? [mk.pose.position.x||0, mk.pose.position.y||0, mk.pose.position.z||0] : [0,0,0];
            const q = mk.pose && mk.pose.orientation ? [mk.pose.orientation.x||0, mk.pose.orientation.y||0, mk.pose.orientation.z||0, mk.pose.orientation.w||1] : [0,0,0,1];
            const hx = (mk.scale && mk.scale.x ? mk.scale.x : 1.0)/2.0;
            const hy = (mk.scale && mk.scale.y ? mk.scale.y : 1.0)/2.0;
            const hz = (mk.scale && mk.scale.z ? mk.scale.z : 1.0)/2.0;
            const locals = [
              [-hx,-hy,-hz], [hx,-hy,-hz], [-hx,hy,-hz], [hx,hy,-hz],
              [-hx,-hy, hz], [hx,-hy, hz], [-hx,hy, hz], [hx,hy, hz],
            ];
            const corners = locals.map(v => {
              const r = this._quatRotateVec(q, v);
              return [r[0]+p[0], r[1]+p[1], r[2]+p[2]];
            });
            const edges = [
              [0,1],[1,3],[3,2],[2,0],
              [4,5],[5,7],[7,6],[6,4],
              [0,4],[1,5],[2,6],[3,7],
            ];
            // sample points along edges
            let pts = [];
            for(let i=0;i<edges.length;i++){
              const a = corners[edges[i][0]]; const b = corners[edges[i][1]];
              const samples = this._sampleEdgePoints(a, b, 0.05);
              for(let k=0;k<samples.length;k+=3){ pts.push(samples[k], samples[k+1], samples[k+2]); }
            }
            let arr = new Float32Array(pts);
            arr = this._applyTFPoints(arr, src, dst);
            drawObjects.push({type:"points", data: arr, colorMode:"fixed", colorUniform: col, pointSize: layer.size});
          }
        }
      }

      else if(type.endsWith("/OccupancyGrid") || type.endsWith("/msg/OccupancyGrid")) {
        // Render occupancy grid as points at z=origin.z; unknown mid gray, free light gray, occupied black
        const info = msg.info || {};
        const res = info.resolution || 1.0;
        const width = info.width || 0;
        const height = info.height || 0;
        const origin = info.origin || {position:{x:0,y:0,z:0}, orientation:{x:0,y:0,z:0,w:1}};
        const q = [origin.orientation.x||0, origin.orientation.y||0, origin.orientation.z||0, origin.orientation.w||1];
        const data = msg.data || [];
        let arr = null;
        let colsArr = null;

        const showOcc = !!layer.occShowOccupied;
        const showFree = !!layer.occShowFree;
        const showUnk = !!layer.occShowUnknown;
        const thrOcc = typeof layer.occOccupiedThreshold === 'number' ? layer.occOccupiedThreshold : 65;
        const stride = Math.max(1, parseInt(layer.occStride||1));

        if(data.length > 0) {
          const pts = [];
          const cols = [];
          for(let y=0;y<height;y+=stride){
            for(let x=0;x<width;x+=stride){
              const v = data[y*width+x];
              const yf = (height - 1 - y);
              const lx = (x+0.5)*res;
              const ly = (yf+0.5)*res;
              const r = this._quatRotateVec(q, [lx, ly, 0]);
              const wx = origin.position.x + r[0];
              const wy = origin.position.y + r[1];
              const wz = origin.position.z + r[2];

              if(v < 0) { // unknown
                if(showUnk){
                  pts.push(wx, wy, wz);
                  cols.push(0.7,0.7,0.7,1.0);
                }
              } else if(v >= thrOcc) {
                if(showOcc){
                  pts.push(wx, wy, wz);
                  cols.push(0,0,0,0.0);

                }
              } else {
                if(showFree){
                  pts.push(wx, wy, wz);
                  // cols.push(0.92,0.92,0.92,1.0);
                  cols.push(0,0,0,1.0);
                }
              }
            }
          }
          arr = new Float32Array(pts);
          colsArr = new Float32Array(cols);
        } else if(msg._data_jpeg) {
          // Fallback: decode jpeg image generated by server compression
          const layerCache = layer._occCache || (layer._occCache = {});
          if(layerCache.lastJpeg !== msg._data_jpeg || !layerCache.points ||
             layerCache._thrOcc !== thrOcc || layerCache._showOcc !== showOcc || layerCache._showFree !== showFree || layerCache._showUnk !== showUnk || layerCache._stride !== stride) {
            const img = new Image();
            img.onload = () => {
              try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const imgdata = ctx.getImageData(0,0,canvas.width, canvas.height).data;
                const scaleX = width > 0 ? width / canvas.width : 1.0;
                const scaleY = height > 0 ? height / canvas.height : 1.0;
                const pts = [];
                const cols = [];
                for(let y=0;y<canvas.height;y+=stride){
                  for(let x=0;x<canvas.width;x+=stride){
                    const idx = (y*canvas.width + x)*4;
                    const rch = imgdata[idx], gch = imgdata[idx+1], bch = imgdata[idx+2];
                    // Classify compressed colors
                    let colorType = 'free';
                    const lum = 0.299*rch + 0.587*gch + 0.114*bch;
                    if(lum < 40) colorType = 'occupied';
                    else if(rch>200 && gch>80 && gch<180 && bch<60) colorType = 'unknown';
                    const gx = Math.floor(x*scaleX);
                    const gyImg = Math.floor(y*scaleY);
                    const gy = (height - 1 - gyImg); // flip y to match server
                    const lx = (gx+0.5)*res;
                    const ly = (gy+0.5)*res;
                    const rot = this._quatRotateVec(q, [lx, ly, 0]);
                    const wx = origin.position.x + rot[0];
                    const wy = origin.position.y + rot[1];
                    const wz = origin.position.z + rot[2];

                    if(colorType === 'unknown') {
                      if(showUnk){ pts.push(wx, wy, wz); cols.push(0.7,0.7,0.7,1.0); }
                    } else if(colorType === 'occupied') {
                      if(showOcc){ pts.push(wx, wy, wz); cols.push(0,0,0,0.0); }
                    } else {
                      if(showFree){ pts.push(wx, wy, wz); cols.push(0.92,0.92,0.92,1.0); }
                    }
                  }
                }
                layerCache.points = new Float32Array(pts);
                layerCache.colors = new Float32Array(cols);
                layerCache.lastJpeg = msg._data_jpeg;
                layerCache._thrOcc = thrOcc;
                layerCache._showOcc = showOcc;
                layerCache._showFree = showFree;
                layerCache._showUnk = showUnk;
                layerCache._stride = stride;
                this._render();
              } catch(e) { console.warn('Occ jpeg decode failed', e); }
            };
            img.src = 'data:image/jpeg;base64,' + msg._data_jpeg;
          }
          if(layer._occCache && layer._occCache.points) {
            arr = layer._occCache.points;
            colsArr = layer._occCache.colors;
          }
        }

        if(arr && colsArr) {
          const src = (msg.header && msg.header.frame_id) ? msg.header.frame_id : "";
          arr = this._applyTFPoints(arr, src, dst);
          drawObjects.push({type:"points", data: arr, colors: colsArr, colorMode:"fixed", colorUniform: [1,1,1,1], pointSize: Math.max(2.5, this.layers[topic].size)});
        }
      }
    }

    // Add PCD layers to draw objects
    for (const layerId in this.pcdLayers) {
      const pcdLayer = this.pcdLayers[layerId];
      if (!pcdLayer.visible) continue;

      // Use the pre-calculated Z-based colors
      const colors = pcdLayer.colors || new Float32Array(pcdLayer.pointCount * 4);

      // Add to draw objects
      drawObjects.push({
        type: "points",
        data: pcdLayer.points,
        colors: colors,
        colorMode: "fixed",
        colorUniform: pcdLayer.color,
        pointSize: pcdLayer.pointSize
      });
    }

    this.draw(drawObjects);
  }

  onData(msg) {
    // When any message routes here (for the card's bound topic), just trigger a render.
    this._render();
  }

  _base64decode(base64) {
    var binary_string = window.atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) { bytes[i] = binary_string.charCodeAt(i); }
    return bytes.buffer;
  }

  // PCD file handling methods
  _handlePcdFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pcd')) {
      this.warn("Please select a .pcd file");
      return;
    }

    this._loadPcdFile(file);
  }

  _loadPcdFile(file) {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target.result;
        const pointCloud = this._parsePcdFile(arrayBuffer, file.name);

        if (pointCloud) {
          // Store the file path for later restoration
          pointCloud.filePath = file.name;
          this._addPcdLayer(pointCloud);
          this.fileInput.val(''); // Reset file input
        }
      } catch (error) {
        console.error('Error parsing PCD file:', error);
        this.warn("Error parsing PCD file: " + error.message);
      }
    };

    reader.onerror = () => {
      this.warn("Error reading file");
    };

    reader.readAsArrayBuffer(file);
  }

  // Method to restore PCD files from file paths (for layout import)
  _restorePcdFromPath(filePath, metadata) {
    // For now, we'll just create a placeholder since we can't access the original file
    // In a real implementation, you might want to store the file in IndexedDB or ask user to reselect
    console.log('Attempting to restore PCD from path:', filePath);

    // Create a placeholder point cloud with metadata
    const pointCloud = {
      id: metadata.id,
      name: metadata.name,
      color: metadata.color || [1.0, 1.0, 1.0, 1.0],
      visible: metadata.visible !== false,
      pointSize: metadata.pointSize || 2.0,
      pointCount: metadata.pointCount || 0,
      zmin: metadata.zmin,
      zmax: metadata.zmax,
      filePath: filePath,
      // Create empty points array as placeholder
      points: new Float32Array(0),
      colors: null
    };

    // Add to PCD layers
    const layerId = `pcd_${pointCloud.id}`;
    this.pcdLayers[layerId] = pointCloud;

    // Update counter to avoid ID conflicts
    this.pcdCounter = Math.max(this.pcdCounter, pointCloud.id);

    // Re-render the PCD layer row
    this._renderPcdLayerRow(layerId, pointCloud);

    // Show a message to the user
    if (window.showNotification) {
      window.showNotification(`PCD file "${filePath}" needs to be reloaded. Please select the file again.`);
    } else {
      this.warn(`PCD file "${filePath}" needs to be reloaded. Please select the file again.`);
    }
  }

  _getColor(v, vmin, vmax) {
    // cube edge walk from from http://paulbourke.net/miscellaneous/colourspace/
    let c = [1.0, 1.0, 1.0];

    if (v < vmin)
       v = vmin;
    if (v > vmax)
       v = vmax;
    let dv = vmax - vmin;
    if(dv < 1e-2) dv = 1e-2;

    if (v < (vmin + 0.25 * dv)) {
      c[0] = 0;
      c[1] = 4 * (v - vmin) / dv;
    } else if (v < (vmin + 0.5 * dv)) {
      c[0] = 0;
      c[2] = 1 + 4 * (vmin + 0.25 * dv - v) / dv;
    } else if (v < (vmin + 0.75 * dv)) {
      c[0] = 4 * (v - vmin - 0.5 * dv) / dv;
      c[2] = 0;
    } else {
      c[1] = 1 + 4 * (vmin + 0.75 * dv - v) / dv;
      c[2] = 0;
    }

    return(c);
  }

  _parsePcdFile(arrayBuffer, filename) {
    const dataView = new DataView(arrayBuffer);
    const decoder = new TextDecoder('utf-8');

    // Find the end of the header by looking for the DATA line
    let headerEnd = -1;
    const headerBytes = new Uint8Array(arrayBuffer);
    const headerText = decoder.decode(headerBytes);

    // Look for the DATA line in the header
    const dataLineIndex = headerText.indexOf('DATA ');
    console.log('DATA line search:', {
      headerTextLength: headerText.length,
      dataLineIndex,
      headerTextSubstring: headerText.substring(0, Math.min(200, headerText.length))
    });

    if (dataLineIndex === -1) {
      throw new Error("Invalid PCD file: Could not find DATA line");
    }

    // Find the end of the DATA line (newline character)
    const dataLineEnd = headerText.indexOf('\n', dataLineIndex);
    if (dataLineEnd === -1) {
      // If no newline found, assume the header ends at the end of the DATA line
      headerEnd = dataLineIndex + 5; // "DATA " is 5 characters
    } else {
      headerEnd = dataLineEnd + 1; // Include the newline character
    }

    // Parse header
    const headerLines = headerText.substring(0, headerEnd).split('\n');
    console.log('Header parsing details:', {
      headerEnd,
      dataOffset: headerEnd,
      headerLinesCount: headerLines.length,
      headerLines: headerLines.map((line, i) => ({ index: i, line: line.trim() }))
    });

    let width = 0, height = 0, pointCount = 0;
    let fields = [];
    let sizes = [];
    let types = [];
    let counts = [];
    let offsets = [];
    let pointStep = 0;
    let dataOffset = headerEnd;
    let isBinary = false;
    let isAscii = false;

    console.log('PCD Header parsing:', { headerEnd, dataOffset });

    for (const line of headerLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed === '') continue;

      console.log('Processing header line:', trimmed);

      if (trimmed.startsWith('VERSION')) {
        // Version line
        console.log('Found VERSION:', trimmed.substring(8));
      } else if (trimmed.startsWith('FIELDS')) {
        fields = trimmed.substring(7).split(' ');
        console.log('Found FIELDS:', fields);
      } else if (trimmed.startsWith('SIZE')) {
        sizes = trimmed.substring(5).split(' ').map(s => parseInt(s));
        console.log('Found SIZES:', sizes);
      } else if (trimmed.startsWith('TYPE')) {
        types = trimmed.substring(5).split(' ');
        console.log('Found TYPES:', types);
      } else if (trimmed.startsWith('COUNT')) {
        counts = trimmed.substring(6).split(' ').map(s => parseInt(s));
        console.log('Found COUNTS:', counts);
      } else if (trimmed.startsWith('WIDTH')) {
        width = parseInt(trimmed.substring(6));
        console.log('Found WIDTH:', width);
      } else if (trimmed.startsWith('HEIGHT')) {
        height = parseInt(trimmed.substring(7));
        console.log('Found HEIGHT:', height);
      } else if (trimmed.startsWith('POINTS')) {
        pointCount = parseInt(trimmed.substring(7));
        console.log('Found POINTS:', pointCount);
      } else if (trimmed.startsWith('DATA')) {
        const dataType = trimmed.substring(5);
        console.log('Found DATA line:', {
          fullLine: trimmed,
          dataType: dataType,
          dataTypeLength: dataType.length,
          isBinary: dataType === 'binary',
          isAscii: dataType === 'ascii'
        });
        if (dataType === 'binary') {
          isBinary = true;
        } else if (dataType === 'ascii') {
          isAscii = true;
        }
      }
    }

    if (pointCount === 0) {
      pointCount = width * height;
    }

    console.log('Final check before error:', {
      fieldsLength: fields.length,
      fields: fields,
      isBinary: isBinary,
      isAscii: isAscii,
      width: width,
      height: height,
      pointCount: pointCount
    });

    if (fields.length === 0) {
      throw new Error("PCD file must have fields defined");
    }

    if (!isBinary) {
      throw new Error("Only binary PCD files are supported. Found: " + (isAscii ? "ascii" : "unknown"));
    }

    console.log('PCD Fields found:', { fields, sizes, types, counts, width, height, pointCount });

    // Calculate offsets and point step
    let currentOffset = 0;
    for (let i = 0; i < fields.length; i++) {
      offsets.push(currentOffset);
      const size = sizes[i] || 4; // Default to 4 bytes if not specified
      const count = counts[i] || 1;
      currentOffset += size * count;
    }
    pointStep = currentOffset;

    console.log('PCD Offsets calculated:', { offsets, pointStep, fields });

    // Find x, y, z field indices (handle various field naming conventions)
    const xIndex = fields.findIndex(field => field === 'x' || field.endsWith('_x') || field.startsWith('x_'));
    const yIndex = fields.findIndex(field => field === 'y' || field.endsWith('_y') || field.startsWith('y_'));
    const zIndex = fields.findIndex(field => field === 'z' || field.endsWith('_z') || field.startsWith('z_'));

    if (xIndex === -1 || yIndex === -1) {
      throw new Error("PCD file must have x and y fields. Available fields: " + fields.join(', '));
    }

    console.log('Field indices:', { xIndex, yIndex, zIndex, xField: fields[xIndex], yField: fields[yIndex], zField: fields[zIndex] });

    // Extract point data
    const points = new Float32Array(pointCount * 3);
    let pointIndex = 0;

    for (let i = 0; i < pointCount; i++) {
      const baseOffset = dataOffset + i * pointStep;

      // Field indices are already calculated above

      // Read x, y, z coordinates
      let x = 0, y = 0, z = 0;

      if (xIndex !== -1) {
        const offset = baseOffset + offsets[xIndex];
        x = this._readPcdValue(dataView, offset, types[xIndex] || 'F', sizes[xIndex] || 4);
      }

      if (yIndex !== -1) {
        const offset = baseOffset + offsets[yIndex];
        y = this._readPcdValue(dataView, offset, types[yIndex] || 'F', sizes[yIndex] || 4);
      }

      if (zIndex !== -1) {
        const offset = baseOffset + offsets[zIndex];
        z = this._readPcdValue(dataView, offset, types[zIndex] || 'F', sizes[zIndex] || 4);
      }

      points[pointIndex * 3] = x;
      points[pointIndex * 3 + 1] = y;
      points[pointIndex * 3 + 2] = z;

      if (i < 3) { // Log first 3 points
        console.log(`Point ${i}:`, { x, y, z, baseOffset, xOffset: baseOffset + offsets[xIndex], yOffset: baseOffset + offsets[yIndex], zOffset: baseOffset + offsets[zIndex] });
      }

      pointIndex++;
    }

    return {
      id: ++this.pcdCounter,
      name: filename,
      points: points,
      pointCount: pointCount,
      color: [1.0, 1.0, 1.0, 1.0], // Default white color
      visible: true,
      pointSize: 2.0
    };
  }

  _readPcdValue(dataView, offset, type, size) {
    switch (type) {
      case 'F': // float32
        return dataView.getFloat32(offset, true); // little endian
      case 'f': // float32
        return dataView.getFloat32(offset, true);
      case 'I': // uint32
        return dataView.getUint32(offset, true);
      case 'i': // int32
        return dataView.getInt32(offset, true);
      case 'U': // uint16
        return dataView.getUint16(offset, true);
      case 'u': // int16
        return dataView.getInt16(offset, true);
      case 'B': // uint8
        return dataView.getUint8(offset);
      case 'b': // int8
        return dataView.getInt8(offset);
      default:
        return dataView.getFloat32(offset, true); // Default to float32
    }
  }

  _addPcdLayer(pointCloud) {
    // Calculate Z-based colors for the point cloud
    const colors = new Float32Array(pointCloud.pointCount * 4);

    // Find Z min/max for color scaling
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < pointCloud.pointCount; i++) {
      const z = pointCloud.points[i * 3 + 2];
      if (z < zmin) zmin = z;
      if (z > zmax) zmax = z;
    }

    // Apply Z-based colormap (same as default viewer)
    for (let i = 0; i < pointCloud.pointCount; i++) {
      const z = pointCloud.points[i * 3 + 2];
      const c = this._getColor(z, zmin, zmax);
      colors[i * 4] = c[0];     // R
      colors[i * 4 + 1] = c[1]; // G
      colors[i * 4 + 2] = c[2]; // B
      colors[i * 4 + 3] = 1.0;  // A
    }

    // Store colors with the point cloud
    pointCloud.colors = colors;
    pointCloud.zmin = zmin;
    pointCloud.zmax = zmax;

    const layerId = `pcd_${pointCloud.id}`;
    this.pcdLayers[layerId] = pointCloud;

    // Add to layers list UI
    this._renderPcdLayerRow(layerId, pointCloud);

    // Update topic selector to include PCD layers
    this._rebuildTopics();

    // Save PCD layers to localStorage for persistence
    this._savePcdLayersToStorage();

    // Trigger re-render
    this._render();
  }

  _removePcdLayer(layerId) {
    delete this.pcdLayers[layerId];
    this._renderPcdLayerRow(layerId, null); // Remove from UI

    // Also remove from layers if it was added there
    if (this.layers[layerId]) {
      delete this.layers[layerId];
    }

    // Update topic selector
    this._rebuildTopics();

    // Save PCD layers to localStorage after removal
    this._savePcdLayersToStorage();

    this._render();
  }

  _clearAllPcdLayers() {
    // Remove PCD layers from main layers if they were added there
    Object.keys(this.pcdLayers).forEach(layerId => {
      if (this.layers[layerId]) {
        delete this.layers[layerId];
      }
    });

    this.pcdLayers = {};
    // Clear PCD layers from UI
    $('.pcd-layer-row').remove();

    // Update topic selector
    this._rebuildTopics();

    // Save PCD layers to localStorage after clearing
    this._savePcdLayersToStorage();

    this._render();
  }

  _renderPcdLayerRow(layerId, pointCloud) {
    // Remove existing row if any
    $(`.pcd-layer-row[data-layer-id="${layerId}"]`).remove();

    if (!pointCloud) return; // Just removing

    const row = $('<div></div>')
      .addClass('pcd-layer-row')
      .attr('data-layer-id', layerId)
      .css({
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px',
        border: '1px solid #404040',
        borderRadius: '4px',
        backgroundColor: '#202020',
        marginTop: '4px'
      })
      .appendTo(this.layersContainer);

    // Visibility toggle
    const visibilityBtn = $('<button class="mdl-button mdl-js-button mdl-button--icon">')
      .append($('<i class="material-icons">').text(pointCloud.visible ? 'visibility' : 'visibility_off'))
      .click(() => {
        pointCloud.visible = !pointCloud.visible;
        visibilityBtn.find('i').text(pointCloud.visible ? 'visibility' : 'visibility_off');
        // Save PCD layers to localStorage after visibility change
        this._savePcdLayersToStorage();
        this._render();
      })
      .appendTo(row);

    // Layer name
    $('<span style="flex: 1; font-size: 12px;">').text(pointCloud.name).appendTo(row);

    // Point count
    $('<span style="color: #808080; font-size: 11px;">').text(`${pointCloud.pointCount} pts`).appendTo(row);

    // Remove button
    $('<button class="mdl-button mdl-js-button mdl-button--icon">')
      .append($('<i class="material-icons">').text('close'))
      .click(() => this._removePcdLayer(layerId))
      .appendTo(row);
  }

  _restorePcdLayersFromStorage() {
    try {
      if (!window.localStorage) return;

      const pcdStorageKey = `rosboard_pcd_layers_${this.card.id || 'default'}`;
      const storedPcdData = window.localStorage.getItem(pcdStorageKey);

      if (storedPcdData) {
        const pcdLayers = JSON.parse(storedPcdData);
        console.log('Restoring PCD layers from localStorage:', pcdLayers.length);

        pcdLayers.forEach(pcdData => {
          // Validate the PCD data before restoration
          if (!pcdData.points || !Array.isArray(pcdData.points) || pcdData.points.length === 0) {
            console.warn('Skipping invalid PCD data from localStorage:', pcdData.name);
            return;
          }

          // Create the point cloud object with restored data
          const pointCloud = {
            id: pcdData.id,
            name: pcdData.name,
            color: pcdData.color || [1.0, 1.0, 1.0, 1.0],
            visible: pcdData.visible !== false,
            pointSize: pcdData.pointSize || 2.0,
            points: new Float32Array(pcdData.points),
            pointCount: pcdData.pointCount,
            colors: pcdData.colors ? new Float32Array(pcdData.colors) : null,
            zmin: pcdData.zmin,
            zmax: pcdData.zmax
          };

          // Add to PCD layers
          const layerId = `pcd_${pointCloud.id}`;
          this.pcdLayers[layerId] = pointCloud;

          // Update counter to avoid ID conflicts
          this.pcdCounter = Math.max(this.pcdCounter, pointCloud.id);

          // Re-render the PCD layer row
          this._renderPcdLayerRow(layerId, pointCloud);
        });

        // Update topic selector to include restored PCD layers
        this._rebuildTopics();

        console.log('Successfully restored PCD layers from localStorage');
      }
    } catch (e) {
      console.warn('Failed to restore PCD layers from localStorage:', e);
    }
  }

  _savePcdLayersToStorage() {
    try {
      if (!window.localStorage) return;

      const pcdStorageKey = `rosboard_pcd_layers_${this.card.id || 'default'}`;
      const pcdLayersToSave = Object.values(this.pcdLayers).map(pcdLayer => ({
        id: pcdLayer.id,
        name: pcdLayer.name,
        color: pcdLayer.color,
        visible: pcdLayer.visible,
        pointSize: pcdLayer.pointSize,
        points: Array.from(pcdLayer.points),
        pointCount: pcdLayer.pointCount,
        colors: pcdLayer.colors ? Array.from(pcdLayer.colors) : null,
        zmin: pcdLayer.zmin,
        zmax: pcdLayer.zmax
      }));

      window.localStorage.setItem(pcdStorageKey, JSON.stringify(pcdLayersToSave));
      console.log('Saved PCD layers to localStorage:', pcdLayersToSave.length);
    } catch (e) {
      console.warn('Failed to save PCD layers to localStorage:', e);
    }
  }
}

Multi3DViewer.friendlyName = "Multi 3D";
// Only advertise for types we explicitly support so it won't be chosen as default for unrelated topics
Multi3DViewer.supportedTypes = [
  "sensor_msgs/msg/PointCloud2",
  "sensor_msgs/msg/PointCloud",
  "visualization_msgs/msg/MarkerArray",
  "nav_msgs/msg/OccupancyGrid",
];
Multi3DViewer.maxUpdateRate = 20.0;
Viewer.registerViewer(Multi3DViewer);

// Hook global onMsg to feed layers if the viewer exists on a card
(function(){
  const _oldOnMsg = window.onMsg;
  window.onMsg = function(msg){
    // deliver to original routing
    if(_oldOnMsg) _oldOnMsg(msg);
    // deliver to any Multi3D viewers
    try {
      const cards = Object.values(subscriptions||{}).map(s=>s.viewer).filter(v=>v && v instanceof Multi3DViewer);
      for(const v of cards){
        if(v.layers[msg._topic_name]){
          v.layers[msg._topic_name].lastMsg = msg;
          // trigger re-render opportunistically
          v._render();
        }
      }
    } catch(e) {}
  }
})();