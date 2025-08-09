"use strict";

class Multi3DViewer extends Space3DViewer {
  onCreate() {
    super.onCreate();

    this.layers = {}; // topicName -> layer config and data

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
    const entries = Object.entries(currentTopics).filter(([name, type]) => {
      return type && (
        type.endsWith("/PointCloud2") || type.endsWith("/PointCloud") ||
        type.endsWith("/MarkerArray") || type.endsWith("/OccupancyGrid") ||
        type.endsWith("/msg/PointCloud2") || type.endsWith("/msg/PointCloud") ||
        type.endsWith("/msg/MarkerArray") || type.endsWith("/msg/OccupancyGrid")
      );
    }).sort((a,b)=> a[0].localeCompare(b[0]));
    const nextStr = entries.map(e=>e[0]).join(',');
    const prevStr = Array.from(this.topicSelect.find('option')).map(o=>o.value).join(',');
    if(nextStr !== prevStr) {
      this.topicSelect.empty();
      entries.forEach(([n,t])=> this.topicSelect.append(`<option value="${n}">${n} (${t.split('/').pop()})</option>`));
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
    const type = currentTopics[topic];
    const layer = {
      type,
      color: [1,1,1,1],
      size: 2.0,
      visible: true,
      lastMsg: null,
      baseFrame: this.baseSelect.val() || "",
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
    const vis = $('<input type="checkbox" checked/>').change(()=>{ layer.visible = vis.is(':checked'); }).appendTo(row);
    const color = $('<input type="color" value="#ffffff"/>').change(()=>{
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
          const data = this._base64decode(msg.data);
          const dv = new DataView(data);
          const little = !msg.is_bigendian;
          const xOff = fields["x"]?fields["x"].offset:0;
          const yOff = fields["y"]?fields["y"].offset:0;
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
        // Render occupancy grid as points in 3D at z=0 (map frame). Use resolution and origin.
        const info = msg.info || {};
        const res = info.resolution || 1.0;
        const width = info.width || 0;
        const height = info.height || 0;
        const origin = info.origin || {position:{x:0,y:0,z:0}, orientation:{x:0,y:0,z:0,w:1}};
        const data = msg.data || [];
        const pts = [];
        const cols = [];
        for(let y=0;y<height;y++){
          for(let x=0;x<width;x++){
            const v = data[y*width+x];
            if(v < 0) continue; // unknown skip
            const wx = origin.position.x + (x+0.5)*res;
            const wy = origin.position.y + (y+0.5)*res;
            const wz = origin.position.z;
            pts.push(wx, wy, wz);
            const occ = Math.max(0, Math.min(100, v))/100.0;
            const c = 1.0 - occ; // free white, occupied darker
            cols.push(c,c,c,1.0);
          }
        }
        let arr = new Float32Array(pts);
        const src = (msg.header && msg.header.frame_id) ? msg.header.frame_id : "";
        arr = this._applyTFPoints(arr, src, dst);
        drawObjects.push({type:"points", data: arr, colors: new Float32Array(cols), colorMode:"fixed", colorUniform: [1,1,1,1], pointSize: layer.size});
      }
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