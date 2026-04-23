/* ── CubeMaster 配置与常量 ── */
window.CM = window.CM || {};

CM.PALETTE = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#6366f1'];
CM.P3 = [0x3b82f6,0x10b981,0xf59e0b,0xef4444,0x8b5cf6,0xec4899,0x06b6d4,0x84cc16,0xf97316,0x6366f1];

var SHARED_CONTAINER_PRESETS = [
  {name:'40HQ',  length:12032, width:2350, height:2694, maxWeight:26480, empty:3900, vtype:'Dry'},
  {name:'40GP',  length:12032, width:2350, height:2395, maxWeight:26680, empty:3750, vtype:'Dry'},
  {name:'20GP',  length:5898,  width:2352, height:2393, maxWeight:21770, empty:2230, vtype:'Dry'}
];

/* ── container presets ── */
CM.PRESETS = {
  'Truck': [
    {name:'53FT-DryVan',   length:16154, width:2489, height:2794, maxWeight:30000, empty:0,    vtype:'Dry'},
    {name:'48FT-DryVan',   length:14630, width:2489, height:2794, maxWeight:30000, empty:0,    vtype:'Dry'},
    {name:'26FT-BoxTruck', length:7925,  width:2235, height:2235, maxWeight:8000,  empty:0,    vtype:'Dry'}
  ],
  'Container': SHARED_CONTAINER_PRESETS.slice(),
  'Pallet': [
    {name:'Standard-Pallet-1200x800', length:1220, width:820, height:1800, maxWeight:900, empty:25, vtype:'Dry'}
  ].concat(SHARED_CONTAINER_PRESETS.map(function (preset) {
    return {
      name: preset.name,
      length: preset.length,
      width: preset.width,
      height: preset.height,
      maxWeight: preset.maxWeight,
      empty: preset.empty,
      vtype: preset.vtype
    };
  }))
};

/* ── pallet presets for 先托后柜 ──
 *  maxLength / maxWidth = 允许货物外廓（含超托）的最大限制，≥ 托盘底面尺寸
 *  maxHeight             = 含托盘板厚的总堆高上限（板厚已在内，API 内部会扣除）
 * ── */
CM.PALLET_PRESETS = [
  {name:'1200×1000 (欧标大)', length:1200, width:1000, maxLength:1240, maxWidth:1040, maxHeight:1800, maxWeight:1000, thickness:150, empty:25},
  {name:'1100×1100 (方托)',   length:1100, width:1100, maxLength:1200, maxWidth:1160, maxHeight:1800, maxWeight:1000, thickness:150, empty:25},
  {name:'1100×1000',          length:1100, width:1000, maxLength:1160, maxWidth:1040, maxHeight:1800, maxWeight:1000, thickness:150, empty:25},
  {name:'1300×800',           length:1300, width:800,  maxLength:1340, maxWidth:840,  maxHeight:1800, maxWeight:1000, thickness:150, empty:25},
  {name:'1400×1000',          length:1400, width:1000, maxLength:1440, maxWidth:1040, maxHeight:1800, maxWeight:1000, thickness:150, empty:25},
  {name:'1200×800 (欧标)',    length:1200, width:800,  maxLength:1240, maxWidth:840,  maxHeight:1800, maxWeight:900,  thickness:150, empty:25}
];

/* ── mode info texts ── */
CM.MODE_INFO = {
  'pallet':     '&#x1F4E6; <b>托盘装载</b>：货物直接装入托盘，托盘即容器。设定托盘尺寸与承重。',
  'direct':     '&#x1F69A; <b>直装柜</b>：货物直接装入货车或集装箱，无托盘中转。选择外部容器类型与型号。',
  'pallet2ctn': '&#x1F4E6;&#x279C;&#x1F69A; <b>先托后柜</b>：货物先按内层托盘规格码垛，再将托盘装入外部容器。需分别设置托盘与容器尺寸。'
};

CM.MODE_CTN_TITLE = {
  'pallet':     '\ud83d\udce6 托盘规格',
  'direct':     '\ud83d\ude9a 容器规格',
  'pallet2ctn': '\ud83d\ude9a 外柜规格'
};

CM.MODE_VIZ_TITLE = {
  'pallet':     '3D 装载可视化 — 托盘装载',
  'direct':     '3D 装载可视化 — 直装柜',
  'pallet2ctn': '3D 装载可视化 — 先托后柜'
};

/* ── per-mode SKU defaults ── */
CM.SKU_DEFAULTS = {
  'pallet': [
    {name:'ET3-PRO-SL',   l:'1150', w:'260', h:'200', weight:'33.2', qty:'24', orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0', ovhW:'0', opt:false, pal:false},
    {name:'ET3T-WH-1-EU', l:'810',  w:'375', h:'195', weight:'30',   qty:'1',  orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0', ovhW:'0', opt:false, pal:false},
    {name:'ET3T-WH-2-EU', l:'830',  w:'185', h:'175', weight:'21.3', qty:'1',  orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0', ovhW:'0', opt:false, pal:false},
    {name:'ET3-BK-EU',    l:'1145', w:'250', h:'205', weight:'34.5', qty:'24', orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0', ovhW:'0', opt:false, pal:false},
    {name:'ET3T-BK-1-EU', l:'810',  w:'375', h:'195', weight:'30',   qty:'11', orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0', ovhW:'0', opt:false, pal:false},
    {name:'ET3T-BK-2-EU', l:'830',  w:'185', h:'175', weight:'21.3', qty:'11', orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0', ovhW:'0', opt:false, pal:false}
  ],
  'direct': [
    {name:'CartonA', l:'600', w:'400', h:'300', weight:'15', qty:'100', orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0', ovhW:'0', opt:false, pal:false},
    {name:'CartonB', l:'500', w:'350', h:'250', weight:'12', qty:'80',  orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0', ovhW:'0', opt:false, pal:false}
  ],
  'pallet2ctn': [
    // overhang=true + ovhL=60: 长1145mm的箱在1100mm托盘上允许在长度方向超托60mm
    {name:'ET223H-W-1/W-2',          l:'1145', w:'310', h:'190', weight:'29.2', qty:'106', orient:'OrientationsAll', maxL:'0', overhang:true,  ovhL:'60', ovhW:'0', opt:false, pal:false},
    {name:'ET223H-W-3(CMP025-01M)',   l:'628',  w:'224', h:'140', weight:'8.7',  qty:'53',  orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0',  ovhW:'0', opt:false, pal:false},
    {name:'ET223H-B-1/B-2',          l:'1145', w:'310', h:'190', weight:'29.2', qty:'60',  orient:'OrientationsAll', maxL:'0', overhang:true,  ovhL:'60', ovhW:'0', opt:false, pal:false},
    {name:'ET223H-B-3(CMP025-01M)',   l:'628',  w:'224', h:'140', weight:'8.7',  qty:'30',  orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0',  ovhW:'0', opt:false, pal:false},
    {name:'ET223-BZ-W',               l:'1145', w:'250', h:'205', weight:'36.8', qty:'30',  orient:'OrientationsAll', maxL:'0', overhang:true,  ovhL:'60', ovhW:'0', opt:false, pal:false},
    {name:'ET223-BZ-B',               l:'1145', w:'250', h:'205', weight:'36.8', qty:'20',  orient:'OrientationsAll', maxL:'0', overhang:true,  ovhL:'60', ovhW:'0', opt:false, pal:false},
    {name:'CMP017-W',                 l:'430',  w:'430', h:'530', weight:'10.2', qty:'30',  orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0',  ovhW:'0', opt:false, pal:false},
    {name:'CMP017-B',                 l:'430',  w:'430', h:'530', weight:'10.2', qty:'10',  orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0',  ovhW:'0', opt:false, pal:false},
    {name:'ET227H-B-4/W-4',           l:'465',  w:'345', h:'205', weight:'20.1', qty:'30',  orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0',  ovhW:'0', opt:false, pal:false},
    {name:'ET227feet/ET223-BZfeet',   l:'688',  w:'122', h:'100', weight:'7.1',  qty:'40',  orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0',  ovhW:'0', opt:false, pal:false},
    {name:'ET223Y',                   l:'985',  w:'275', h:'210', weight:'30.5', qty:'3',   orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0',  ovhW:'0', opt:false, pal:false},
    {name:'CMP023-01',                l:'875',  w:'245', h:'475', weight:'24.6', qty:'1',   orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0',  ovhW:'0', opt:false, pal:false},
    {name:'CMP025-03M',               l:'620',  w:'330', h:'127', weight:'12',   qty:'1',   orient:'OrientationsAll', maxL:'0', overhang:false, ovhL:'0',  ovhW:'0', opt:false, pal:false}
  ]
};
