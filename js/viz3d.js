/* ── CubeMaster 3D 可视化 (Three.js) ── */
(function () {
  'use strict';
  var CM = window.CM = window.CM || {};
  var $ = CM.$;

  CM._3d = null;

  function init3D() {
    if (!window.THREE) return null;
    var canvas = $('vizCanvas');
    if (!canvas) return null;
    var w = canvas.clientWidth  || 800;
    var h = canvas.clientHeight || 320;
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 8000);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    var sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(120, 220, 160); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
    var fill = new THREE.DirectionalLight(0x8899ff, 0.35);
    fill.position.set(-100, 60, -100); scene.add(fill);
    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.enablePan = true; controls.minDistance = 0.5; controls.maxDistance = 2000;
    var cargoGroup = new THREE.Group();
    scene.add(cargoGroup);
    (function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); })();
    window.addEventListener('resize', function () {
      var nw = canvas.clientWidth, nh = canvas.clientHeight;
      if (nw && nh) { camera.aspect = nw/nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh, false); }
    });
    return { renderer:renderer, scene:scene, camera:camera, controls:controls, cargoGroup:cargoGroup };
  }

  function clearScene3D() {
    if (!CM._3d) return;
    var cg = CM._3d.cargoGroup;
    while (cg.children.length) cg.remove(cg.children[0]);
    ['ctnWire','ctnFront','ctnLeft','ctnRight','ctnTop','floor','palletBase','palletLegs'].forEach(function(n){
      var o = CM._3d.scene.getObjectByName(n); if (o) CM._3d.scene.remove(o);
    });
  }

  /* ── place cargo from API spaces (exact coordinates) ── */
  function placeCargoFromSpaces(spaces, baseY) {
    var S = 100;
    var gap = 0.015;
    var edgeMat = new THREE.LineBasicMaterial({color:0xffffff, transparent:true, opacity:0.20});
    for (var si = 0; si < spaces.length; si++) {
      var sp = spaces[si];
      var cargo = sp.cargo || {};
      var hexStr = (cargo.colorHexaCode || '').replace('#','');
      var col = (hexStr.length === 6) ? parseInt(hexStr, 16) : (cargo.color || CM.P3[si % CM.P3.length]);
      var placements = sp.placements || [];
      for (var pi = 0; pi < placements.length; pi++) {
        var pl = placements[pi];
        var sL = Math.max(0.02, (pl.size.length || cargo.length || 100) / S - gap);
        var sW = Math.max(0.02, (pl.size.width  || cargo.width  || 100) / S - gap);
        var sH = Math.max(0.02, (pl.size.height || cargo.height || 100) / S - gap);
        var x  = pl.pos.length / S + sL / 2 + gap / 2;
        var y  = baseY + pl.pos.height / S + sH / 2 + gap / 2;
        var z  = pl.pos.width  / S + sW / 2 + gap / 2;
        var geo = new THREE.BoxGeometry(sL, sH, sW);
        var mat = new THREE.MeshPhongMaterial({color:col, transparent:true, opacity:0.88, shininess:70});
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true; mesh.receiveShadow = true;
        CM._3d.cargoGroup.add(mesh);
        var edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
        edges.position.copy(mesh.position);
        CM._3d.cargoGroup.add(edges);
      }
    }
  }

  /* ── shared cargo placement — floor-first BLD ── */
  function placeCargo(manifest, baseY, maxL, maxW, maxH) {
    var gap = 0.06;
    var edgeMat = new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.18});

    var boxes = [];
    for (var i=0; i<manifest.length; i++) {
      var entry = manifest[i];
      var mc  = entry.cargo || {};
      var qty = Math.min(entry.cargoesLoaded != null ? entry.cargoesLoaded : (mc.qty||1), 80);
      var bL  = Math.max(0.15, (mc.length||400)/100);
      var bWd = Math.max(0.15, (mc.width ||300)/100);
      var bH  = Math.max(0.15, (mc.height||300)/100);
      var col = CM.P3[i % CM.P3.length];
      for (var q=0; q<qty; q++) boxes.push({bL:bL, bWd:bWd, bH:bH, col:col});
    }

    boxes.sort(function(a,b){ return (b.bL*b.bWd) - (a.bL*a.bWd); });

    var curX=0, curZ=0, curY=baseY;
    var rowMaxZ=0, layerMaxY=0;

    for (var k=0; k<boxes.length; k++) {
      var b = boxes[k];
      if (curX + b.bL > maxL + 0.01) {
        curX = 0; curZ += rowMaxZ + gap; rowMaxZ = 0;
      }
      if (curZ + b.bWd > maxW + 0.01) {
        curX = 0; curZ = 0; rowMaxZ = 0;
        curY += layerMaxY + gap; layerMaxY = 0;
      }
      if (curY - baseY + b.bH > maxH + 0.01) break;

      var boxGeo = new THREE.BoxGeometry(b.bL-gap, b.bH-gap, b.bWd-gap);
      var boxMat = new THREE.MeshPhongMaterial({color:b.col,transparent:true,opacity:0.88,shininess:70});
      var mesh = new THREE.Mesh(boxGeo, boxMat);
      mesh.position.set(curX+b.bL/2, curY+b.bH/2, curZ+b.bWd/2);
      mesh.castShadow=true; mesh.receiveShadow=true;
      CM._3d.cargoGroup.add(mesh);
      var edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), edgeMat);
      edges.position.copy(mesh.position);
      CM._3d.cargoGroup.add(edges);

      curX += b.bL + gap;
      if (b.bWd  > rowMaxZ)  rowMaxZ  = b.bWd;
      if (b.bH   > layerMaxY) layerMaxY = b.bH;
    }

    if (manifest.length===0) {
      var fillMesh=new THREE.Mesh(
        new THREE.BoxGeometry(maxL*0.8, maxH*0.4, maxW*0.8),
        new THREE.MeshPhongMaterial({color:0x0f766e,transparent:true,opacity:0.22})
      );
      fillMesh.position.set(maxL/2, baseY+maxH*0.2, maxW/2);
      CM._3d.cargoGroup.add(fillMesh);
    }
  }

  /* ── draw truck / container mode ── */
  function drawTruckMode(fc, cargoes) {
    var S  = 100;
    var as = fc.actualSize || {};
    var cL = (as.length || 12000) / S;
    var cW = (as.width  || 2500)  / S;
    var cH = (as.height || 2600)  / S;

    CM._3d.scene.background = new THREE.Color(0x0f172a);

    var fl = new THREE.Mesh(new THREE.PlaneGeometry(cL, cW),
      new THREE.MeshStandardMaterial({ color:0x1e293b, roughness:1 }));
    fl.name='floor'; fl.rotation.x=-Math.PI/2; fl.position.set(cL/2,0.002,cW/2); fl.receiveShadow=true;
    CM._3d.scene.add(fl);

    var ctnE = new THREE.EdgesGeometry(new THREE.BoxGeometry(cL, cH, cW));
    var ctnL = new THREE.LineSegments(ctnE, new THREE.LineBasicMaterial({color:0x94a3b8}));
    ctnL.name='ctnWire'; ctnL.position.set(cL/2, cH/2, cW/2);
    CM._3d.scene.add(ctnL);

    var wallMat = new THREE.MeshPhongMaterial({color:0x1e3a5f, transparent:true, opacity:0.18, side:THREE.DoubleSide});
    var backM = new THREE.Mesh(new THREE.PlaneGeometry(cW, cH), wallMat);
    backM.name='ctnFront'; backM.rotation.y=Math.PI/2; backM.position.set(0, cH/2, cW/2); CM._3d.scene.add(backM);
    var rightM = new THREE.Mesh(new THREE.PlaneGeometry(cL, cH), wallMat.clone());
    rightM.name='ctnRight'; rightM.position.set(cL/2, cH/2, 0); CM._3d.scene.add(rightM);
    var leftM = new THREE.Mesh(new THREE.PlaneGeometry(cL, cH), wallMat.clone());
    leftM.name='ctnLeft'; leftM.position.set(cL/2, cH/2, cW); CM._3d.scene.add(leftM);
    var topM = new THREE.Mesh(new THREE.PlaneGeometry(cL, cW), wallMat.clone());
    topM.name='ctnTop'; topM.rotation.x=Math.PI/2; topM.position.set(cL/2, cH, cW/2); CM._3d.scene.add(topM);

    if (fc.spaces && fc.spaces.length) {
      placeCargoFromSpaces(fc.spaces, 0);
    } else {
      placeCargo(cargoes, 0, cL, cW, cH);
    }

    var dist = Math.max(cL, cW, cH) * 1.85;
    CM._3d.camera.position.set(cL*0.7, cH*1.3, dist);
    CM._3d.camera.lookAt(cL/2, cH/2, cW/2);
    CM._3d.controls.target.set(cL/2, cH/2, cW/2);
    CM._3d.controls.update();
  }

  /* ── draw pallet mode ── */
  function drawPalletMode(fc, cargoes) {
    var S  = 100;
    var as = fc.actualSize || {};
    var cL = (as.length || 1200) / S;
    var cW = (as.width  || 800)  / S;
    var cH = (as.height || 1600) / S;
    var palletH = 1.5;

    CM._3d.scene.background = new THREE.Color(0x1a2035);

    var gridHelper = new THREE.GridHelper(Math.max(cL,cW)*3, 12, 0x334155, 0x1e293b);
    gridHelper.name='floor'; gridHelper.position.set(cL/2, 0, cW/2);
    CM._3d.scene.add(gridHelper);

    var deckMat = new THREE.MeshPhongMaterial({color:0x8B6914, shininess:20});
    var deckMesh = new THREE.Mesh(new THREE.BoxGeometry(cL, palletH*0.4, cW), deckMat);
    deckMesh.name='palletBase'; deckMesh.position.set(cL/2, palletH*0.8, cW/2);
    deckMesh.castShadow=true; deckMesh.receiveShadow=true;
    CM._3d.scene.add(deckMesh);

    var legMat = new THREE.MeshPhongMaterial({color:0x7a5c10, shininess:10});
    var legGroup = new THREE.Group(); legGroup.name='palletLegs';
    var legW=cL*0.28, legD=cW*0.22, legH=palletH*0.6;
    var legPosX=[cL*0.1, cL/2, cL*0.9];
    var legPosZ=[cW*0.15, cW*0.85];
    for (var lx=0; lx<3; lx++) for (var lz=0; lz<2; lz++) {
      var leg=new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legD), legMat);
      leg.position.set(legPosX[lx], legH/2, legPosZ[lz]);
      leg.castShadow=true; legGroup.add(leg);
    }
    CM._3d.scene.add(legGroup);

    var stackH = cH - palletH;
    var bndE = new THREE.EdgesGeometry(new THREE.BoxGeometry(cL, stackH, cW));
    var bndL = new THREE.LineSegments(bndE, new THREE.LineBasicMaterial({color:0x475569, transparent:true, opacity:0.5}));
    bndL.name='ctnWire'; bndL.position.set(cL/2, palletH + stackH/2, cW/2);
    CM._3d.scene.add(bndL);

    if (fc.spaces && fc.spaces.length) {
      placeCargoFromSpaces(fc.spaces, palletH);
    } else {
      placeCargo(cargoes, palletH, cL, cW, stackH);
    }

    var dist = Math.max(cL, cW) * 3.5;
    CM._3d.camera.position.set(cL/2, dist*0.9, dist*1.1);
    CM._3d.camera.lookAt(cL/2, cH/2, cW/2);
    CM._3d.controls.target.set(cL/2, cH/2, cW/2);
    CM._3d.controls.update();
  }

  /* ── 3D: pallet-then-container mode ── */
  function drawPallet2CtnMode(fc, manifest) {
    var S   = 100;
    var as  = fc.actualSize || {};
    var cL  = (as.length || 12000) / S;
    var cW  = (as.width  || 2500)  / S;
    var cH  = (as.height || 2600)  / S;

    var _vPlt = CM._activePalletSpec || {};
    var pL  = (_vPlt.length    || parseFloat($('plt_length')    ? $('plt_length').value    : 1200) || 1200) / S;
    var pW  = (_vPlt.width     || parseFloat($('plt_width')     ? $('plt_width').value     : 1000) || 1000) / S;
    var pTh = (_vPlt.thickness || parseFloat($('plt_thickness') ? $('plt_thickness').value : 150)  || 150)  / S;
    var pMH = (_vPlt.maxHeight || parseFloat($('plt_maxHeight') ? $('plt_maxHeight').value : 1800) || 1800) / S;

    CM._3d.scene.background = new THREE.Color(0x0f172a);

    var fl = new THREE.Mesh(new THREE.PlaneGeometry(cL, cW),
      new THREE.MeshStandardMaterial({color:0x1e293b, roughness:1}));
    fl.name='floor'; fl.rotation.x=-Math.PI/2; fl.position.set(cL/2,0.002,cW/2);
    fl.receiveShadow=true; CM._3d.scene.add(fl);

    var ctnLine = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(cL,cH,cW)),
      new THREE.LineBasicMaterial({color:0x94a3b8}));
    ctnLine.name='ctnWire'; ctnLine.position.set(cL/2,cH/2,cW/2);
    CM._3d.scene.add(ctnLine);
    var wm = new THREE.MeshPhongMaterial({color:0x1e3a5f,transparent:true,opacity:0.18,side:THREE.DoubleSide});
    var walls = [
      {n:'ctnFront', geo:[cW,cH], pos:[0,cH/2,cW/2],  ry:Math.PI/2},
      {n:'ctnRight', geo:[cL,cH], pos:[cL/2,cH/2,0],  ry:0},
      {n:'ctnLeft',  geo:[cL,cH], pos:[cL/2,cH/2,cW], ry:0},
      {n:'ctnTop',   geo:[cL,cW], pos:[cL/2,cH,cW/2], rx:Math.PI/2}
    ];
    walls.forEach(function(w) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w.geo[0],w.geo[1]), wm.clone());
      m.name=w.n; m.position.set(w.pos[0],w.pos[1],w.pos[2]);
      if (w.rx) m.rotation.x=w.rx; if (w.ry) m.rotation.y=w.ry;
      CM._3d.scene.add(m);
    });

    /* Use API spaces data when available (accurate placement) */
    if (fc.spaces && fc.spaces.length) {
      placeCargoFromSpaces(fc.spaces, 0);
    } else {
    /* fallback: estimation layout */

    var gapP  = 0.08;
    var numX  = Math.max(1, Math.floor((cL + gapP) / (pL + gapP)));
    var numZ  = Math.max(1, Math.floor((cW + gapP) / (pW + gapP)));
    var nPal  = numX * numZ;

    var cList = [];
    for (var k = 0; k < manifest.length; k++) {
      var ent = manifest[k], mc0 = ent.cargo || {};
      var qty = parseFloat(ent.cargoesLoaded != null ? ent.cargoesLoaded : mc0.qty) || 0;
      if (!qty) continue;
      cList.push({ mc: mc0, qty: qty, col: CM.P3[k % CM.P3.length] });
    }

    var totalEstH = 0;
    for (var ci = 0; ci < cList.length; ci++) {
      var mc1 = cList[ci].mc;
      var uL  = Math.max(0.1, (parseFloat(mc1.length)||600)/S);
      var uW  = Math.max(0.1, (parseFloat(mc1.width) ||400)/S);
      var uH  = Math.max(0.1, (parseFloat(mc1.height)||300)/S);
      var cols = Math.max(1, Math.floor(pL/uL));
      var deps = Math.max(1, Math.floor(pW/uW));
      var qtyPerPal = cList[ci].qty / nPal;
      var layers    = Math.max(1, Math.ceil(qtyPerPal / (cols * deps)));
      totalEstH += uH * layers;
    }
    var maxSH = Math.max(0.01, pMH - pTh);
    var scale = (totalEstH > maxSH && totalEstH > 0) ? maxSH / totalEstH : 1.0;

    var deckMat = new THREE.MeshPhongMaterial({color:0x8B6914, shininess:25});
    var legMat  = new THREE.MeshPhongMaterial({color:0x6b4d10, shininess:10});

    for (var pi = 0; pi < nPal; pi++) {
      var ix = pi % numX;
      var iz = Math.floor(pi / numX);
      var px = ix * (pL + gapP);
      var pz = iz * (pW + gapP);

      var deck = new THREE.Mesh(new THREE.BoxGeometry(pL, pTh, pW), deckMat.clone());
      deck.position.set(px+pL/2, pTh/2, pz+pW/2);
      deck.castShadow=true; deck.receiveShadow=true; CM._3d.cargoGroup.add(deck);

      var beamH=pTh*0.55, beamD=pW*0.22;
      for (var b=0; b<3; b++) {
        var beam = new THREE.Mesh(new THREE.BoxGeometry(pL*0.25,beamH,beamD), legMat.clone());
        beam.position.set(px+pL*(b*0.37+0.12), -beamH/2, pz+pW/2);
        CM._3d.cargoGroup.add(beam);
      }

      var curY  = pTh;
      var usedH = 0;
      for (var ci2 = 0; ci2 < cList.length; ci2++) {
        var cargo = cList[ci2], mc2 = cargo.mc;
        var uL2   = Math.max(0.1, (parseFloat(mc2.length)||600)/S);
        var uW2   = Math.max(0.1, (parseFloat(mc2.width) ||400)/S);
        var uH2   = Math.max(0.1, (parseFloat(mc2.height)||300)/S);
        var cols2 = Math.max(1, Math.floor(pL/uL2));
        var deps2 = Math.max(1, Math.floor(pW/uW2));
        var qtyPal2  = cargo.qty / nPal;
        var layers2  = Math.max(1, Math.ceil(qtyPal2 / (cols2 * deps2)));
        var blockH   = uH2 * layers2 * scale;
        blockH = Math.max(0.01, Math.min(blockH, maxSH - usedH));
        if (blockH < 0.01) continue;

        var cGeo = new THREE.BoxGeometry(pL*0.92, blockH, pW*0.92);
        var cMat = new THREE.MeshPhongMaterial({color:cargo.col, transparent:true, opacity:0.85, shininess:60});
        var cMesh = new THREE.Mesh(cGeo, cMat);
        cMesh.position.set(px+pL/2, curY+blockH/2, pz+pW/2);
        cMesh.castShadow=true; CM._3d.cargoGroup.add(cMesh);
        var eL = new THREE.LineSegments(new THREE.EdgesGeometry(cGeo),
          new THREE.LineBasicMaterial({color:0xffffff, transparent:true, opacity:0.15}));
        eL.position.copy(cMesh.position); CM._3d.cargoGroup.add(eL);
        curY  += blockH;
        usedH += blockH;
      }
    }
    } /* end fallback else */

    var dist = Math.max(cL,cW,cH)*1.85;
    CM._3d.camera.position.set(cL*0.7, cH*1.3, dist);
    CM._3d.camera.lookAt(cL/2, cH/2, cW/2);
    CM._3d.controls.target.set(cL/2, cH/2, cW/2);
    CM._3d.controls.update();
  }

  /* ── draw single pallet space (先托后柜 pallet detail view) ── */
  function drawSinglePalletSpace(space, palletSpec) {
    var S   = 100;
    var pL  = (palletSpec.length    || 1200) / S;
    var pW  = (palletSpec.width     || 1000) / S;
    var pTh = (palletSpec.thickness || 150)  / S;
    var pMH = (palletSpec.maxHeight || 1800) / S;

    /* offset: re-zero placements to pallet-local coordinates */
    var offL = (space.pos && space.pos.length) || 0;
    var offW = (space.pos && space.pos.width)  || 0;
    var offH = (space.pos && space.pos.height) || 0;

    var srcPlacements = space.placements || [];
    var adjusted = [];
    for (var i = 0; i < srcPlacements.length; i++) {
      var pl = srcPlacements[i];
      adjusted.push({
        pos: {
          length: pl.pos.length - offL,
          width:  pl.pos.width  - offW,
          height: pl.pos.height - offH
        },
        size: pl.size
      });
    }

    /* virtual fc compatible with drawPalletMode */
    var virtualFc = {
      actualSize: {
        length: palletSpec.length,
        width:  palletSpec.width,
        height: palletSpec.maxHeight + palletSpec.thickness
      },
      spaces: [{ cargo: space.cargo, placements: adjusted }],
      manifest: []
    };

    drawPalletMode(virtualFc, []);
  }

  /* ── entry point: draw a single pallet space ── */
  CM.drawPalletSpaceViz = function (space, palletSpec) {
    if (!window.THREE) return;
    if (!space) return;
    if (!CM._3d) CM._3d = init3D();
    if (!CM._3d) return;
    clearScene3D();
    drawSinglePalletSpace(space, palletSpec);
  };

  /* ── main drawViz entry point ── */
  CM.drawViz = function (fc) {
    if (!window.THREE) return;
    if (!fc) return;
    if (!CM._3d) CM._3d = init3D();
    if (!CM._3d) return;
    clearScene3D();

    var manifest = fc.manifest || [];
    var mode = ($('calcMode') && $('calcMode').value) || 'pallet';
    var cat  = $('containerCategory') ? $('containerCategory').value : 'Pallet';

    if (mode === 'pallet2ctn') {
      drawPallet2CtnMode(fc, manifest);
    } else if (mode === 'pallet' || cat === 'Pallet') {
      drawPalletMode(fc, manifest);
    } else {
      drawTruckMode(fc, manifest);
    }
  };
})();
