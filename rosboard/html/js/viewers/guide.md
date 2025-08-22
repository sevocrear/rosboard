# ROSBoard Viewer Development Guide

This guide explains how to create new viewers for ROSBoard, based on the implementation of JoystickViewer, Topics Monitor Viewer, and Multi3DViewer.

## Table of Contents

1. [Basic Viewer Structure](#basic-viewer-structure)
2. [Viewer Registration](#viewer-registration)
3. [Special Viewers (Non-ROS Topics)](#special-viewers-non-ros-topics)
4. [Integration with ROSBoard System](#integration-with-rosboard-system)
5. [Layout Persistence](#layout-persistence)
6. [Troubleshooting Guide](#troubleshooting-guide)
7. [Best Practices](#best-practices)

## Basic Viewer Structure

### 1. Create Viewer Class

```javascript
"use strict";

importJsOnce("js/viewers/meta/Viewer.js");

class MyViewer extends Viewer {
  constructor(card, topicName, topicType) {
    super(card, topicName, topicType);

    // Initialize viewer-specific properties
    this.myData = {};
  }

  onCreate() {
    // Call parent onCreate to set up basic viewer structure
    super.onCreate();

    // Initialize viewer-specific UI and logic
    this.initializeUI();
    this.setupEventHandlers();
  }

  initializeUI() {
    // Create your viewer's UI elements
    this.content = $('<div class="my-viewer-content"></div>')
      .appendTo(this.card.content);
  }

  setupEventHandlers() {
    // Set up event handlers for your viewer
  }

  destroy() {
    // Clean up resources
    super.destroy();
  }
}
```

### 2. Register the Viewer

```javascript
// Register the viewer
MyViewer.friendlyName = "My Viewer";
MyViewer.supportedTypes = ["std_msgs/String"];
MyViewer.maxUpdateRate = 10.0;
Viewer.registerViewer(MyViewer, "MyViewer", "My Viewer", ["std_msgs/String"]);
```

## Viewer Registration

### Required Properties

- **`friendlyName`**: Display name in the UI
- **`supportedTypes`**: Array of ROS message types this viewer can handle
- **`maxUpdateRate`**: Maximum update rate in Hz
- **`Viewer.registerViewer()`**: Registers the viewer with ROSBoard

### Registration Parameters

```javascript
Viewer.registerViewer(
  MyViewer,           // Viewer class
  "MyViewer",         // Internal name (must match constructor.name)
  "My Viewer",        // Display name
  ["std_msgs/String"] // Supported types
);
```

## Special Viewers (Non-ROS Topics)

For viewers that don't subscribe to actual ROS topics (like JoystickViewer and Topics Monitor), use special topic names:

- **`_manual_control`**: For robot control viewers
- **`_topics_monitor`**: For system monitoring viewers

### Example: Topics Monitor Viewer

```javascript
class StatusViewer extends Viewer {
  constructor(card, topicName, topicType) {
    super(card, "_topics_monitor", "std_msgs/String");

    // Define topics to monitor (real ROS topics)
    this.topicsToMonitor = [
      'left/image', 'right/image', 'front/image', 'rear/image',
      '/driver/lidar/frontbottom', '/driver/lidar/top'
    ];
  }

  onCreate() {
    // Initialize before calling super.onCreate
    this.topicsToMonitor = [...];
    this.topicData = {};

    super.onCreate();

    // Set up monitoring after parent initialization
    this.setupGlobalMessageHandler();
  }

  // Override to prevent standard subscription
  initSubscribe({topicName, topicType}) {
    console.log('StatusViewer initSubscribe called - doing nothing');
  }
}
```

## Integration with ROSBoard System

### 1. Add to Navigation Menu

In `src/third_party/rosboard/rosboard/html/js/index.js`:

```javascript
$('<a></a>')
  .addClass("mdl-navigation__link")
  .click(() => {
    const card = newCard();
    const viewer = new MyViewer(card, "_my_special_topic", "std_msgs/String");

    subscriptions["_my_special_topic"] = {
      topicType: "std_msgs/String",
      viewer: viewer
    };

    $grid.masonry("appended", card);
    $grid.masonry("layout");
    updateStoredSubscriptions();
  })
  .text("My Viewer")
  .appendTo($("#topics-nav-system"));
```

### 2. Handle Layout Serialization

In `serializeLayout()` function:

```javascript
// Check if this is a special viewer
const isMySpecialViewer = topicName === "_my_special_topic";

list.push({
  topicName: topicName,
  topicType: sub.topicType,
  viewer: sub.viewer.constructor && sub.viewer.constructor.name || null,
  viewState: viewState,
  width: card.width(),
  height: card.height(),
  isMySpecialViewer: isMySpecialViewer
});
```

### 3. Handle Layout Restoration

In `applyLayout()` function:

```javascript
} else if (it.isMySpecialViewer) {
  // Handle my special viewer through regular subscriptions system
  const card = newCard();
  let viewerCtor = null;
  try {
    if (it.viewer) {
      viewerCtor = Viewer._viewers.find(v => v && v.name === it.viewer) || null;
    }
    if (!viewerCtor) {
      viewerCtor = MyViewer;
    }

    const viewer = new viewerCtor(card, it.topicName, it.topicType);
    subscriptions[it.topicName] = {
      topicType: it.topicType,
      viewer: viewer
    };

    if (it.viewState && typeof viewer.applyState === 'function') {
      try { viewer.applyState(it.viewState); } catch(e){}
    }

    if (it.width) viewer.card.width(it.width);
    if (it.height) viewer.card.height(it.height);

    $grid.masonry("appended", card);
    console.log('Restored my special viewer:', it.topicName);
  } catch(e) {
    console.error('Failed to restore my special viewer:', e);
    card.remove();
  }
```

### 4. Handle Page Refresh

In `onOpen()` function:

```javascript
let onOpen = function() {
  // First, restore special viewers that don't need ROS subscription
  for(let topic_name in subscriptions) {
    if (topic_name === "_my_special_topic") {
      console.log("Restoring special viewer: " + topic_name);
      try {
        const sub = subscriptions[topic_name];
        if (sub && sub.preferredViewer) {
          const card = newCard();
          let viewerCtor = Viewer._viewers.find(v => v && v.name === sub.preferredViewer) || MyViewer;

          const viewer = new viewerCtor(card, topic_name, sub.topicType);
          subscriptions[topic_name].viewer = viewer;

          if (sub.viewState && typeof viewer.applyState === 'function') {
            try { viewer.applyState(sub.viewState); } catch(e){}
          }

          $grid.masonry("appended", card);
          console.log("Successfully restored special viewer:", topic_name);
        }
      } catch (e) {
        console.error("Failed to restore special viewer:", topic_name, e);
      }
      continue;
    }

    // Handle regular ROS topic subscriptions
    console.log("Re-subscribing to " + topic_name);
    initSubscribe({topicName: topic_name, topicType: subscriptions[topic_name].topicType});
  }
}
```

## Layout Persistence

### 1. Automatic Persistence

Special viewers are automatically persisted through:
- `updateStoredSubscriptions()`: Saves to localStorage
- `onOpen()`: Restores from localStorage on page refresh

### 2. Manual Layout Export/Import

Special viewers are included in layout export/import through:
- `serializeLayout()`: Includes special viewer flags
- `applyLayout()`: Restores special viewers with their state

## Troubleshooting Guide

### Problem: Viewer Disappears After Page Refresh

**Symptoms:**
- Viewer works when created
- Layout export/import works
- Viewer disappears after page refresh

**Causes:**
1. Viewer not properly registered with `Viewer.registerViewer()`
2. Missing integration in `onOpen()` function
3. Incorrect topic name (should start with `_` for special viewers)

**Solutions:**
1. Check viewer registration:
   ```javascript
   console.log('Available viewers:', Viewer._viewers.map(v => v ? v.name : 'null'));
   ```

2. Verify integration in `onOpen()`:
   ```javascript
   console.log('Restoring special viewer:', topic_name);
   ```

3. Check topic name format:
   ```javascript
   // Correct for special viewers
   super(card, "_my_special_topic", "std_msgs/String");
   ```

### Problem: Viewer Not Saved in Layout

**Symptoms:**
- Viewer works but not included in layout export
- Layout import doesn't restore viewer

**Causes:**
1. Missing integration in `serializeLayout()`
2. Missing integration in `applyLayout()`
3. Incorrect flag name in serialization

**Solutions:**
1. Add to `serializeLayout()`:
   ```javascript
   const isMySpecialViewer = topicName === "_my_special_topic";
   ```

2. Add to `applyLayout()`:
   ```javascript
   } else if (it.isMySpecialViewer) {
     // Handle restoration
   ```

### Problem: Transport Not Available

**Symptoms:**
- `currentTransport not available for subscription`
- Viewer can't subscribe to ROS topics

**Causes:**
1. WebSocket connection not established
2. Using wrong transport access method
3. Trying to subscribe too early

**Solutions:**
1. Use the correct transport access method:
   ```javascript
   _getCurrentTransport() {
     try {
       if(typeof currentTransport !== 'undefined' && currentTransport) return currentTransport;
     } catch(e){}
     return null;
   }
   ```

2. Check transport availability before subscribing:
   ```javascript
   const transport = this._getCurrentTransport();
   if (transport && transport.connected) {
     transport.subscribe({topicName: topic});
   }
   ```

3. Implement retry logic:
   ```javascript
   trySubscribeToTopics() {
     const transport = this._getCurrentTransport();
     if (transport && transport.connected) {
       this.subscribeToTopics();
       return true;
     } else {
       setTimeout(() => this.trySubscribeToTopics(), 1000);
       return false;
     }
   }
   ```

### Problem: Viewer Not Draggable

**Symptoms:**
- Viewer appears but can't be moved
- Console errors about Draggabilly

**Causes:**
1. Draggabilly not initialized properly
2. DOM elements not ready when draggable is initialized
3. Missing CSS classes

**Solutions:**
1. Ensure base Viewer functionality:
   ```javascript
   onCreate() {
     super.onCreate(); // This sets up draggable functionality
   }
   ```

2. Check CSS classes:
   ```css
   .card.drag-enabled {
     cursor: move;
   }
   ```

### Problem: Viewer Not Receiving Messages

**Symptoms:**
- Viewer subscribes to topics but no data received
- No console logs for incoming messages

**Causes:**
1. Wrong message handling method
2. Missing global message hook
3. Incorrect topic subscription

**Solutions:**
1. Use the correct message handling pattern:
   ```javascript
   // For special viewers, use global onMsg hook
   setupGlobalMessageHandler() {
     if (!window.myViewerInstances) {
       window.myViewerInstances = [];
     }
     window.myViewerInstances.push(this);
   }
   ```

2. Add to global message handler in `index.js`:
   ```javascript
   // Also feed any MyViewer instances
   try {
     if (window.myViewerInstances) {
       for (const viewer of window.myViewerInstances) {
         if (viewer && viewer.processIncomingMessage) {
           viewer.processIncomingMessage(msg);
         }
       }
     }
   } catch(e) {}
   ```

## Best Practices

### 1. Viewer Structure
- Always extend the base `Viewer` class
- Call `super.onCreate()` in your `onCreate()` method
- Implement proper cleanup in `destroy()` method

### 2. Special Viewers
- Use topic names starting with `_` (e.g., `_my_special_topic`)
- Override `initSubscribe()` to prevent standard ROS subscription
- Handle message routing through global hooks

### 3. Transport Access
- Use `_getCurrentTransport()` method for consistent transport access
- Implement retry logic for transport availability
- Check connection status before subscribing

### 4. Layout Persistence
- Integrate with `serializeLayout()` and `applyLayout()`
- Handle page refresh in `onOpen()`
- Preserve viewer state and size

### 5. Error Handling
- Wrap critical operations in try-catch blocks
- Log errors with meaningful messages
- Gracefully handle missing dependencies

### 6. Performance
- Use appropriate update rates (`maxUpdateRate`)
- Implement efficient message processing
- Clean up resources properly

## Example: Complete Special Viewer

```javascript
"use strict";

importJsOnce("js/viewers/meta/Viewer.js");

class MySpecialViewer extends Viewer {
  constructor(card, topicName, topicType) {
    super(card, "_my_special_topic", "std_msgs/String");

    // Initialize viewer-specific properties
    this.myData = {};
  }

  onCreate() {
    // Initialize before calling super.onCreate
    this.initializeData();

    // Call parent onCreate to set up basic viewer structure
    super.onCreate();

    // Set up viewer-specific functionality
    this.createUI();
    this.setupGlobalMessageHandler();
  }

  initializeData() {
    // Initialize your data structures
  }

  createUI() {
    // Create your viewer's UI
  }

  setupGlobalMessageHandler() {
    if (!window.myViewerInstances) {
      window.myViewerInstances = [];
    }
    window.myViewerInstances.push(this);
  }

  // Override to prevent standard subscription
  initSubscribe({topicName, topicType}) {
    console.log('MySpecialViewer initSubscribe called - doing nothing');
  }

  destroy() {
    // Clean up
    if (window.myViewerInstances) {
      const index = window.myViewerInstances.indexOf(this);
      if (index > -1) {
        window.myViewerInstances.splice(index, 1);
      }
    }

    super.destroy();
  }
}

// Register the viewer
MySpecialViewer.friendlyName = "My Special Viewer";
MySpecialViewer.supportedTypes = ["std_msgs/String"];
MySpecialViewer.maxUpdateRate = 10.0;
Viewer.registerViewer(MySpecialViewer, "MySpecialViewer", "My Special Viewer", ["std_msgs/String"]);
```
