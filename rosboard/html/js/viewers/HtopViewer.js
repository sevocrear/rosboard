"use strict";

// Htop-like viewer for _top (non-ROS system process list)

class HtopViewer extends Viewer {
  constructor(card, topicName, topicType){
    super(card, topicName, topicType);
    this._sortKey = 'cpu'; // 'cpu' | 'mem' | 'pid' | 'user' | 'command'
    this._filter = '';
  }

  onCreate(){
    this.card.title.text("htop");

    // Container
    this.wrapper = $('<div></div>').css({ position:'relative', width:'100%' }).appendTo(this.card.content);

    // Controls bar
    const controls = $('<div></div>').css({ display:'flex', gap:'8px', alignItems:'center', padding:'6px' }).appendTo(this.wrapper);

    $('<span></span>').text('Sort').css({ color:'#ccc', fontSize:'10px' }).appendTo(controls);
    this.sortSel = $('<select></select>')
      .append('<option value="cpu">CPU</option>')
      .append('<option value="mem">MEM</option>')
      .append('<option value="pid">PID</option>')
      .append('<option value="user">USER</option>')
      .append('<option value="command">CMD</option>')
      .val(this._sortKey)
      .change(()=>{ this._sortKey = this.sortSel.val(); if(this._lastMsg) this._render(this._lastMsg); })
      .appendTo(controls);

    this.filterInp = $('<input type="text" placeholder="filter (regex)"/>')
      .css({ flex:'1 1 auto', minWidth:'120px', background:'#404040', border:'1px solid #505050', color:'#e0e0e0', padding:'4px 6px', fontSize:'11px' })
      .on('input', ()=>{ this._filter = (this.filterInp.val()||'').trim(); if(this._lastMsg) this._render(this._lastMsg); })
      .appendTo(controls);

    // Table container
    this.tableWrap = $('<div></div>').css({ position:'relative', width:'100%', height:'0', paddingBottom:'80%', overflow:'auto' }).appendTo(this.wrapper);
    this.table = $('<table></table>')
      .addClass('mdl-data-table mdl-data-table-compact mdl-js-data-table')
      .css({ tableLayout:'fixed', position:'absolute', width:'100%', height:'100%', fontSize:'10pt' })
      .appendTo(this.tableWrap);

    super.onCreate();
  }

  _fmtPct(v){
    const n = (typeof v === 'number') ? v : parseFloat(v||0);
    const clamped = isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    return clamped;
  }

  _barCell(pct, text){
    const p = this._fmtPct(pct);
    const bg = `linear-gradient(90deg, rgba(68,176,224,0.8) ${p}%, rgba(64,64,64,0.6) ${p}%)`;
    return `<div style="position:relative;width:100%;background:${bg};border-radius:2px;padding:0 4px;">${text}</div>`;
  }

  _render(msg){
    // header
    let html = '';
    html += '<tr>'+
      '<th style="width:14%">PID</th>'+
      '<th style="width:18%">CPU%</th>'+
      '<th style="width:18%">MEM%</th>'+
      '<th class="mdl-data-table__cell--non-numeric" style="width:15%">USER</th>'+
      '<th class="mdl-data-table__cell--non-numeric" style="width:35%">COMMAND</th>'+
      '</tr>';

    let rows = (msg.processes||[]).slice();
    // filter
    const f = this._filter;
    if(f){
      try {
        const re = new RegExp(f, 'i');
        rows = rows.filter(p => re.test(String(p.command||'')) || re.test(String(p.user||'')) || re.test(String(p.pid||'')) );
      } catch(e) {
        // invalid regex; do simple substring
        const s = f.toLowerCase();
        rows = rows.filter(p => String(p.command||'').toLowerCase().includes(s) || String(p.user||'').toLowerCase().includes(s));
      }
    }
    // sort
    const key = this._sortKey;
    rows.sort((a,b)=>{
      if(key==='cpu') return (parseFloat(b.cpu||0)-parseFloat(a.cpu||0));
      if(key==='mem') return (parseFloat(b.mem||0)-parseFloat(a.mem||0));
      if(key==='pid') return (parseInt(a.pid||0)-parseInt(b.pid||0));
      if(key==='user') return String(a.user||'').localeCompare(String(b.user||''));
      if(key==='command') return String(a.command||'').localeCompare(String(b.command||''));
      return 0;
    });

    const maxRows = 200;
    if(rows.length > maxRows){ rows = rows.slice(0,maxRows); }

    for(const p of rows){
      const pid = p.pid||'';
      const cpu = this._fmtPct(p.cpu);
      const mem = this._fmtPct(p.mem);
      const user = p.user||'';
      const cmd = p.command||'';
      html += `<tr>`+
        `<td>${pid}</td>`+
        `<td>${this._barCell(cpu, cpu.toFixed(1))}</td>`+
        `<td>${this._barCell(mem, mem.toFixed(1))}</td>`+
        `<td class="mdl-data-table__cell--non-numeric" title="${user}">${user}</td>`+
        `<td class="mdl-data-table__cell--non-numeric" title="${cmd}" style="text-overflow:ellipsis;overflow:hidden;">${cmd}</td>`+
      `</tr>`;
    }
    this.table[0].innerHTML = html;
  }

  onData(msg){
    this._lastMsg = msg;
    this.card.title.text(msg._topic_name + ' (htop)');
    this._render(msg);
  }
}

HtopViewer.friendlyName = "htop";
HtopViewer.supportedTypes = [
  "rosboard_msgs/msg/ProcessList",
];
Viewer.registerViewer(HtopViewer);