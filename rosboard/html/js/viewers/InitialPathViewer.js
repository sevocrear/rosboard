"use strict";

importJsOnce("js/viewers/meta/Viewer.js");

class InitialPathViewer extends Viewer {
  constructor(card, topicName, topicType) {
    super(card, "_initial_path_picker", "std_msgs/String");
    this.paths = {};
    this.currentFile = "paths.json";
    this.defaultTopic = "/clicked_path";
  }

  onCreate() {
    super.onCreate();

    this.card.title.text("Initial Path Picker");

    const container = $('<div></div>')
      .css({ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' })
      .appendTo(this.card.content);

    const row1 = $('<div></div>')
      .css({ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' })
      .appendTo(container);

    $('<span>Config file</span>').appendTo(row1);
    this.fileSelect = $('<select></select>')
      .css({ minWidth: '180px' })
      .appendTo(row1);
    this.refreshBtn = $('<button class="mdl-button mdl-js-button mdl-button--raised">Refresh</button>')
      .appendTo(row1)
      .click(() => this._loadFiles());

    const row2 = $('<div></div>')
      .css({ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' })
      .appendTo(container);

    $('<span>Path</span>').appendTo(row2);
    this.pathSelect = $('<select></select>')
      .css({ minWidth: '180px' })
      .appendTo(row2);

    const row3 = $('<div></div>')
      .css({ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' })
      .appendTo(container);

    $('<span>Topic</span>').appendTo(row3);
    this.topicInput = $('<input type="text"/>')
      .val(this.defaultTopic)
      .attr('placeholder', '/clicked_path')
      .css({ width: '220px' })
      .appendTo(row3);

    this.publishBtn = $('<button class="mdl-button mdl-js-button mdl-button--raised mdl-button--colored">Publish</button>')
      .appendTo(row3)
      .click(() => this._publish());

    // Load files and default file
    this._loadFiles(() => this._loadFile(this.currentFile));

    // Remove spinner overlay since this viewer doesn't wait for ROS data
    setTimeout(() => {
      try {
        if (this.loaderContainer) {
          this.loaderContainer.remove();
          this.loaderContainer = null;
        }
      } catch(e) {}
    }, 0);
  }

  // This viewer doesn't subscribe to ROS topics
  initSubscribe() {}

  _loadFiles(cb) {
    $.getJSON('/rosboard/api/loc-configs', (data) => {
      const files = (data && data.files) || [];
      this.fileSelect.empty();
      files.forEach(f => this.fileSelect.append(`<option value="${f}">${f}</option>`));
      const wanted = files.includes(this.currentFile) ? this.currentFile : (files[0] || "");
      if (wanted) this.fileSelect.val(wanted);
      this.fileSelect.off('change').on('change', () => {
        this.currentFile = this.fileSelect.val();
        this._loadFile(this.currentFile);
      });
      if (cb) cb();
    }).fail(() => {
      this.warn('Failed to list loc configs');
    });
  }

  _loadFile(filename) {
    if (!filename) return;
    $.getJSON(`/rosboard/api/loc-configs/${encodeURIComponent(filename)}`, (obj) => {
      this.paths = obj || {};
      this.pathSelect.empty();
      Object.keys(this.paths).forEach(name => this.pathSelect.append(`<option value="${name}">${name}</option>`));
    }).fail(() => {
      this.warn(`Failed to load ${filename}`);
    });
  }

  _publish() {
    const name = this.pathSelect.val();
    if (!name || !this.paths[name]) { this.warn('Select a path'); return; }
    const seg = this.paths[name];
    const topic = (this.topicInput && this.topicInput.val()) || this.defaultTopic;

    const poseFromXY = (x, y) => ({
      header: { frame_id: 'map' },
      pose: { position: { x: x, y: y, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }
    });

    const poses = [];
    if (Array.isArray(seg) && seg.length >= 2) {
      // If config is array of points: [{x,y}, ...]
      for (let i = 0; i < seg.length; i++) {
        const p = seg[i];
        if (p && typeof p.x === 'number' && typeof p.y === 'number') poses.push(poseFromXY(p.x, p.y));
      }
    } else if (seg && typeof seg.x0 === 'number' && typeof seg.y0 === 'number' && typeof seg.x1 === 'number' && typeof seg.y1 === 'number') {
      poses.push(poseFromXY(seg.x0, seg.y0));
      poses.push(poseFromXY(seg.x1, seg.y1));
    } else {
      this.warn('Bad path format');
      return;
    }

    const msg = { header: { frame_id: 'map' }, poses: poses };
    const transport = (typeof currentTransport !== 'undefined' && currentTransport) ? currentTransport : (window.currentTransport || null);
    if (!transport || !transport.publish) { this.warn('Publish not supported'); return; }
    transport.publish({ topicName: topic, topicType: 'nav_msgs/msg/Path', message: msg });
    this.tip(`Published Path '${name}' to ${topic}`);
  }

  destroy() { super.destroy(); }
}

InitialPathViewer.friendlyName = "Initial Path Picker";
InitialPathViewer.supportedTypes = ["std_msgs/String"]; // special viewer, not bound to ROS topic
InitialPathViewer.maxUpdateRate = 1.0;
Viewer.registerViewer(InitialPathViewer, "InitialPathViewer", "Initial Path Picker", ["std_msgs/String"]);


