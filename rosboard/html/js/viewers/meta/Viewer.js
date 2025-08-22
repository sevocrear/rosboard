"use strict";

// Viewer is just a base class. It just has the boilerplate code to
// instantiate the elemnets (title, content, close button, spinner) of a card
// and display an error if there is an error. Viewer doesn't have any visualization
// capability at all, hence, it has no supportedTypes. Child classes will inherit
// from Viewer and implement visualization functionality.

class Viewer {
  /**
    * Class constructor.
    * @constructor
  **/
  constructor(card, topicName, topicType) {
    this.card = card;
    this.isPaused = false;

    this.topicName = topicName;
    this.topicType = topicType;

    this.onClose = () => {};
    let that = this;

    // make card resizable
    this.card.css({ resize: "both", overflow: "hidden", position: "relative" });

    // add visible resize handle (purely visual, OS/browser still handles the resize)
    if(!this.card.find('.resize-handle').length) {
      $('<div class="resize-handle"></div>')
        .css({
          position: "absolute",
          right: "6px",
          bottom: "6px",
          width: "14px",
          height: "14px",
          background: "linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.25) 50%), linear-gradient(45deg, transparent 50%, rgba(255,255,255,0.15) 50%)",
          backgroundSize: "100% 100%",
          pointerEvents: "none",
          opacity: 0.6,
          borderRadius: "2px",
        })
        .appendTo(this.card);
    }

    // div container at the top right for all the buttons
    card.buttons = $('<div></div>').addClass('card-buttons').text('').appendTo(card);

    // card title div
    card.title = $('<div></div>').addClass('card-title').text("Waiting for data ...").appendTo(card);

    // card content div
    card.content = $('<div></div>').addClass('card-content').text('').appendTo(card);

    // card pause button
    let menuId = 'menu-' + Math.floor(Math.random() * 1e6);

    card.settingsButton = $('<button id="' + menuId + '"></button>')
    .addClass('mdl-button')
    .addClass('mdl-js-button')
    .addClass('mdl-button--icon')
    .addClass('mdl-button--colored')
    .append($('<i></i>').addClass('material-icons').text('more_vert'))
    .appendTo(card.buttons);
    /*card.settingsButton.click(function(e) {
      console.log("not implemented yet");
    });*/

    card.menu = $('<ul class="mdl-menu mdl-menu--bottom-right mdl-js-menu mdl-js-ripple-effect" \
      for="' + menuId + '"></ul>').appendTo(card);

    // <li class="mdl-menu__item">Some Action</li> \
    // <li class="mdl-menu__item mdl-menu__item--full-bleed-divider">Another Action</li> \
    // <li disabled class="mdl-menu__item">Disabled Action</li> \
    // <li class="mdl-menu__item">Yet Another Action</li> \

    let viewers = Viewer.getViewersForType(this.topicType);
    for(let i in viewers) {
      let item = $('<li ' + (viewers[i].name === this.constructor.name ? 'disabled' : '') + ' class="mdl-menu__item">' + viewers[i].friendlyName + '</li>').appendTo(this.card.menu);
      let that = this;
      item.click(() => { Viewer.onSwitchViewer(that, viewers[i]); });
    }

    componentHandler.upgradeAllRegistered();

    // card pause button
    card.pauseButton = $('<button></button>')
      .addClass('mdl-button')
      .addClass('mdl-js-button')
      .addClass('mdl-button--icon')
      .addClass('mdl-button--colored')
      .append($('<i></i>').addClass('material-icons').text('pause'))
      .appendTo(card.buttons);
      card.pauseButton.click(function(e) {
        that.isPaused = !that.isPaused;
        that.card.pauseButton.find('i').text(that.isPaused ? 'play_arrow' : 'pause');
      });

    // card close button
    card.closeButton = $('<button></button>')
      .addClass('mdl-button')
      .addClass('mdl-js-button')
      .addClass('mdl-button--icon')
      .append($('<i></i>').addClass('material-icons').text('close'))
      .appendTo(card.buttons);
    card.closeButton.click(() => { Viewer.onClose(that); });

    // call onCreate(); child class will override this and initialize its UI
    this.onCreate();

    // lay a spinner over everything and get rid of it after first data is received
    this.loaderContainer = $('<div></div>')
      .addClass('loader-container')
      .append($('<div></div>').addClass('loader'))
      .appendTo(this.card);

    this.lastDataTime = 0.0;

    // observe card resize and call onResize + relayout grid
    if(window.ResizeObserver) {
      this._resizeObserver = new ResizeObserver(() => {
        try { this.onResize(); } catch(e) { console.warn("onResize error:", e); }
        try { if(typeof $grid !== 'undefined') { $grid.masonry("layout"); } } catch(e) {}
      });
      try { this._resizeObserver.observe(this.card[0]); } catch(e) {}
    }

    // Initialize draggable functionality after card elements are fully created
    setTimeout(() => {
      this.initDraggable();
    }, 100);
  }

  /**
   * Initialize draggable functionality for the card
   * Works with middle mouse button, touchpad gestures, and keyboard shortcuts
   */
  initDraggable() {
    console.log('=== DRAG DEBUG START ===');
    console.log('Draggabilly available:', typeof Draggabilly);
    console.log('jQuery available:', typeof $);
    console.log('Card element:', this.card[0]);
    console.log('Card title element:', this.card.find('.card-title')[0]);

    if (typeof Draggabilly !== 'undefined') {
      console.log('Initializing draggable for card:', this.topicName);

      // Add keyboard shortcut for dragging (Ctrl+Shift+D)
      this.card.attr('tabindex', '0');
      this.card.on('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
          e.preventDefault();
          this.toggleDragMode();
        }
      });

      // Add visual indicator for drag mode
      this.dragIndicator = $('<div class="drag-indicator"></div>')
        .text('')
        .appendTo(this.card.buttons);

      // Make drag indicator clickable
      this.dragIndicator.on('click', () => {
        this.toggleDragMode();
      });

      console.log('Creating Draggabilly instance for card:', this.card[0]);
      try {
        this.draggable = new Draggabilly(this.card[0], {
          containment: '.page-content',
          handle: '.card-title',
          onDragStart: (event, pointer) => {
            console.log('Drag start event:', event);
            console.log('Drag allowed - mouse button:', event.button);
            // Add dragging class for visual feedback
            this.card.addClass('dragging');
            // Temporarily disable masonry layout during drag
            if (typeof $grid !== 'undefined') {
              console.log('Destroying masonry grid during drag');
              $grid.masonry("destroy");
            }
          },
          onDrag: () => {
            console.log('Dragging...');
            // Update position during drag
            this.card.css({
              position: 'absolute',
              zIndex: 1000
            });
          },
          onDragEnd: () => {
            console.log('Drag end');
            // Remove dragging class
            this.card.removeClass('dragging');
            // Re-enable masonry layout after dragging
            if (typeof $grid !== 'undefined') {
              console.log('Re-enabling masonry grid after drag');
              $grid.masonry({
                itemSelector: '.card',
                gutter: 10,
                percentPosition: true,
              });
              $grid.masonry("layout");
            }
          }
        });

        // Enable dragging by default
        this.isDragEnabled = true;
        this.dragIndicator.text('').addClass('drag-active');
        this.card.addClass('drag-enabled');
        console.log('Draggable initialized successfully for:', this.topicName);
      } catch (error) {
        console.error('Error creating Draggabilly instance:', error);
        this.initFallbackDraggable();
      }
    } else {
      console.warn('Draggabilly library not loaded, using fallback');
      this.initFallbackDraggable();
    }
    console.log('=== DRAG DEBUG END ===');
  }

  /**
   * Fallback dragging method using jQuery events
   */
  initFallbackDraggable() {
    console.log('Initializing fallback draggable for card:', this.topicName);

    let isDragging = false;
    let startX, startY, startLeft, startTop;

    this.card.find('.card-title').on('mousedown', (e) => {
      console.log('Fallback drag start:', e);
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseInt(this.card.css('left')) || 0;
      startTop = parseInt(this.card.css('top')) || 0;

      this.card.addClass('dragging');
      this.card.css({
        position: 'absolute',
        zIndex: 1000,
        cursor: 'grabbing'
      });

      e.preventDefault();
    });

    $(document).on('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      this.card.css({
        left: startLeft + deltaX + 'px',
        top: startTop + deltaY + 'px'
      });
    });

    $(document).on('mouseup', () => {
      if (!isDragging) return;

      isDragging = false;
      this.card.removeClass('dragging');
      this.card.css({
        cursor: 'grab'
      });

      // Re-enable masonry layout
      if (typeof $grid !== 'undefined') {
        $grid.masonry({
          itemSelector: '.card',
          gutter: 10,
          percentPosition: true,
        });
        $grid.masonry("layout");
      }
    });

    // Enable dragging by default
    this.isDragEnabled = true;
    this.dragIndicator.text('').addClass('drag-active');
    this.card.addClass('drag-enabled');
    console.log('Fallback draggable initialized successfully for:', this.topicName);
  }

  /**
   * Toggle drag mode on/off
   */
  toggleDragMode() {
    if (!this.draggable) return;

    this.isDragEnabled = !this.isDragEnabled;
    if (this.isDragEnabled) {
      this.draggable.enable();
      this.dragIndicator.text('Drag mode: ON (click title to drag)').addClass('drag-active');
      this.card.addClass('drag-enabled');
    } else {
      this.draggable.disable();
      this.dragIndicator.text('Ctrl+Shift+D to drag').removeClass('drag-active');
      this.card.removeClass('drag-enabled');
    }
  }

  /**
    * Gets called when Viewer is first initialized.
    * @override
  **/
  onCreate() {
    // for MDL elements to get instantiated
    if(!(typeof(componentHandler) === 'undefined')){
      componentHandler.upgradeAllRegistered();
    }
    // Initialize draggable functionality after card elements are created
    setTimeout(() => {
      this.initDraggable();
    }, 100);
  }

  // Optional: override in child to persist custom UI state
  serializeState() { return null; }
  // Optional: override in child to restore custom UI state
  applyState(state) {}
  destroy() {
    if(this._resizeObserver) { try { this._resizeObserver.disconnect(); } catch(e){} }
    if(this.draggable) { try { this.draggable.destroy(); } catch(e){} }
    this.card.empty();
  }

  onResize() { }

  onDataPaused(data) { }

  onData(data) { }

  update(data) {
    let time = Date.now();
    if( (time - this.lastDataTime)/1000.0 < 1/this.constructor.maxUpdateRate - 5e-4) {
      return;
    }

    if(this.isPaused) { this.onDataPaused(data); return; }

    this.lastDataTime = time;

    // get rid of the spinner
    if(this.loaderContainer) {
      this.loaderContainer.remove();
      this.loaderContainer = null;
    }

    if(data._error) {
      this.error(data._error);
      return;
    }

    if(data._warn) {
      this.warn(data._warn);
    }

    // actually update the data
    try {
      this.onData(data);
    } catch(e) {
      console.error("Viewer onData error:", e);
      this.warn("Viewer error: " + (e && e.message ? e.message : String(e)));
    }
  }

  error(error_text) {
    if(!this.card.error) {
      this.card.error = $("<div></div>").css({
        "background": "#f06060",
        "color": "#ffffff",
        "padding": "20pt",
      }).appendTo(this.card);
    }
    this.card.error.text(error_text).css({
      "display": "",
    });
    this.card.content.css({
      "display": "none",
    })
  }

  warn(warn_text) {
    if(!this.card.warn) {
      this.card.warn = $("<div></div>").css({
        "background": "#a08000",
        "color": "#ffffff",
        "padding": "20pt",
      }).appendTo(this.card);
    }
    this.card.warn.text(warn_text).css({
      "display": "",
    });
  }

  tip(tip_text) {
    if(this.tipHideTimeout) clearTimeout(this.tipHideTimeout);
    if(!this.tipBox) {
      this.tipBox = $("<div></div>").css({
        "background": "rgba(0,0,0,0.3)",
        "position": "absolute",
        "z-index": "10",
        "bottom": "0",
        "width": "calc( 100% - 24pt )",
        "height": "24px",
        "text-overflow": "ellipsis",
        "overflow": "hidden",
        "padding-left": "12pt",
        "padding-right": "12pt",
        "padding-bottom": "4pt",
        "padding-top": "4pt",
        "font-size": "8pt",
        "white-space": "nowrap",
        "color": "#ffffff",
      }).addClass("monospace").appendTo(this.card);
    }
    let that = this;
    this.tipBox.css({"display": ""});
    this.tipHideTimeout = setTimeout(() => that.tipBox.css({"display": "none"}), 1000);
    this.tipBox.text(tip_text);
  }
}

Viewer.friendlyName = "Viewer";

// can be overridden by child class
// list of supported message types by viewer, or "*" for all types
// todo: support regexes?
Viewer.supportedTypes = [];

// can be overridden by child class
// max update rate that this viewer can handle
// for some viewers that do extensive DOM manipulations, this should be set conservatively
Viewer.maxUpdateRate = 50.0;

// not to be overwritten by child class!
// stores registered viewers in sequence of loading
Viewer._viewers = [];

// override this
Viewer.onClose = (viewerInstance) => { console.log("not implemented; override necessary"); }
Viewer.onSwitchViewer = (viewerInstance, newViewerType) => { console.log("not implemented; override necessary"); }

// not to be overwritten by child class!
Viewer.registerViewer = (viewer) => {
  // registers a viewer. the viewer child class calls this at the end of the file to register itself
  Viewer._viewers.push(viewer);
};

// not to be overwritten by child class!
Viewer.getDefaultViewerForType = (type) => {
  // gets the viewer class for a given message type (e.g. "std_msgs/msg/String")

  // if type is "package/MessageType", converted it to "package/msgs/MessageType"
  let tokens = type.split("/");
  if(tokens.length == 2) {
    type = [tokens[0], "msg", tokens[1]].join("/");
  }

  // go down the list of registered viewers and return the first match
  for(let i in Viewer._viewers) {
    if(Viewer._viewers[i].supportedTypes.includes(type)) {
      return Viewer._viewers[i];
    }
    if(Viewer._viewers[i].supportedTypes.includes("*")) {
      return Viewer._viewers[i];
    }
  }
  return null;
}

// not to be overwritten by child class!
Viewer.getViewersForType = (type) => {
  // gets the viewer classes for a given message type (e.g. "std_msgs/msg/String")

  let matchingViewers = [];

  // if type is "package/MessageType", converted it to "package/msgs/MessageType"
  let tokens = type.split("/");
  if(tokens.length == 2) {
    type = [tokens[0], "msg", tokens[1]].join("/");
  }

  // go down the list of registered viewers and return the first match
  for(let i in Viewer._viewers) {
    if(Viewer._viewers[i].supportedTypes.includes(type)) {
      matchingViewers.push(Viewer._viewers[i]);
    }
    if(Viewer._viewers[i].supportedTypes.includes("*")) {
      matchingViewers.push(Viewer._viewers[i]);
    }
  }

  return matchingViewers;
}

