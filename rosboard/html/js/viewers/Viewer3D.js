"use strict";

class Viewer3D extends Space3DViewer {
  onCreate() {
    super.onCreate();

    this.loadedPointClouds = []; // Array to store loaded PCD data
    this.pointCloudCounter = 0; // Counter for unique IDs

    // Create controls container
    const controls = $('<div></div>')
      .css({
        display: "flex",
        gap: "8px",
        alignItems: "center",
        padding: "6px",
        flexWrap: "wrap",
        borderBottom: "1px solid #404040",
        marginBottom: "8px"
      })
      .appendTo(this.card.content);

    // File input for PCD files
    this.fileInput = $('<input type="file" accept=".pcd" style="display: none;">')
      .appendTo(controls);

    // Load PCD button
    this.loadPcdBtn = $('<button class="mdl-button mdl-js-button mdl-button--raised mdl-button--colored">Load PCD File</button>')
      .click(() => this.fileInput.click())
      .appendTo(controls);

    // Color mode selector
    this.colorModeSelect = $('<select class="mdl-textfield__input">')
      .css({
        padding: '4px',
        backgroundColor: '#404040',
        color: '#ffffff',
        border: '1px solid #606060',
        borderRadius: '4px'
      })
      .append($('<option value="z">Z-based Colors</option>'))
      .append($('<option value="intensity">Intensity Colors</option>'))
      .append($('<option value="fixed">Fixed Color</option>'))
      .val('z')
      .change(() => this._updatePointCloudColors())
      .appendTo(controls);

    // Clear all button
    this.clearBtn = $('<button class="mdl-button mdl-js-button mdl-button--raised">Clear All</button>')
      .click(() => this._clearAllPointClouds())
      .appendTo(controls);

    // Point cloud list container
    this.pointCloudList = $('<div></div>')
      .css({
        padding: "6px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        maxHeight: "200px",
        overflowY: "auto"
      })
      .appendTo(this.card.content);

    // Set up file input event handler
    this.fileInput.on('change', (e) => this._handleFileSelect(e));

    // Set title and remove spinner
    this.card.title.text("3D Viewer (PCD Loader)");
    setTimeout(() => {
      if(this.loaderContainer){
        this.loaderContainer.remove();
        this.loaderContainer = null;
      }
    }, 0);

    // Restore point clouds from localStorage after everything is initialized
    // Use a small delay to ensure the viewer is fully ready
    setTimeout(() => {
      this._restorePointCloudsFromStorage();
      // Force a render after restoration to ensure everything is displayed
      if (this.draw) {
        this.draw([]);
      }
    }, 200);
  }

  _handleFileSelect(event) {
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
          this._addPointCloud(pointCloud);
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
        console.log('Found DATA type:', dataType);
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

    if (fields.length === 0 || !isBinary) {
      throw new Error("Only binary PCD files are supported");
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

    // Extract point data
    const points = new Float32Array(pointCount * 3);
    let pointIndex = 0;

    for (let i = 0; i < pointCount; i++) {
      const baseOffset = dataOffset + i * pointStep;

            // Find x, y, z field indices (handle various field naming conventions)
      const xIndex = fields.findIndex(field => field === 'x' || field.endsWith('_x') || field.startsWith('x_'));
      const yIndex = fields.findIndex(field => field === 'y' || field.endsWith('_y') || field.startsWith('y_'));
      const zIndex = fields.findIndex(field => field === 'z' || field.endsWith('_z') || field.startsWith('z_'));

      if (xIndex === -1 || yIndex === -1) {
        throw new Error("PCD file must have x and y fields. Available fields: " + fields.join(', '));
      }

      if (i === 0) { // Log only for first point
        console.log('Field indices:', { xIndex, yIndex, zIndex, xField: fields[xIndex], yField: fields[yIndex], zField: fields[zIndex] });
      }

      // Read x, y, z coordinates
      let x = 0, y = 0, z = 0;

      if (xIndex !== -1) {
        const offset = baseOffset + offsets[xIndex];
        x = this._readValue(dataView, offset, types[xIndex] || 'F', sizes[xIndex] || 4);
      }

      if (yIndex !== -1) {
        const offset = baseOffset + offsets[yIndex];
        y = this._readValue(dataView, offset, types[yIndex] || 'F', sizes[yIndex] || 4);
      }

      if (zIndex !== -1) {
        const offset = baseOffset + offsets[zIndex];
        z = this._readValue(dataView, offset, types[zIndex] || 'F', sizes[zIndex] || 4);
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
      id: ++this.pointCloudCounter,
      name: filename,
      points: points,
      pointCount: pointCount,
      color: [1.0, 1.0, 1.0, 1.0], // Default white color
      visible: true,
      pointSize: 2.0,
      filePath: file.name // Store the file path
    };
  }

  _readValue(dataView, offset, type, size) {
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

  _addPointCloud(pointCloud) {
    // Apply initial colors based on current color mode
    const colorMode = this.colorModeSelect.val();
    if (colorMode === 'z') {
      this._applyZBasedColors(pointCloud);
    } else if (colorMode === 'intensity' && pointCloud.intensities) {
      this._applyIntensityColors(pointCloud);
    } else {
      this._applyFixedColors(pointCloud);
    }

    this.loadedPointClouds.push(pointCloud);
    this._renderPointCloudList();

    // Save point clouds to localStorage after adding
    this._savePointCloudsToStorage();

    this.draw([]); // Trigger redraw with empty drawObjects to use our custom draw method
  }

  _removePointCloud(id) {
    this.loadedPointClouds = this.loadedPointClouds.filter(pc => pc.id !== id);
    this._renderPointCloudList();

    // Save point clouds to localStorage after removal
    this._savePointCloudsToStorage();

    this.draw([]); // Trigger redraw with empty drawObjects to use our custom draw method
  }

  _clearAllPointClouds() {
    this.loadedPointClouds = [];
    this._renderPointCloudList();

    // Save point clouds to localStorage after clearing
    this._savePointCloudsToStorage();

    this.draw([]); // Trigger redraw with empty drawObjects to use our custom draw method
  }

  _updatePointCloudColors() {
    const colorMode = this.colorModeSelect.val();

    for (const pc of this.loadedPointClouds) {
      if (colorMode === 'z') {
        // Re-apply Z-based colors
        this._applyZBasedColors(pc);
      } else if (colorMode === 'intensity' && pc.intensities) {
        // Apply intensity-based colors
        this._applyIntensityColors(pc);
      } else if (colorMode === 'fixed') {
        // Apply fixed color
        this._applyFixedColors(pc);
      }
    }

    // Save point clouds to localStorage after color update
    this._savePointCloudsToStorage();

    this.draw([]); // Trigger redraw
  }

  _applyZBasedColors(pointCloud) {
    const colors = new Float32Array(pointCloud.pointCount * 4);

    // Find Z min/max for color scaling
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < pointCloud.pointCount; i++) {
      const z = pointCloud.points[i * 3 + 2];
      if (z < zmin) zmin = z;
      if (z > zmax) zmax = z;
    }

    // Apply Z-based colormap
    for (let i = 0; i < pointCloud.pointCount; i++) {
      const z = pointCloud.points[i * 3 + 2];
      const c = this._getColor(z, zmin, zmax);
      colors[i * 4] = c[0];     // R
      colors[i * 4 + 1] = c[1]; // G
      colors[i * 4 + 2] = c[2]; // B
      colors[i * 4 + 3] = 1.0;  // A
    }

    pointCloud.colors = colors;
    pointCloud.zmin = zmin;
    pointCloud.zmax = zmax;
  }

  _applyIntensityColors(pointCloud) {
    if (!pointCloud.intensities) return;

    const colors = new Float32Array(pointCloud.pointCount * 4);

    // Find intensity min/max for color scaling
    let imin = Infinity, imax = -Infinity;
    for (let i = 0; i < pointCloud.pointCount; i++) {
      const intensity = pointCloud.intensities[i];
      if (intensity < imin) imin = intensity;
      if (intensity > imax) imax = intensity;
    }

    // Apply intensity-based colormap
    for (let i = 0; i < pointCloud.pointCount; i++) {
      const intensity = pointCloud.intensities[i];
      const c = this._getColor(intensity, imin, imax);
      colors[i * 4] = c[0];     // R
      colors[i * 4 + 1] = c[1]; // G
      colors[i * 4 + 2] = c[2]; // B
      colors[i * 4 + 3] = 1.0;  // A
    }

    pointCloud.colors = colors;
  }

  _applyFixedColors(pointCloud) {
    const colors = new Float32Array(pointCloud.pointCount * 4);

    // Apply fixed color (use the original color property)
    for (let i = 0; i < pointCloud.pointCount; i++) {
      colors[i * 4] = pointCloud.color[0];
      colors[i * 4 + 1] = pointCloud.color[1];
      colors[i * 4 + 2] = pointCloud.color[2];
      colors[i * 4 + 3] = pointCloud.color[3];
    }

    pointCloud.colors = colors;
  }

  _renderPointCloudList() {
    this.pointCloudList.empty();

    if (this.loadedPointClouds.length === 0) {
      $('<div style="color: #808080; font-style: italic;">No PCD files loaded</div>')
        .appendTo(this.pointCloudList);
      return;
    }

    for (const pc of this.loadedPointClouds) {
      const pcItem = $('<div></div>')
        .css({
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px',
          border: '1px solid #404040',
          borderRadius: '4px',
          backgroundColor: '#202020'
        })
        .appendTo(this.pointCloudList);

      // Visibility toggle
      const visibilityBtn = $('<button class="mdl-button mdl-js-button mdl-button--icon">')
        .append($('<i class="material-icons">').text(pc.visible ? 'visibility' : 'visibility_off'))
        .click(() => {
          pc.visible = !pc.visible;
          visibilityBtn.find('i').text(pc.visible ? 'visibility' : 'visibility_off');
          this.draw([]); // Trigger redraw with empty drawObjects to use our custom draw method
        })
        .appendTo(pcItem);

      // Point cloud name
      $('<span style="flex: 1; font-size: 12px;">').text(pc.name).appendTo(pcItem);

      // Point count
      $('<span style="color: #808080; font-size: 11px;">').text(`${pc.pointCount} pts`).appendTo(pcItem);

      // Remove button
      $('<button class="mdl-button mdl-js-button mdl-button--icon">')
        .append($('<i class="material-icons">').text('close'))
        .click(() => this._removePointCloud(pc.id))
        .appendTo(pcItem);
    }
  }

  draw(drawObjects) {
    // Call parent draw method for grid and axes
    super.draw(drawObjects);

    // Add loaded point clouds to draw objects
    for (const pc of this.loadedPointClouds) {
      if (!pc.visible) continue;

      // Use the pre-calculated Z-based colors
      const colors = pc.colors || new Float32Array(pc.pointCount * 4);

      // Create mesh for this point cloud
      const mesh = GL.Mesh.load({
        vertices: pc.points,
        colors: colors
      }, null, null, this.gl);

      // Add to draw objects
      this.drawObjectsGl.push({
        type: "points",
        mesh: mesh,
        colorUniform: pc.color,
        pointSize: pc.pointSize
      });
    }
  }

  serializeState() {
    try {
      const baseState = super.serializeState ? super.serializeState() : {};
      return {
        ...baseState,
        loadedPointClouds: this.loadedPointClouds.map(pc => ({
          id: pc.id,
          name: pc.name,
          color: pc.color,
          visible: pc.visible,
          pointSize: pc.pointSize,
          // Save file path instead of point data
          filePath: pc.filePath || null,
          // Save metadata for display
          pointCount: pc.pointCount,
          zmin: pc.zmin,
          zmax: pc.zmax
        })),
        // Store color mode preference
        colorMode: this.colorModeSelect ? this.colorModeSelect.val() : 'z'
      };
    } catch (e) {
      console.error('Error serializing Viewer3D state:', e);
      return null;
    }
  }

  // Method to restore point clouds from file paths (for layout import)
  _restorePointCloudFromPath(filePath, metadata) {
    // For now, we'll just create a placeholder since we can't access the original file
    // In a real implementation, you might want to store the file in IndexedDB or ask user to reselect
    console.log('Attempting to restore point cloud from path:', filePath);

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

    // Add to loaded point clouds
    this.loadedPointClouds.push(pointCloud);

    // Update counter to avoid ID conflicts
    this.pointCloudCounter = Math.max(this.pointCloudCounter, pointCloud.id);

    // Re-render the point cloud list
    this._renderPointCloudList();

    // Show a message to the user
    if (window.showNotification) {
      window.showNotification(`Point cloud file "${filePath}" needs to be reloaded. Please select the file again.`);
    } else {
      this.warn(`Point cloud file "${filePath}" needs to be reloaded. Please select the file again.`);
    }
  }

  applyState(state) {
    try {
      if (super.applyState) {
        super.applyState(state);
      }

      if (state && state.loadedPointClouds && state.loadedPointClouds.length > 0) {
        console.log('Restoring point clouds from file paths:', state.loadedPointClouds.length);
        // Restore each point cloud from file path
        state.loadedPointClouds.forEach(pcData => {
          if (pcData.filePath) {
            // Use the new restoration method that creates placeholders
            this._restorePointCloudFromPath(pcData.filePath, pcData);
          } else {
            console.warn('Point cloud missing file path:', pcData.name);
          }
        });
      }

      // Restore color mode preference
      if (state.colorMode && this.colorModeSelect) {
        this.colorModeSelect.val(state.colorMode);
        // Re-apply colors based on the restored mode
        this._updatePointCloudColors();
      }
    } catch (e) {
      console.warn('Error applying state:', e);
    }
  }

  destroy() {
    if (this._topicsRefreshInterval) {
      clearInterval(this._topicsRefreshInterval);
    }
    if (this._tfRefreshInterval) {
      clearInterval(this._tfRefreshInterval);
    }
    super.destroy();
  }

  _restorePointCloudsFromStorage() {
    try {
      if (!window.localStorage) return;

      const pcdStorageKey = `rosboard_viewer3d_pcd_${this.card.id || 'default'}`;
      const storedPcdData = window.localStorage.getItem(pcdStorageKey);

      if (storedPcdData) {
        const pointClouds = JSON.parse(storedPcdData);
        console.log('Restoring point clouds from localStorage:', pointClouds.length);

        pointClouds.forEach(pcData => {
          // Validate the point cloud data before restoration
          if (!pcData.points || !Array.isArray(pcData.points) || pcData.points.length === 0) {
            console.warn('Skipping invalid point cloud data from localStorage:', pcData.name);
            return;
          }

          // Create the point cloud object with restored data
          const pointCloud = {
            id: pcData.id,
            name: pcData.name,
            color: pcData.color || [1.0, 1.0, 1.0, 1.0],
            visible: pcData.visible !== false,
            pointSize: pcData.pointSize || 2.0,
            points: new Float32Array(pcData.points),
            pointCount: pcData.pointCount,
            colors: pcData.colors ? new Float32Array(pcData.colors) : null,
            zmin: pcData.zmin,
            zmax: pcData.zmax
          };

          // Add to loaded point clouds
          this.loadedPointClouds.push(pointCloud);

          // Update counter to avoid ID conflicts
          this.pointCloudCounter = Math.max(this.pointCloudCounter, pointCloud.id);
        });

        // Re-render the point cloud list
        this._renderPointCloudList();

        console.log('Successfully restored point clouds from localStorage');
      }
    } catch (e) {
      console.warn('Failed to restore point clouds from localStorage:', e);
    }
  }

  _savePointCloudsToStorage() {
    try {
      if (!window.localStorage) return;

      const pcdStorageKey = `rosboard_viewer3d_pcd_${this.card.id || 'default'}`;
      const pointCloudsToSave = this.loadedPointClouds.map(pc => ({
        id: pc.id,
        name: pc.name,
        color: pc.color,
        visible: pc.visible,
        pointSize: pc.pointSize,
        points: Array.from(pc.points),
        pointCount: pc.pointCount,
        colors: pc.colors ? Array.from(pc.colors) : null,
        zmin: pc.zmin,
        zmax: pc.zmax
      }));

      window.localStorage.setItem(pcdStorageKey, JSON.stringify(pointCloudsToSave));
      console.log('Point clouds saved to localStorage:', pointCloudsToSave.length);
    } catch (e) {
      console.warn('Failed to save point clouds to localStorage:', e);
    }
  }
}

// Register the viewer
Viewer3D.friendlyName = "3D Viewer (PCD)";
Viewer3D.supportedTypes = ["*"]; // Support all types since it's for file loading
Viewer3D.maxUpdateRate = 30.0;
Viewer.registerViewer(Viewer3D);
