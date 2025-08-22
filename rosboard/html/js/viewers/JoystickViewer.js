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
      isActive: true  // Always active since we're not waiting for connection
    };

    // Initialize ROS publisher for control commands
    this.initControlPublisher();

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

      const rect = this.joystickArea[0].getBoundingClientRect();
      centerX = rect.width / 2;
      centerY = rect.height / 2;
      maxRadius = Math.min(centerX, centerY) - 20;

      this.updateJoystickPosition(e);
    });

    $(document).on('mousemove touchmove', (e) => {
      if (!isDragging) return;
      this.updateJoystickPosition(e);
    });

    $(document).on('mouseup touchend', () => {
      if (!isDragging) return;

      isDragging = false;
      this.controlState.isActive = false;

      // Return joystick to center
      this.joystickHandle.css({
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)'
      });

      // Stop robot
      this.controlState.linear = 0.0;
      this.controlState.angular = 0.0;
      this.publishControlCommand();
    });
  }

  updateJoystickPosition(e) {
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
      this.controlState.angular = angle;            // Angle in radians (0 = forward, π/2 = right, etc.)
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

    // Publish control command
    this.publishControlCommand();
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
    if (!this.controlState.isActive) {
      console.log('Joystick not active, skipping control command');
      return;
    }

    // Get transport using the same method as 3D viewer
    const transport = this._getTransport();
    console.log('Transport available:', !!transport);

    if (!transport || !transport.publish) {
      console.warn('Publish not supported by transport');
      return;
    }

    try {
      // Use the proper publish method from the transport
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
      console.log('Control command sent - linear.x:', this.controlState.linear, 'angular.z (rad):', this.controlState.angular);
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
    // Clean up event listeners
    $(document).off('mousemove touchmove mouseup touchend');
    super.destroy();
  }
}

// Register the viewer
Viewer.registerViewer(JoystickViewer, "JoystickViewer", "Robot Control", ["std_msgs/String", "geometry_msgs/Twist"]);
