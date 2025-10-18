"use strict";

importJsOnce("js/viewers/meta/Viewer.js");

class ControlActivatorViewer extends Viewer {
  constructor(card, topicName, topicType) {
    super(card, topicName, topicType);
    this.maxUpdateRate = 10; // UI doesn't need frequent updates
  }

  onCreate() {
    super.onCreate();

    this.card.title.text("Control Activator");

    // Defaults
    this.publishHz = 10;
    this.targetTopic = "/control_activation";
    this.isActive = false;
    this._interval = null;

    // Ensure custom styles are present
    this._ensureStyles();

    // UI
    this._buildUi();
    this._updateUi();

    // This viewer doesn't subscribe to any topic, so remove the loading spinner overlay
    this._removeSpinnerSoon();
  }

  _getTransport() {
    try { if (typeof currentTransport !== 'undefined' && currentTransport) return currentTransport; } catch(e){}
    return (window.currentTransport || null);
  }

  _buildUi() {
    const container = $("<div></div>").css({ padding: "12px", position: "relative", zIndex: 2, pointerEvents: "auto" }).appendTo(this.card.content);

    // Topic input
    const topicRow = $("<div></div>").css({ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px", position: "relative", zIndex: 3, pointerEvents: "auto" }).appendTo(container);
    $("<label></label>").text("Topic:").css({ minWidth: "48px" }).appendTo(topicRow);
    this.topicInput = $("<input type='text'>")
      .val(this.targetTopic)
      .css({ width: "240px", padding: "6px 8px" })
      .appendTo(topicRow);
    this.topicInput.on('change input', () => { this.targetTopic = (this.topicInput.val() || "/control_activation").trim() || "/control_activation"; });

    // Row for centering the toggle button
    const btnRow = $("<div></div>")
      .css({ display: "flex", justifyContent: "center", marginTop: "10px" })
      .appendTo(container);

    // Toggle button
    this.toggleBtn = $("<button></button>")
      .addClass('mdl-button mdl-js-button control-activator-btn')
      .css({ fontWeight: 'bold', position: "relative", zIndex: 3, pointerEvents: "auto" })
      .appendTo(btnRow)
      .text("INACTIVE")
      .on('click', () => this._toggle());

    // Info text
    this.info = $("<div></div>").css({ marginTop: "10px", color: "#666" }).appendTo(container);
  }

  _updateUi() {
    // Colors: green when active, red when inactive
    if (this.isActive) {
      this.toggleBtn.text("ACTIVE").css({ background: "#28a745", color: "#fff" });
      this.info.text(`Publishing true @ ${this.publishHz} Hz to ${this.targetTopic}`);
    } else {
      this.toggleBtn.text("INACTIVE").css({ background: "#dc3545", color: "#fff" });
      this.info.text("Not publishing");
    }
  }

  _toggle() {
    if (this.isActive) {
      this._stopPublishing();
    } else {
      this._startPublishing();
    }
    this._updateUi();
  }

  _startPublishing() {
    const transport = this._getTransport();
    if (!transport || !transport.publish) {
      try { window.showNotification && window.showNotification('Transport not ready'); } catch(_){ }
      return;
    }

    // Clear any existing interval without flipping state
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }

    this.isActive = true;

    const periodMs = Math.max(50, Math.floor(1000 / this.publishHz));
    this._interval = setInterval(() => {
      try {
        if (!this.isActive) return; // guard
        transport.publish({
          topicName: this.targetTopic || "/control_activation",
          topicType: 'std_msgs/Bool',
          message: { data: true }
        });
      } catch(e) {
        // ignore transient errors
      }
    }, periodMs);

    // Publish immediately
    try {
      transport.publish({
        topicName: this.targetTopic || "/control_activation",
        topicType: 'std_msgs/Bool',
        message: { data: true }
      });
    } catch(e) {}
  }

  _stopPublishing() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this.isActive = false;
    // Requirement: when inactive, send no messages at all (no final publish)
  }

  // Persist topic and active state
  serializeState() {
    return {
      topic: this.targetTopic,
      isActive: !!this.isActive
    };
  }

  applyState(state) {
    try {
      if (state && state.topic) {
        this.targetTopic = state.topic;
        if (this.topicInput) this.topicInput.val(this.targetTopic);
      }
      // Do not auto-activate on restore to avoid unintended publishing
      this._stopPublishing();
      this._updateUi();
    } catch(e) {}
  }

  destroy() {
    this._stopPublishing();
    super.destroy();
  }

  // Spinner management copied in spirit from JoystickViewer to ensure UI is clickable
  _removeSpinnerSoon() {
    this._removeSpinnerNow();
    setTimeout(() => this._removeSpinnerNow(), 100);
  }

  _removeSpinnerNow() {
    try {
      if (this.loaderContainer) {
        this.loaderContainer.remove();
        this.loaderContainer = null;
      }
      this.card.find('.loader-container').remove();
      this.card.find('.loader').remove();
      this.card.find('.spinner').remove();
      this.card.find('[class*="spinner"]').remove();
    } catch(_) {}
  }

  _ensureStyles() {
    if (document.getElementById('control-activator-styles')) return;
    const style = document.createElement('style');
    style.id = 'control-activator-styles';
    style.textContent = `
      .control-activator-btn {
        padding: 14px 26px !important;
        font-size: 16px !important;
        min-width: 200px !important;
        height: 48px !important;
        line-height: 48px !important;
        border-radius: 6px !important;
      }
    `;
    document.head.appendChild(style);
  }
}

// Register the viewer
Viewer.registerViewer(ControlActivatorViewer, "ControlActivatorViewer", "Control Activator", ["std_msgs/Bool"]);


