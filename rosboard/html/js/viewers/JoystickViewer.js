"use strict";

importJsOnce("js/viewers/meta/Viewer.js");

class JoystickViewer extends Viewer {
  constructor(card, topicName, topicType) {
    super(card, topicName, topicType);
    this.maxUpdateRate = 10; // Limit to 10 Hz for control commands
  }

  onCreate() {
    super.onCreate();

    // Set the title
    this.card.title.text("Robot Joystick Control");

    // Create joystick container
    this.joystickContainer = $('<div class="joystick-container"></div>')
      .appendTo(this.card.content);

    // Create joystick visualization
    this.createJoystick();

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
    if (this.loaderContainer) {
      this.loaderContainer.remove();
      this.loaderContainer = null;
    }

    // Also remove any existing loaders that might be present
    this.card.find('.loader-container').remove();
    this.card.find('.loader').remove();

    // Mark joystick as ready immediately
    this.card.title.text("Robot Joystick Control - Ready");
    this.joystickArea.addClass('ready');
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
      // Only publish if we have a valid transport
      if (this._getTransport()) {
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

  createJoystick() {
    // Create joystick area
    this.joystickArea = $('<div class="joystick-area"></div>')
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

    // Mouse/touch events for joystick
    this.joystickArea.on('mousedown touchstart', (e) => {
      e.preventDefault();
      isDragging = true;
      this.controlState.isActive = true;
      this.controlState.isInteracting = true; // Start interacting

      // Start publishing at 10 FPS when interaction begins
      this.startContinuousPublishing();

      const rect = this.joystickArea[0].getBoundingClientRect();
      centerX = rect.width / 2;
      centerY = rect.height / 2;
      maxRadius = Math.min(centerX, centerY) - 20;
      startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      startY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    });

    // Use global document handlers to prevent losing track of fast mouse movements
    $(document).on('mousemove touchmove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      this.updateJoystickPosition(e);
    });

    $(document).on('mouseup touchend', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      isDragging = false;
      this.controlState.isActive = false;
      this.controlState.isInteracting = false; // End interacting

      // Stop publishing when interaction ends
      this.stopContinuousPublishing();

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
    });
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

  onData(data) {
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

    // Call parent destroy
    super.destroy();
  }
}

// Register the viewer
Viewer.registerViewer(JoystickViewer, "JoystickViewer", "Robot Control", ["std_msgs/String", "geometry_msgs/Twist"]);
