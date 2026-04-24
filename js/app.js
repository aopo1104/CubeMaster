/* ── CubeMaster 主应用逻辑 ── */
(function () {
  'use strict';
  var CM = window.CM = window.CM || {};

  var _lastContainers = [];
  var _lastOuterCat = 'Truck';
  var _skuCache = {};
  var _prevMode = null;
  var _lastFcForPallet = null;      // fc of the currently selected container (pallet2ctn)
  var _lastSelectedCtnIdx = 0;      // track which container row is selected
  var _step1Pallets = [];           // Step 1 filledContainers (actual pallets with real SKU manifests)
  var _ctnPalletMap = [];           // [containerIdx] -> [step1PalletIdx, ...] built after Step 2
  var _optimResults = [];            // stores {candidate, data, metrics} for comparison
  var _optimCancelled = false;       // allow cancellation

  /* ── DOM shortcuts ── */
  function $(id) { return document.getElementById(id); }
  CM.$ = $;

  function setText(id, val) { var el=$(id); if(el) el.textContent = (val===null||val===undefined) ? '—' : String(val); }
  function setHtml(id, html) { var el=$(id); if(el) el.innerHTML = html; }
  function e(v) {
    return String(v===null||v===undefined ? '—' : v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function pct(v) { var n=parseFloat(v); return isNaN(n) ? '—' : n.toFixed(1)+'%'; }
  function bar(v) {
    var n = Math.min(100, Math.max(0, parseFloat(v)||0));
    var color = n >= 100 ? '#ef4444' : n >= 85 ? '#f59e0b' : 'var(--brand)';
    return '<div class="bar-wrap"><div class="bar-fill" style="width:'+n+'%;background:'+color+'"></div></div>';
  }
  function flash(id) {
    var el=$(id); if(!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
  function safeGet(obj, key) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
    return null;
  }

  function setStatus(text, mode) {
    $('statusBar').className = mode || '';
    setText('statusText', text);
  }

  function setBusy(busy) {
    $('btnCreate').disabled = busy;
    if (busy) setStatus('请求中…', 'loading');
  }

  /* ── container / model management ── */
  function onCategoryChange() {
    var cat  = $('containerCategory').value;
    if (cat !== 'Pallet') _lastOuterCat = cat;
    var list = CM.PRESETS[cat] || CM.PRESETS['Truck'];
    var sel  = $('containerType');
    sel.innerHTML = '';
    for (var i=0; i<list.length; i++) {
      var opt = document.createElement('option');
      opt.value = list[i].name;
      opt.textContent = list[i].name;
      sel.appendChild(opt);
    }
    onModelChange();
    var vtRow = $('vehicleTypeRow');
    if (vtRow) vtRow.style.display = (cat === 'Truck') ? '' : 'none';
  }
  window.onCategoryChange = onCategoryChange;

  function onModelChange() {
    var cat  = $('containerCategory').value;
    var name = $('containerType').value;
    var list = CM.PRESETS[cat] || [];
    for (var i=0; i<list.length; i++) {
      if (list[i].name === name) {
        $('ctnLength').value      = list[i].length;
        $('ctnWidth').value       = list[i].width;
        $('ctnHeight').value      = list[i].height;
        $('maxWeight').value      = list[i].maxWeight;
        $('ctnEmptyWeight').value = list[i].empty;
        if ($('vehicleType')) $('vehicleType').value = list[i].vtype;
        break;
      }
    }
  }
  window.onModelChange = onModelChange;

  function onOuterCatChange() {
    var ocs = $('outerCatSelect');
    if (!ocs) return;
    _lastOuterCat = ocs.value;
    var catSel = $('containerCategory');
    if (catSel) { catSel.value = ocs.value; onCategoryChange(); }
  }
  window.onOuterCatChange = onOuterCatChange;

  /* ── multi-pallet type table (先托后柜) ── */
  var _palletTypeSpecs = {};   // pltName → spec, populated by buildPalletStepPayload

  function _palletTypeRowHtml(p, rowIdx) {
    var presetOpts = '';
    for (var i = 0; i < CM.PALLET_PRESETS.length; i++) {
      var pr = CM.PALLET_PRESETS[i];
      presetOpts += '<option value="' + i + '">' + pr.name + '</option>';
    }
    var s = 'style="width:46px;font-size:11px;padding:1px 2px"';
    return '<td style="text-align:center;padding:2px">' +
        '<input type="checkbox" checked style="width:auto" title="启用此托盘类型"/></td>' +
      '<td style="padding:2px"><select class="plt-preset" onchange="onPalletTypePreset(this)" ' +
        'style="max-width:110px;font-size:11px">' + presetOpts + '</select></td>' +
      '<td style="padding:2px"><input class="plt-name" value="' + e(p.name) + '" ' +
        'style="width:70px;font-size:11px;padding:1px 2px"/></td>' +
      '<td style="padding:2px"><input class="plt-len" value="' + (p.length||1200) + '" ' + s + '/></td>' +
      '<td style="padding:2px"><input class="plt-wid" value="' + (p.width||1000) + '" ' + s + '/></td>' +
      '<td style="padding:2px"><input class="plt-th" value="' + (p.thickness||150) + '" ' + s + '/></td>' +
      '<td style="padding:2px"><input class="plt-ml" value="' + (p.maxLength||1240) + '" ' + s + '/></td>' +
      '<td style="padding:2px"><input class="plt-mw" value="' + (p.maxWidth||1040) + '" ' + s + '/></td>' +
      '<td style="padding:2px"><input class="plt-mh" value="' + (p.maxHeight||1800) + '" ' + s + '/></td>' +
      '<td style="padding:2px"><input class="plt-mwt" value="' + (p.maxWeight||1000) + '" ' + s + '/></td>' +
      '<td style="padding:2px"><input class="plt-ew" value="' + (p.empty||25) + '" ' + s + '/></td>' +
      '<td style="padding:2px"><input class="plt-qty" value="999" title="最大托盘数量" ' + s + '/></td>' +
      '<td style="padding:2px;text-align:center"><button onclick="this.closest(\'tr\').remove()" ' +
        'style="background:transparent;border:none;color:#ef4444;font-size:14px;cursor:pointer;padding:0 2px">×</button></td>';
  }

  function addPalletTypeRow(presetIdx) {
    if (!$('palletTypeBody')) return;
    presetIdx = (presetIdx != null) ? presetIdx : 0;
    var p = CM.PALLET_PRESETS[presetIdx] || CM.PALLET_PRESETS[0];
    var rowCount = $('palletTypeBody').querySelectorAll('tr').length;
    var tr = document.createElement('tr');
    tr.innerHTML = _palletTypeRowHtml(p, rowCount);
    var sel = tr.querySelector('.plt-preset');
    if (sel) sel.value = String(presetIdx);
    $('palletTypeBody').appendChild(tr);
  }
  window.addPalletTypeRow = addPalletTypeRow;

  function onPalletTypePreset(sel) {
    var idx = parseInt(sel.value, 10) || 0;
    var p = CM.PALLET_PRESETS[idx];
    if (!p) return;
    var row = sel.closest('tr');
    row.querySelector('.plt-name').value = p.name;
    row.querySelector('.plt-len').value  = p.length;
    row.querySelector('.plt-wid').value  = p.width;
    row.querySelector('.plt-th').value   = p.thickness;
    row.querySelector('.plt-ml').value   = p.maxLength;
    row.querySelector('.plt-mw').value   = p.maxWidth;
    row.querySelector('.plt-mh').value   = p.maxHeight;
    row.querySelector('.plt-mwt').value  = p.maxWeight;
    row.querySelector('.plt-ew').value   = p.empty;
  }
  window.onPalletTypePreset = onPalletTypePreset;

  function readPalletTypes() {
    var rows = document.querySelectorAll('#palletTypeBody tr');
    var types = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var chk = row.querySelector('input[type=checkbox]');
      if (chk && !chk.checked) continue;
      function gv(cls) { var el = row.querySelector('.' + cls); return el ? el.value : ''; }
      var L   = parseFloat(gv('plt-len'))  || 1200;
      var W   = parseFloat(gv('plt-wid'))  || 1000;
      var th  = parseFloat(gv('plt-th'))   || 150;
      var mL  = parseFloat(gv('plt-ml'))   || (L + 40);
      var mW  = parseFloat(gv('plt-mw'))   || (W + 40);
      var mH  = parseFloat(gv('plt-mh'))   || 1800;
      var mWt = parseFloat(gv('plt-mwt')) || 1000;
      var ew  = parseFloat(gv('plt-ew'))   || 25;
      var qty = parseInt(gv('plt-qty'), 10);  if (!(qty > 0)) qty = 999;
      var nm  = (gv('plt-name') || ('PLT-' + (i + 1))).trim();
      types.push({ name: nm, length: L, width: W, thickness: th,
                   maxLength: mL, maxWidth: mW, maxHeight: mH,
                   maxWeight: mWt, emptyWeight: ew, qty: qty });
    }
    return types;
  }

  function initPalletTypeTable() {
    var body = $('palletTypeBody');
    if (!body || body.querySelectorAll('tr').length > 0) return;
    // Default: 1100×1100 (index 1) as first pallet type
    addPalletTypeRow(1);
  }

  /* ── SKU row management ── */
  function skuRowHtml(d) {
    return '<td><input value="'+d.name+'"/></td>'
      +'<td><input value="'+(d.l||'')+'" style="width:100%"/></td>'
      +'<td><input value="'+(d.w||'')+'" style="width:100%"/></td>'
      +'<td><input value="'+(d.h||'')+'" style="width:100%"/></td>'
      +'<td><input value="'+d.weight+'"/></td>'
      +'<td><input value="'+d.qty+'"/></td>'
      +'<td><select class="orientSel">'
      +'<option value="OrientationsAll"'+(d.orient==='OrientationsAll'?' selected':'')+'>All</option>'
      +'<option value="Orientations12"'+(d.orient==='Orientations12'?' selected':'')+'>12方向</option>'
      +'<option value="Orientations14"'+(d.orient==='Orientations14'?' selected':'')+'>2方向</option>'
      +'<option value="Orientation1"'+(d.orient==='Orientation1'?' selected':'')+'>固定</option>'
      +'</select></td>'
      +'<td><input value="'+d.maxL+'" title="maxLayersOnOrientation1，0=不限"/></td>'
      +'<td><input type="checkbox" style="width:auto" title="overhangAllowed：允许货物超出托盘边缘（建议适度超托SKU勾选）"'+(d.overhang?' checked':'')+'/></td>'
      +'<td><input value="'+(d.ovhL||'0')+'" title="overhangLength(mm)：长度方向最大超托mm，0=不超" style="width:100%"/></td>'
      +'<td><input value="'+(d.ovhW||'0')+'" title="overhangWidth(mm)：宽度方向最大超托mm，0=不超" style="width:100%"/></td>'
      +'<td><input type="checkbox" style="width:auto" title="isOptional"'+(d.opt?' checked':'')+'/></td>'
      +'<td><input type="checkbox" style="width:auto" title="isPalletized"'+(d.pal?' checked':'')+'/></td>'
      +'<td><input type="checkbox" style="width:auto" title="turnAllowedOnFloor：允许货物在地面水平旋转 90°"'+(d.turn!==false?' checked':'')+'/></td>'
      +'<td style="text-align:center"><button onclick="this.closest(\'tr\').remove()" style="background:transparent;border:none;color:#ef4444;font-size:14px;cursor:pointer;padding:0 4px">×</button></td>';
  }

  function saveSkuCache(mode) {
    if (!mode) return;
    var rows = $('skuBody').querySelectorAll('tr');
    var saved = [];
    for (var ri=0; ri<rows.length; ri++) {
      var inp = rows[ri].querySelectorAll('input, select');
      if (inp.length < 11) continue;
      saved.push({
        name:     inp[0].value,
        l:        inp[1].value,
        w:        inp[2].value,
        h:        inp[3].value,
        weight:   inp[4].value,
        qty:      inp[5].value,
        orient:   inp[6].value,
        maxL:     inp[7].value,
        overhang: inp[8]  ? inp[8].checked  : false,
        ovhL:     inp[9]  ? inp[9].value    : '0',
        ovhW:     inp[10] ? inp[10].value   : '0',
        opt:      inp[11] ? inp[11].checked : false,
        pal:      inp[12] ? inp[12].checked : false,
        turn:     inp[13] ? inp[13].checked : true
      });
    }
    _skuCache[mode] = saved;
  }

  function loadSkuRows(mode) {
    var data = _skuCache[mode] || CM.SKU_DEFAULTS[mode] || CM.SKU_DEFAULTS['pallet2ctn'];
    var tbody = $('skuBody');
    tbody.innerHTML = '';
    for (var i=0; i<data.length; i++) {
      var tr = document.createElement('tr');
      tr.innerHTML = skuRowHtml(data[i]);
      tbody.appendChild(tr);
    }
  }

  function addSkuRow(sku, l, w, h, kg, qty, orient, maxL, opt, pal, ovh, ovhL, ovhW) {
    var d = {
      name: sku||'', l: l||'', w: w||'', h: h||'',
      weight: kg||'', qty: qty||'',
      orient: orient||'OrientationsAll', maxL: maxL||'0',
      overhang: !!ovh, ovhL: ovhL||'0', ovhW: ovhW||'0',
      opt: !!opt, pal: !!pal
    };
    var tr = document.createElement('tr');
    tr.innerHTML = skuRowHtml(d);
    $('skuBody').appendChild(tr);
  }

  /* ── calcMode switch ── */
  function setCalcMode(mode) {
    if (_prevMode && _prevMode !== mode) saveSkuCache(_prevMode);
    if (_prevMode !== mode) loadSkuRows(mode);
    _prevMode = mode;

    $('calcMode').value = mode;
    ['pallet','direct','pallet2ctn'].forEach(function(m) {
      var t = $('tab-'+m); if (t) t.className = 'mode-tab'+(m===mode?' active':'');
    });
    setHtml('modeInfo', CM.MODE_INFO[mode] || '');

    var sp = $('secPalletInner');
    if (sp) sp.style.display = (mode==='pallet2ctn') ? '' : 'none';

    var compCard = $('comparisonCard');
    if (compCard && mode !== 'pallet2ctn') compCard.style.display = 'none';

    var ocr = $('outerCatRow');
    if (ocr) ocr.style.display = (mode === 'pallet') ? 'none' : '';

    var catSel = $('containerCategory');
    var ocs    = $('outerCatSelect');
    if (catSel) {
      if (mode === 'pallet') {
        catSel.value = 'Pallet';
      } else {
        var defaultCat = (mode === 'pallet2ctn') ? 'Container' : 'Truck';
        var cat = defaultCat;
        if (ocs) { ocs.value = cat; }
        catSel.value = cat;
        _lastOuterCat = cat;
      }
      onCategoryChange();
    }

    var vtRow = $('vehicleTypeRow');
    if (vtRow) vtRow.style.display = (mode === 'pallet') ? 'none' : '';

    var st = $('secCtnTitle'); if (st) st.textContent = CM.MODE_CTN_TITLE[mode];
    var vt = $('vizTitle');    if (vt) vt.textContent = CM.MODE_VIZ_TITLE[mode];

    var lblL = $('lblCtnLength');
    var lblW = $('lblCtnWidth');
    var lblH = $('lblCtnHeight');
    if (mode === 'pallet') {
      if (lblL) lblL.textContent = '最大装载L（可超标）';
      if (lblW) lblW.textContent = '最大装载W（可超标）';
      if (lblH) lblH.textContent = '最大装载H（带托）';
    } else {
      if (lblL) lblL.textContent = '长 length(mm)';
      if (lblW) lblW.textContent = '宽 width(mm)';
      if (lblH) lblH.textContent = '高 height(mm)';
    }

    var s2sec = $('step2JsonSection');
    if (s2sec) s2sec.style.display = (mode === 'pallet2ctn') ? '' : 'none';

    if (mode === 'pallet') {
      var mwEl = $('maxWeight');
      if (mwEl) mwEl.value = '800';
    } else {
      onModelChange();
    }
  }
  window.setCalcMode = setCalcMode;

  /* ── build payload (mode-aware, opts.maxHeight overrides pallet height) ── */
  function buildPayload(opts) {
    opts = opts || {};
    var mode = ($('calcMode') && $('calcMode').value) || 'pallet';
    var rows = $('skuBody').querySelectorAll('tr'), cargoes = [];

    /* pltSpec for enrichCargo when mode==='pallet' (the container IS the pallet) */
    var _enrPltSpec = (mode === 'pallet') ? (function () {
      var L = parseFloat($('ctnLength').value) || 1200;
      var W = parseFloat($('ctnWidth').value)  || 1000;
      return { length: L, width: W, maxLength: L + 80, maxWidth: W + 60 };
    }()) : null;

    var palletSpec = null;
    if (mode === 'pallet2ctn') {
      // Use first enabled pallet type from the multi-pallet table
      var _bpPts = readPalletTypes();
      var _bpPt0 = (_bpPts.length && _bpPts[0]) || {
        name: 'Standard-Pallet', length: 1200, width: 1000, thickness: 150,
        maxLength: 1240, maxWidth: 1040, maxHeight: 1800, maxWeight: 1000, emptyWeight: 25
      };
      var pMH = opts.maxHeight || _bpPt0.maxHeight;
      palletSpec = {
        name:        _bpPt0.name,
        length:      _bpPt0.length,  width: _bpPt0.width,  height: _bpPt0.thickness,
        maxLength:   _bpPt0.maxLength, maxWidth: _bpPt0.maxWidth, maxHeight: pMH,
        maxWeight:   _bpPt0.maxWeight,
        emptyWeight: _bpPt0.emptyWeight
      };
    }

    for (var i=0; i<rows.length; i++) {
      var inp = rows[i].querySelectorAll('input');
      if (!inp[0] || !inp[0].value.trim()) continue;
      var orientSel       = rows[i].querySelector('.orientSel');
      var maxLayerInp     = inp[6];
      var ovhLInp         = inp[8];   // overhangLength text input
      var ovhWInp         = inp[9];   // overhangWidth text input
      var overhangInp     = rows[i].querySelectorAll('input[type=checkbox]')[0];
      var isOptionalChk   = rows[i].querySelectorAll('input[type=checkbox]')[1];
      var isPalletizedChk = rows[i].querySelectorAll('input[type=checkbox]')[2];

      var forcePalletized = (mode === 'pallet2ctn');
      var turnAllowedChk  = rows[i].querySelectorAll('input[type=checkbox]')[3];
      var cargoObj = {
        style:  'Shipcase',
        name:   inp[0].value.trim(),
        length: parseFloat(inp[1].value)||0, width: parseFloat(inp[2].value)||0, height: parseFloat(inp[3].value)||0,
        weight: parseFloat(inp[4].value)||0,
        qty:    parseInt(inp[5].value,10)||0,
        orientationsAllowed:      orientSel ? orientSel.value : 'OrientationsAll',
        maxLayersOnOrientation1:  parseInt(maxLayerInp ? maxLayerInp.value : '0', 10)||0,
        overhangAllowed:          overhangInp ? overhangInp.checked : false,
        isOptional:   isOptionalChk   ? isOptionalChk.checked    : false,
        isPalletized: forcePalletized ? true : (isPalletizedChk ? isPalletizedChk.checked : false),
        turnAllowedOnFloor: turnAllowedChk ? turnAllowedChk.checked : true
      };
      if (cargoObj.overhangAllowed) {
        cargoObj.overhangLength = parseInt(ovhLInp ? ovhLInp.value : '0', 10) || 0;
        cargoObj.overhangWidth  = parseInt(ovhWInp ? ovhWInp.value : '0', 10) || 0;
      }
      /* ── Smart orientation / overhang enrichment (pallet mode) — disabled ── */

      if (mode === 'pallet2ctn') {
        cargoObj.palletizing = {
          pallet:                palletSpec,
          flatPalletTop:         true,
          partialPalletsAllowed: $('plt_partialAllowed').checked,
          remainQtyToMixPallet:  $('plt_mixPallet').checked,
          remainQtyToVehicle:    false
        };
      }
      cargoes.push(cargoObj);
    }

    var mw = parseFloat($('maxWeight').value) || (mode==='pallet' ? 800 : 30000);

    var ctnType = (mode === 'pallet') ? 'Pallet'
                : (mode === 'pallet2ctn') ? (($('outerCatSelect') && $('outerCatSelect').value) || 'Truck')
                : ($('containerCategory') ? $('containerCategory').value : 'Truck');

    return {
      document: {
        title:           $('docTitle').value.trim() || 'API装托计划',
        description:     $('docDesc').value.trim(),
        containerType:   ctnType,
        calculationType: $('calcType').value
      },
      containers: [{
        name:          $('containerType').value,
        qty:           parseInt($('containerQty').value,10)||1,
        maxWeight:     mw,
        length:        parseFloat($('ctnLength').value)||16154,
        width:         parseFloat($('ctnWidth').value)||2489,
        height:        parseFloat($('ctnHeight').value)||2794,
        emptyWeight:   parseFloat($('ctnEmptyWeight').value)||0,
        maxVolPercent: 100,
        maxLength:     parseFloat($('ctnLength').value)||0,
        maxWidth:      parseFloat($('ctnWidth').value)||0,
        maxHeight:     parseFloat($('ctnHeight').value)||0,
        priority:      parseInt($('ctnPriority').value,10)||0,
        vehicleType:   $('vehicleType') ? $('vehicleType').value : 'Dry'
      }],
      cargoes: cargoes,
      rules: (function () {
        var r = {
          isWeightLimited:               true,
          isUnitloadFirst:               $('isUnitloadFirst').checked,
          isSpreadIdenticalCargoAllowed: $('isSpreadIdentical').checked,
          bestFitContainersSelectionType: $('bestFitType').value
        };
        if (mode === 'pallet') {
          r.algorithmType     = 'Optimization';
          r.optimizationLevel = 4;
          r.fillDirection     = 'FrontToRear';
        }
        return r;
      }())
    };
  }

  /* ── fetch ── */
  function fetchApi(path, method, body, cb) {
    var base  = window.location.origin;
    var opts = { method: method||'GET', headers: {} };
    if (body) { opts.headers['Content-Type']='application/json'; opts.body=JSON.stringify(body); }
    fetch(base+path, opts).then(function(res) {
      var s=res.status, ct=res.headers.get('content-type')||'';
      if (ct.indexOf('application/json')!==-1) {
        res.json().then(function(d){ cb(d,null,s); });
      } else {
        res.text().then(function(t){ cb(t,null,s); });
      }
    }).catch(function(err){ cb(null,String(err),0); });
  }

  function fetchApiAsync(path, method, body) {
    return new Promise(function(resolve) {
      fetchApi(path, method, body, function(data, err, status) {
        resolve({ data: data, err: err, status: status });
      });
    });
  }

  /* ── two-step pallet→container calculation (先托后柜) ── */

  function buildPalletStepPayload() {
    var pltTypes = readPalletTypes();
    if (!pltTypes.length) {
      pltTypes = [{ name: 'Standard-Pallet', length: 1200, width: 1000, thickness: 150,
                    maxLength: 1240, maxWidth: 1040, maxHeight: 1800, maxWeight: 1000, emptyWeight: 25 }];
    }

    // Populate _palletTypeSpecs map (side effect, used by buildContainerStepPayload & buildCtnPalletMap)
    _palletTypeSpecs = {};
    var containers = [];
    for (var pi = 0; pi < pltTypes.length; pi++) {
      var pt = pltTypes[pi];
      _palletTypeSpecs[pt.name] = pt;
      containers.push({
        name:        pt.name,
        qty:         pt.qty || 999,
        length:      pt.length,
        width:       pt.width,
        height:      pt.maxHeight - pt.thickness,   // usable stacking height above board
        maxLength:   pt.maxLength,
        maxWidth:    pt.maxWidth,
        maxHeight:   pt.maxHeight - pt.thickness,
        maxWeight:   pt.maxWeight - pt.emptyWeight,
        emptyWeight: pt.emptyWeight
      });
    }
    // Expose first pallet spec for 3D visualization
    CM._activePalletSpec = pltTypes[0] || null;

    var rows = $('skuBody').querySelectorAll('tr');
    var cargoes = [];
    for (var i = 0; i < rows.length; i++) {
      var inp = rows[i].querySelectorAll('input');
      if (!inp[0] || !inp[0].value.trim()) continue;
      var orientSel   = rows[i].querySelector('.orientSel');
      var maxLayerInp = inp[6];
      var ovhLInp     = inp[8];
      var ovhWInp     = inp[9];
      var overhangInp = rows[i].querySelectorAll('input[type=checkbox]')[0];
      var cargoP = {
        style:                   'Shipcase',
        name:                    inp[0].value.trim(),
        length:                  parseFloat(inp[1].value) || 0,
        width:                   parseFloat(inp[2].value) || 0,
        height:                  parseFloat(inp[3].value) || 0,
        weight:                  parseFloat(inp[4].value) || 0,
        qty:                     parseInt(inp[5].value, 10) || 0,
        orientationsAllowed:     orientSel ? orientSel.value : 'OrientationsAll',
        maxLayersOnOrientation1: parseInt(maxLayerInp ? maxLayerInp.value : '0', 10) || 0,
        overhangAllowed:         overhangInp ? overhangInp.checked : false,
        isOptional:              false,
        isPalletized:            false,
        turnAllowedOnFloor:      rows[i].querySelectorAll('input[type=checkbox]')[3] ? rows[i].querySelectorAll('input[type=checkbox]')[3].checked : true
      };
      if (cargoP.overhangAllowed) {
        cargoP.overhangLength = parseInt(ovhLInp ? ovhLInp.value : '0', 10) || 0;
        cargoP.overhangWidth  = parseInt(ovhWInp ? ovhWInp.value : '0', 10) || 0;
      }
      /* ── Smart orientation / overhang enrichment (Step 1) — disabled ── */
      cargoes.push(cargoP);
    }
    return {
      document: {
        title:           ($('docTitle').value.trim() || 'Step1') + ' — 托盘计算',
        description:     'Step 1: pallet loading',
        containerType:   'Pallet',
        calculationType: $('calcType').value
      },
      containers: containers,
      cargoes: cargoes,
      rules: {
        isWeightLimited:                true,
        isUnitloadFirst:                true,
        isSpreadIdenticalCargoAllowed:  $('plt_spreadIdenticalPallet') ? $('plt_spreadIdenticalPallet').checked : true,
        algorithmType:                  ($('plt_algorithmType') && $('plt_algorithmType').value) || 'Optimization',
        optimizationLevel:              parseInt(($('plt_optimLevel') && $('plt_optimLevel').value) || '4', 10) || 4,
        fillDirection:                  'FrontToRear',
        bestFitContainersSelectionType: $('bestFitType').value
      }
    };
  }

  /* ── Build PLT group key for a single Step 1 pallet ──
   *  nameToSpec: map of container_name -> {thickness, emptyWeight, length, width, ...}
   */
  function _pltKey(fp, nameToSpec) {
    var spec = (nameToSpec && fp.name && nameToSpec[fp.name]) || {};
    var as = fp.actualSize  || {};
    var ls = fp.loadSummary || {};
    var L  = Math.round(as.length || spec.length  || 1200);
    var W  = Math.round(as.width  || spec.width   || 1000);
    var H  = Math.round(as.height || 0) + (spec.thickness || 150);
    var grossWt = Math.round(((parseFloat(ls.weightLoaded) || 0) + (spec.emptyWeight || 25)) * 10) / 10;
    return L + '_' + W + '_' + H + '_' + grossWt;
  }

  /* ── Map each Step 2 container's manifest back to Step 1 pallet indices ── */
  function buildCtnPalletMap(filledContainers, step1Pallets, nameToSpec) {
    // Build ordered group list + index map (same key order as buildContainerStepPayload)
    var groupOrder = [];
    var groups = {};  // key -> [step1 indices]
    for (var i = 0; i < step1Pallets.length; i++) {
      var key = _pltKey(step1Pallets[i], nameToSpec);
      if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
      groups[key].push(i);
    }
    // Build PLT-N name -> key in the same iteration order used by buildContainerStepPayload
    var pltKeyMap = {};
    for (var ki = 0; ki < groupOrder.length; ki++) pltKeyMap['PLT-' + (ki + 1)] = groupOrder[ki];

    var allocated = {};  // key -> how many already assigned to earlier containers
    var result = [];
    for (var ci = 0; ci < filledContainers.length; ci++) {
      var mfst = filledContainers[ci].manifest || [];
      var indices = [];
      for (var mi = 0; mi < mfst.length; mi++) {
        var entry = mfst[mi];
        var cname = (entry.cargo || {}).name || '';
        var gk = pltKeyMap[cname];
        if (!gk || !groups[gk]) continue;
        var cnt = parseInt(entry.cargoesLoaded != null ? entry.cargoesLoaded : (entry.cargo || {}).qty, 10) || 0;
        var grp = groups[gk];
        var start = allocated[gk] || 0;
        for (var ai = start; ai < start + cnt && ai < grp.length; ai++) indices.push(grp[ai]);
        allocated[gk] = (allocated[gk] || 0) + cnt;
      }
      result.push(indices);
    }
    return result;
  }

  function buildContainerStepPayload(filledPallets, nameToSpec) {
    // Group filled pallets by dimensions+weight, create one cargo entry per unique type
    var groupOrder2 = [];
    var groups2 = {};
    for (var i2 = 0; i2 < filledPallets.length; i2++) {
      var key2 = _pltKey(filledPallets[i2], nameToSpec);
      if (!groups2[key2]) { groups2[key2] = { key: key2, L: 0, W: 0, H: 0, wt: 0, qty: 0 }; groupOrder2.push(key2); }
      var fp2 = filledPallets[i2], as2 = fp2.actualSize || {}, ls2 = fp2.loadSummary || {};
      var spec2 = (nameToSpec && fp2.name && nameToSpec[fp2.name]) || {};
      groups2[key2].L  = groups2[key2].L  || Math.round(as2.length || spec2.length  || 1200);
      groups2[key2].W  = groups2[key2].W  || Math.round(as2.width  || spec2.width   || 1000);
      groups2[key2].H  = groups2[key2].H  || Math.round(as2.height || 0) + (spec2.thickness || 150);
      groups2[key2].wt = groups2[key2].wt || Math.round(((parseFloat(ls2.weightLoaded) || 0) + (spec2.emptyWeight || 25)) * 10) / 10;
      groups2[key2].qty++;
    }
    var cargoes = [];
    var idx = 1;
    for (var ki = 0; ki < groupOrder2.length; ki++) { var k = groupOrder2[ki];
      var g = groups2[k];
      cargoes.push({
        style:               'Shipcase',
        name:                'PLT-' + (idx++),
        length:              g.L,
        width:               g.W,
        height:              g.H,
        weight:              g.wt,
        qty:                 g.qty,
        isPalletized:        false,
        isOptional:          false,
        orientationsAllowed: 'Orientation1'
      });
    }
    var outerCat = ($('outerCatSelect') && $('outerCatSelect').value) || 'Truck';
    return {
      document: {
        title:           ($('docTitle').value.trim() || 'Step2') + ' — 装柜',
        description:     'Step 2: container loading',
        containerType:   outerCat,
        calculationType: $('calcType').value
      },
      containers: [{
        name:          $('containerType').value,
        qty:           parseInt($('containerQty').value, 10) || 1,
        maxWeight:     parseFloat($('maxWeight').value) || 30000,
        length:        parseFloat($('ctnLength').value)      || 16154,
        width:         parseFloat($('ctnWidth').value)       || 2489,
        height:        parseFloat($('ctnHeight').value)      || 2794,
        emptyWeight:   parseFloat($('ctnEmptyWeight').value) || 0,
        maxVolPercent: 100,
        maxLength:     parseFloat($('ctnLength').value)      || 0,
        maxWidth:      parseFloat($('ctnWidth').value)       || 0,
        maxHeight:     parseFloat($('ctnHeight').value)      || 0,
        priority:      parseInt($('ctnPriority').value, 10)  || 0,
        vehicleType:   $('vehicleType') ? $('vehicleType').value : 'Dry'
      }],
      cargoes: cargoes,
      rules: {
        isWeightLimited:                true,
        isUnitloadFirst:                $('isUnitloadFirst').checked,
        isSpreadIdenticalCargoAllowed:  $('isSpreadIdentical').checked,
        bestFitContainersSelectionType: $('bestFitType').value
      }
    };
  }

  function runPallet2CtnCalc() {
    setBusy(true);
    _ctnPalletMap = [];  // reset mapping from previous run
    var palletPayload = buildPalletStepPayload();
    $('req1Json').value  = JSON.stringify(palletPayload, null, 2);
    $('resp1Json').value = '等待中…';
    $('req2Json').value  = '—';
    $('resp2Json').value = '—';
    $('wRaw').style.display = 'block';
    setStatus('第1步：计算托盘装载中…', 'loading');

    var qs1 = 'UOM=UnitMetric&placementsCreated=true&spacesCreated=true';
    if ($('chkGraphics') && $('chkGraphics').checked) qs1 += '&graphicsCreated=true&graphicsImageWidth=800&graphicsImageDepth=600';
    fetchApiAsync('/cubemaster/api/loads?' + qs1, 'POST', palletPayload)
      .then(function(r1) {
        $('resp1Json').value = typeof r1.data === 'string' ? r1.data : JSON.stringify(r1.data, null, 2);
        if (r1.err || r1.status >= 400) {
          setBusy(false);
          var m1 = (r1.data && r1.data.message) ? r1.data.message : ('HTTP ' + r1.status);
          setStatus('Step1 失败: ' + m1, 'error');
          return;
        }
        var item1 = pickItem(r1.data);
        var filledPallets = (item1 && item1.filledContainers) || [];
        if (!filledPallets.length) {
          setBusy(false);
          setStatus('Step1 无填充托盘，请检查货物/托盘规格', 'error');
          return;
        }
        _step1Pallets = filledPallets;  // save for pallet table display
        var pltCnt = filledPallets.length;
        setStatus('第1步完成 — 共 ' + pltCnt + ' 托，开始装柜计算…', 'loading');

        // Immediately show Step 1 pallet results so user sees pallet data while Step 2 runs
        var _ctnDetailEl = $('ctnDetail');
        if (_ctnDetailEl) _ctnDetailEl.style.display = '';
        renderPalletTable(null);
        if (filledPallets.length) selectPallet(0);

        var ctnPayload = buildContainerStepPayload(filledPallets, _palletTypeSpecs);
        $('req2Json').value  = JSON.stringify(ctnPayload, null, 2);
        $('resp2Json').value = '等待中…';

        var qs2 = 'UOM=UnitMetric&placementsCreated=true&spacesCreated=true';
        if ($('chkGraphics') && $('chkGraphics').checked) qs2 += '&graphicsCreated=true&graphicsImageWidth=800&graphicsImageDepth=600';
        fetchApiAsync('/cubemaster/api/loads?' + qs2, 'POST', ctnPayload)
          .then(function(r2) {
            $('resp2Json').value = typeof r2.data === 'string' ? r2.data : JSON.stringify(r2.data, null, 2);
            setBusy(false);
            if (r2.err || r2.status >= 400) {
              var m2 = (r2.data && r2.data.message) ? r2.data.message : ('HTTP ' + r2.status);
              setStatus('Step2 失败: ' + m2, 'error');
              return;
            }
            setStatus('先托后柜完成 ✓ — 共 ' + pltCnt + ' 托', 'ok');
            // Build container→pallet mapping so clicking a container filters the pallet table
            var item2 = pickItem(r2.data);
            var filledCtn2 = (item2 && item2.filledContainers) || [];
            _ctnPalletMap = buildCtnPalletMap(filledCtn2, _step1Pallets, _palletTypeSpecs);
            renderResult(r2.data);
          });
      });
  }



  function getTotalQty() {
    var rows = $('skuBody').querySelectorAll('tr'), total = 0;
    for (var i = 0; i < rows.length; i++) {
      var inp = rows[i].querySelectorAll('input');
      total += parseInt(inp[5] ? inp[5].value : '0', 10) || 0;
    }
    return total;
  }

  function generateCandidates() {
    var ctnH     = parseFloat($('ctnHeight').value) || 2694;
    var _gcPts   = readPalletTypes();
    var _gcPt0   = (_gcPts.length && _gcPts[0]) || {};
    var pltTh    = _gcPt0.thickness || 150;
    var userMaxH = _gcPt0.maxHeight  || 1800;
    var maxStack = parseInt($('maxStackLayers') ? $('maxStackLayers').value : '2', 10) || 2;

    var candidates = [];
    var seen = {};

    function add(label, maxH, stackHint) {
      maxH = Math.floor(maxH);
      if (maxH < pltTh + 100) return;
      if (maxH > ctnH) maxH = Math.floor(ctnH);
      if (seen[maxH]) return;
      seen[maxH] = true;
      candidates.push({ label: label, maxHeight: maxH, stackHint: stackHint });
    }

    /* stack-based candidates */
    for (var n = 1; n <= maxStack; n++) {
      var mH = Math.floor(ctnH / n);
      var lbl = (n === 1) ? '单层托(不叠)' : n + '层叠托';
      add(lbl, mH, n);
    }

    /* user's original setting */
    add('用户设定', userMaxH, 0);

    /* cargo-height-based variants */
    var rows = $('skuBody').querySelectorAll('tr');
    var heights = [];
    for (var ri = 0; ri < rows.length; ri++) {
      var inp = rows[ri].querySelectorAll('input');
      var h = parseFloat(inp[3] ? inp[3].value : 0) || 0;
      if (h > 0 && heights.indexOf(h) === -1) heights.push(h);
    }
    heights.sort(function(a, b) { return b - a; });

    for (var hi = 0; hi < heights.length; hi++) {
      var ch = heights[hi];
      for (var ly = 1; ly <= 8; ly++) {
        var mhC = ch * ly + pltTh;
        if (mhC > ctnH) break;
        var stk = Math.floor(ctnH / mhC);
        if (stk > maxStack) continue;
        add(ly + '层箱×' + stk + '叠', mhC, stk);
      }
    }

    candidates.sort(function(a, b) { return b.maxHeight - a.maxHeight; });
    return candidates;
  }

  function extractMetrics(resp, totalQty) {
    if (resp.err || resp.status >= 400) {
      return { ok: false, error: resp.err || ('HTTP ' + resp.status) };
    }
    var data = resp.data;
    var item = pickItem(data);
    if (!item) return { ok: false, error: '无 loadSummary' };
    var sum = item.loadSummary || {};
    var fc  = (item.filledContainers || [])[0] || {};
    var fcs = fc.loadSummary || {};
    return {
      ok:            true,
      data:          data,
      containersLoaded: sum.containersLoaded || 0,
      piecesLoaded:  sum.piecesLoaded || 0,
      unloaded:      Math.max(0, totalQty - (sum.piecesLoaded || 0)),
      volUtil:       fcs.volumeUtilization || 0,
      wtUtil:        fcs.weightUtilization || 0,
      compoundVol:   compoundVolPct(fc)
    };
  }

  function renderCompStart(candidates) {
    $('comparisonCard').style.display = '';
    $('wComparison').style.display = '';
    $('compProgress').style.display = '';
    var html = '';
    for (var i = 0; i < candidates.length; i++) {
      html += '<tr id="compRow' + i + '" class="comp-row">';
      html += '<td style="text-align:center">' + (i + 1) + '</td>';
      html += '<td>' + e(candidates[i].label) + '</td>';
      html += '<td>' + candidates[i].maxHeight + '</td>';
      html += '<td colspan="5" style="color:var(--muted)">等待中…</td>';
      html += '<td><span class="tag tag-gray">等待</span></td>';
      html += '</tr>';
    }
    setHtml('comparisonRows', html);
  }

  function updateCompRow(idx, candidate, metrics) {
    var row = $('compRow' + idx);
    if (!row) return;
    if (!metrics.ok) {
      row.innerHTML =
        '<td style="text-align:center">' + (idx + 1) + '</td>' +
        '<td>' + e(candidate.label) + '</td>' +
        '<td>' + candidate.maxHeight + '</td>' +
        '<td colspan="5" style="color:#ef4444">' + e(metrics.error) + '</td>' +
        '<td><span class="tag" style="background:#fef2f2;color:#991b1b;border:1px solid #fca5a5">失败</span></td>';
      return;
    }
    var vU = metrics.compoundVol || metrics.volUtil;
    row.innerHTML =
      '<td style="text-align:center">' + (idx + 1) + '</td>' +
      '<td><strong>' + e(candidate.label) + '</strong></td>' +
      '<td>' + candidate.maxHeight + '</td>' +
      '<td><strong>' + metrics.piecesLoaded + '</strong></td>' +
      '<td>' + (metrics.unloaded > 0 ? '<span style="color:#ef4444">' + metrics.unloaded + '</span>' : '0') + '</td>' +
      '<td>' + metrics.containersLoaded + '</td>' +
      '<td>' + bar(vU) + ' ' + pct(vU) + '</td>' +
      '<td>' + pct(metrics.wtUtil) + '</td>' +
      '<td><span class="tag tag-green">完成</span></td>';
    row.onclick = function() { selectCandidateResult(idx); };
    row.style.cursor = 'pointer';
  }

  function findBest(results, goal) {
    var bestIdx = -1, bestVal = -Infinity;
    for (var i = 0; i < results.length; i++) {
      var m = results[i];
      if (!m.ok) continue;
      var val;
      if (goal === 'maxPieces')       val = m.piecesLoaded * 10000 + (m.compoundVol || m.volUtil);
      else if (goal === 'maxVolUtil')  val = (m.compoundVol || m.volUtil);
      else if (goal === 'maxWtUtil')   val = m.wtUtil;
      else if (goal === 'minContainers') val = -m.containersLoaded * 10000 + m.piecesLoaded;
      else val = m.piecesLoaded;
      if (val > bestVal) { bestVal = val; bestIdx = i; }
    }
    return bestIdx;
  }

  function selectCandidateResult(idx) {
    var entry = _optimResults[idx];
    if (!entry || !entry.ok) return;
    /* highlight row */
    var allRows = document.querySelectorAll('#comparisonRows .comp-row');
    for (var r = 0; r < allRows.length; r++) allRows[r].classList.remove('ctn-row-sel');
    var row = $('compRow' + idx);
    if (row) row.classList.add('ctn-row-sel');
    /* render full result using existing pipeline */
    renderResult(entry.data);
  }
  window.selectCandidateResult = selectCandidateResult;

  function runOptimization() {
    _optimCancelled = false;
    var candidates = generateCandidates();
    if (!candidates.length) {
      setStatus('无法生成候选方案，检查托盘 / 柜子高度设定', 'error');
      return;
    }
    setBusy(true);
    setStatus('多方案寻优中… 共 ' + candidates.length + ' 个方案', 'loading');
    renderCompStart(candidates);
    _optimResults = [];

    var totalQty = getTotalQty();
    var qs = 'UOM=UnitMetric&placementsCreated=true&spacesCreated=true';

    var idx = 0;
    function next() {
      if (_optimCancelled || idx >= candidates.length) {
        finish();
        return;
      }
      var c = candidates[idx];
      setText('compProgressText', '计算中… ' + (idx + 1) + ' / ' + candidates.length + '  (' + c.label + ')');
      var payload = buildPayload({ maxHeight: c.maxHeight });
      fetchApiAsync('/cubemaster/api/loads?' + qs, 'POST', payload).then(function(resp) {
        var metrics = extractMetrics(resp, totalQty);
        _optimResults[idx] = metrics;
        updateCompRow(idx, c, metrics);
        $('resp1Json').value = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data, null, 2);
        idx++;
        next();
      });
    }

    function finish() {
      $('compProgress').style.display = 'none';
      setBusy(false);
      if (_optimCancelled) {
        setStatus('寻优已取消', '');
        return;
      }
      var goal = $('optimGoal') ? $('optimGoal').value : 'maxPieces';
      var bestIdx = findBest(_optimResults, goal);
      if (bestIdx >= 0) {
        var bRow = $('compRow' + bestIdx);
        if (bRow) bRow.classList.add('comp-best');
        selectCandidateResult(bestIdx);
        var bm = _optimResults[bestIdx];
        setStatus('寻优完成 ✓ 推荐方案 #' + (bestIdx + 1) + ' ' + candidates[bestIdx].label +
          ' — 总件数 ' + bm.piecesLoaded + '，体积利用率 ' + pct(bm.compoundVol || bm.volUtil), 'ok');
      } else {
        setStatus('所有方案均失败', 'error');
      }
    }

    next();
  }

  function pickItem(data) {
    if (!data) return null;
    if (data.items && data.items.length) return data.items[0];
    if (data.loadSummary) return data;
    return null;
  }

  /* ── compound volume utilization ── */
  function compoundVolPct(fc) {
    var manifest = (fc && fc.manifest) || [];
    var as = (fc && fc.actualSize) || {};
    var ctnVol = (parseFloat(as.length)||0) * (parseFloat(as.width)||0) * (parseFloat(as.height)||0);
    if (!ctnVol) return null;
    var cargoVol = 0;
    for (var k = 0; k < manifest.length; k++) {
      var ent = manifest[k], mc = ent.cargo || {};
      var qty = parseFloat(ent.cargoesLoaded != null ? ent.cargoesLoaded : mc.qty) || 0;
      cargoVol += qty * (parseFloat(mc.length)||0) * (parseFloat(mc.width)||0) * (parseFloat(mc.height)||0);
    }
    return cargoVol / ctnVol * 100;
  }

  /* ── render all results ── */
  function renderResult(data) {
    var item = pickItem(data);
    if (!item) {
      setStatus('HTTP 200 但响应中无 loadSummary 数据', 'error');
      return;
    }

    var summary    = item.loadSummary    || {};
    var containers = item.filledContainers || [];
    _lastContainers = containers;
    var fc         = containers[0]       || {};
    var fcs        = fc.loadSummary      || {};
    var doc        = item.document       || {};

    setText('mContainers', safeGet(summary,'containersLoaded'));
    var _rMode = ($('calcMode') && $('calcMode').value) || 'pallet';
    var _rVol  = (_rMode === 'pallet2ctn') ? (compoundVolPct(fc) || safeGet(fcs,'volumeUtilization')) : safeGet(fcs,'volumeUtilization');
    setText('mVolume',     pct(_rVol));
    setText('mWeight',     pct(safeGet(fcs,'weightUtilization')));
    // In pallet2ctn mode, show total product pieces from Step 1 (not pallet count from Step 2)
    if (_rMode === 'pallet2ctn' && _step1Pallets.length) {
      var _s1Pieces = 0;
      for (var _si = 0; _si < _step1Pallets.length; _si++) {
        _s1Pieces += parseInt((_step1Pallets[_si].loadSummary || {}).piecesLoaded || 0, 10);
      }
      setText('mPieces', _s1Pieces);
    } else {
      setText('mPieces', safeGet(summary,'piecesLoaded'));
    }
    setText('mDocTitle',   doc.title || '—');
    setHtml('mVolumeBar',  bar(_rVol));
    setHtml('mWeightBar',  bar(safeGet(fcs,'weightUtilization')));

    ['card-containers','card-volume','card-weight','card-pieces'].forEach(flash);

    CM.drawViz(containers[0] || null);

    if (!containers.length) {
      setHtml('containerRows','<tr><td colspan="6"><div class="empty-state">无容器数据</div></td></tr>');
    } else {
      var ch='';
      for (var i=0; i<containers.length; i++) {
        var c=containers[i], cs=c.loadSummary||{};
        var rowCls = (i===0) ? ' class="ctn-row-sel"' : '';
        var mfst = c.manifest || [];
        ch+='<tr'+rowCls+' onclick="selectContainer('+i+')">';
        ch+='<td><strong>'+e(c.name)+'</strong></td>';
        ch+='<td>'+mfst.length+'</td>';
        ch+='<td>'+e(safeGet(cs,'piecesLoaded'))+'</td>';
        ch+='<td>'+bar(cs.volumeUtilization)+' '+pct(cs.volumeUtilization)+'</td>';
        ch+='<td>'+bar(cs.weightUtilization)+' '+pct(cs.weightUtilization)+'</td>';
        ch+='<td>'+pct(cs.floorUtilization)+'</td>';
        ch+='</tr>';
      }
      setHtml('containerRows', ch);
    }

    renderManifest(containers[0] || null);
    setText('stamp', '更新时间: '+new Date().toLocaleString());
    if (containers.length) {
      selectContainer(0);
    } else if (_rMode === 'pallet2ctn' && _step1Pallets.length) {
      // Step 2 returned no containers but Step 1 pallet data is available — show pallet section
      var _ctnDetailEl2 = $('ctnDetail');
      if (_ctnDetailEl2) _ctnDetailEl2.style.display = '';
      renderPalletTable(null);
      if (_step1Pallets.length) selectPallet(0);
    }
  }

  function renderManifest(fc) {
    var manifest = (fc && fc.manifest) || [];
    if (!manifest.length) {
      setHtml('manifestRows','<tr><td colspan="9"><div class="empty-state">无清单数据</div></td></tr>');
      setHtml('manifestFoot','');
      return;
    }
    var mh='', totalW=0, totalV=0;
    for (var k=0; k<manifest.length; k++) {
      var entry= manifest[k];
      var mc   = entry.cargo || {};
      var qty  = parseFloat(entry.cargoesLoaded != null ? entry.cargoesLoaded : mc.qty) || 0;
      var wt   = parseFloat(mc.weight) || 0;
      var l    = parseFloat(mc.length) || 0;
      var w    = parseFloat(mc.width)  || 0;
      var h    = parseFloat(mc.height) || 0;
      var rowW = qty * wt;
      var rowV = qty * l * w * h / 1e9;
      totalW += rowW;
      totalV += rowV;
      var palTag= mc.isPalletized
        ? '<span class="tag tag-green">托盘</span>'
        : '<span class="tag tag-gray">普通</span>';
      mh+='<tr>';
      mh+='<td>'+(k+1)+'</td>';
      mh+='<td><strong>'+e(mc.name)+'</strong></td>';
      mh+='<td>'+e(mc.description)+'</td>';
      mh+='<td>'+e(mc.length)+'&times;'+e(mc.width)+'&times;'+e(mc.height)+'</td>';
      mh+='<td>'+e(mc.weight)+'</td>';
      mh+='<td>'+qty+'</td>';
      mh+='<td>'+rowW.toFixed(2)+'</td>';
      mh+='<td>'+rowV.toFixed(4)+'</td>';
      mh+='<td>'+palTag+'</td>';
      mh+='</tr>';
    }
    setHtml('manifestRows', mh);
    setHtml('manifestFoot',
      '<tr style="font-weight:700;background:#f0f4ff">'+
      '<td colspan="6" style="text-align:right">合计</td>'+
      '<td>'+totalW.toFixed(2)+' kg</td>'+
      '<td>'+totalV.toFixed(4)+' m³</td>'+
      '<td></td></tr>'
    );
  }

  /* ── pallet table for 先托后柜 mode ── */
  function renderPalletTable(ctnIdx) {
    var mode = ($('calcMode') && $('calcMode').value) || 'pallet';
    var pSection = $('palletDetailSection');
    if (!pSection) return;
    if (mode !== 'pallet2ctn' || !_step1Pallets.length) {
      pSection.style.display = 'none';
      return;
    }
    pSection.style.display = '';

    // Determine which pallets to display
    var indices;
    var filtered = (ctnIdx != null && _ctnPalletMap[ctnIdx] && _ctnPalletMap[ctnIdx].length);
    if (filtered) {
      indices = _ctnPalletMap[ctnIdx];
    } else {
      indices = [];
      for (var ii = 0; ii < _step1Pallets.length; ii++) indices.push(ii);
    }

    var label = $('palletCountLabel');
    if (label) {
      label.textContent = filtered
        ? '— 此柜 ' + indices.length + ' 托（共 ' + _step1Pallets.length + ' 托）'
        : '— 共 ' + _step1Pallets.length + ' 托';
    }

    var _rpPts = readPalletTypes();
    var pltTh = ((_rpPts.length && _rpPts[0]) || {}).thickness || 150;
    var html = '';
    for (var ii = 0; ii < indices.length; ii++) {
      var i   = indices[ii];
      var plt  = _step1Pallets[i];
      var ls   = plt.loadSummary || {};
      var lsz  = plt.loadSize   || plt.actualSize || {};  // loadSize for actual stacking envelope
      var mfst = plt.manifest    || [];
      var skuNames = [];
      var vol = 0;
      for (var m = 0; m < mfst.length; m++) {
        var me = mfst[m], mc = me.cargo || {};
        var nm = mc.name; if (nm && skuNames.indexOf(nm) === -1) skuNames.push(nm);
        var qty = parseFloat(me.cargoesLoaded != null ? me.cargoesLoaded : mc.qty) || 0;
        vol += qty * (parseFloat(mc.length)||0) * (parseFloat(mc.width)||0) * (parseFloat(mc.height)||0) / 1e9;
      }
      var totalH = Math.round(lsz.height || 0) + pltTh;
      var vU = ls.volumeUtilization || 0;
      var wU = ls.weightUtilization || 0;
      html += '<tr class="pallet-row" data-s1idx="' + i + '" onclick="selectPallet(' + i + ')">';
      html += '<td><strong>#' + (i + 1) + '</strong></td>';
      html += '<td>' + e(skuNames.join(', ') || plt.name || '—') + '</td>';
      html += '<td>' + (ls.piecesLoaded || 0) + '</td>';
      html += '<td>' + ((ls.weightLoaded || 0)).toFixed(1) + '</td>';
      html += '<td>' + vol.toFixed(4) + '</td>';
      html += '<td>' + (lsz.length||'—') + '×' + (lsz.width||'—') + '×' + (lsz.height||'—') +
              '<br><small style="color:var(--muted)">总高 ' + totalH + ' mm</small></td>';
      html += '<td>' + bar(vU) + ' ' + pct(vU) + '</td>';
      html += '<td>' + pct(wU) + '</td>';
      html += '</tr>';
    }
    setHtml('palletRows', html || '<tr><td colspan="8"><div class="empty-state">无数据</div></td></tr>');
  }

  function selectPallet(spaceIdx) {
    var plt = _step1Pallets[spaceIdx];
    if (!plt) return;

    var rows = document.querySelectorAll('#palletRows .pallet-row');
    for (var r = 0; r < rows.length; r++) rows[r].classList.remove('ctn-row-sel');
    // Find the row whose data-s1idx matches the original pallet index
    for (var r = 0; r < rows.length; r++) {
      if (parseInt(rows[r].getAttribute('data-s1idx'), 10) === spaceIdx) {
        rows[r].classList.add('ctn-row-sel');
        break;
      }
    }

    /* manifest: real SKUs from Step 1 pallet */
    renderManifest(plt);

    var vt = $('vizTitle');
    if (vt) vt.textContent = '3D 装载可视化 — 托盘 #' + (spaceIdx + 1) + '  ' + (plt.name || '');

    CM.drawViz(plt);

    var imgBody = $('apiImgBody');
    if (imgBody) {
      var imgs = plt.graphics && plt.graphics.images;
      var has = imgs && (imgs.path3DDiagram || imgs.pathComposite);
      if (has) {
        var iHtml = '<div class="api-img-row">';
        if (imgs.path3DDiagram) iHtml += '<img src="' + imgs.path3DDiagram + '" class="img-3d" title="3D" onclick="window.open(this.src,\'_blank\')"/>';
        if (imgs.pathComposite)  iHtml += '<img src="' + imgs.pathComposite  + '" title="合成" onclick="window.open(this.src,\'_blank\')"/>';
        iHtml += '</div>';
        imgBody.innerHTML = iHtml;
      } else {
        imgBody.innerHTML = '<div class="empty-state">暂无托盘图片</div>';
      }
    }
    setText('stamp', '更新时间: '+new Date().toLocaleString());
  }
  window.selectPallet = selectPallet;

  function showContainerViz() {
    var rows = document.querySelectorAll('#palletRows .pallet-row');
    for (var r = 0; r < rows.length; r++) rows[r].classList.remove('ctn-row-sel');
    var vt = $('vizTitle');
    if (vt) vt.textContent = CM.MODE_VIZ_TITLE['pallet2ctn'] || '3D 装载可视化';
    selectContainer(_lastSelectedCtnIdx);
  }
  window.showContainerViz = showContainerViz;

  function selectContainer(i) {
    var fc = _lastContainers[i];
    if (!fc) return;
    _lastSelectedCtnIdx = i;
    var rows = document.querySelectorAll('#containerRows tr');
    for (var r=0; r<rows.length; r++) rows[r].classList.remove('ctn-row-sel');
    if (rows[i]) rows[i].classList.add('ctn-row-sel');
    var cs = fc.loadSummary || {};
    var _sMode = ($('calcMode') && $('calcMode').value) || 'pallet';
    var _sVol  = (_sMode === 'pallet2ctn') ? (compoundVolPct(fc) || cs.volumeUtilization) : cs.volumeUtilization;
    setText('mVolume', pct(_sVol));
    setText('mWeight', pct(cs.weightUtilization));
    setHtml('mVolumeBar', bar(_sVol));
    setHtml('mWeightBar', bar(cs.weightUtilization));
    var _sVizTitle = $('vizTitle');
    if (_sVizTitle) _sVizTitle.textContent = CM.MODE_VIZ_TITLE[_sMode] || '3D 装载可视化';
    CM.drawViz(fc);
    renderManifest(fc);
    renderPalletTable(i);
    setText('stamp', '更新时间: '+new Date().toLocaleString());

    var ctnDetail = $('ctnDetail');
    ctnDetail.style.display = '';
    var imgBody = $('apiImgBody');
    var imgs = fc.graphics && fc.graphics.images;
    if (imgs) {
      var imgHtml = '<div class="api-img-row">';
      var views = [
        {key:'path3DDiagram', label:'3D'},
        {key:'path2DFront',   label:'前'},
        {key:'path2DRear',    label:'后'},
        {key:'path2DLeft',    label:'左'},
        {key:'path2DRight',   label:'右'},
        {key:'path2DTop',     label:'顶'},
        {key:'path2DBottom',  label:'底'}
      ];
      for (var vi=0; vi<views.length; vi++) {
        var v = views[vi];
        if (!imgs[v.key]) continue;
        var cls = (v.key==='path3DDiagram') ? 'img-3d' : '';
        imgHtml += '<img src="'+imgs[v.key]+'" class="'+cls+'" title="'+v.label+'" onclick="window.open(this.src,\'_blank\')" alt="'+v.label+'"/>';
      }
      imgHtml += '</div>';
      imgBody.innerHTML = imgHtml;
    } else {
      imgBody.innerHTML = '<div class="empty-state">暂无图片</div>';
    }
  }
  window.selectContainer = selectContainer;

  /* ── handle api response ── */
  function handleResponse(data, err, status) {
    setBusy(false);
    if (err) {
      setStatus('请求失败: '+err, 'error');
      $('resp1Json').value = err;
      $('wRaw').style.display='block';
      return;
    }
    $('resp1Json').value = typeof data==='string' ? data : JSON.stringify(data,null,2);
    if (status >= 400) {
      var msg = (data && data.message) ? data.message : 'HTTP '+status;
      setStatus('错误 '+status+': '+msg, 'error');
      return;
    }
    setStatus('HTTP '+status+' — 成功 ✓', 'ok');
    renderResult(data);
  }

  /* ── Excel upload / download ── */
  function parseExcelFile(file) {
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var wb = XLSX.read(ev.target.result, {type:'array'});
        var ws = wb.Sheets[wb.SheetNames[0]];
        var data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
        if (!data || data.length < 2) { alert('Excel 内容为空或格式错误'); return; }
        $('skuBody').innerHTML = '';
        var count = 0;
        for (var r=1; r<data.length; r++) {
          var row = data[r];
          var sku = String(row[0]||'').trim(); if (!sku) continue;
          addSkuRow(sku, parseFloat(row[1])||'', parseFloat(row[2])||'', parseFloat(row[3])||'', parseFloat(row[4])||'', parseInt(row[5],10)||'');
          count++;
        }
        $('excelFileInput').value = '';
        setStatus('已导入 '+count+' 行货物', 'ok');
      } catch(err) { alert('解析失败: '+err.message); }
    };
    reader.readAsArrayBuffer(file);
  }

  /* ── collapsible sections ── */
  function makeToggle(headId, wrapId) {
    $(headId).addEventListener('click', function(){
      var wrap=$(wrapId);
      var open = wrap.style.display!=='none';
      wrap.style.display = open ? 'none' : 'block';
      $(headId).innerHTML = $(headId).innerHTML.replace(/[▲▼]/g, open ? '&#9660;' : '&#9650;');
    });
  }

  /* ── init ── */
  $('btnCreate').addEventListener('click', function(){
    var mode = ($('calcMode') && $('calcMode').value) || 'pallet';
    if (mode === 'pallet2ctn') {
      runPallet2CtnCalc();
      return;
    }
    setBusy(true);
    var payload = buildPayload();
    $('req1Json').value = JSON.stringify(payload, null, 2);
    $('wRaw').style.display = 'block';
    var qs = 'UOM=UnitMetric&placementsCreated=true';
    if ($('chkGraphics') && $('chkGraphics').checked) qs += '&graphicsCreated=true&graphicsImageWidth=800&graphicsImageDepth=600';
    if ($('chkSpaces')   && $('chkSpaces').checked)   qs += '&spacesCreated=true';
    fetchApi('/cubemaster/api/loads?'+qs,'POST',payload,handleResponse);
  });

  $('btnAddSku').addEventListener('click', function(){ addSkuRow(); });

  $('ddExcel').querySelector('.dd-arrow').addEventListener('click', function(ev) {
    ev.stopPropagation();
    $('ddExcel').classList.toggle('open');
  });
  $('ddExcel').querySelector('.dd-main').addEventListener('click', function() {
    $('excelFileInput').click();
  });
  document.addEventListener('click', function(ev) {
    if (!$('ddExcel').contains(ev.target)) $('ddExcel').classList.remove('open');
  });

  $('btnDownloadTpl').addEventListener('click', function(){
    var ws = XLSX.utils.aoa_to_sheet([['SKU','L(mm)','W(mm)','H(mm)','kg','数量'],['ET3-PRO-SL',1150,260,200,33.2,24],['ET3-BK-EU',1145,250,205,34.5,24]]);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'cubemaster_template.xlsx');
  });
  $('excelFileInput').addEventListener('change', function(ev){
    var file = ev.target.files[0]; if (!file) return;
    parseExcelFile(file);
  });

  makeToggle('hContainer','wContainer');
  makeToggle('hRaw','wRaw');
  makeToggle('hComparison','wComparison');

  initPalletTypeTable();
  setCalcMode('pallet');
})();
