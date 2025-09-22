"use strict";

// Space3DViewer is an extension of a Viewer that implements the common visualization
// framework for 3D stuff.
// Space3DViewer implements drawing functionality, but does not implement any
// message decoding functionality. Child classes that inherit from Space3DViewer
// should decode a message and instruct the plotting framework what to do.

class Space3DViewer extends Viewer {
  /**
    * Gets called when Viewer is first initialized.
    * @override
  **/
  onCreate() {
    // silly css nested div hell to force 100% width
    // but keep 1:1 aspect ratio

    this.wrapper = $('<div></div>')
      .css({
        "position": "relative",
        "width": "100%",
      })
      .appendTo(this.card.content);

    this.wrapper2 = $('<div></div>')
      .css({
        "width": "100%",
        "height": "0",
        "padding-bottom": "100%",
        "background": "#303035",
        "position": "relative",
        "overflow": "hidden",
      })
      .appendTo(this.wrapper);

    let that = this;

    this.gl = GL.create({ version:1, width: 500, height: 500});
	  this.wrapper2[0].appendChild(this.gl.canvas);
    $(this.gl.canvas).css({ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" });
    // Fallback DOM events for picking across browsers
    this.gl.canvas.addEventListener('click', (ev)=>{ try{ this._onCanvasClick(ev); }catch(e){} });
	  this.gl.animate(); // launch loop

		this.cam_pos = [0,100,100];
    this.cam_theta = -1.5707;
    this.cam_phi = 1.0;
    this.cam_r = 50.0;
    this.cam_offset_x = 0.0;
    this.cam_offset_y = 0.0;
    this.cam_offset_z = 0.0;

    this.drawObjectsGl = null;

    //create basic matrices for cameras and transformation
    this.proj = mat4.create();
    this.view = mat4.create();
    this.model = mat4.create();
    this.mvp = mat4.create();
    this.temp = mat4.create();

    this.gl.captureMouse(true, true);
    this.gl.onmouse = function(e) {
			if(e.dragging) {
        if(e.rightButton) {
          that.cam_offset_x += e.deltax/30 * Math.sin(that.cam_theta);
          that.cam_offset_y -= e.deltax/30 * Math.cos(that.cam_theta);
          that.cam_offset_z += e.deltay/30;
          that.updatePerspective();
        } else {
          // Normal camera rotation
          if(Math.abs(e.deltax) > 100 || Math.abs(e.deltay) > 100) return;
          that.cam_theta -= e.deltax / 300;
          that.cam_phi -= e.deltay / 300;

          // avoid euler singularities
          // also don't let the user flip the entire cloud around
          if(that.cam_phi < 0) {
            that.cam_phi = 0.001;
          }
          if(that.cam_phi > Math.PI) {
            that.cam_phi = Math.PI - 0.001;
          }
          that.updatePerspective();
        }
			}
      // click picking (left click without drag)
      if(!e.dragging && !e.rightButton && e.buttons === 0 && e.event && e.event.type === 'mouseup') {
        try { that._onCanvasClick(e.event); } catch(err) { console.warn('pick error', err); }
      }
		}

    this.gl.onmousewheel = function(e) {
      that.cam_r -= e.delta;
      if(that.cam_r < 1.0) that.cam_r = 1.0;
      if(that.cam_r > 1000.0) that.cam_r = 1000.0;
      that.updatePerspective();
    }

    // Add direct mouse event listeners for pose orientation
    this.gl.canvas.addEventListener('mousedown', function(evt) {
      if (that._pickingMode && that._pubMode === 'pose' && that._currentPose && that._poseOrientationMode) {
        that._isDraggingPose = true;
        that._lastMousePos = { x: evt.clientX, y: evt.clientY };
        that.tip('Dragging pose orientation...');
        evt.preventDefault();
      }
    });

    this.gl.canvas.addEventListener('mousemove', function(evt) {
      if (that._isDraggingPose && that._currentPose) {
        const rect = that.gl.canvas.getBoundingClientRect();
        const mouseX = evt.clientX - rect.left;
        const mouseY = evt.clientY - rect.top;
        
        // Try to get the pose screen position first
        const poseScreenPos = that._worldToScreen(that._currentPose.x, that._currentPose.y, that._currentPose.z);
        
        let yaw;
        if (poseScreenPos) {
          // Use actual pose position as reference
          const dx = mouseX - poseScreenPos.x;
          const dy = poseScreenPos.y - mouseY; // Flip Y-axis for correct rotation
          yaw = Math.atan2(dy, dx) - Math.PI / 2; // Adjust for 90-degree offset
          console.log('Using pose position as reference:', poseScreenPos);
        } else {
          // Fallback: use a simple approach based on pose world position
          // Convert pose world position to a rough screen estimate
          const rect = that.gl.canvas.getBoundingClientRect();
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          
          // Simple projection: assume pose is roughly at center of view
          // This is a fallback when proper coordinate conversion fails
          const dx = mouseX - centerX;
          const dy = centerY - mouseY; // Flip Y-axis for correct rotation
          yaw = Math.atan2(dy, dx) - Math.PI / 2; // Adjust for 90-degree offset
          console.log('Using canvas center as fallback reference');
        }
        
        console.log('Mouse:', mouseX, mouseY, 'Yaw:', (yaw * 180 / Math.PI).toFixed(1) + '°');
        
        that._currentPose.yaw = yaw;
        that.tip(`Pose orientation: ${(yaw * 180 / Math.PI).toFixed(1)}°`);
        that.draw(that.drawObjects || []);
        evt.preventDefault();
      }
    });

    this.gl.canvas.addEventListener('mouseup', function(evt) {
      if (that._isDraggingPose) {
        console.log('Mouse up - stopping drag, keeping orientation mode');
        that._isDraggingPose = false;
        // Don't disable orientation mode yet - let user continue adjusting
        that.tip('Pose orientation set. Click and drag to adjust, or click "Publish Pose" to publish.');
        evt.preventDefault();
      }
    });

    this.updatePerspective = () => {
      that.cam_pos[0] = that.cam_offset_x + that.cam_r * Math.sin(that.cam_phi) * Math.cos(that.cam_theta);
      that.cam_pos[1] = that.cam_offset_y + that.cam_r * Math.sin(that.cam_phi) * Math.sin(that.cam_theta);
      that.cam_pos[2] = that.cam_offset_z + that.cam_r * Math.cos(that.cam_phi);

      that.view = mat4.create();
      mat4.perspective(that.proj, 45 * DEG2RAD, that.gl.canvas.width / that.gl.canvas.height, 0.1, 1000);
      mat4.lookAt(that.view, that.cam_pos, [this.cam_offset_x,this.cam_offset_y, this.cam_offset_z], [0,0,1]);
	    mat4.multiply(that.mvp, that.proj, that.view);
    }

    this.updatePerspective();

    this.shader = new Shader('\
      precision highp float;\
      attribute vec3 a_vertex;\
      attribute vec4 a_color;\
      uniform mat4 u_mvp;\
      uniform float u_pointSize;\
      varying vec4 v_color;\
      void main() {\
          v_color = a_color;\
          gl_Position = u_mvp * vec4(a_vertex,1.0);\
          gl_PointSize = u_pointSize;\
      }\
      ', '\
      precision highp float;\
      uniform vec4 u_color;\
      varying vec4 v_color;\
      void main() {\
        gl_FragColor = u_color * v_color;\
      }\
    ');
    //generic gl flags and settings
    this.gl.clearColor(0.1,0.1,0.1,1);
    // Enable depth testing and alpha blending for correct 3D rendering
    this.gl.enable( this.gl.DEPTH_TEST );
    this.gl.depthFunc( this.gl.LEQUAL );
    this.gl.enable( this.gl.BLEND );
    this.gl.blendFunc( this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA );

    // defaults for uniforms if not provided per-object
    this.defaultPointSize = 1.5;

    //rendering loop
    this.gl.ondraw = function() {
      // synchronize canvas pixel size to wrapper2 client box (includes padding)
      const cw = that.wrapper2[0].clientWidth;
      const ch = that.wrapper2[0].clientHeight;
      if(cw && ch && (that.gl.canvas.width !== cw || that.gl.canvas.height !== ch)) {
        that.gl.canvas.width = cw;
        that.gl.canvas.height = ch;
        that.gl.viewport(0,0,cw,ch);
        that.updatePerspective();
      }

      that.gl.clear( that.gl.COLOR_BUFFER_BIT | that.gl.DEPTH_BUFFER_BIT );
      if(!that.drawObjectsGl) return;
      for(let i in that.drawObjectsGl) {
        if(that.drawObjectsGl[i].type === "points") {
          const colorUniform = that.drawObjectsGl[i].colorUniform || [1,1,1,1];
          const pointSize = that.drawObjectsGl[i].pointSize || that.defaultPointSize;
          that.shader.uniforms({
            u_color: colorUniform,
            u_mvp: that.mvp,
            u_pointSize: pointSize,
          }).draw(that.drawObjectsGl[i].mesh, gl.POINTS);
        } else if(that.drawObjectsGl[i].type === "lines") {
          const colorUniform = that.drawObjectsGl[i].colorUniform || [1,1,1,1];
          that.shader.uniforms({
            u_color: colorUniform,
            u_mvp: that.mvp,
            u_pointSize: that.defaultPointSize,
          }).draw(that.drawObjectsGl[i].mesh, gl.LINES);
        }
      }
    };

    // initialize static mesh for grid

    this.gridPoints = [];
    this.gridColors = [];
    for(let x=-5.0;x<=5.0+0.001;x+=1.0) {
      this.gridPoints.push(x);
      this.gridPoints.push(-5);
      this.gridPoints.push(0);
      this.gridPoints.push(x);
      this.gridPoints.push(5);
      this.gridPoints.push(0);
      for(let i=0;i<8;i++) {
        this.gridColors.push(1);
      }
    }

    for(let y=-5.0;y<=5.0+0.001;y+=1.0) {
      this.gridPoints.push(-5);
      this.gridPoints.push(y);
      this.gridPoints.push(0);
      this.gridPoints.push(5);
      this.gridPoints.push(y);
      this.gridPoints.push(0);
      for(let i=0;i<8;i++) {
        this.gridColors.push(1);
      }
    }

    this.gridMesh = GL.Mesh.load({vertices: this.gridPoints, colors: this.gridColors}, null, null, this.gl);

    // initialize static mesh for axes

    this.axesPoints = [ 0,0,0, 1,0,0, 0,0,0, 0,1,0, 0,0,0, 0,0,1, ];
    this.axesColors = [ 1,0,0,1, 1,0,0,1, 0,1,0,1, 0,1,0,1, 0,0.5,1,1, 0,0.5,1,1, ];

    this.axesMesh = GL.Mesh.load({vertices: this.axesPoints, colors: this.axesColors});

    // Annotation publish UI
    this._initPublishUI();
  }

  // Persist camera parameters (view angle/zoom/offset)
  serializeState(){
    try {
      return {
        cam_theta: this.cam_theta,
        cam_phi: this.cam_phi,
        cam_r: this.cam_r,
        cam_offset_x: this.cam_offset_x,
        cam_offset_y: this.cam_offset_y,
        cam_offset_z: this.cam_offset_z,
      };
    } catch(e) { return null; }
  }

  // Restore camera parameters
  applyState(state){
    try {
      if(!state) return;
      if(typeof state.cam_theta === 'number') this.cam_theta = state.cam_theta;
      if(typeof state.cam_phi === 'number') this.cam_phi = state.cam_phi;
      if(typeof state.cam_r === 'number') this.cam_r = state.cam_r;
      if(typeof state.cam_offset_x === 'number') this.cam_offset_x = state.cam_offset_x;
      if(typeof state.cam_offset_y === 'number') this.cam_offset_y = state.cam_offset_y;
      if(typeof state.cam_offset_z === 'number') this.cam_offset_z = state.cam_offset_z;

      // Ensure camera perspective is updated after restoring state
      if(this.updatePerspective) {
        this.updatePerspective();
        // Force a redraw to ensure the camera changes are applied
        if(this.draw) this.draw(this.drawObjects||[]);
      }
    } catch(e){
      console.warn('Error restoring camera state:', e);
    }
  }

  _initPublishUI(){
    const bar = $('<div></div>').css({display:'flex', gap:'4px', alignItems:'center', padding:'4px 6px', borderTop:'1px solid rgba(255,255,255,0.06)', flexWrap:'wrap'}).appendTo(this.card.content);
    $('<span style="color:#ccc;font-size:10px;">Annotate</span>').appendTo(bar);
    
    // Mode selection (only visible when not in picking mode)
    this._pubMode = 'pose'; // 'pose' or 'path'
    this._pickingMode = false; // true when user is picking points
    this._pickedPoints = []; // [{x,y,z}]
    this._currentPose = null; // {x,y,z,yaw} for pose mode
    this._poseOrientationMode = false; // true when adjusting pose orientation
    this._isDraggingPose = false; // true when dragging pose orientation
    this._lastMousePos = null; // last mouse position for pose dragging
    
    this._modeSelect = $('<select></select>').css({maxWidth:'90px'}).append('<option value="pose">Pose</option>').append('<option value="path">Path</option>').val(this._pubMode).change(()=>{ this._pubMode = this._modeSelect.val(); this._syncDefaultTopic(); }).appendTo(bar);
    
    this._pubFrame = $('<input type="text" placeholder="frame" title="frame (default: map)"/>').css({width:'90px', fontSize:'11px'}).appendTo(bar);
    
    // frames dropdown
    const framesSel = $('<select></select>').css({maxWidth:'110px'}).append('<option value="">(frames)</option>').appendTo(bar);
    this._refreshFramesDropdown = () => {
      try {
        if(!window.ROSBOARD_TF) return;
        const frames = window.ROSBOARD_TF.getFrames();
        const prev = framesSel.val();
        const curOpts = Array.from(framesSel.find('option')).map(o=>o.value).join(',');
        const nextOpts = [''].concat(frames).join(',');
        if(curOpts !== nextOpts){ framesSel.empty(); framesSel.append('<option value="">(frames)</option>'); frames.forEach(f=>framesSel.append(`<option value="${f}">${f}</option>`)); framesSel.val(prev||''); }
      } catch(e){}
    };
    setInterval(this._refreshFramesDropdown, 1000);
    framesSel.on('change', ()=>{ const v = framesSel.val(); if(v){ this._pubFrame.val(v); }});
    
    this._pubTopic = $('<input type="text" placeholder="topic" title="topic (default: /clicked_pose)"/>').css({width:'140px', fontSize:'11px'}).appendTo(bar);
    
    // Publish button - changes behavior based on mode
    this._btnPub = $('<button class="mdl-button mdl-js-button mdl-button--raised">Start Picking</button>').css({padding:'2px 6px', minWidth:'auto', color:'#fff'}).appendTo(bar);
    
    // Reset button
    const btnReset = $('<button class="mdl-button mdl-js-button">Reset</button>').css({padding:'2px 6px', minWidth:'auto', color:'#fff'}).appendTo(bar);

    // Status label to show current state
    this._statusLabel = $('<span style="color:#4caf50;font-size:10px;margin-left:8px;"></span>').appendTo(bar);

    btnReset.click(()=>{ this._resetPicking(); });
    this._btnPub.click(()=>{ this._handlePublishClick(); });
    this._syncDefaultTopic();
  }

  _syncDefaultTopic(){
    if(!this._pubTopic) return;
    if(this._pubMode === 'pose'){
      const v = this._pubTopic.val();
      if(!v || v === '/clicked_path') this._pubTopic.val('/clicked_pose');
      this._pubTopic.attr('title','topic (default: /clicked_pose)');
    } else {
      const v = this._pubTopic.val();
      if(!v || v === '/clicked_pose') this._pubTopic.val('/clicked_path');
      this._pubTopic.attr('title','topic (default: /clicked_path)');
    }
  }

  _handlePublishClick(){
    if (!this._pickingMode) {
      // Start picking mode
      this._startPickingMode();
    } else {
      // In picking mode - publish based on current mode
      if (this._pubMode === 'pose') {
        this._publishPose();
      } else {
        this._publishPath();
      }
    }
  }

  _startPickingMode(){
    this._pickingMode = true;
    this._pickedPoints = [];
    this._currentPose = null;
    
    // Update UI
    this._btnPub.text(this._pubMode === 'pose' ? 'Publish Pose' : 'Publish Path');
    this._modeSelect.prop('disabled', true);
    this._statusLabel.text(this._pubMode === 'pose' ? 'Click and drag to set pose' : 'Click points for path');
    
    this.tip(`Started ${this._pubMode} picking mode`);
  }

  _resetPicking(){
    console.log('Resetting picking mode - this will disable orientation mode');
    this._pickingMode = false;
    this._pickedPoints = [];
    this._currentPose = null;
    this._poseOrientationMode = false;
    this._isDraggingPose = false;
    this._lastMousePos = null;
    
    // Update UI
    this._btnPub.text('Start Picking');
    this._modeSelect.prop('disabled', false);
    this._statusLabel.text('');
    
    this.tip('Reset picking mode');
    this.draw(this.drawObjects || []);
  }

  _publishPose(){
    if (!this._currentPose) {
      this.warn('No pose selected. Click and drag to set position and orientation.');
      return;
    }

    try {
      const transport = this._getTransport();
      if(!transport || !transport.publish) { this.warn('Publish not supported by transport'); return; }
      
      const frame = (this._pubFrame.val()||'map');
      const topic = (this._pubTopic.val()||'/clicked_pose');
      
      const msg = {
        header: { frame_id: frame },
        pose: { 
          position: {x: this._currentPose.x, y: this._currentPose.y, z: this._currentPose.z}, 
          orientation: this._quatFromYaw(this._currentPose.yaw)
        }
      };
      
      transport.publish({topicName: topic, topicType: 'geometry_msgs/msg/PoseStamped', message: msg});
      this.tip(`Published PoseStamped to ${topic}`);
      this._resetPicking();
    } catch(e) {
      console.warn('publish pose error', e);
      this.warn('Publish failed: '+e.message);
    }
  }

  _publishPath(){
    if (this._pickedPoints.length < 2) {
      this.warn('Path needs at least 2 points. Click more points.');
      return;
    }

    try {
      const transport = this._getTransport();
      if(!transport || !transport.publish) { this.warn('Publish not supported by transport'); return; }
      
      const frame = (this._pubFrame.val()||'map');
      const topic = (this._pubTopic.val()||'/clicked_path');
      
      const poses = this._pickedPoints.map(pt=>({ 
        header:{frame_id:frame}, 
        pose:{position:{x:pt.x,y:pt.y,z:pt.z}, orientation:{x:0,y:0,z:0,w:1}} 
      }));
      
      const msg = { header:{ frame_id:frame }, poses: poses };
      transport.publish({topicName: topic, topicType: 'nav_msgs/msg/Path', message: msg});
      this.tip(`Published Path with ${poses.length} poses to ${topic}`);
      this._resetPicking();
    } catch(e) {
      console.warn('publish path error', e);
      this.warn('Publish failed: '+e.message);
    }
  }

  _quatFromYaw(yaw) {
    return {
      x: 0,
      y: 0,
      z: Math.sin(yaw / 2),
      w: Math.cos(yaw / 2)
    };
  }

  _updatePickingStatus(){
    if (!this._pickingMode) return;
    
    if (this._pubMode === 'pose') {
      if (this._currentPose) {
        this._statusLabel.text(`Pose ready: (${this._currentPose.x.toFixed(2)}, ${this._currentPose.y.toFixed(2)}) ${(this._currentPose.yaw * 180 / Math.PI).toFixed(1)}°`);
      } else {
        this._statusLabel.text('Click to set pose position');
      }
    } else {
      this._statusLabel.text(`Path: ${this._pickedPoints.length} points`);
    }
  }

  _worldToScreen(wx, wy, wz) {
    try {
      // Convert world coordinates to screen coordinates
      const worldPos = vec4.fromValues(wx, wy, wz, 1.0);
      const clipPos = vec4.create();
      const ndcPos = vec4.create();
      
      // Transform to clip space
      vec4.transformMat4(clipPos, worldPos, this.mvp);
      
      // Convert to NDC
      ndcPos[0] = clipPos[0] / clipPos[3];
      ndcPos[1] = clipPos[1] / clipPos[3];
      ndcPos[2] = clipPos[2] / clipPos[3];
      
      // Check if point is behind camera or outside view
      if (ndcPos[2] > 1.0 || ndcPos[2] < -1.0) {
        return null;
      }
      
      // Check if point is outside screen bounds
      if (Math.abs(ndcPos[0]) > 1.0 || Math.abs(ndcPos[1]) > 1.0) {
        return null;
      }
      
      // Convert NDC to screen coordinates
      const rect = this.gl.canvas.getBoundingClientRect();
      const screenX = (ndcPos[0] + 1.0) * 0.5 * rect.width;
      const screenY = (1.0 - ndcPos[1]) * 0.5 * rect.height;
      
      return { x: screenX, y: screenY };
    } catch (error) {
      console.warn('Error in _worldToScreen:', error);
      return null;
    }
  }


  _getTransport(){
    try { if(typeof currentTransport !== 'undefined' && currentTransport) return currentTransport; } catch(e){}
    return (window.currentTransport || null);
  }

  _publishPicked(){
    const transport = this._getTransport();
    if(!transport || !transport.publish) { this.warn('Publish not supported by transport'); return; }
    const frame = (this._pubFrame.val()||'map');
    const topic = (this._pubTopic.val()|| (this._pubMode==='pose'?'/clicked_pose':'/clicked_path'));
    // If <=1 point, always publish Pose; otherwise publish Path
    const isPose = (this._pickedPoints.length <= 1);
    if(isPose){
      if(this._pickedPoints.length < 1) { this.warn('Pick a point in 3D'); return; }
      const p = this._pickedPoints[this._pickedPoints.length-1];
      const msg = {
        header: { frame_id: frame },
        pose: { position: {x:p.x,y:p.y,z:p.z}, orientation: {x:0,y:0,z:0,w:1} }
      };
      transport.publish({topicName: topic, topicType: 'geometry_msgs/msg/PoseStamped', message: msg});
      this.tip(`Published PoseStamped to ${topic}`);
    } else {
      // path
      const poses = this._pickedPoints.map(pt=>({ header:{frame_id:frame}, pose:{position:{x:pt.x,y:pt.y,z:pt.z}, orientation:{x:0,y:0,z:0,w:1}} }));
      const msg = { header:{ frame_id:frame }, poses: poses };
      transport.publish({topicName: topic, topicType: 'nav_msgs/msg/Path', message: msg});
      this.tip(`Published Path to ${topic}`);
    }
  }

  _onCanvasClick(evt){
    // Only handle clicks when in picking mode
    if (!this._pickingMode) return;

    // Dedup clicks: ignore multiple events within small time and distance window
    const now = performance && performance.now ? performance.now() : Date.now();
    if(!this._lastPick) this._lastPick = {t:0,x:0,y:0};
    const rect0 = this.gl.canvas.getBoundingClientRect();
    const sx = (evt.clientX - rect0.left);
    const sy = (evt.clientY - rect0.top);
    const dt = now - this._lastPick.t;
    const dx = sx - this._lastPick.x;
    const dy = sy - this._lastPick.y;
    if(dt < 150 && (dx*dx + dy*dy) < 4) { return; }
    this._lastPick = {t: now, x: sx, y: sy};

    // Compute pick ray in world and intersect with plane z=0 in viewer coordinates
    const rect = this.gl.canvas.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((evt.clientY - rect.top) / rect.height) * 2 - 1);

    // Inverse matrices
    const invProj = mat4.create();
    const invView = mat4.create();
    mat4.invert(invProj, this.proj);
    mat4.invert(invView, this.view);

    const near = vec4.fromValues(x, y, -1, 1);
    const far = vec4.fromValues(x, y, 1, 1);

    // unproject to view space
    vec4.transformMat4(near, near, invProj);
    vec4.transformMat4(far, far, invProj);
    near[0] /= near[3]; near[1] /= near[3]; near[2] /= near[3];
    far[0] /= far[3]; far[1] /= far[3]; far[2] /= far[3];

    // to world space
    vec4.transformMat4(near, near, invView);
    vec4.transformMat4(far, far, invView);
    near[0] /= near[3]; near[1] /= near[3]; near[2] /= near[3];
    far[0] /= far[3]; far[1] /= far[3]; far[2] /= far[3];

    const rayOrigin = [near[0], near[1], near[2]];
    const rayDir = [far[0]-near[0], far[1]-near[1], far[2]-near[2]];
    const invLen = 1.0 / Math.hypot(rayDir[0], rayDir[1], rayDir[2]);
    rayDir[0]*=invLen; rayDir[1]*=invLen; rayDir[2]*=invLen;

    // intersect with plane z=0 (viewer world)
    const t = -rayOrigin[2] / (rayDir[2] || 1e-9);
    if(t < 0) return;
    const hit = { x: rayOrigin[0] + t*rayDir[0], y: rayOrigin[1] + t*rayDir[1], z: 0 };

    if (this._pubMode === 'pose') {
      // For pose mode, start with position and default orientation
      // Only reset yaw if this is the first time setting the pose
      if (!this._currentPose) {
        this._currentPose = { x: hit.x, y: hit.y, z: hit.z, yaw: 0 };
      } else {
        // Keep existing yaw, just update position
        this._currentPose.x = hit.x;
        this._currentPose.y = hit.y;
        this._currentPose.z = hit.z;
      }
      this._pickedPoints = [hit]; // Store for visualization
      this._poseOrientationMode = true; // Enable orientation mode
      console.log('Pose position set, orientation mode enabled:', this._poseOrientationMode);
      this.tip(`Pose position set. Click and drag to adjust orientation.`);
    } else {
      // For path mode, add point to path
      // Avoid adding duplicates (same as last point)
      if(this._pickedPoints && this._pickedPoints.length){
        const lp = this._pickedPoints[this._pickedPoints.length-1];
        const ddx = hit.x - lp.x, ddy = hit.y - lp.y, ddz = hit.z - lp.z;
        if((ddx*ddx + ddy*ddy + ddz*ddz) < 1e-6) { return; }
      }
      
      this._pickedPoints.push(hit);
      this.tip(`Path point ${this._pickedPoints.length} added. Click "Publish Path" when done.`);
    }
    
    // Update status
    this._updatePickingStatus();
    
    // force rebuild to show overlay immediately
    this.draw(this.drawObjects || []);
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

  draw(drawObjects) {
    this.drawObjects = drawObjects;
    let drawObjectsGl = [];

    // draw grid

    drawObjectsGl.push({type: "lines", mesh: this.gridMesh});

    // draw axes

    drawObjectsGl.push({type: "lines", mesh: this.axesMesh});

    for(let i in drawObjects) {
      let drawObject = drawObjects[i];
      if(drawObject.type === "points") {
        // Use pre-built mesh when available to avoid re-uploading buffers each draw
        if (drawObject.mesh) {
          drawObjectsGl.push({
            type: "points",
            mesh: drawObject.mesh,
            colorUniform: drawObject.colorUniform || [1,1,1,1],
            pointSize: drawObject.pointSize || this.defaultPointSize,
          });
          continue;
        }
        // Guard against malformed objects (e.g., colors without data)
        const points = drawObject.data;
        if(!points || !points.length) {
          continue;
        }
        let colors = null;
        if(drawObject.colors && drawObject.colors.length === (points.length/3*4)) {
          colors = drawObject.colors;
        } else {
          colors = new Float32Array(points.length / 3 * 4);
          let zmin = drawObject.zmin || -2;
          let zmax = drawObject.zmax || 2;
          let colorMode = drawObject.colorMode || "z"; // "z" or "fixed"
          if(colorMode === "fixed") {
            // per-vertex color is white; actual color supplied via uniform
            for(let j=0; j < points.length / 3; j++) {
              colors[4*j] = 1.0;
              colors[4*j+1] = 1.0;
              colors[4*j+2] = 1.0;
              colors[4*j+3] = 1.0;
            }
          } else {
            // z-based colormap
            for(let j=0; j < points.length / 3; j++) {
              let c = this._getColor(points[3*j+2], zmin, zmax)
              colors[4*j] = c[0];
              colors[4*j+1] = c[1];
              colors[4*j+2] = c[2];
              colors[4*j+3] = 1;
            }
          }
        }
        const mesh = GL.Mesh.load({vertices: points, colors: colors}, null, null, this.gl);
        drawObjectsGl.push({
          type: "points",
          mesh: mesh,
          colorUniform: drawObject.colorUniform || [1,1,1,1],
          pointSize: drawObject.pointSize || this.defaultPointSize,
        });
      } else if(drawObject.type === "lines" && drawObject.mesh) {
        drawObjectsGl.push({ type: "lines", mesh: drawObject.mesh, colorUniform: drawObject.colorUniform || [1,1,1,1] });
      }
    }

    // overlays: picked points and pose visualization
    if(this._pickingMode) {
      if(this._pubMode === 'pose' && this._currentPose) {
        // Show pose position and orientation arrow
        const pos = this._currentPose;
        const verts = [pos.x, pos.y, pos.z];
        const vColors = new Float32Array([1, 1, 1, 1]);
        const ptMesh = GL.Mesh.load({vertices: verts, colors: vColors}, null, null, this.gl);
        drawObjectsGl.push({ type: 'points', mesh: ptMesh, colorUniform: [0.0, 1.0, 1.0, 1.0], pointSize: 8.0 });
        
        // Draw orientation arrow
        const arrowLength = 2.0;
        const arrowHeadLength = 0.5;
        const arrowHeadWidth = 0.3;
        
        const endX = pos.x + arrowLength * Math.cos(pos.yaw);
        const endY = pos.y + arrowLength * Math.sin(pos.yaw);
        
        // Arrow stem
        const stemVerts = [pos.x, pos.y, pos.z, endX, endY, pos.z];
        const stemColors = new Float32Array([1, 1, 0, 1, 1, 1, 0, 1]);
        const stemMesh = GL.Mesh.load({vertices: stemVerts, colors: stemColors}, null, null, this.gl);
        drawObjectsGl.push({ type: 'lines', mesh: stemMesh, colorUniform: [1.0, 1.0, 0.0, 1.0] });
        
        // Arrow head
        const headLeftX = endX + arrowHeadLength * Math.cos(pos.yaw + 2.5);
        const headLeftY = endY + arrowHeadLength * Math.sin(pos.yaw + 2.5);
        const headRightX = endX + arrowHeadLength * Math.cos(pos.yaw - 2.5);
        const headRightY = endY + arrowHeadLength * Math.sin(pos.yaw - 2.5);
        
        const headVerts = [endX, endY, pos.z, headLeftX, headLeftY, pos.z, endX, endY, pos.z, headRightX, headRightY, pos.z];
        const headColors = new Float32Array([1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1]);
        const headMesh = GL.Mesh.load({vertices: headVerts, colors: headColors}, null, null, this.gl);
        drawObjectsGl.push({ type: 'lines', mesh: headMesh, colorUniform: [1.0, 1.0, 0.0, 1.0] });
        
      } else if(this._pubMode === 'path' && this._pickedPoints && this._pickedPoints.length > 0) {
        // Show path points and connecting lines
        const verts = [];
        for(let i=0;i<this._pickedPoints.length;i++){ const p=this._pickedPoints[i]; verts.push(p.x,p.y,p.z); }
        const vColors = new Float32Array(this._pickedPoints.length*4);
        for(let i=0;i<this._pickedPoints.length;i++){ vColors[4*i]=1; vColors[4*i+1]=1; vColors[4*i+2]=1; vColors[4*i+3]=1; }
        const ptMesh = GL.Mesh.load({vertices: verts, colors: vColors}, null, null, this.gl);
        drawObjectsGl.push({ type: 'points', mesh: ptMesh, colorUniform: [0.0, 1.0, 0.0, 1.0], pointSize: 6.0 });
        
        if(this._pickedPoints.length > 1) {
          const lineVerts = [];
          for(let i=0;i<this._pickedPoints.length-1;i++){ const a=this._pickedPoints[i], b=this._pickedPoints[i+1]; lineVerts.push(a.x,a.y,a.z, b.x,b.y,b.z); }
          const lineColors = new Float32Array((this._pickedPoints.length-1)*2*4); for(let i=0;i<lineColors.length/4;i++){ lineColors[4*i]=0; lineColors[4*i+1]=1; lineColors[4*i+2]=0; lineColors[4*i+3]=1; }
          const lineMesh = GL.Mesh.load({vertices: lineVerts, colors: lineColors}, null, null, this.gl);
          drawObjectsGl.push({ type: 'lines', mesh: lineMesh, colorUniform: [0.0, 1.0, 0.0, 1.0] });
        }
      }
    }

    this.drawObjectsGl = drawObjectsGl;
  }
}

Space3DViewer.supportedTypes = [
];

Space3DViewer.maxUpdateRate = 10.0;

Viewer.registerViewer(Space3DViewer);