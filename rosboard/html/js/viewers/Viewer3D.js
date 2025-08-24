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

    // Load Remote PCD button
    this.loadRemotePcdBtn = $('<button class="mdl-button mdl-js-button mdl-button--raised mdl-button--colored">Load Remote PCD</button>')
      .click(() => this._showRemotePcdDialog())
      .appendTo(controls);

    // Clear PCD button
    this.clearPcdBtn = $('<button class="mdl-button mdl-js-button mdl-button--raised">Clear PCD</button>')
      .click(() => this._clearAllPointClouds())
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
      filePath: filename // Store the file path
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

    // Set default transparency and point size if not specified
    if (pointCloud.transparency === undefined) {
      pointCloud.transparency = 1.0;
    }
    if (pointCloud.pointSize === undefined) {
      pointCloud.pointSize = 2.0;
    }

    this.loadedPointClouds.push(pointCloud);
    this._renderPointCloudList();

    // Save point clouds to localStorage after adding
    console.log('Adding point cloud:', pointCloud.name, 'Total count:', this.loadedPointClouds.length);
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

    // Mark that PCDs were cleared
    try {
      const clearStateKey = `rosboard_viewer3d_cleared_${this.card.id || 'default'}`;
      window.localStorage.setItem(clearStateKey, 'true');
      console.log('Marked PCDs as cleared in localStorage');
    } catch (e) {
      console.warn('Failed to mark PCDs as cleared:', e);
    }

    // Save point clouds to localStorage after clearing
    this._savePointCloudsToStorage();

    this.draw([]); // Trigger redraw
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

      // Transparency control
      const transparencyLabel = $('<span style="color: #808080; font-size: 11px;">').text('Transp:').appendTo(pcItem);
      const transparencySlider = $('<input type="range" min="0.1" max="1.0" step="0.1" style="width: 60px;">')
        .val(pc.transparency !== undefined ? pc.transparency : 1.0)
        .on('input change', () => {
          pc.transparency = parseFloat(transparencySlider.val());
          this._savePointCloudsToStorage();
          this.draw([]); // Trigger redraw
        })
        .appendTo(pcItem);

      // Thickness control
      const thicknessLabel = $('<span style="color: #808080; font-size: 11px;">').text('Size:').appendTo(pcItem);
      const thicknessSlider = $('<input type="range" min="1" max="10" step="1" style="width: 60px;">')
        .val(pc.pointSize || 2.0)
        .on('input change', () => {
          pc.pointSize = parseFloat(thicknessSlider.val());
          this._savePointCloudsToStorage();
          this.draw([]); // Trigger redraw
        })
        .appendTo(pcItem);

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

      // Apply transparency if specified
      if (pc.transparency !== undefined && pc.transparency < 1.0) {
        for (let i = 3; i < colors.length; i += 4) {
          colors[i] = pc.transparency;
        }
      }

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
          transparency: pc.transparency,
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
    console.log('Attempting to restore point cloud from path:', filePath);

    // Check if this is a remote file path
    if (filePath && filePath.startsWith('/root/ws/src/maps/')) {
      const filename = filePath.split('/').pop();
      console.log('Detected remote PCD file, attempting to load:', filename);

      // Try to load the remote PCD file
      this._loadRemotePcdFileForRestore(filename, metadata);
      return;
    }

    // For local files, create a placeholder
    const pointCloud = {
      id: metadata.id || ++this.pointCloudCounter,
      name: metadata.name || 'Unknown PCD',
      color: metadata.color || [1.0, 1.0, 1.0, 1.0],
      visible: metadata.visible !== false,
      pointSize: metadata.pointSize || 2.0,
      points: new Float32Array(0), // Empty placeholder
      pointCount: 0,
      filePath: filePath
    };

    this.loadedPointClouds.push(pointCloud);
    this._renderPointCloudList();

    // Show notification that manual reload is needed
    if (window.showNotification) {
      window.showNotification(`PCD "${metadata.name}" needs to be reloaded manually`);
    }
  }

  _loadRemotePcdFileForRestore(filename, metadata) {
    console.log('Loading remote PCD file for restoration:', filename);

    // Use fetch instead of jQuery for better binary data handling
    fetch('/rosboard/api/remote-pcd-files/' + encodeURIComponent(filename))
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.arrayBuffer();
      })
      .then(arrayBuffer => {
        try {
          // Parse the PCD data
          const pointCloud = this._parsePcdFile(arrayBuffer, filename);

          if (pointCloud) {
            // Apply metadata from storage
            pointCloud.visible = metadata.visible !== false;
            pointCloud.pointSize = metadata.pointSize || 2.0;
            pointCloud.transparency = metadata.transparency !== undefined ? metadata.transparency : 1.0;

            // Store the remote file path
            pointCloud.filePath = `/root/ws/src/maps/${filename}`;

            // Add to loaded point clouds using the proper method to ensure colors are calculated
            this._addPointCloud(pointCloud);

            console.log('Successfully restored remote PCD file:', filename);

            // Show success notification
            if (window.showNotification) {
              window.showNotification(`PCD "${filename}" restored successfully`);
            }
          } else {
            throw new Error('Failed to parse PCD file');
          }
        } catch (error) {
          console.error('Error parsing remote PCD file:', error);
          if (window.showNotification) {
            window.showNotification(`Failed to load remote PCD file "${filename}"`);
          }

          // Fall back to creating a placeholder
          this._createPointCloudPlaceholder(filename, metadata);
        }
      })
      .catch(error => {
        console.error('Failed to load remote PCD file:', error);
        if (window.showNotification) {
          window.showNotification(`Failed to load remote PCD file "${filename}"`);
        }

        // Fall back to creating a placeholder
        this._createPointCloudPlaceholder(filename, metadata);
      });
  }

  _createPointCloudPlaceholder(filename, metadata) {
    const pointCloud = {
      id: metadata.id || ++this.pointCloudCounter,
      name: metadata.name || filename,
      color: metadata.color || [1.0, 1.0, 1.0, 1.0],
      visible: metadata.visible !== false,
      pointSize: metadata.pointSize || 2.0,
      points: new Float32Array(0), // Empty placeholder
      pointCount: 0,
      filePath: `/root/ws/src/maps/${filename}`
    };

    this.loadedPointClouds.push(pointCloud);
    this._renderPointCloudList();

    if (window.showNotification) {
      window.showNotification(`Created placeholder for PCD "${filename}"`);
    }
  }

  // Show remote PCD file selection dialog
  _showRemotePcdDialog() {
    // Create dialog
    const dialog = $('<div></div>')
      .css({
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: '#2a2a2a',
        border: '1px solid #404040',
        borderRadius: '8px',
        padding: '20px',
        zIndex: 10000,
        maxWidth: '600px',
        maxHeight: '400px',
        overflow: 'auto'
      })
      .appendTo('body');

    // Dialog header
    $('<h3 style="margin: 0 0 20px 0; color: #fff;">Select Remote PCD File</h3>').appendTo(dialog);

    // Loading indicator
    const loadingDiv = $('<div style="text-align: center; color: #ccc;">Loading remote PCD files...</div>').appendTo(dialog);

    // Load remote PCD files
    this._loadRemotePcdFiles(dialog, loadingDiv);
  }

  // Load PCD files from remote directory
  _loadRemotePcdFiles(dialog, loadingDiv) {
    // Make request to list PCD files in remote directory
    $.ajax({
      url: '/rosboard/api/remote-pcd-files',
      method: 'GET',
      success: (data) => {
        loadingDiv.remove();
        this._renderRemotePcdFileList(dialog, data.files || []);
      },
      error: (xhr, status, error) => {
        loadingDiv.html(`<div style="color: #ff6b6b;">Failed to load remote PCD files: ${error}</div>`);
        // Add close button
        $('<button class="mdl-button mdl-js-button mdl-button--raised" style="margin-top: 10px;">Close</button>')
          .click(() => dialog.remove())
          .appendTo(loadingDiv);
      }
    });
  }

  // Render remote PCD file list
  _renderRemotePcdFileList(dialog, files) {
    if (files.length === 0) {
      $('<div style="color: #ccc; text-align: center; margin: 20px 0;">No PCD files found in remote directory</div>').appendTo(dialog);
      $('<button class="mdl-button mdl-js-button mdl-button--raised" style="margin-top: 10px;">Close</button>')
        .click(() => dialog.remove())
        .appendTo(dialog);
      return;
    }

    // File list
    const fileList = $('<div style="max-height: 300px; overflow-y: auto;"></div>').appendTo(dialog);

    files.forEach(file => {
      if (file.toLowerCase().endsWith('.pcd')) {
        const fileRow = $('<div></div>')
          .css({
            padding: '8px',
            border: '1px solid #404040',
            margin: '4px 0',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          })
          .hover(
            () => fileRow.css('backgroundColor', '#404040'),
            () => fileRow.css('backgroundColor', 'transparent')
          )
          .click(() => this._loadRemotePcdFile(file, dialog))
          .appendTo(fileList);

        $('<span style="color: #fff;">').text(file).appendTo(fileRow);
        $('<span style="color: #808080; font-size: 12px;">').text('Click to load').appendTo(fileRow);
      }
    });

    // Close button
    $('<button class="mdl-button mdl-js-button mdl-button--raised" style="margin-top: 20px;">Close</button>')
      .click(() => dialog.remove())
      .appendTo(dialog);
  }

  // Load PCD file from remote directory
  _loadRemotePcdFile(filename, dialog) {
    // Show loading message
    dialog.html('<div style="text-align: center; color: #ccc;">Loading PCD file...</div>');

    // Use fetch instead of jQuery for better binary data handling
    fetch('/rosboard/api/remote-pcd-files/' + encodeURIComponent(filename))
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.arrayBuffer();
      })
      .then(arrayBuffer => {
        try {
          // Parse the PCD data
          const pointCloud = this._parsePcdFile(arrayBuffer, filename);

          if (pointCloud) {
            // Store the remote file path
            pointCloud.filePath = `/root/ws/src/maps/${filename}`;
            this._addPointCloud(pointCloud);

            // Show success message
            dialog.html('<div style="text-align: center; color: #4caf50;">PCD file loaded successfully!</div>');
            setTimeout(() => dialog.remove(), 1500);
          } else {
            dialog.html('<div style="text-align: center; color: #ff6b6b;">Failed to parse PCD file</div>');
            setTimeout(() => dialog.remove(), 2000);
          }
        } catch (error) {
          console.error('Error parsing remote PCD file:', error);
          dialog.html(`<div style="text-align: center; color: #ff6b6b;">Error parsing PCD file: ${error.message}</div>`);
          setTimeout(() => dialog.remove(), 3000);
        }
      })
      .catch(error => {
        console.error('Failed to load remote PCD file:', error);
        dialog.html(`<div style="text-align: center; color: #ff6b6b;">Failed to load PCD file: ${error.message}</div>`);
        setTimeout(() => dialog.remove(), 3000);
      });
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
      const clearStateKey = `rosboard_viewer3d_cleared_${this.card.id || 'default'}`;

      console.log('Attempting to restore from localStorage with key:', pcdStorageKey);

      // Check if PCDs were cleared
      const wasCleared = window.localStorage.getItem(clearStateKey);
      if (wasCleared === 'true') {
        console.log('PCDs were cleared, not restoring');
        return;
      }

      const storedPcdData = window.localStorage.getItem(pcdStorageKey);

      if (storedPcdData) {
        const pointClouds = JSON.parse(storedPcdData);
        console.log('Restoring point clouds from localStorage:', pointClouds.length);
        console.log('Point cloud names in storage:', pointClouds.map(pc => pc.name));
        console.log('Point cloud file paths in storage:', pointClouds.map(pc => pc.filePath));

        // Restore PCDs from file paths
        pointClouds.forEach(pcData => {
          if (pcData.filePath) {
            console.log('Attempting to restore point cloud from path:', pcData.filePath);
            this._restorePointCloudFromPath(pcData.filePath, pcData);
          } else {
            console.warn('No file path for point cloud:', pcData.name);
          }
        });

        console.log('Successfully initiated point cloud restoration from localStorage');
      } else {
        console.log('No PCD data found in localStorage for key:', pcdStorageKey);
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
        transparency: pc.transparency,
        // Save file path instead of raw data
        filePath: pc.filePath || null,
        // Save metadata for display
        pointCount: pc.pointCount,
        zmin: pc.zmin,
        zmax: pc.zmax
      }));

      // Also save whether PCDs were cleared
      const clearStateKey = `rosboard_viewer3d_cleared_${this.card.id || 'default'}`;
      window.localStorage.setItem(clearStateKey, 'false');

      window.localStorage.setItem(pcdStorageKey, JSON.stringify(pointCloudsToSave));
      console.log('Point clouds saved to localStorage:', pointCloudsToSave.length, 'Key:', pcdStorageKey);
      console.log('Point cloud names:', pointCloudsToSave.map(pc => pc.name));
      console.log('Point cloud file paths:', pointCloudsToSave.map(pc => pc.filePath));
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
