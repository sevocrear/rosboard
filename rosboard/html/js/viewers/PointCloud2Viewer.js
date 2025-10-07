"use strict";

class PointCloud2Viewer extends Space3DViewer {
  _base64decode(base64) {
    var binary_string = window.atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }

  _getDataGetter(datatype, view) {
    // given a JS DataView view and a ROS PointField datatype,
    // fetch the getXXX function for that datatype.
    // (needed to bind it back to the view before returning, or else it doesn't work)
    // used for decoding raw point clouds

    switch(datatype) {
      case PointCloud2Viewer.INT8:
        return view.getInt8.bind(view);
      case PointCloud2Viewer.UINT8:
        return view.getUint8.bind(view);
      case PointCloud2Viewer.INT16:
        return view.getInt16.bind(view);
      case PointCloud2Viewer.UINT16:
        return view.getUint16.bind(view);
      case PointCloud2Viewer.INT32:
        return view.getInt32.bind(view);
      case PointCloud2Viewer.UINT32:
        return view.getUint32.bind(view);
      case PointCloud2Viewer.FLOAT32:
        return view.getFloat32.bind(view);
      case PointCloud2Viewer.FLOAT64:
        return view.getFloat64.bind(view);
      default:
        return (offset, littleEndian) => {return 0.0};
    }
  }

  onCreate() {
    super.onCreate();

    // UI controls
    const controls = $('<div></div>')
      .css({"display":"flex","gap":"8px","align-items":"center","padding":"6px","flex-wrap":"wrap"})
      .appendTo(this.card.content);

    // Color mode selector
    this.colorMode = "z"; // "z" or "fixed"
    const colorModeSel = $('<select></select>')
      .append('<option value="z">Color by Z</option>')
      .append('<option value="fixed">Fixed Color</option>')
      .val(this.colorMode)
      .change(() => { this.colorMode = colorModeSel.val(); })
      .appendTo(controls);

    // Color picker (for fixed mode)
    this.fixedColor = [1,1,1,1];
    const colorInput = $('<input type="color" value="#ffffff"/>')
      .change(() => {
        const hex = colorInput.val().replace('#','');
        const r = parseInt(hex.substring(0,2),16)/255.0;
        const g = parseInt(hex.substring(2,4),16)/255.0;
        const b = parseInt(hex.substring(4,6),16)/255.0;
        this.fixedColor = [r,g,b,1.0];
      })
      .appendTo(controls);

    // Point size slider
    this.pointSize = 1.5;
    const sizeLabel = $('<span>Size</span>').appendTo(controls);
    const sizeSlider = $('<input type="range" min="1" max="10" step="0.5"/>')
      .val(this.pointSize)
      .on('input change', () => { this.pointSize = parseFloat(sizeSlider.val()); })
      .appendTo(controls);

    // Decimation/downsampling control for performance
    this.decimationStride = 1;
    const decimLabel = $('<span>Skip</span>').css({marginLeft:'8px'}).appendTo(controls);
    const decimSlider = $('<input type="range" min="1" max="10" step="1"/>')
      .val(this.decimationStride)
      .attr('title', 'Downsample: render every Nth point (higher = faster, lower quality)')
      .on('input change', () => { 
        this.decimationStride = parseInt(decimSlider.val());
        decimValue.text(this.decimationStride);
        // Re-render with new decimation
        if(this._lastMsg) this.onData(this._lastMsg);
      })
      .appendTo(controls);
    const decimValue = $('<span></span>').text(this.decimationStride).css({marginLeft:'4px'}).appendTo(controls);

    // Base frame select (populated from TF)
    this.baseFrame = "";
    const baseLabel = $('<span>Base frame</span>').css({marginLeft:'8px'}).appendTo(controls);
    this.baseSelect = $('<select></select>')
      .css({width:"160px"})
      .append('<option value="">(none)</option>')
      .change(() => { this.baseFrame = this.baseSelect.val(); })
      .appendTo(controls);

    this._populateFrames();

    // Periodically refresh frames list (cheap, but effective)
    this._tfRefreshInterval = setInterval(() => this._populateFrames(), 1000);

    // Subscribe to TF updates to trigger re-rendering when transformations change
    this._tfUpdateListener = () => {
      // Use requestAnimationFrame for optimal rendering timing
      if(this._tfRenderPending) return;
      this._tfRenderPending = true;
      if(window.requestAnimationFrame) {
        window.requestAnimationFrame(() => {
          this._tfRenderPending = false;
          if(this._lastMsg) {
            this.onData(this._lastMsg);
          }
        });
      } else {
        setTimeout(() => {
          this._tfRenderPending = false;
          if(this._lastMsg) {
            this.onData(this._lastMsg);
          }
        }, 16);
      }
    };
    if(window.ROSBOARD_TF && window.ROSBOARD_TF.addListener) {
      window.ROSBOARD_TF.addListener(this._tfUpdateListener);
    }
  }

  destroy() {
    if(this._tfRefreshInterval) clearInterval(this._tfRefreshInterval);
    
    // Unsubscribe from TF updates
    if(this._tfUpdateListener && window.ROSBOARD_TF && window.ROSBOARD_TF.removeListener) {
      window.ROSBOARD_TF.removeListener(this._tfUpdateListener);
    }
    
    super.destroy();
  }

  _populateFrames() {
    if(!window.ROSBOARD_TF) return;
    const frames = window.ROSBOARD_TF.getFrames();
    const current = this.baseSelect ? this.baseSelect.val() : this.baseFrame;
    if(this.baseSelect) {
      const prevOptions = Array.from(this.baseSelect.find('option')).map(o=>o.value).join(',');
      const nextOptions = [''].concat(frames).join(',');
      if(prevOptions !== nextOptions) {
        this.baseSelect.empty();
        this.baseSelect.append('<option value="">(none)</option>');
        frames.forEach(f => this.baseSelect.append(`<option value="${f}">${f}</option>`));
      }
      if(current && this.baseSelect.val() !== current) {
        this.baseSelect.val(current);
      }
      this.baseFrame = this.baseSelect.val();
    }
  }

  onData(msg) {
    this.card.title.text(msg._topic_name);

    // Store the last message for re-rendering when TF changes
    this._lastMsg = msg;

    let points = null;

    if(msg.__comp) {
      points = this.decodeAndRenderCompressed(msg);
    } else {
      points = this.decodeAndRenderUncompressed(msg);
    }

  }

  _applyBaseFrameTransform(points, msg) {
    const src = (msg.header && msg.header.frame_id) ? msg.header.frame_id : "";
    const dst = (this.baseFrame || "");
    if(!dst || !src || !window.ROSBOARD_TF) return points;
    
    // Validate TF before transformation
    if(!this._validateTF(src, dst)) {
      console.warn(`TF validation failed: ${src} -> ${dst}`);
      return points;
    }
    
    const T = window.ROSBOARD_TF.getTransform(src, dst);
    if(!T) return points;
    return window.ROSBOARD_TF.transformPoints(T, points);
  }

  _validateTF(src, dst) {
    if(!src || !dst || !window.ROSBOARD_TF) return false;
    
    // Normalize frame names
    const normalizeSrc = src[0] === '/' ? src.substring(1) : src;
    const normalizeDst = dst[0] === '/' ? dst.substring(1) : dst;
    
    // Same frames are always valid
    if(normalizeSrc === normalizeDst) return true;
    
    // Check if frames exist in TF tree
    const tfTree = window.ROSBOARD_TF.tree || {};
    
    // Trace from src to root
    let cur = normalizeSrc;
    const srcChain = new Set([cur]);
    let iterations = 0;
    while(tfTree[cur] && iterations < 256) {
      cur = tfTree[cur].parent;
      if(cur) srcChain.add(cur);
      iterations++;
    }
    const srcRoot = cur;
    
    // Trace from dst to root
    cur = normalizeDst;
    const dstChain = new Set([cur]);
    iterations = 0;
    while(tfTree[cur] && iterations < 256) {
      cur = tfTree[cur].parent;
      if(cur) dstChain.add(cur);
      iterations++;
    }
    const dstRoot = cur;
    
    // Check if frames share a common root
    if(srcRoot !== dstRoot) {
      return false;
    }
    
    return true;
  }

  _checkTFAvailability() {
    // Check if TF system is available and has data
    if(!window.ROSBOARD_TF || !window.ROSBOARD_TF.tree) {
      return false;
    }
    
    // Store TF tree state for this render cycle
    this._currentTFTree = window.ROSBOARD_TF.tree;
    this._tfTreeFrameCount = Object.keys(this._currentTFTree).length;
    
    // Log TF tree state on significant changes (optional debug)
    if(this._lastTfFrameCount !== this._tfTreeFrameCount) {
      console.log(`TF tree updated: ${this._tfTreeFrameCount} frames`);
      this._lastTfFrameCount = this._tfTreeFrameCount;
    }
    
    return true;
  }

  _drawPoints(points, zmin, zmax, msg) {
    // Check TF availability before drawing
    this._checkTFAvailability();
    
    const colorMode = this.colorMode || "z";
    const colorUniform = (colorMode === "fixed") ? (this.fixedColor || [1,1,1,1]) : [1,1,1,1];
    const pointSize = this.pointSize || 1.5;

    const transformed = this._applyBaseFrameTransform(points, msg);

    this.draw([
      {type: "points", data: transformed, zmin: zmin, zmax: zmax, colorMode: colorMode, colorUniform: colorUniform, pointSize: pointSize},
    ]);
  }

  decodeAndRenderCompressed(msg) {
    // decodes a uint16 lossy-compressed point cloud
    // basic explanation of algorithm:
    // - keep only x,y,z fields and throw away the rest
    // - throw away rows containing nans
    // - compress each number into a uint16 from 0 to 65535
    //   where 0 is the minimum value over the whole set and 65535 is the max value over the set
    //   so for example if the x values range from -95 m to 85 m, we encode x into a uint16 where
    //   0 represents -95 and 65535 represents 85
    // - provide the actual bounds (i.e. [-95, 85]) in a separate bounds field so it can be
    //   scaled back correctly by the decompressor (this function)

    let bounds = msg._data_uint16.bounds;
    let points_data = this._base64decode(msg._data_uint16.points);
    let points_view = new DataView(points_data);

    const stride = Math.max(1, parseInt(this.decimationStride || 1));
    const totalPoints = Math.floor(points_data.byteLength / 6);
    const decimatedCount = Math.ceil(totalPoints / stride);
    let points = new Float32Array(decimatedCount * 3);

    let xrange = bounds[1] - bounds[0];
    let xmin = bounds[0];
    let yrange = bounds[3] - bounds[2];
    let ymin = bounds[2];
    let zrange = bounds[5] - bounds[4];
    let zmin = bounds[4];

    let outIdx = 0;
    for(let i=0; i<totalPoints; i+=stride) {
      let offset = i * 6;
      points[outIdx*3] = (points_view.getUint16(offset, true) / 65535) * xrange + xmin;
      points[outIdx*3+1] = (points_view.getUint16(offset+2, true) / 65535) * yrange + ymin;
      points[outIdx*3+2] = (points_view.getUint16(offset+4, true) / 65535) * zrange + zmin;
      outIdx++;
    }

    this._drawPoints(points, zmin, zmin + zrange, msg);
  }

  decodeAndRenderUncompressed(msg) {
    // decode an uncompressed pointcloud.
    // expects "data" field to be base64 encoded raw bytes but otherwise follows ROS standards

    let fields = {};
    let actualRecordSize = 0;

    (msg.fields||[]).forEach((field) => {
      fields[field.name] = field;
      if(!(field.datatype in PointCloud2Viewer.SIZEOF)) {
        this.warn("Invalid PointCloud2 message: field " + field.name + " has invalid datatype = " + String(field.datatype));
        return;
      }
      actualRecordSize += PointCloud2Viewer.SIZEOF[field.datatype];
    });

    if(!("x" in fields) || !("y" in fields)) {
      this.warn("Cannot display PointCloud2 message: Must have at least 'x' and 'y' fields or I don't know how to display it.");
      return;
    }

    let data = this._base64decode(msg.data || "");
    if(!data || !msg.point_step || !msg.width || !msg.height) {
      this.warn("Invalid PointCloud2 message: missing data/point_step/width/height");
      return;
    }

    if(!(msg.point_step * msg.width * msg.height === data.byteLength)) {
      this.warn("Invalid PointCloud2: failed assertion: point_step * width * height === data.length");
      return;
    }

    const stride = Math.max(1, parseInt(this.decimationStride || 1));
    const totalPoints = Math.floor(data.byteLength / msg.point_step);
    const decimatedCount = Math.ceil(totalPoints / stride);
    let points = new Float32Array(decimatedCount * 3);
    let view = new DataView(data);
    let littleEndian = !msg.is_bigendian;

    // cache these into variables to avoid hitting hash repeatedly
    let xOffset = fields["x"].offset;
    let xDataGetter = this._getDataGetter(fields["x"].datatype, view);
    let yOffset = fields["y"].offset;
    let yDataGetter = this._getDataGetter(fields["y"].datatype, view);
    let zOffset = -1;
    let zDataGetter = null;
    if("z" in fields) {
      zOffset = fields["z"].offset;
      zDataGetter = this._getDataGetter(fields["z"].datatype, view);
    }

    let outIdx = 0;
    for(let i=0; i<totalPoints; i+=stride) {
      let offset = i * msg.point_step;
      points[outIdx*3] = xDataGetter(offset + xOffset, littleEndian); // x
      points[outIdx*3+1] = yDataGetter(offset + yOffset, littleEndian); // y
      points[outIdx*3+2] = zDataGetter ? zDataGetter(offset + zOffset, littleEndian) : 0.0; // z
      outIdx++;
    }

    this._drawPoints(points, -2.0, 2.0, msg);
  }
}

// constants used for decoding raw point clouds (not used for decoding compressed)

PointCloud2Viewer.INT8 = 1;
PointCloud2Viewer.UINT8 = 2;
PointCloud2Viewer.INT16 = 3;
PointCloud2Viewer.UINT16 = 4;
PointCloud2Viewer.INT32 = 5;
PointCloud2Viewer.UINT32 = 6;
PointCloud2Viewer.FLOAT32 = 7;
PointCloud2Viewer.FLOAT64 = 8;
PointCloud2Viewer.SIZEOF = {
  [PointCloud2Viewer.INT8]: 1,
  [PointCloud2Viewer.UINT8]: 1,
  [PointCloud2Viewer.INT16]: 2,
  [PointCloud2Viewer.UINT16]: 2,
  [PointCloud2Viewer.INT32]: 4,
  [PointCloud2Viewer.UINT32]: 4,
  [PointCloud2Viewer.FLOAT32]: 4,
  [PointCloud2Viewer.FLOAT64]: 8,
}

// advertise this viewer to the system

PointCloud2Viewer.friendlyName = "Point cloud (3D)";
PointCloud2Viewer.supportedTypes = [
    "sensor_msgs/msg/PointCloud2",
];
PointCloud2Viewer.maxUpdateRate = 30.0;
Viewer.registerViewer(PointCloud2Viewer);
