"use strict";

importJsOnce("js/viewers/meta/Viewer.js");
importJsOnce("js/viewers/meta/Space2DViewer.js");
importJsOnce("js/viewers/meta/Space3DViewer.js");

importJsOnce("js/viewers/ImageViewer.js");
importJsOnce("js/viewers/LogViewer.js");
importJsOnce("js/viewers/ProcessListViewer.js");
importJsOnce("js/viewers/MapViewer.js");
importJsOnce("js/viewers/LaserScanViewer.js");
importJsOnce("js/viewers/GeometryViewer.js");
importJsOnce("js/viewers/PolygonViewer.js");
importJsOnce("js/viewers/DiagnosticViewer.js");
importJsOnce("js/viewers/TimeSeriesPlotViewer.js");
importJsOnce("js/viewers/PointCloud2Viewer.js");

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
    const qv = [v[0], v[1], v[2], 0];
    const t = quatMultiply(quatMultiply(q, qv), quatConjugate(q));
    return [t[0], t[1], t[2]];
  }
  function compose(T1, T2) {
    // returns T = T1 o T2 (apply T2 then T1)
    const r = quatMultiply(T1.r, T2.r);
    const t2r = quatRotateVec(T1.r, T2.t);
    const t = [T1.t[0]+t2r[0], T1.t[1]+t2r[1], T1.t[2]+t2r[2]];
    return {r, t};
  }
  function invert(T) {
    const r_inv = quatConjugate(T.r);
    const t_inv_r = quatRotateVec(r_inv, T.t);
    return { r: r_inv, t: [-t_inv_r[0], -t_inv_r[1], -t_inv_r[2]] };
  }
  function normalizeFrame(f){ if(!f) return ""; return (f[0]==='/'?f.substring(1):f); }

  window.ROSBOARD_TF = {
    // child -> {parent, T, static}
    tree: {},
    update: function(msg){
      // expects TFMessage-like: {transforms: [ {child_frame_id, header:{frame_id}, transform:{translation:{x,y,z}, rotation:{x,y,z,w}} }, ... ]}
      const list = msg.transforms || [];
      for(let i=0;i<list.length;i++){
        const tr = list[i];
        const child = normalizeFrame(tr.child_frame_id);
        const parent = normalizeFrame((tr.header&&tr.header.frame_id)||"");
        if(!child || !parent) continue;
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
        this.tree[child] = { parent: parent, T: T, static: (msg._topic_name === "/tf_static") };
      }
    },
    getTransform: function(src, dst){
      src = normalizeFrame(src); dst = normalizeFrame(dst);
      if(!src || !dst || src===dst) return { r:[0,0,0,1], t:[0,0,0] };
      const up = (f)=>{ let chain=[]; let cur=f; let Tacc={r:[0,0,0,1], t:[0,0,0]};
        while(this.tree[cur]){ const node=this.tree[cur]; chain.push({frame:cur, parent:node.parent, T:node.T}); Tacc = compose(node.T, Tacc); cur=node.parent; if(chain.length>256) break; }
        return {root: cur, chain, Tacc}; };
      const a = up(src); const b = up(dst);
      if(a.root !== b.root) return null;
      // find LCA by walking from src to root and indexing frames
      const visited = new Set([src]);
      const parentMap = {}; // frame -> {parent, T}
      let cur = src; for(let i=0;i<a.chain.length;i++){ parentMap[cur] = a.chain[i]; cur = a.chain[i].parent; visited.add(cur); }
      cur = dst; let T_dst_to_lca={r:[0,0,0,1], t:[0,0,0]};
      while(!visited.has(cur) && this.tree[cur]){ const node=this.tree[cur]; T_dst_to_lca = compose(node.T, T_dst_to_lca); cur = node.parent; if(!cur) break; if(b.chain.length>256) break; }
      const lca = cur;
      // compute T_src_to_lca
      let T_src_to_lca={r:[0,0,0,1], t:[0,0,0]}; cur=src;
      while(cur!==lca && parentMap[cur]){ T_src_to_lca = compose(parentMap[cur].T, T_src_to_lca); cur = parentMap[cur].parent; }
      // desired T_src_to_dst = inverse(T_dst_to_lca) o T_src_to_lca
      return compose(invert(T_dst_to_lca), T_src_to_lca);
    },
    transformPoints: function(T, points){
      // points: Float32Array [x,y,z,...]
      if(!T) return points;
      const out = new Float32Array(points.length);
      const r = T.r, t=T.t;
      for(let i=0;i<points.length/3;i++){
        const p = [points[3*i], points[3*i+1], points[3*i+2]];
        const pr = quatRotateVec(r, p);
        out[3*i] = pr[0] + t[0];
        out[3*i+1] = pr[1] + t[1];
        out[3*i+2] = pr[2] + t[2];
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

function updateStoredSubscriptions() {
  if(window.localStorage) {
    let storedSubscriptions = {};
    for(let topicName in subscriptions) {
      storedSubscriptions[topicName] = {
        topicType: subscriptions[topicName].topicType,
      };
    }
    window.localStorage['subscriptions'] = JSON.stringify(storedSubscriptions);
  }
}

function newCard() {
  // creates a new card, adds it to the grid, and returns it.
  let card = $("<div></div>").addClass('card')
    .appendTo($('.grid'));
  return card;
}

let onOpen = function() {
  for(let topic_name in subscriptions) {
    console.log("Re-subscribing to " + topic_name);
    initSubscribe({topicName: topic_name, topicType: subscriptions[topic_name].topicType});
  }
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
    if(!(msg._topic_name === "/tf" || msg._topic_name === "/tf_static")) {
      console.log("Received unsolicited message", msg);
    }
  } else if(!subscriptions[msg._topic_name].viewer) {
    console.log("Received msg but no viewer", msg);
  } else {
    subscriptions[msg._topic_name].viewer.update(msg);
  }
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
    let viewer = Viewer.getDefaultViewerForType(topicType);
    try {
      subscriptions[topicName].viewer = new viewer(card, topicName, topicType);
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
};
