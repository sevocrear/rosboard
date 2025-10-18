"use strict";

importJsOnce("js/viewers/meta/Viewer.js");
importJsOnce("js/viewers/meta/Space2DViewer.js");
importJsOnce("js/viewers/meta/Space3DViewer.js");

importJsOnce("js/viewers/ImageViewer.js");
importJsOnce("js/viewers/LogViewer.js");
importJsOnce("js/viewers/ProcessListViewer.js");
importJsOnce("js/viewers/HtopViewer.js");
importJsOnce("js/viewers/MapViewer.js");
importJsOnce("js/viewers/LaserScanViewer.js");
importJsOnce("js/viewers/GeometryViewer.js");
importJsOnce("js/viewers/PolygonViewer.js");
importJsOnce("js/viewers/DiagnosticViewer.js");
importJsOnce("js/viewers/TimeSeriesPlotViewer.js");
importJsOnce("js/viewers/PointCloud2Viewer.js");
importJsOnce("js/viewers/Multi3DViewer.js");
importJsOnce("js/viewers/Viewer3D.js");
importJsOnce("js/viewers/JoystickViewer.js");
importJsOnce("js/viewers/StatusViewer.js");
importJsOnce("js/viewers/InitialPathViewer.js");
importJsOnce("js/viewers/ControlActivatorViewer.js");

// GenericViewer must be last
importJsOnce("js/viewers/GenericViewer.js");

importJsOnce("js/transports/WebSocketV1Transport.js");

var snackbarContainer = document.querySelector('#demo-toast-example');

// Minimal TF buffer in browser
(function(){
  function quatMultiply(a, b) {
    const ax=a[0], ay=a[1], az=a[2], aw=a[3];
    const bx=b[0], by=b[1], bz=b[2], bw=b[3];
    return [
      aw*bx + ax*bw + ay*bz - az*by,
      aw*by - ax*bz + ay*bw + az*bx,
      aw*bz + ax*by - ay*bx + az*bw,
      aw*bw - ax*bx - ay*by - az*bz,
    ];
  }
  function quatConjugate(q){ return [-q[0], -q[1], -q[2], q[3]]; }
  function quatRotateVec(q, v) {
    // v' = q * (v,0) * q_conj
    // Proper quaternion rotation: rotate vector v by quaternion q
    const qv = [v[0], v[1], v[2], 0];
    const t = quatMultiply(quatMultiply(q, qv), quatConjugate(q));
    return [t[0], t[1], t[2]];
  }
  function compose(T1, T2) {
    // returns T = T1 o T2 (apply T2 then T1)
    // Proper composition: first rotate T2's translation by T1's rotation, then add T1's translation
    const r = quatMultiply(T1.r, T2.r);
    const t2r = quatRotateVec(T1.r, T2.t);
    const t = [T1.t[0]+t2r[0], T1.t[1]+t2r[1], T1.t[2]+t2r[2]];
    return {r, t};
  }
  function invert(T) {
    // Proper inverse transform: T^-1 = (R^-1, -R^-1 * t)
    const r_inv = quatConjugate(T.r);
    const t_inv_r = quatRotateVec(r_inv, T.t);
    return { r: r_inv, t: [-t_inv_r[0], -t_inv_r[1], -t_inv_r[2]] };
  }
  function normalizeFrame(f){ 
    if(!f) return ""; 
    // Remove leading slash and trim whitespace
    const normalized = (f[0]==='/'?f.substring(1):f).trim();
    return normalized;
  }

  window.ROSBOARD_TF = {
    // child -> {parent, T, static}
    tree: {},
    // Version counter to invalidate caches when TF changes
    version: 0,
    // Listeners for TF updates
    listeners: [],
    update: function(msg){
      // expects TFMessage-like: {transforms: [ {child_frame_id, header:{frame_id}, transform:{translation:{x,y,z}, rotation:{x,y,z,w}} }, ... ]}
      const list = msg.transforms || [];
      let hasChanges = false;
      for(let i=0;i<list.length;i++){
        const tr = list[i];
        const child = normalizeFrame(tr.child_frame_id);
        const parent = normalizeFrame((tr.header&&tr.header.frame_id)||"");
        if(!child || !parent) continue;
        if(child === parent) continue; // Skip self-transforms
        
        const T = {
          t: [
            (tr.transform&&tr.transform.translation&&tr.transform.translation.x)||0,
            (tr.transform&&tr.transform.translation&&tr.transform.translation.y)||0,
            (tr.transform&&tr.transform.translation&&tr.transform.translation.z)||0,
          ],
          r: [
            (tr.transform&&tr.transform.rotation&&tr.transform.rotation.x)||0,
            (tr.transform&&tr.transform.rotation&&tr.transform.rotation.y)||0,
            (tr.transform&&tr.transform.rotation&&tr.transform.rotation.z)||0,
            (tr.transform&&tr.transform.rotation&&tr.transform.rotation.w)||1,
          ],
        };
        
        // Normalize quaternion to ensure it's valid
        const qlen = Math.sqrt(T.r[0]*T.r[0] + T.r[1]*T.r[1] + T.r[2]*T.r[2] + T.r[3]*T.r[3]);
        if(qlen > 0.001) {
          T.r[0] /= qlen;
          T.r[1] /= qlen;
          T.r[2] /= qlen;
          T.r[3] /= qlen;
        } else {
          // Invalid quaternion, use identity
          T.r = [0, 0, 0, 1];
        }
        
        // Check if this is actually a new/changed transform
        const existing = this.tree[child];
        if(!existing || 
           existing.parent !== parent ||
           Math.abs(existing.T.t[0] - T.t[0]) > 1e-6 ||
           Math.abs(existing.T.t[1] - T.t[1]) > 1e-6 ||
           Math.abs(existing.T.t[2] - T.t[2]) > 1e-6 ||
           Math.abs(existing.T.r[0] - T.r[0]) > 1e-6 ||
           Math.abs(existing.T.r[1] - T.r[1]) > 1e-6 ||
           Math.abs(existing.T.r[2] - T.r[2]) > 1e-6 ||
           Math.abs(existing.T.r[3] - T.r[3]) > 1e-6) {
          hasChanges = true;
        }
        
        this.tree[child] = { parent: parent, T: T, static: (msg._topic_name === "/tf_static") };
      }
      
      // Increment version if there were any changes to invalidate caches
      if(hasChanges) {
        this.version++;
        // Notify all listeners about TF update
        this.notifyListeners();
      }
    },
    // Add listener for TF updates
    addListener: function(callback) {
      if(typeof callback === 'function') {
        this.listeners.push(callback);
      }
    },
    // Remove listener
    removeListener: function(callback) {
      const index = this.listeners.indexOf(callback);
      if(index > -1) {
        this.listeners.splice(index, 1);
      }
    },
    // Notify all listeners
    notifyListeners: function() {
      this.listeners.forEach(listener => {
        try {
          listener();
        } catch(e) {
          console.warn('TF listener error:', e);
        }
      });
    },
    getTransform: function(src, dst){
      src = normalizeFrame(src); 
      dst = normalizeFrame(dst);
      
      // Return identity transform if frames are the same or invalid
      if(!src || !dst || src===dst) return { r:[0,0,0,1], t:[0,0,0] };
      
      // Walk up the tree from each frame to find the common ancestor
      const up = (f)=>{ 
        let chain=[]; 
        let cur=f; 
        let Tacc={r:[0,0,0,1], t:[0,0,0]};
        let iterations = 0;
        while(this.tree[cur] && iterations < 256){ 
          const node=this.tree[cur]; 
          chain.push({frame:cur, parent:node.parent, T:node.T}); 
          Tacc = compose(node.T, Tacc); 
          cur=node.parent; 
          iterations++;
        }
        return {root: cur, chain, Tacc}; 
      };
      
      const a = up(src); 
      const b = up(dst);
      
      // If frames don't share a common root, transformation is impossible
      if(a.root !== b.root) {
        console.warn(`TF: Cannot transform from ${src} to ${dst}: different roots (${a.root} vs ${b.root})`);
        return null;
      }
      
      // Find lowest common ancestor (LCA)
      const visited = new Set([src]);
      const parentMap = {}; // frame -> {parent, T}
      let cur = src; 
      for(let i=0;i<a.chain.length;i++){ 
        parentMap[cur] = a.chain[i]; 
        cur = a.chain[i].parent; 
        visited.add(cur); 
      }
      
      // Walk from dst towards root until we hit a visited frame (the LCA)
      cur = dst; 
      let T_dst_to_lca={r:[0,0,0,1], t:[0,0,0]};
      let iterations = 0;
      while(!visited.has(cur) && this.tree[cur] && iterations < 256){ 
        const node=this.tree[cur]; 
        T_dst_to_lca = compose(node.T, T_dst_to_lca); 
        cur = node.parent; 
        if(!cur) break;
        iterations++;
      }
      const lca = cur;
      
      // Compute transform from src to LCA
      let T_src_to_lca={r:[0,0,0,1], t:[0,0,0]}; 
      cur=src;
      while(cur!==lca && parentMap[cur]){ 
        T_src_to_lca = compose(parentMap[cur].T, T_src_to_lca); 
        cur = parentMap[cur].parent; 
      }
      
      // Final transform: T_src_to_dst = inverse(T_dst_to_lca) o T_src_to_lca
      return compose(invert(T_dst_to_lca), T_src_to_lca);
    },
    transformPoints: function(T, points){
      // points: Float32Array [x,y,z,...]
      if(!T || !points || points.length === 0) return points;
      
      const out = new Float32Array(points.length);
      const r = T.r, t = T.t;
      const rx = r[0], ry = r[1], rz = r[2], rw = r[3];
      const tx = t[0], ty = t[1], tz = t[2];
      
      // Optimize quaternion rotation by pre-computing common terms
      for(let i=0; i<points.length; i+=3){
        const px = points[i], py = points[i+1], pz = points[i+2];
        
        // Optimized quaternion-vector multiplication: q * (v,0) * q_conj
        // Intermediate: q * (v, 0)
        const ix = rw*px + ry*pz - rz*py;
        const iy = rw*py + rz*px - rx*pz;
        const iz = rw*pz + rx*py - ry*px;
        const iw = -rx*px - ry*py - rz*pz;
        
        // Final: (intermediate) * q_conj
        out[i]   = ix*rw + iw*(-rx) + iy*(-rz) - iz*(-ry) + tx;
        out[i+1] = iy*rw + iw*(-ry) + iz*(-rx) - ix*(-rz) + ty;
        out[i+2] = iz*rw + iw*(-rz) + ix*(-ry) - iy*(-rx) + tz;
      }
      return out;
    },
    getFrames: function(){
      // collect unique frames from tree: children and parents
      const framesSet = new Set();
      for(const child in this.tree){
        framesSet.add(child);
        const parent = this.tree[child].parent;
        if(parent && parent.length) framesSet.add(parent);
      }
      return Array.from(framesSet).sort();
    }
  };
})();

let subscriptions = {};

if(window.localStorage && window.localStorage.subscriptions) {
  if(window.location.search && window.location.search.indexOf("reset") !== -1) {
    subscriptions = {};
    updateStoredSubscriptions();
    window.location.href = "?";
  } else {
    try {
      subscriptions = JSON.parse(window.localStorage.subscriptions);
    } catch(e) {
      console.log(e);
      subscriptions = {};
    }
  }
}

let $grid = null;
$(() => {
  $grid = $('.grid').masonry({
    itemSelector: '.card',
    gutter: 10,
    percentPosition: true,
  });
  $grid.masonry("layout");
});

setInterval(() => {
  if(currentTransport && !currentTransport.isConnected()) {
    console.log("attempting to reconnect ...");
    currentTransport.connect();
  }
}, 5000);

function updateStoredSubscriptions(){
  if(!window.localStorage) return;
  const storedSubscriptions = {};
  for(const [topicName, sub] of Object.entries(subscriptions)){
    if(!sub || !sub.viewer) continue;
    storedSubscriptions[topicName] = {
      topicType: sub.topicType,
      preferredViewer: sub.viewer.constructor && sub.viewer.constructor.name || null,
      viewState: null,
    };
    try { if(sub.viewer.serializeState) storedSubscriptions[topicName].viewState = sub.viewer.serializeState(); } catch(e){}
  }
  window.localStorage['subscriptions'] = JSON.stringify(storedSubscriptions);
}

function newCard() {
  // creates a new card, adds it to the grid, and returns it.
  let card = $("<div></div>").addClass('card')
    .appendTo($('.grid'));
  return card;
}

let onOpen = function() {
  console.log('onOpen: Starting viewer restoration');

  // First, restore special viewers that don't need ROS subscription
  for(let topic_name in subscriptions) {
    if (topic_name === "_topics_monitor" || topic_name === "_manual_control") {
      console.log("Restoring special viewer: " + topic_name);
      try {
        const sub = subscriptions[topic_name];
        // Guard: if a viewer instance already exists for this special topic, skip creating another
        if (sub && sub.viewer) {
          console.log("Viewer already exists for", topic_name, "- skipping duplicate creation");
          continue;
        }
        if (sub && sub.preferredViewer) {
          // Create a new card for the viewer
          const card = newCard();
          let viewerCtor = null;

          // Find the viewer constructor
          if (sub.preferredViewer) {
            viewerCtor = Viewer._viewers.find(v => v && v.name === sub.preferredViewer) || null;
          }

          // Use default viewer if not found
          if (!viewerCtor) {
            if (topic_name === "_topics_monitor") {
              viewerCtor = StatusViewer;
            } else if (topic_name === "_manual_control") {
              viewerCtor = JoystickViewer;
            } else if (topic_name === "_initial_path_picker") {
              viewerCtor = InitialPathViewer;
            }
          }

          if (viewerCtor) {
            // Create the viewer
            const viewer = new viewerCtor(card, topic_name, sub.topicType);

            // Update the subscription with the new viewer
            subscriptions[topic_name].viewer = viewer;

            // Restore view state if available
            if (sub.viewState && typeof viewer.applyState === 'function') {
              try { viewer.applyState(sub.viewState); } catch(e){}
            }

            // Add to grid
            $grid.masonry("appended", card);
            console.log("Successfully restored special viewer:", topic_name);
          }
        }
      } catch (e) {
        console.error("Failed to restore special viewer:", topic_name, e);
      }
      continue;
    }

    console.log("Re-subscribing to " + topic_name);
    initSubscribe({topicName: topic_name, topicType: subscriptions[topic_name].topicType});
  }

  // Ensure the grid is properly updated after all viewers are restored
  // Use a longer delay to ensure all async operations complete
  setTimeout(() => {
    try {
      $grid.masonry("layout");
      console.log('onOpen: Grid layout updated');
    } catch(e){
      console.error('onOpen: Failed to update grid layout:', e);
    }
  }, 200);
}

let onSystem = function(system) {
  if(system.hostname) {
    console.log("hostname: " + system.hostname);
    $('.mdl-layout-title').text("ROSboard: " + system.hostname);
  }

  if(system.version) {
    console.log("server version: " + system.version);
    versionCheck(system.version);
  }
}

let onMsg = function(msg) {
  // Feed TF buffer if applicable
  const ttype = msg._topic_type || "";
  if(msg._topic_name === "/tf" || msg._topic_name === "/tf_static" || (ttype.indexOf("tf2_msgs") !== -1 && ttype.indexOf("TFMessage") !== -1)) {
    if(window.ROSBOARD_TF) window.ROSBOARD_TF.update(msg);
  }

  if(!subscriptions[msg._topic_name]) {
    // silently ignore unsolicited tf messages
    // if(!(msg._topic_name === "/tf" || msg._topic_name === "/tf_static")) {
    //   console.warn("Received unsolicited message", msg);
    // }
  } else if(!subscriptions[msg._topic_name].viewer) {
    console.log("Received msg but no viewer", msg);
  } else {
    subscriptions[msg._topic_name].viewer.update(msg);
  }

  // Also feed any Multi3D viewer layers
  try {
    const viewers = Object.values(subscriptions).map(s=>s.viewer).filter(v=>v && v instanceof Multi3DViewer);
    for(const v of viewers) {
      if(v.layers[msg._topic_name]) {
        v.layers[msg._topic_name].lastMsg = msg;
        // Immediately request render for smooth updates
        if (typeof v.requestRender === 'function') {
          v.requestRender();
        } else if (typeof v._render === 'function') {
          v._render();
        }
      }
    }
  } catch(e) {
    console.warn('Error updating Multi3D viewer:', e);
  }

  // Also feed any StatusViewer instances for topic monitoring
  try {
    if (window.topicsMonitorViewers) {
      for (const viewer of window.topicsMonitorViewers) {
        if (viewer && viewer.processIncomingMessage) {
          viewer.processIncomingMessage(msg);
        }
      }
    }
  } catch(e) {}
}

let currentTopics = {};
let currentTopicsStr = "";
let subscribedTF = {tf:false, tf_static:false};

let onTopics = function(topics) {

  // check if topics has actually changed, if not, don't do anything
  // lazy shortcut to deep compares, might possibly even be faster than
  // implementing a deep compare due to
  // native optimization of JSON.stringify
  let newTopicsStr = JSON.stringify(topics);
  if(newTopicsStr === currentTopicsStr) return;
  currentTopics = topics;
  currentTopicsStr = newTopicsStr;

  // auto-subscribe to TF topics (no viewer created)
  if(currentTransport) {
    if(currentTopics["/tf"] && !subscribedTF.tf) { try { currentTransport.subscribe({topicName: "/tf", maxUpdateRate: 30.0}); } catch(e){} subscribedTF.tf=true; }
    if(currentTopics["/tf_static"] && !subscribedTF.tf_static) { try { currentTransport.subscribe({topicName: "/tf_static", maxUpdateRate: 1.0}); } catch(e){} subscribedTF.tf_static=true; }
  }

  let topicTree = treeifyPaths(Object.keys(topics));

  $("#topics-nav-ros").empty();
  $("#topics-nav-system").empty();

  addTopicTreeToNav(topicTree[0], $('#topics-nav-ros'));

  $('<a></a>')
  .addClass("mdl-navigation__link")
  .click(() => { initSubscribe({topicName: "_dmesg", topicType: "rcl_interfaces/msg/Log"}); })
  .text("dmesg")
  .appendTo($("#topics-nav-system"));

  $('<a></a>')
  .addClass("mdl-navigation__link")
  .click(() => { initSubscribe({topicName: "_top", topicType: "rosboard_msgs/msg/ProcessList"}); })
  .text("Processes")
  .appendTo($("#topics-nav-system"));

  $('<a></a>')
  .addClass("mdl-navigation__link")
  .click(() => { initSubscribe({topicName: "_system_stats", topicType: "rosboard_msgs/msg/SystemStats"}); })
  .text("System stats")
  .appendTo($("#topics-nav-system"));

  $('<a></a>')
  .addClass("mdl-navigation__link")
  .click(() => {
    // Create a manual control joystick viewer
    const card = newCard();
    const viewer = new JoystickViewer(card, "_manual_control", "std_msgs/String");

    // Store in regular subscriptions system like other viewers
    subscriptions["_manual_control"] = {
      topicType: "std_msgs/String",
      viewer: viewer
    };

    console.log('Created manual control viewer:', viewer);
    console.log('Added to subscriptions:', subscriptions["_manual_control"]);

    $grid.masonry("appended", card);
    $grid.masonry("layout");

    // Update stored subscriptions to persist the manual control viewer
    updateStoredSubscriptions();
  })
  .text("Manual Control")
  .appendTo($("#topics-nav-system"));

  $('<a></a>')
  .addClass("mdl-navigation__link")
  .click(() => {
    // Create a topics monitor viewer directly
    const card = newCard();
    const viewer = new StatusViewer(card, "_topics_monitor", "std_msgs/String");

    // Store in regular subscriptions system like other viewers
    subscriptions["_topics_monitor"] = {
      topicType: "std_msgs/String",
      viewer: viewer
    };

    console.log('Created topics monitor viewer:', viewer);
    console.log('Added to subscriptions:', subscriptions["_topics_monitor"]);

    $grid.masonry("appended", card);
    $grid.masonry("layout");

    // Update stored subscriptions to persist the topics monitor viewer
    updateStoredSubscriptions();
  })
  .text("Topics Monitor")
  .appendTo($("#topics-nav-system"));

  $('<a></a>')
  .addClass("mdl-navigation__link")
  .click(() => {
    // Create Control Activator viewer (special, non-ROS topic-like card)
    const card = newCard();
    const viewer = new ControlActivatorViewer(card, "_control_activator", "std_msgs/Bool");

    // Store like other viewers under a special key
    subscriptions["_control_activator"] = {
      topicType: "std_msgs/Bool",
      viewer: viewer
    };

    $grid.masonry("appended", card);
    $grid.masonry("layout");
    updateStoredSubscriptions();
  })
  .text("Control Activator")
  .appendTo($("#topics-nav-system"));

  $('<a></a>')
  .addClass("mdl-navigation__link")
  .click(() => {
    // Create Initial Path picker viewer (special, non-ROS topic)
    const card = newCard();
    const viewer = new InitialPathViewer(card, "_initial_path_picker", "std_msgs/String");

    subscriptions["_initial_path_picker"] = {
      topicType: "std_msgs/String",
      viewer: viewer
    };

    $grid.masonry("appended", card);
    $grid.masonry("layout");
    updateStoredSubscriptions();
  })
  .text("Initial Path Picker")
  .appendTo($("#topics-nav-system"));
}

function addTopicTreeToNav(topicTree, el, level = 0, path = "") {
  topicTree.children.sort((a, b) => {
    if(a.name>b.name) return 1;
    if(a.name<b.name) return -1;
    return 0;
  });
  topicTree.children.forEach((subTree, i) => {
    let subEl = $('<div></div>')
    .css(level < 1 ? {} : {
      "padding-left": "0pt",
      "margin-left": "12pt",
      "border-left": "1px dashed #808080",
    })
    .appendTo(el);
    let fullTopicName = path + "/" + subTree.name;
    let topicType = currentTopics[fullTopicName];
    if(topicType) {
      $('<a></a>')
        .addClass("mdl-navigation__link")
        .css({
          "padding-left": "12pt",
          "margin-left": 0,
        })
        .click(() => { initSubscribe({topicName: fullTopicName, topicType: topicType}); })
        .text(subTree.name)
        .appendTo(subEl);
    } else {
      $('<a></a>')
      .addClass("mdl-navigation__link")
      .attr("disabled", "disabled")
      .css({
        "padding-left": "12pt",
        "margin-left": 0,
        opacity: 0.5,
      })
      .text(subTree.name)
      .appendTo(subEl);
    }
    addTopicTreeToNav(subTree, subEl, level + 1, path + "/" + subTree.name);
  });
}

function initSubscribe({topicName, topicType}) {
  // creates a subscriber for topicName
  // and also initializes a viewer (if it doesn't already exist)
  // in advance of arrival of the first data
  // this way the user gets a snappy UI response because the viewer appears immediately
  if(!subscriptions[topicName]) {
    subscriptions[topicName] = {
      topicType: topicType,
    }
  }
  currentTransport.subscribe({topicName: topicName});
  if(!subscriptions[topicName].viewer) {
    let card = newCard();
    // honor preferred viewer if saved in localStorage
    let viewerCtor = null;
    try {
      const prefName = subscriptions[topicName].preferredViewer;
      if(prefName){ viewerCtor = Viewer._viewers.find(v => v && v.name === prefName) || null; }
    } catch(e){}
    if(!viewerCtor) viewerCtor = Viewer.getDefaultViewerForType(topicType);
    let viewer = viewerCtor;
    try {
      subscriptions[topicName].viewer = new viewer(card, topicName, topicType);
      // restore last viewState if present
      try {
        const st = subscriptions[topicName].viewState;
        if(st && typeof subscriptions[topicName].viewer.applyState === 'function') {
          subscriptions[topicName].viewer.applyState(st);
        }
      } catch(e){}
    } catch(e) {
      console.log(e);
      card.remove();
    }
    $grid.masonry("appended", card);
    $grid.masonry("layout");
  }
  updateStoredSubscriptions();
}

let currentTransport = null;

function initDefaultTransport() {
  currentTransport = new WebSocketV1Transport({
    path: "/rosboard/v1",
    onOpen: onOpen,
    onMsg: onMsg,
    onTopics: onTopics,
    onSystem: onSystem,
  });
  currentTransport.connect();
}

function treeifyPaths(paths) {
  // turn a bunch of ros topics into a tree
  let result = [];
  let level = {result};

  paths.forEach(path => {
    path.split('/').reduce((r, name, i, a) => {
      if(!r[name]) {
        r[name] = {result: []};
        r.result.push({name, children: r[name].result})
      }

      return r[name];
    }, level)
  });
  return result;
}

let lastBotherTime = 0.0;
function versionCheck(currentVersionText) {
  $.get("https://raw.githubusercontent.com/dheera/rosboard/release/setup.py").done((data) => {
    let matches = data.match(/version='(.*)'/);
    if(matches.length < 2) return;
    let latestVersion = matches[1].split(".").map(num => parseInt(num, 10));
    let currentVersion = currentVersionText.split(".").map(num => parseInt(num, 10));
    let latestVersionInt = latestVersion[0] * 1000000 + latestVersion[1] * 1000 + latestVersion[2];
    let currentVersionInt = currentVersion[0] * 1000000 + currentVersion[1] * 1000 + currentVersion[2];
    if(currentVersion < latestVersion && Date.now() - lastBotherTime > 1800000) {
      lastBotherTime = Date.now();
      snackbarContainer.MaterialSnackbar.showSnackbar({
        message: "New version of ROSboard available (" + currentVersionText + " -> " + matches[1] + ").",
        actionText: "Check it out",
        actionHandler: ()=> {window.location.href="https://github.com/dheera/rosboard/"},
      });
    }
  });
}

// ---- Layout import/export ----
function serializeLayout(){
  const list = [];

  // Serialize regular topic subscriptions
  for(const [topicName, sub] of Object.entries(subscriptions)){
    if(!sub || !sub.viewer) continue;
    const card = sub.viewer.card;
    let viewState = null;
    try { if(sub.viewer.serializeState) viewState = sub.viewer.serializeState(); } catch(e){}

    // Check if this is a manual control viewer
    const isManualControl = topicName === "_manual_control";

    // Check if this is a topics monitor viewer
    const isTopicsMonitor = topicName === "_topics_monitor";

    // Check if this is a control activator viewer
    const isControlActivator = topicName === "_control_activator";

    // Ensure we capture the viewer constructor name properly
    const viewerName = sub.viewer.constructor && sub.viewer.constructor.name;

    if (!viewerName) {
      console.warn('Could not determine viewer name for topic:', topicName);
      continue;
    }

    list.push({
      topicName: topicName,
      topicType: sub.topicType,
      viewer: viewerName,
      viewState: viewState,
      // store size hints; masonry is auto, but keep width/height to restore
      width: card.width(),
      height: card.height(),
      isManualControl: isManualControl,
      isTopicsMonitor: isTopicsMonitor,
      isControlActivator: isControlActivator
    });
  }

  console.log('Serialized layout with subscriptions:', Object.keys(subscriptions));
  console.log('Serialized items:', list.length);

  // Log special viewers
  for (const [topicName, sub] of Object.entries(subscriptions)) {
    if (sub && sub.viewer) {
      if (topicName === "_topics_monitor") {
        console.log('Topics Monitor Viewer found in subscriptions:', sub.viewer.constructor.name);
      } else if (topicName === "_manual_control") {
        console.log('Manual Control Viewer found in subscriptions:', sub.viewer.constructor.name);
      }
    }
  }

  return { items: list };
}

function applyLayout(layout){
  try {
    // clear current viewers
    for(const key of Object.keys(subscriptions)){
      if(subscriptions[key] && subscriptions[key].viewer){ try { Viewer.onClose(subscriptions[key].viewer); } catch(e){} }
    }
  } catch(e){}

  // Clear subscriptions (this will include manual control viewers)
  subscriptions = {};
  updateStoredSubscriptions();
  const items = (layout && layout.items) || [];

  console.log('Applying layout with', items.length, 'items');

  for(const it of items){
    if(!it || !it.topicName || !it.topicType) continue;

    if (it.isManualControl) {
      // Handle manual control viewers through regular subscriptions system
      const card = newCard();
      let viewerCtor = null;
      try {
        console.log('Restoring manual control viewer, it.viewer:', it.viewer);
        if (it.viewer) {
          viewerCtor = Viewer._viewers.find(v => v && v.name === it.viewer) || null;
          console.log('Found viewerCtor:', viewerCtor);
        }
        if (!viewerCtor) {
          // Default to JoystickViewer for manual control
          viewerCtor = JoystickViewer;
          console.log('Using default JoystickViewer');
        }

        const viewer = new viewerCtor(card, it.topicName, it.topicType);

        // Store in regular subscriptions system
        subscriptions[it.topicName] = {
          topicType: it.topicType,
          viewer: viewer
        };

        // Restore view state if available
        if (it.viewState && typeof viewer.applyState === 'function') {
          try { viewer.applyState(it.viewState); } catch(e){}
        }

        // Restore size
        if (it.width) viewer.card.width(it.width);
        if (it.height) viewer.card.height(it.height);

        // Add to grid and update
        $grid.masonry("appended", card);
        $grid.masonry("layout");
      } catch (e) {
        console.error('Failed to restore manual control viewer:', e);
      }
    } else if (it.isTopicsMonitor) {
      // Handle topics monitor viewers through regular subscriptions system
      const card = newCard();
      let viewerCtor = null;
      try {
        console.log('Restoring topics monitor viewer, it.viewer:', it.viewer);
        console.log('Available viewers in Viewer._viewers:', Viewer._viewers.map(v => v ? v.name : 'null'));
        if (it.viewer) {
          viewerCtor = Viewer._viewers.find(v => v && v.name === it.viewer) || null;
          console.log('Found viewerCtor for topics monitor:', viewerCtor);
        }
        if (!viewerCtor) {
          // Default to StatusViewer for topics monitor
          viewerCtor = StatusViewer;
          console.log('Using default StatusViewer');
        }

        const viewer = new viewerCtor(card, it.topicName, it.topicType);

        // Store in regular subscriptions system
        subscriptions[it.topicName] = {
          topicType: it.topicType,
          viewer: viewer
        };

        // Restore view state if available
        if (it.viewState && typeof viewer.applyState === 'function') {
          try { viewer.applyState(it.viewState); } catch(e){}
        }

        // Restore size
        if (it.width) viewer.card.width(it.width);
        if (it.height) viewer.card.height(it.height);

        $grid.masonry("appended", card);
        if (it.isTopicsMonitor) {
          console.log('Restored topics monitor viewer through subscriptions:', it.topicName);
        } else {
          console.log('Restored manual control viewer through subscriptions:', it.topicName);
        }
      } catch(e) {
        console.error('Failed to restore viewer:', e);
        card.remove();
      }

    } else if (it.topicName === "_initial_path_picker") {
      const card = newCard();
      let viewerCtor = InitialPathViewer;
      try {
        const viewer = new viewerCtor(card, it.topicName, it.topicType);
        subscriptions[it.topicName] = { topicType: it.topicType, viewer: viewer };
        if (it.viewState && typeof viewer.applyState === 'function') {
          try { viewer.applyState(it.viewState); } catch(e){}
        }
        if (it.width) viewer.card.width(it.width);
        if (it.height) viewer.card.height(it.height);
        $grid.masonry("appended", card);
        $grid.masonry("layout");
      } catch (e) {
        console.error('Failed to restore Initial Path Picker viewer:', e);
      }
    } else if (it.isControlActivator) {
      // Restore Control Activator viewer
      const card = newCard();
      let viewerCtor = null;
      try {
        if (it.viewer) {
          viewerCtor = Viewer._viewers.find(v => v && v.name === it.viewer) || null;
        }
        if (!viewerCtor) {
          viewerCtor = ControlActivatorViewer;
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
        $grid.masonry("layout");
      } catch (e) {
        console.error('Failed to restore Control Activator viewer:', e);
        card.remove();
      }
    } else {
      // Handle regular topic subscriptions
      console.log('Restoring regular topic:', it.topicName, 'with viewer:', it.viewer);
      initSubscribe({topicName: it.topicName, topicType: it.topicType});
      try {
        const sub = subscriptions[it.topicName];
        if(sub && sub.viewer && it.viewer && sub.viewer.constructor && sub.viewer.constructor.name !== it.viewer){
          let target = null;
          try { target = Viewer._viewers.find(v => v && v.name === it.viewer); } catch(e){}
          if(!target) target = Viewer.getDefaultViewerForType(it.topicType);
          if(target) Viewer.onSwitchViewer(sub.viewer, target);
        }
        // refresh local reference after potential switch
        const viewerNow = subscriptions[it.topicName] && subscriptions[it.topicName].viewer;
        if(viewerNow && it.viewState && typeof viewerNow.applyState === 'function'){
          console.log('Applying state to viewer:', viewerNow.constructor.name, 'for topic:', it.topicName);
          try {
            viewerNow.applyState(it.viewState);
            console.log('Successfully applied state to viewer:', viewerNow.constructor.name);
          } catch(e){
            console.error('Failed to apply state to viewer:', viewerNow.constructor.name, 'error:', e);
          }
        }
        if(viewerNow){
          if(it.width) viewerNow.card.width(it.width);
          if(it.height) viewerNow.card.height(it.height);
        }
      } catch(e){
        console.error('Error restoring regular topic:', it.topicName, 'error:', e);
      }
    }
  }

  // Ensure all viewers are properly restored before updating the grid
  // Use a longer delay to ensure all async operations complete
  setTimeout(() => {
    try { $grid.masonry("layout"); } catch(e){}
    // persist viewer choices after applying layout
    try { updateStoredSubscriptions(); } catch(e){}
    console.log('Layout application completed');
  }, 100);
}

function listLayouts(){
  return $.get('/rosboard/api/layouts');
}

function fetchLayout(name){
  return $.get('/rosboard/api/layouts/' + encodeURIComponent(name));
}

function saveLayout(name, obj){
  return $.ajax({
    url: '/rosboard/api/layouts/' + encodeURIComponent(name),
    method: 'POST',
    data: JSON.stringify(obj||{}),
    contentType: 'application/json; charset=utf-8'
  });
}

$(() => {
  const dlgImport = document.getElementById('import-dialog');
  const dlgExport = document.getElementById('export-dialog');
  const btnImport = document.getElementById('btn-import');
  const btnExport = document.getElementById('btn-export');
  const btnImportClose = document.getElementById('import-cancel');
  const btnExportCancel = document.getElementById('export-cancel');
  const btnExportSave = document.getElementById('export-save');
  const inputExportName = document.getElementById('export-name');

  function openDialog(d){ if(d && typeof d.showModal === 'function') d.showModal(); }
  function closeDialog(d){ if(d && typeof d.close === 'function') d.close(); }

  if(btnImport){ btnImport.onclick = function(){
    listLayouts().done(function(data){
      let names = (data && data.layouts) || [];
      const list = $('#layouts-list').empty();
      if(!names.length){ list.append($('<div>').text('No saved layouts yet.')); }
      names.forEach(function(n){
        const row = $('<div>').css({padding:'6px 0', cursor:'pointer'}).text(n).appendTo(list);
        row.click(function(){
          fetchLayout(n).done(function(obj){
            try {
              if(typeof obj === 'string') obj = JSON.parse(obj);
            } catch(e){}
            applyLayout(obj);
            closeDialog(dlgImport);

            // Show notification about page refresh
            snackbarContainer.MaterialSnackbar.showSnackbar({
              message: 'Layout imported successfully. Page will refresh in 5 seconds to restore PCD files...'
            });

            // Trigger page refresh after layout import to ensure everything is properly restored
            setTimeout(() => {
              console.log('Layout imported, triggering page refresh...');
              window.location.reload();
            }, 5000);
          });
        });
      });
      openDialog(dlgImport);
    }).fail(function(err){ snackbarContainer.MaterialSnackbar.showSnackbar({message:'Failed to list layouts'}); });
  }; }

  if(btnExport){ btnExport.onclick = function(){ inputExportName.value = ''; openDialog(dlgExport); }; }
  if(btnImportClose){ btnImportClose.onclick = function(){ closeDialog(dlgImport); }; }
  if(btnExportCancel){ btnExportCancel.onclick = function(){ closeDialog(dlgExport); }; }
  if(btnExportSave){ btnExportSave.onclick = function(){
    const name = (inputExportName.value||'').trim();
    if(!name){ snackbarContainer.MaterialSnackbar.showSnackbar({message:'Enter a layout name'}); return; }
    const layout = serializeLayout();
    saveLayout(name, layout).done(function(){ snackbarContainer.MaterialSnackbar.showSnackbar({message:'Layout saved'}); closeDialog(dlgExport); }).fail(function(){ snackbarContainer.MaterialSnackbar.showSnackbar({message:'Save failed'}); });
  }; }
});

$(() => {
  if(window.location.href.indexOf("rosboard.com") === -1) {
    initDefaultTransport();
  }
});

Viewer.onClose = function(viewerInstance) {
  let topicName = viewerInstance.topicName;
  let topicType = viewerInstance.topicType;

  currentTransport.unsubscribe({topicName:topicName});
  $grid.masonry("remove", viewerInstance.card);
  $grid.masonry("layout");
  delete(subscriptions[topicName].viewer);
  delete(subscriptions[topicName]);
  updateStoredSubscriptions();
}

Viewer.onSwitchViewer = (viewerInstance, newViewerType) => {
  let topicName = viewerInstance.topicName;
  let topicType = viewerInstance.topicType;
  if(!subscriptions[topicName].viewer === viewerInstance) console.error("viewerInstance does not match subscribed instance");
  let card = subscriptions[topicName].viewer.card;
  subscriptions[topicName].viewer.destroy();
  delete(subscriptions[topicName].viewer);
  subscriptions[topicName].viewer = new newViewerType(card, topicName, topicType);
  try { updateStoredSubscriptions(); } catch(e){}
};

// Global function to show snackbar notifications
function showNotification(message) {
  try {
    if (snackbarContainer && snackbarContainer.MaterialSnackbar) {
      snackbarContainer.MaterialSnackbar.showSnackbar({ message: message });
    } else {
      console.log('Notification:', message);
    }
  } catch (e) {
    console.log('Notification:', message);
  }
}

// Make it available globally
window.showNotification = showNotification;
