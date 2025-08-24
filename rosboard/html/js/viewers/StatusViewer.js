"use strict";

importJsOnce("js/viewers/meta/Viewer.js");

class StatusViewer extends Viewer {
  constructor(card, topicName, topicType) {
    console.log('StatusViewer constructor called with:', card, topicName, topicType);
    super(card, topicName, topicType);
  }

  onCreate() {
    console.log('StatusViewer onCreate called');

    // Define topics to monitor
    this.topicsToMonitor = [
      '/driver/lidar/frontbottom',
      '/driver/lidar/top', '/ultramarker',
      '/tpcansensor',
      '/ivsensorgps', '/ivsensorimu',
      'left/image', 'right/image', 'front/image', 'rear/image',
    ];

    // Track message counts and timing for each topic
    this.topicData = {};
    this.topicsToMonitor.forEach(topic => {
      this.topicData[topic] = {
        messageCount: 0,
        lastMessageTime: 0,
        status: 'unknown',
        elements: null
      };
    });

    console.log('StatusViewer initialized for topics:', this.topicsToMonitor);
    console.log('topicData initialized:', this.topicData);

    // Call parent onCreate to set up basic viewer structure
    super.onCreate();

    // Create status container
    this.statusContainer = $('<div class="status-container"></div>')
      .css({
        'padding': '10px',
        'background': '#f9f9f9',
        'border-radius': '4px',
        'margin': '10px',
        'min-height': '300px'
      })
      .appendTo(this.card.content);

    // Create status grid
    this.statusGrid = $('<div class="status-grid"></div>')
      .css({
        'display': 'grid',
        'grid-template-columns': '1fr',
        'gap': '8px',
        'max-height': '400px',
        'overflow-y': 'auto'
      })
      .appendTo(this.statusContainer);

    // Create status items for each topic
    this.createStatusItems();

    // Start periodic status checking (subscription will be delayed until transport is available)
    this.startStatusMonitoring();

    // Set up global message handler for all monitored topics
    this.setupGlobalMessageHandler();

    // Simulate first data to remove loader and make header green
    setTimeout(() => {
      this.update({
        _topic_name: "Topics Monitor Viewer",
        _topic_type: "std_msgs/String"
      });
    }, 100);

    console.log('StatusViewer onCreate completed');
  }

  createStatusItems() {
    console.log('createStatusItems called, this.topicsToMonitor:', this.topicsToMonitor);

    if (!this.topicsToMonitor) {
      console.error('topicsToMonitor is undefined!');
      return;
    }

    this.topicsToMonitor.forEach(topic => {
      const statusItem = $('<div class="status-item"></div>')
        .css({
          'display': 'flex',
          'align-items': 'center',
          'padding': '8px',
          'border': '1px solid #e0e0e0',
          'border-radius': '4px',
          'background': '#ffffff',
          'margin-bottom': '4px'
        });

      // Status light
      const light = $('<div class="status-light"></div>')
        .css({
          'width': '12px',
          'height': '12px',
          'border-radius': '50%',
          'background-color': '#808080', // gray for unknown
          'margin-right': '10px',
          'flex-shrink': '0'
        });

      // Topic name
      const name = $('<div class="topic-name"></div>')
        .css({
          'font-weight': 'bold',
          'margin-right': '10px',
          'min-width': '120px',
          'font-size': '12px'
        })
        .text(topic);

      // Status text
      const statusText = $('<div class="status-text"></div>')
        .css({
          'margin-right': '10px',
          'color': '#666',
          'font-size': '11px'
        })
        .text('Unknown');

      // Message count
      const count = $('<div class="message-count"></div>')
        .css({
          'margin-left': 'auto',
          'font-size': '10px',
          'color': '#888',
          'min-width': '40px',
          'text-align': 'right'
        })
        .text('0 msgs');

      statusItem.append(light, name, statusText, count);
      this.statusGrid.append(statusItem);

      // Store element references
      this.topicData[topic].elements = {
        light: light,
        text: statusText,
        count: count
      };
    });

    console.log('Created status items for', this.topicsToMonitor.length, 'topics');
  }

  subscribeToTopics() {
    console.log('Subscribing to topics for monitoring...');

    this.topicsToMonitor.forEach(topic => {
      try {
        // Subscribe using currentTransport like Multi3D Viewer does
        const transport = this._getCurrentTransport();
        if (transport) {
          console.log(`Subscribing to topic: ${topic}`);
          transport.subscribe({topicName: topic});
        } else {
          console.warn('currentTransport not available for subscription');
        }
      } catch (error) {
        console.error(`Failed to subscribe to topic ${topic}:`, error);
      }
    });

    console.log('Topic subscription completed');
  }

  setupGlobalMessageHandler() {
    // Store reference to this viewer instance
    if (!window.topicsMonitorViewers) {
      window.topicsMonitorViewers = [];
    }
    window.topicsMonitorViewers.push(this);

    console.log('Global message handler set up for StatusViewer');
  }

  _getTransport() {
    try {
      if(typeof currentTransport !== 'undefined' && currentTransport) return currentTransport;
    } catch(e){}
    return (window.currentTransport || null);
  }

  _getCurrentTransport() {
    // Use the same approach as Multi3DViewer - direct access to global currentTransport
    console.log('_getCurrentTransport called');
    console.log('typeof currentTransport:', typeof currentTransport);
    console.log('currentTransport value:', currentTransport);

    try {
      if(typeof currentTransport !== 'undefined' && currentTransport) {
        console.log('currentTransport found, connected:', currentTransport.connected);
        return currentTransport;
      }
    } catch(e){
      console.log('Error accessing currentTransport:', e);
    }

    console.log('No currentTransport available');
    return null;
  }

  trySubscribeToTopics() {
    // Check if transport is available using the same method as Multi3DViewer
    const transport = this._getCurrentTransport();
    console.log('trySubscribeToTopics - transport:', transport);

    if (transport) {
      console.log('Transport found, checking connected property...');
      console.log('transport.connected:', transport.connected);
      console.log('transport.isConnected:', transport.isConnected);

      if (transport.connected || transport.isConnected()) {
        console.log('Transport available, subscribing to topics...');
        this.subscribeToTopics();
        return true;
      } else {
        console.log('Transport exists but not connected');
      }
    } else {
      console.log('No transport found');
    }

    console.log('Transport not available yet, will retry...');
    // Retry in 1 second
    setTimeout(() => {
      this.trySubscribeToTopics();
    }, 1000);
    return false;
  }

  startStatusMonitoring() {
    // Check status every 2 seconds
    this.statusInterval = setInterval(() => {
      this.updateAllTopicStatuses();
    }, 2000);

    // Try to subscribe to topics when transport becomes available
    this.trySubscribeToTopics();

    console.log('Started status monitoring');
  }

  updateAllTopicStatuses() {
    const currentTime = Date.now();

    this.topicsToMonitor.forEach(topic => {
      const data = this.topicData[topic];
      const timeSinceLastMessage = (currentTime - data.lastMessageTime) / 1000;

      let status, statusText, lightColor;

      if (data.messageCount === 0) {
        status = 'unknown';
        statusText = 'No data';
        lightColor = '#808080'; // gray
      } else if (timeSinceLastMessage < 5) {
        status = 'active';
        statusText = 'Active';
        lightColor = '#4CAF50'; // green
      } else if (timeSinceLastMessage < 30) {
        status = 'inactive';
        statusText = 'Inactive';
        lightColor = '#FF9800'; // orange
      } else {
        status = 'error';
        statusText = 'Error';
        lightColor = '#F44336'; // red
      }

      // Update visual elements
      if (data.elements) {
        data.elements.light.css('background-color', lightColor);
        data.elements.text.text(statusText);
        data.elements.count.text(`${data.messageCount} msgs`);
      }

      data.status = status;
    });
  }

  // Override initSubscribe to prevent standard subscription to _topics_monitor
  initSubscribe({topicName, topicType}) {
    // Do nothing - we handle subscriptions manually
    console.log('StatusViewer initSubscribe called with:', topicName, topicType, '- doing nothing');
  }

  // This method is called when viewer receives data (but we're not using it for this viewer)
  onData(msg) {
    // Set the title with topic name to get green header like other viewers
    this.card.title.text("Topics Monitor Viewer");

    // Process incoming message for status monitoring
    this.processIncomingMessage(msg);
  }

  processIncomingMessage(msg) {
    const topicName = msg._topic_name;
    if (!topicName || !this.topicsToMonitor.includes(topicName)) {
      return; // Not a topic we're monitoring
    }

    console.log(`Received message for monitored topic: ${topicName}`);

    // Update topic data
    if (this.topicData[topicName]) {
      this.topicData[topicName].messageCount++;
      this.topicData[topicName].lastMessageTime = Date.now();
      this.topicData[topicName].status = 'active';

      // Update visual elements immediately
      this.updateTopicStatus(topicName);
    }
  }

  destroy() {
    console.log('StatusViewer destroy called');

    // Stop status monitoring
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }

    // Call parent destroy
    super.destroy();
  }
}

// Register the viewer
StatusViewer.friendlyName = "Topics Monitor Viewer";
StatusViewer.supportedTypes = ["std_msgs/String"];
StatusViewer.maxUpdateRate = 1.0;
Viewer.registerViewer(StatusViewer, "StatusViewer", "Topics Monitor", ["std_msgs/String"]);



(function(){
  const _oldOnMsg = window.onMsg;
  window.onMsg = function(msg) {
    // Deliver to original routing
    if (_oldOnMsg) _oldOnMsg(msg);

    // Deliver to any StatusViewer instances
    try {
      const statusViewers = Object.values(window.subscriptions || {})
        .map(s => s.viewer)
        .filter(v => v && v instanceof StatusViewer);

      for (const viewer of statusViewers) {
        if (viewer.topicsToMonitor.includes(msg._topic_name)) {
          // Update message count and timestamp for this topic
          const topicData = viewer.topicData[msg._topic_name];
          if (topicData) {
            topicData.messageCount++;
            topicData.lastMessageTime = Date.now();
            console.log(`Received message from ${msg._topic_name}, count: ${topicData.messageCount}`);
          }
        }
      }
    } catch (e) {
      console.warn('Error in StatusViewer message hook:', e);
    }
  };
})();