"use strict";

importJsOnce("js/viewers/meta/Viewer.js");

class JoystickViewer extends Viewer {
  constructor(card, topicName, topicType) {
    super(card, topicName, topicType);
    this.maxUpdateRate = 10; // Limit to 10 Hz for control commands
  }

  onCreate() {
    super.onCreate();

    // Add CSS styles for the new elements
    this.addCustomStyles();

    // Set the title
    this.card.title.text("Robot Joystick Control");

    // Create view selector
    this.createViewSelector();

    // Create joystick container
    this.joystickContainer = $('<div class="joystick-container"></div>')
      .appendTo(this.card.content);

    // Create slider container
    this.sliderContainer = $('<div class="slider-container" style="display: none;"></div>')
      .appendTo(this.card.content);

    console.log('Containers created:', {
      joystick: this.joystickContainer.length,
      slider: this.sliderContainer.length,
      cardContent: this.card.content.length
    });

    // Create joystick visualization
    this.createJoystick();

    // Create slider view
    this.createSliderView();

    // Create control buttons
    this.createControlButtons();

    // Initialize control state
    this.controlState = {
      linear: 0.0,    // Forward/backward speed (-1.0 to 1.0)
      angular: 0.0,   // Left/right turning (-1.0 to 1.0)
      isActive: false, // Start inactive - no publishing until interaction
      isInteracting: false // Track if user is currently interacting
    };

    // Initialize ROS publisher for control commands
    this.initControlPublisher();

    // Don't start continuous publishing - wait for interaction
    console.log('Joystick ready - waiting for interaction to start publishing');

    // Force remove the loading spinner immediately
    this.removeLoadingSpinner();

    // Mark joystick as ready immediately
    this.card.title.text("Robot Joystick Control - Ready");
    if (this.joystickArea) {
      this.joystickArea.addClass('ready');
    }

    // Ensure spinner is removed after a short delay as a fallback
    setTimeout(() => {
      this.removeLoadingSpinner();
    }, 100);
  }

  addCustomStyles() {
    // Check if styles are already added
    if (document.getElementById('joystick-viewer-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'joystick-viewer-styles';
    style.textContent = `
      .view-selector {
        display: flex;
        gap: 10px;
        margin-bottom: 20px;
        justify-content: center;
      }

      .view-btn {
        padding: 8px 16px;
        border: 2px solid #007bff;
        background: white;
        color: #007bff;
        border-radius: 5px;
        cursor: pointer;
        font-weight: bold;
        transition: all 0.3s ease;
      }

      .view-btn:hover {
        background: #007bff;
        color: white;
      }

      .view-btn.active {
        background: #007bff;
        color: white;
      }

      .slider-container {
        padding: 20px;
        text-align: center;
      }

      .angle-slider-container {
        margin-bottom: 30px;
      }

      .angle-label {
        font-size: 16px;
        font-weight: bold;
        margin-bottom: 15px;
        color: #333;
      }

      .angle-value {
        color: #007bff;
        font-weight: bold;
      }

      .angle-slider {
        width: 80%;
        height: 8px;
        border-radius: 5px;
        background: #ddd;
        outline: none;
        -webkit-appearance: none;
      }

      .angle-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #007bff;
        cursor: pointer;
      }

      .angle-slider::-moz-range-thumb {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #007bff;
        color: white;
        border: none;
      }

      .movement-buttons {
        display: flex;
        gap: 20px;
        justify-content: center;
        flex-wrap: wrap;
      }

      .movement-btn {
        padding: 15px 30px;
        font-size: 18px;
        font-weight: bold;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s ease;
        min-width: 120px;
      }

      .forward-btn {
        background: #28a745;
        color: white;
      }

      .forward-btn:hover {
        background: #218838;
        transform: translateY(-2px);
      }

      .forward-btn:active {
        transform: translateY(0);
      }

      .backward-btn {
        background: #dc3545;
        color: white;
      }

      .backward-btn:hover {
        background: #c82333;
        transform: translateY(-2px);
      }

      .backward-btn:active {
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);
    console.log('Custom styles added');
  }

  /**
   * Get transport using the same method as 3D viewer
   */
  _getTransport() {
    try {
      if(typeof currentTransport !== 'undefined' && currentTransport) return currentTransport;
    } catch(e){}
    return (window.currentTransport || null);
  }

  /**
   * Start continuous publishing at 10 FPS
   */
  startContinuousPublishing() {
    // Publish at exactly 10 FPS (every 100ms)
    this.publishInterval = setInterval(() => {
      // Only publish if we have a valid transport and are in an active state
      if (this._getTransport() && this.controlState.isActive) {
        this.publishControlCommand();
      }
    }, 100); // 10 FPS = 100ms interval

    console.log('Started continuous publishing at 10 FPS');

    // Also publish immediately to start
    this.publishControlCommand();
  }

  /**
   * Stop continuous publishing
   */
  stopContinuousPublishing() {
    if (this.publishInterval) {
      clearInterval(this.publishInterval);
      this.publishInterval = null;
      console.log('Stopped continuous publishing');
    }
  }

  createViewSelector() {
    console.log('Creating view selector...');

    // Create view selector container
    this.viewSelectorContainer = $('<div class="view-selector"></div>')
      .css({
        'position': 'relative',
        'z-index': '1000',
        'pointer-events': 'auto'
      })
      .appendTo(this.card.content);

    // Create view selector buttons
    this.joystickViewBtn = $('<button class="view-btn active">Joystick</button>')
      .css({
        'position': 'relative',
        'z-index': '1001',
        'pointer-events': 'auto',
        'cursor': 'pointer',
        'user-select': 'none'
      })
      .appendTo(this.viewSelectorContainer);

    this.sliderViewBtn = $('<button class="view-btn">Slider</button>')
      .css({
        'position': 'relative',
        'z-index': '1001',
        'pointer-events': 'auto',
        'cursor': 'pointer',
        'user-select': 'none'
      })
      .appendTo(this.viewSelectorContainer);

    // Add some debugging info to the buttons
    this.joystickViewBtn.attr('data-debug', 'joystick-btn');
    this.sliderViewBtn.attr('data-debug', 'slider-btn');

    // Remove debugging borders since buttons are working
    // this.joystickViewBtn.css('border', '2px solid red');
    // this.sliderViewBtn.css('border', '2px solid red');

    console.log('View selector buttons created:', {
      joystick: this.joystickViewBtn.length,
      slider: this.sliderViewBtn.length
    });

    // Debug button properties
    console.log('Button details:', {
      joystick: {
        element: this.joystickViewBtn[0],
        offset: this.joystickViewBtn.offset(),
        isVisible: this.joystickViewBtn.is(':visible'),
        css: {
          position: this.joystickViewBtn.css('position'),
          zIndex: this.joystickViewBtn.css('z-index'),
          pointerEvents: this.joystickViewBtn.css('pointer-events')
        }
      },
      slider: {
        element: this.sliderViewBtn[0],
        offset: this.sliderViewBtn.offset(),
        isVisible: this.sliderViewBtn.is(':visible'),
        css: {
          position: this.sliderViewBtn.css('position'),
          zIndex: this.sliderViewBtn.css('z-index'),
          pointerEvents: this.sliderViewBtn.css('pointer-events')
        }
      }
    });

        // Bind view selector events - try multiple event types
    this.joystickViewBtn.on('click mousedown touchstart', (e) => {
      console.log('Joystick button clicked/touched:', e.type);
      e.preventDefault();
      e.stopPropagation();
      this.switchToView('joystick');
    });

    this.sliderViewBtn.on('click mousedown touchstart', (e) => {
      console.log('Slider button clicked/touched:', e.type);
      e.preventDefault();
      e.stopPropagation();
      this.switchToView('slider');
    });

    // Also try direct DOM event listeners as backup
    try {
      this.joystickViewBtn[0].addEventListener('click', (e) => {
        console.log('Joystick button clicked via DOM listener');
        e.preventDefault();
        this.switchToView('joystick');
      });

      this.sliderViewBtn[0].addEventListener('click', (e) => {
        console.log('Slider button clicked via DOM listener');
        e.preventDefault();
        this.switchToView('slider');
      });
    } catch (err) {
      console.log('DOM event listeners failed:', err);
    }

        console.log('View selector events bound');
  }

  switchToView(viewType) {
    console.log('Switching to view:', viewType);

    // Update button states
    this.joystickViewBtn.removeClass('active');
    this.sliderViewBtn.removeClass('active');

    if (viewType === 'joystick') {
      console.log('Showing joystick view');
      this.joystickViewBtn.addClass('active');
      this.joystickContainer.show();
      this.sliderContainer.hide();
      console.log('Container visibility after switch:', {
        joystick: this.joystickContainer.is(':visible'),
        slider: this.sliderContainer.is(':visible')
      });
      // Stop continuous publishing and reset control state for joystick view
      this.stopContinuousPublishing();
      this.controlState.isActive = false;
      this.controlState.linear = 0.0;
      this.controlState.angular = 0.0;
    } else if (viewType === 'slider') {
      console.log('Showing slider view');
      this.sliderViewBtn.addClass('active');
      this.joystickContainer.hide();
      this.sliderContainer.show();
      console.log('Container visibility after switch:', {
        joystick: this.joystickContainer.is(':visible'),
        slider: this.sliderContainer.is(':visible')
      });
      // Stop continuous publishing and reset control state for slider view
      this.stopContinuousPublishing();
      this.controlState.isActive = false;
      this.controlState.linear = 0.0;
      this.controlState.angular = 0.0;
    }
  }

  createSliderView() {
    console.log('Creating slider view...');

    // Create angle slider container
    this.angleSliderContainer = $('<div class="angle-slider-container"></div>')
      .css({
        'position': 'relative',
        'z-index': '1000',
        'pointer-events': 'auto'
      })
      .appendTo(this.sliderContainer);

    // Create angle label with direction indicators
    $('<div class="angle-label">Steering Angle: <span class="angle-value">0°</span></div>')
      .appendTo(this.angleSliderContainer);

    // Add direction labels for the slider
    $('<div class="slider-labels" style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 14px; color: #666;">')
      .append('<span>+45° (Left)</span>')
      .append('<span>-45° (Right)</span>')
      .appendTo(this.angleSliderContainer);

    // Create angle slider with proper styling - use valid range, invert in handler
    this.angleSlider = $('<input type="range" min="-45" max="45" value="0" step="1" class="angle-slider">')
      .css({
        'position': 'relative',
        'z-index': '1001',
        'pointer-events': 'auto',
        'cursor': 'pointer'
      })
      .appendTo(this.angleSliderContainer);

    // Create movement buttons container
    this.movementButtonsContainer = $('<div class="movement-buttons"></div>')
      .css({
        'position': 'relative',
        'z-index': '1000',
        'pointer-events': 'auto'
      })
      .appendTo(this.sliderContainer);

    // Create forward button
    this.forwardBtn = $('<button class="movement-btn forward-btn">FORWARD</button>')
      .css({
        'position': 'relative',
        'z-index': '1001',
        'pointer-events': 'auto',
        'cursor': 'pointer'
      })
      .appendTo(this.movementButtonsContainer);

    // Create backward button
    this.backwardBtn = $('<button class="movement-btn backward-btn">BACKWARD</button>')
      .css({
        'position': 'relative',
        'z-index': '1001',
        'pointer-events': 'auto',
        'cursor': 'pointer'
      })
      .appendTo(this.movementButtonsContainer);

    // Bind slider events with multiple event types
    this.angleSlider.on('input change mousedown touchstart', (e) => {
      const rawAngle = parseInt(e.target.value);
      // Invert the angle: left side (+45) becomes +45, right side (-45) becomes -45
      const invertedAngle = -rawAngle;
      this.angleSliderContainer.find('.angle-value').text(invertedAngle + '°');
      // Convert degrees to radians for control
      this.controlState.angular = (invertedAngle * Math.PI) / 180;
      console.log('Slider moved to:', invertedAngle + '° (raw value:', rawAngle + ')');
    });

    // Bind movement button events with multiple event types
    this.forwardBtn.on('mousedown touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.controlState.linear = 1.0;
      this.controlState.isActive = true;
      this.startContinuousPublishing();
      console.log('Forward button pressed - starting continuous publishing');
    });

    this.forwardBtn.on('mouseup touchend mouseleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.controlState.linear = 0.0;
      this.controlState.isActive = false;
      this.stopContinuousPublishing();
      // Send one final zero command to stop the robot
      this.publishControlCommand();
      console.log('Forward button released - stopping continuous publishing');
    });

    this.backwardBtn.on('mousedown touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.controlState.linear = -1.0;
      this.controlState.isActive = true;
      this.startContinuousPublishing();
      console.log('Backward button pressed - starting continuous publishing');
    });

    this.backwardBtn.on('mouseup touchend mouseleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.controlState.linear = 0.0;
      this.controlState.isActive = false;
      this.stopContinuousPublishing();
      // Send one final zero command to stop the robot
      this.publishControlCommand();
      console.log('Backward button released - stopping continuous publishing');
    });
  }

  createJoystick() {
    // Create joystick area
    this.joystickArea = $('<div class="joystick-area"></div>')
      .css({
        touchAction: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        overscrollBehavior: 'contain'
      })
      .appendTo(this.joystickContainer);

    // Create joystick handle
    this.joystickHandle = $('<div class="joystick-handle"></div>')
      .appendTo(this.joystickArea);

    // Create joystick center point
    this.joystickCenter = $('<div class="joystick-center"></div>')
      .appendTo(this.joystickArea);

    // Create joystick labels
    this.createJoystickLabels();

    // Bind joystick events
    this.bindJoystickEvents();
  }

  createJoystickLabels() {
    // Add direction labels
    $('<div class="joystick-label joystick-label-forward">FWD</div>')
      .appendTo(this.joystickArea);
    $('<div class="joystick-label joystick-label-backward">BWD</div>')
      .appendTo(this.joystickArea);
    $('<div class="joystick-label joystick-label-left">LEFT</div>')
      .appendTo(this.joystickArea);
    $('<div class="joystick-label joystick-label-right">RIGHT</div>')
      .appendTo(this.joystickArea);
  }

  bindJoystickEvents() {
    let isDragging = false;
    let startX, startY, centerX, centerY, maxRadius;
    this._lastPublishMs = 0;

    // Mouse/touch events for joystick
    const onStart = (e) => {
      try { if(e && e.cancelable) e.preventDefault(); } catch(_){}
      isDragging = true;
      this.controlState.isActive = true;
      this.controlState.isInteracting = true; // Start interacting

      const rect = this.joystickArea[0].getBoundingClientRect();
      centerX = rect.width / 2;
      centerY = rect.height / 2;
      maxRadius = Math.min(centerX, centerY) - 20;
      const isTouch = (e && e.touches && e.touches.length);
      startX = isTouch ? e.touches[0].clientX : e.clientX;
      startY = isTouch ? e.touches[0].clientY : e.clientY;
      // Initial publish
      this.publishControlCommand();
    };
    this.joystickArea.on('mousedown', onStart);
    // use passive:false for touch to prevent page scroll
    try { this.joystickArea[0].addEventListener('touchstart', onStart, {passive:false}); } catch(_){ this.joystickArea.on('touchstart', onStart); }

    // Use global document handlers to prevent losing track of fast mouse movements
    const onMove = (e) => {
      if (!isDragging) return;
      try { if(e && e.cancelable) e.preventDefault(); } catch(_){}
      this.updateJoystickPosition(e);
      // Throttle publishes while dragging
      const now = Date.now();
      if (!this._lastPublishMs || (now - this._lastPublishMs) > 120) {
        this.publishControlCommand();
        this._lastPublishMs = now;
      }
    };
    $(document).on('mousemove', onMove);
    try { document.addEventListener('touchmove', onMove, {passive:false}); } catch(_){ $(document).on('touchmove', onMove); }

    const onEnd = (e) => {
      if (!isDragging) return;
      try { if(e && e.cancelable) e.preventDefault(); } catch(_){}
      isDragging = false;
      this.controlState.isActive = false;
      this.controlState.isInteracting = false; // End interacting

      // Return joystick to center
      this.joystickHandle.css({
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)'
      });

      // Reset control state to zero
      this.controlState.linear = 0.0;
      this.controlState.angular = 0.0;

      // Send one final zero command to stop the robot
      this.publishControlCommand();
    };
    $(document).on('mouseup', onEnd);
    try { document.addEventListener('touchend', onEnd, {passive:false}); } catch(_){ $(document).on('touchend', onEnd); }
  }

  updateJoystickPosition(e) {
    const MAX_ANGLE=45;
    const rect = this.joystickArea[0].getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const maxRadius = Math.min(centerX, centerY) - 20;

    // Get pointer position
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

    // Calculate relative position from center
    // FIXED: deltaX should be horizontal (left/right), deltaY should be vertical (up/down)
    const deltaX = clientX - rect.left - centerX;  // Horizontal: left = negative, right = positive
    const deltaY = -(clientY - rect.top - centerY); // Vertical: up = positive, down = negative (inverted Y-axis)

    // Calculate distance
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Normalize deltaX and deltaY to the range [-1, 1] based on maxRadius
    const normalizedDeltaX = Math.max(-1, Math.min(1, deltaX / maxRadius));
    const normalizedDeltaY = Math.max(-1, Math.min(1, deltaY / maxRadius));

    console.log('normalizedDeltaX:', normalizedDeltaX, 'normalizedDeltaY:', normalizedDeltaY);

    // Calculate angle using arctan2 - FIXED: Forward (up) should be 0 radians
    // arctan2(deltaY, deltaX) gives us the angle where:
    // Forward (up) = 0 radians
    // Right = π/2 radians
    // Backward (down) = π radians
    // Left = -π/2 radians
    const angle = -Math.atan2(deltaX, deltaY);

    // Limit to max radius
    const clampedDistance = Math.min(distance, maxRadius);

    // Simple control mapping: just use the normalized values and angle
    if (clampedDistance > 10) { // Only control if moved significantly
      // Use normalized deltas directly for linear control
      if (normalizedDeltaY > 0) {
        this.controlState.linear = 1;  // Y-axis movement (forward/backward) [-1, 1]
      } else {
        this.controlState.linear = -1;  // Y-axis movement (forward/backward) [-1, 1]
      }
      const ratio = 45/90;
      // Print the angle in degrees
      if (angle > -Math.PI/2 && angle < Math.PI/2) {
        this.controlState.angular = -Math.atan2(deltaX, deltaY)*ratio;            // Angle in radians (0 = forward, π/2 = right, etc.) //FIXED: divide by 2 to limit the angle to 45 degrees
      } else if (angle > Math.PI/2 && angle < 3*Math.PI/2) {
        this.controlState.angular = Math.atan2(deltaX, deltaY)*ratio + Math.PI/2;            // Angle in radians (0 = forward, π/2 = right, etc.) //FIXED: divide by 2 to limit the angle to 45 degrees
      } else if (angle > -3*Math.PI/2 && angle < -Math.PI/2) {
        this.controlState.angular = Math.atan2(deltaX, deltaY)*ratio - Math.PI/2;            // Angle in radians (0 = forward, π/2 = right, etc.) //FIXED: divide by 2 to limit the angle to 45 degrees
      }
    } else {
      // Center position - no movement
      this.controlState.linear = 0.0;
      this.controlState.angular = 0.0;
    }

    // Update joystick handle position
    const handleX = centerX - clampedDistance * Math.cos(angle);
    const handleY = centerY - clampedDistance * Math.sin(angle);

    this.joystickHandle.css({
      left: handleY + 'px',
      top: handleX + 'px',
      transform: 'translate(-50%, -50%)'
    });

    // Note: publishControlCommand is now called continuously by the interval
    // No need to call it here anymore
  }

  createControlButtons() {
    // Create button container
    this.buttonContainer = $('<div class="joystick-buttons"></div>')
      .appendTo(this.joystickContainer);

    // No more emergency stop button or speed slider - simplified interface
    this.maxSpeed = 1.0; // Fixed max speed
  }

  emergencyStop() {
    // This method is no longer needed since we removed the emergency stop button
    console.log('Emergency stop method called but button was removed');
  }

  initControlPublisher() {
    // This will be handled by the backend to publish to /control_cmd topic
    console.log('Joystick control initialized for topic:', this.topicName);
    console.log('WebSocket transport available:', !!window.currentTransport);
    if (window.currentTransport) {
      console.log('WebSocket connected:', window.currentTransport.isConnected());
      console.log('WebSocket object:', window.currentTransport.ws);
    }
  }

  publishControlCommand() {
    // Get transport using the same method as 3D viewer
    const transport = this._getTransport();

    if (!transport || !transport.publish) {
      console.warn('Publish not supported by transport');
      return;
    }

    try {
      // Publish current control state (only called when isInteracting is true)
      transport.publish({
        topicName: '/control_cmd',
        topicType: 'geometry_msgs/Twist',
        message: {
          linear: {
            x: this.controlState.linear,                          // X-axis movement (not used)
            y: 0,   // Y-axis movement (forward/backward) [-1, 1]
            z: 0
          },
          angular: {
            x: 0,
            y: 0,
            z: this.controlState.angular  // Angle in radians (0 = forward, π/2 = right, etc.)
          }
        }
      });

      // Track publishing rate for debugging
      const now = Date.now();
      if (!this.lastPublishTime) {
        this.lastPublishTime = now;
        this.publishCount = 0;
      } else {
        this.publishCount++;
        if (this.publishCount % 10 === 0) { // Log every 10th publish
          const elapsed = now - this.lastPublishTime;
          const actualFPS = (this.publishCount / elapsed) * 1000;
          console.log(`Publishing rate: ${actualFPS.toFixed(1)} FPS (${this.publishCount} messages in ${elapsed}ms)`);
          this.lastPublishTime = now;
          this.publishCount = 0;
        }
      }

      // Log only when there's actual movement to reduce console spam
      if (Math.abs(this.controlState.linear) > 0.01 || Math.abs(this.controlState.angular) > 0.01) {
        console.log('Control command sent - linear.x:', this.controlState.linear, 'angular.z (rad):', this.controlState.angular);
      }
    } catch (e) {
      console.error('Failed to send control command:', e);
    }
  }

  removeLoadingSpinner() {
    // Remove the main loader container
    if (this.loaderContainer) {
      this.loaderContainer.remove();
      this.loaderContainer = null;
    }

    // Also remove any existing loaders that might be present
    this.card.find('.loader-container').remove();
    this.card.find('.loader').remove();
    
    // Remove any spinner elements
    this.card.find('.spinner').remove();
    this.card.find('[class*="spinner"]').remove();
  }

  onData(data) {
    // Remove spinner when data is received (though this viewer typically doesn't receive data)
    this.removeLoadingSpinner();
    
    // Update status if we receive any data
    if (data && data._topic_name) {
      this.card.title.text("Robot Joystick Control - Active");
    }
  }

  destroy() {
    // Stop continuous publishing
    this.stopContinuousPublishing();

    // Remove global event listeners
    $(document).off('mousemove touchmove mouseup touchend');

    // Remove joystick area event listeners
    if (this.joystickArea) {
      this.joystickArea.off('mousedown touchstart');
    }

    // Remove slider view event listeners
    if (this.angleSlider) {
      this.angleSlider.off('input');
    }
    if (this.forwardBtn) {
      this.forwardBtn.off('mousedown touchstart mouseup touchend mouseleave');
    }
    if (this.backwardBtn) {
      this.backwardBtn.off('mousedown touchstart mouseup touchend mouseleave');
    }

    // Remove view selector event listeners
    if (this.joystickViewBtn) {
      this.joystickViewBtn.off('click');
    }
    if (this.sliderViewBtn) {
      this.sliderViewBtn.off('click');
    }

    // Call parent destroy
    super.destroy();
  }
}

// Register the viewer
Viewer.registerViewer(JoystickViewer, "JoystickViewer", "Robot Control", ["std_msgs/String", "geometry_msgs/Twist"]);
