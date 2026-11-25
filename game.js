// SPDX-License-Identifier: MIT
// PRISM RICOCHET — Deterministic 9:16 One-Thumb Physics Ricochet & Merge Roguelite Engine.
// Zero network dependencies, pure seeded PRNG, zero wall-clock drift in simulation.
(function (global) {
  'use strict';

  var W = 390;
  var H = 844;
  var BOUNDS = { left: 14, right: 376, top: 92, dangerY: 684, floorY: 746 };
  var LAUNCHER_Y = 724;

  var COLS = 7;
  var CELL_W = 48;
  var CELL_H = 44;
  var GAP = 3;
  var GRID_X = 18;
  var GRID_TOP = 104;
  var STEP_X = CELL_W + GAP;
  var STEP_Y = CELL_H + GAP;

  var ORB_SPEED = 640;
  var MAX_ACTIVE_ORBS = 44;
  var SUBSTEPS = 4;
  var FIRE_INTERVAL_TICKS = 4;
  var MAX_VOLLEY_SEC = 8.5;

  var UPGRADE_CATALOG = [
    { id: 'split', name: 'Split Shot', tag: 'VOLLEY', desc: '+2 volley orbs & twin fan angles', accent: '#38e8ff' },
    { id: 'gravity', name: 'Gravity Well', tag: 'CONTROL', desc: 'First hit spawns an orbital vortex', accent: '#b77dff' },
    { id: 'lightning', name: 'Chain Arc', tag: 'CHAIN', desc: 'Every 3rd bounce zaps nearby foes', accent: '#ffe14d' },
    { id: 'magnet', name: 'Prism Magnet', tag: 'MERGE', desc: 'Pulls Prism Cores & fuses orbs', accent: '#ff70c8' },
    { id: 'shield', name: 'Aegis Barrier', tag: 'DEFENSE', desc: 'Floor shield bounces falling orbs', accent: '#4dff9b' },
    { id: 'nova', name: 'Nova Shatter', tag: 'BLAST', desc: 'Broken blocks shockwave neighbors', accent: '#ff7b3b' },
    { id: 'overclock', name: 'Overclock', tag: 'POWER', desc: '+1 base orb damage & merge score', accent: '#ff5268' },
    { id: 'cryo', name: 'Cryo Fracture', tag: 'CONTROL', desc: '+2 dmg vs heavy tiles & slower ramp', accent: '#75c4ff' }
  ];

  var TIER_COLORS = ['', '#47ecff', '#ffd24d', '#ff64c4', '#ffffff'];

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function distSq(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return dx * dx + dy * dy;
  }

  function colX(col) {
    return GRID_X + col * STEP_X;
  }

  function rowY(row) {
    return GRID_TOP + row * STEP_Y;
  }

  var rendererFn = null;
  var interactiveMode = true;
  var S = null;

  function createFreshState(seed) {
    var s = (seed === undefined || seed === null ? 42 : seed) >>> 0;
    var st = {
      seed: s,
      rng: mulberry32(s),
      nextId: 1,
      tick: 0,
      phase: 'aim',
      wave: 1,
      score: 0,
      combo: 0,
      bestCombo: 0,
      maxComboThisVolley: 0,
      game_over: false,
      awaiting_revive: false,
      revivesLeft: 1,
      launcherX: W * 0.5,
      launcherY: LAUNCHER_Y,
      nextLauncherX: null,
      aimAngle: -Math.PI * 0.5,
      aiming: false,
      prevDown: false,
      aimRay: [],
      orbCount: 5,
      baseDmg: 1,
      orbsToFire: 0,
      fireCooldown: 0,
      volleyElapsed: 0,
      volleyHits: 0,
      wellSpawnedThisVolley: false,
      shieldBounces: 0,
      shieldMax: 0,
      blocks: [],
      orbs: [],
      pickups: [],
      wells: [],
      particles: [],
      floaters: [],
      rings: [],
      arcs: [],
      shake: { x: 0, y: 0, mag: 0 },
      hitStop: 0,
      upgrades: {
        split: 0,
        gravity: 0,
        lightning: 0,
        magnet: 0,
        shield: 0,
        nova: 0,
        overclock: 0,
        cryo: 0
      },
      upgradeChoices: [],
      events: []
    };
    return st;
  }

  function emit(st, type, combo, tier, power) {
    if (st.events.length < 32) {
      st.events.push({
        type: type,
        combo: combo || 0,
        tier: tier || 1,
        power: power || 1
      });
    }
  }

  function addShake(st, amount) {
    st.shake.mag = Math.min(14, Math.max(st.shake.mag, amount));
  }

  function addRing(st, x, y, maxR, color, life) {
    if (st.rings.length >= 24) st.rings.shift();
    st.rings.push({ x: x, y: y, r: 6, maxR: maxR, color: color, life: life || 0.32, maxLife: life || 0.32 });
  }

  function addFloater(st, x, y, text, color, scale) {
    if (st.floaters.length >= 28) st.floaters.shift();
    st.floaters.push({
      x: clamp(x, BOUNDS.left + 26, BOUNDS.right - 26),
      y: y,
      vy: -54,
      text: text,
      color: color || '#ffffff',
      scale: scale || 1,
      life: 0.68,
      maxLife: 0.68
    });
  }

  function spawnParticles(st, x, y, color, count, speed) {
    var sp = speed || 150;
    for (var i = 0; i < count; i++) {
      if (st.particles.length >= 140) st.particles.shift();
      var ang = st.rng() * Math.PI * 2;
      var mag = sp * (0.35 + st.rng() * 0.85);
      var life = 0.24 + st.rng() * 0.32;
      st.particles.push({
        x: x,
        y: y,
        vx: Math.cos(ang) * mag,
        vy: Math.sin(ang) * mag,
        r: 1.8 + st.rng() * 2.8,
        color: color,
        life: life,
        maxLife: life
      });
    }
  }

  function spawnWaveRow(st, rowIndex, waveNum, forceOpening) {
    var cryoScale = Math.max(0.76, 1 - st.upgrades.cryo * 0.06);
    var baseHp = Math.max(2, Math.round((1.5 + waveNum * 1.9 + Math.pow(waveNum, 1.32) * 0.55) * cryoScale));
    var isBossWave = waveNum >= 5 && waveNum % 5 === 0;
    var count = forceOpening ? 5 : clamp(3 + Math.floor(waveNum * 0.35), 3, 6);
    var cols = [0, 1, 2, 3, 4, 5, 6];
    for (var i = cols.length - 1; i > 0; i--) {
      var j = Math.floor(st.rng() * (i + 1));
      var tmp = cols[i];
      cols[i] = cols[j];
      cols[j] = tmp;
    }

    var placedBomb = false;
    var placedPrism = false;
    var used = {};
    for (var k = 0; k < count; k++) {
      var c = cols[k];
      used[c] = true;
      var kind = 'normal';
      var hp = Math.max(2, Math.round(baseHp * (0.75 + st.rng() * 0.5)));

      if (forceOpening && rowIndex === 1 && !placedBomb && (c === 3 || k === 1)) {
        kind = 'bomb';
        hp = Math.max(2, Math.round(baseHp * 0.85));
        placedBomb = true;
      } else if (forceOpening && rowIndex === 2 && !placedPrism && k === 0) {
        kind = 'prism';
        hp = Math.max(2, Math.round(baseHp * 0.8));
        placedPrism = true;
      } else if (!forceOpening) {
        var roll = st.rng();
        if (isBossWave && k === 0) {
          kind = 'armored';
          hp = Math.round(baseHp * 2.2);
        } else if (!placedBomb && roll < 0.14) {
          kind = 'bomb';
          hp = Math.max(2, Math.round(baseHp * 0.8));
          placedBomb = true;
        } else if (!placedPrism && roll >= 0.14 && roll < 0.27) {
          kind = 'prism';
          hp = Math.max(2, Math.round(baseHp * 0.85));
          placedPrism = true;
        } else if (waveNum >= 4 && roll >= 0.27 && roll < 0.41) {
          kind = 'armored';
          hp = Math.round(baseHp * 1.55);
        }
      }

      st.blocks.push({
        id: st.nextId++,
        row: rowIndex,
        col: c,
        x: colX(c),
        y: rowY(rowIndex),
        w: CELL_W,
        h: CELL_H,
        hp: hp,
        maxHp: hp,
        kind: kind,
        flash: 0
      });
    }

    // Spawn 1-2 pickups (Prism Merge Core or +1 Ammo) in empty columns
    var emptyCols = [];
    for (var ec = 0; ec < COLS; ec++) {
      if (!used[ec]) emptyCols.push(ec);
    }
    if (emptyCols.length > 0) {
      var pCol = emptyCols[Math.floor(st.rng() * emptyCols.length)];
      var pKind = (forceOpening && rowIndex === 2) || st.rng() < 0.58 ? 'prism' : 'ammo';
      st.pickups.push({
        id: st.nextId++,
        row: rowIndex,
        col: pCol,
        x: colX(pCol) + CELL_W * 0.5,
        y: rowY(rowIndex) + CELL_H * 0.5,
        r: pKind === 'prism' ? 12 : 10,
        kind: pKind,
        tier: pKind === 'prism' ? (waveNum >= 6 && st.rng() < 0.35 ? 2 : 1) : 1,
        pulse: st.rng() * Math.PI * 2
      });
    }
  }

  function populateOpeningBoard(st) {
    // Immediate 3-row engaging layout so shot 1 has rich ricochet + bomb + merge opportunities
    spawnWaveRow(st, 0, 1, true);
    spawnWaveRow(st, 1, 1, true);
    spawnWaveRow(st, 2, 1, true);
    // Guarantee an easily hittable center-lane Prism Merge Core at row 4 for instant <1.5s hook
    st.pickups.push({
      id: st.nextId++,
      row: 4,
      col: 3,
      x: colX(3) + CELL_W * 0.5,
      y: rowY(4) + CELL_H * 0.5,
      r: 13,
      kind: 'prism',
      tier: 1,
      pulse: 0
    });
  }

  function computeAimAngle(st, rawX, rawY) {
    var nx = rawX > 1 ? rawX / W : rawX;
    var ny = rawY > 1 ? rawY / H : rawY;
    var px = clamp(nx, 0, 1) * W;
    var py = clamp(ny, 0, 1) * H;
    var dx = px - st.launcherX;
    var dy = py - st.launcherY;
    // If thumb drags below launcher, treat intuitively as slingshot pull-back
    if (dy > 14) {
      dx = -dx;
      dy = -dy;
    }
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      dx = 0;
      dy = -1;
    }
    var ang = Math.atan2(dy, dx);
    // Clamp strictly upward (-166 deg .. -14 deg)
    var minAng = -Math.PI + 0.24;
    var maxAng = -0.24;
    if (ang > 0) {
      ang = dx < 0 ? minAng : maxAng;
    } else {
      ang = clamp(ang, minAng, maxAng);
    }
    return ang;
  }

  function computeAimRay(st) {
    var ox = st.launcherX;
    var oy = st.launcherY;
    var dx = Math.cos(st.aimAngle);
    var dy = Math.sin(st.aimAngle);
    var pts = [{ x: ox, y: oy }];
    var r = 6;
    var maxDist = 720;
    var step = 6;
    var cx = ox;
    var cy = oy;
    var bounced = false;

    for (var d = 0; d < maxDist; d += step) {
      cx += dx * step;
      cy += dy * step;
      var hitNormX = 0;
      var hitNormY = 0;

      if (cx - r <= BOUNDS.left) {
        cx = BOUNDS.left + r;
        hitNormX = 1;
      } else if (cx + r >= BOUNDS.right) {
        cx = BOUNDS.right - r;
        hitNormX = -1;
      } else if (cy - r <= BOUNDS.top) {
        cy = BOUNDS.top + r;
        hitNormY = 1;
      } else {
        for (var i = 0; i < st.blocks.length; i++) {
          var b = st.blocks[i];
          var nearX = clamp(cx, b.x, b.x + b.w);
          var nearY = clamp(cy, b.y, b.y + b.h);
          var rx = cx - nearX;
          var ry = cy - nearY;
          if (rx * rx + ry * ry <= r * r) {
            if (Math.abs(rx) > Math.abs(ry)) hitNormX = rx >= 0 ? 1 : -1;
            else hitNormY = ry >= 0 ? 1 : -1;
            break;
          }
        }
      }

      if (hitNormX !== 0 || hitNormY !== 0) {
        pts.push({ x: cx, y: cy });
        if (!bounced) {
          bounced = true;
          if (hitNormX !== 0) dx = -dx;
          if (hitNormY !== 0) dy = -dy;
          maxDist = d + 170;
        } else {
          break;
        }
      }
    }
    if (pts.length === 1 || (bounced && pts.length === 2)) {
      pts.push({ x: cx, y: cy });
    }
    return pts;
  }

  function orbDamageFor(st, tier) {
    var mult = tier === 1 ? 1 : tier === 2 ? 2 : tier === 3 ? 4 : 8;
    return (st.baseDmg + st.upgrades.overclock) * mult;
  }

  function spawnOrb(st, x, y, angle, tier, speedScale) {
    if (st.orbs.length >= MAX_ACTIVE_ORBS) return null;
    var t = clamp(tier || 1, 1, 4);
    var spd = ORB_SPEED * (speedScale || 1);
    var o = {
      id: st.nextId++,
      x: x,
      y: y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      r: 5.5 + (t - 1) * 1.6,
      tier: t,
      dmg: orbDamageFor(st, t),
      bounces: 0,
      age: 0,
      trail: [{ x: x, y: y }]
    };
    st.orbs.push(o);
    return o;
  }

  function startVolley(st) {
    st.phase = 'firing';
    st.aiming = false;
    st.aimRay = [];
    st.combo = 0;
    st.maxComboThisVolley = 0;
    st.volleyElapsed = 0;
    st.volleyHits = 0;
    st.wellSpawnedThisVolley = false;
    st.nextLauncherX = null;
    st.shieldMax = st.upgrades.shield > 0 ? 1 + st.upgrades.shield : 0;
    st.shieldBounces = st.shieldMax;
    st.orbsToFire = st.orbCount + st.upgrades.split * 2;
    st.fireCooldown = 0;
    emit(st, 'launch', 0, 1, 1);
    // Fire first orb immediately on launch tick for instant visual feedback
    fireNextVolleyOrb(st);
  }

  function fireNextVolleyOrb(st) {
    if (st.orbsToFire <= 0) return;
    st.orbsToFire -= 1;
    st.fireCooldown = FIRE_INTERVAL_TICKS;
    var spread = 0;
    if (st.upgrades.split > 0) {
      var parity = st.orbsToFire % 3;
      if (parity === 1) spread = -0.055;
      else if (parity === 2) spread = 0.055;
    }
    var ang = clamp(st.aimAngle + spread, -Math.PI + 0.2, -0.2);
    spawnOrb(st, st.launcherX, st.launcherY, ang, 1, 1);
  }

  function damageBlock(st, block, dmg, sourceOrb, chainDepth) {
    if (!block || block.hp <= 0) return;
    var bonus = 0;
    if (st.upgrades.cryo > 0 && (block.kind === 'armored' || block.hp >= 10)) {
      bonus = st.upgrades.cryo * 2;
    }
    var totalDmg = Math.max(1, Math.round(dmg + bonus));
    block.hp -= totalDmg;
    block.flash = 1;

    st.combo += 1;
    if (st.combo > st.maxComboThisVolley) st.maxComboThisVolley = st.combo;
    if (st.combo > st.bestCombo) st.bestCombo = st.combo;
    st.volleyHits += 1;

    var bx = block.x + block.w * 0.5;
    var by = block.y + block.h * 0.5;
    var comboMult = 1 + Math.min(3.5, Math.floor(st.combo / 4) * 0.25);
    var pts = Math.round(totalDmg * 10 * comboMult);
    st.score += pts;

    var dmgColor = block.kind === 'bomb' ? '#ff934f' : block.kind === 'prism' ? '#ff7ae2' : '#eef8ff';
    addFloater(st, bx + (st.rng() - 0.5) * 14, by - 8, '-' + totalDmg, dmgColor, totalDmg >= 4 ? 1.15 : 0.92);
    spawnParticles(st, bx, by, dmgColor, 4, 120);
    emit(st, 'hit', st.combo, sourceOrb ? sourceOrb.tier : 1, totalDmg);

    // Gravity Well upgrade: first block impact spawns vortex
    if (st.upgrades.gravity > 0 && !st.wellSpawnedThisVolley && sourceOrb) {
      st.wellSpawnedThisVolley = true;
      st.wells.push({
        x: bx,
        y: clamp(by + 36, BOUNDS.top + 40, BOUNDS.dangerY - 40),
        r: 72 + st.upgrades.gravity * 16,
        life: 3.2 + st.upgrades.gravity * 0.7,
        maxLife: 3.2 + st.upgrades.gravity * 0.7
      });
      addRing(st, bx, by + 36, 78, '#b77dff', 0.4);
    }

    // Splitter prism block spawns an extra angled orb on direct orb hit
    if (block.kind === 'prism' && sourceOrb && chainDepth === 0 && st.orbs.length < MAX_ACTIVE_ORBS) {
      var baseAng = Math.atan2(sourceOrb.vy, sourceOrb.vx);
      var splitAng = baseAng + (st.rng() < 0.5 ? 0.42 : -0.42);
      spawnOrb(st, bx, by, splitAng, Math.min(4, sourceOrb.tier), 0.96);
      addRing(st, bx, by, 34, '#ff7ae2', 0.25);
    }

    // Chain Lightning upgrade: every 3rd direct hit arcs to nearest blocks
    if (st.upgrades.lightning > 0 && chainDepth === 0 && st.volleyHits % 3 === 0) {
      var targets = [];
      for (var ti = 0; ti < st.blocks.length; ti++) {
        var tb = st.blocks[ti];
        if (tb.id !== block.id && tb.hp > 0) {
          targets.push({ b: tb, d2: distSq(bx, by, tb.x + tb.w * 0.5, tb.y + tb.h * 0.5) });
        }
      }
      targets.sort(function (a, b) { return a.d2 - b.d2 || a.b.id - b.b.id; });
      var arcCount = Math.min(targets.length, 1 + st.upgrades.lightning);
      var arcDmg = Math.max(1, Math.ceil((st.baseDmg + st.upgrades.overclock) * 1.25));
      for (var ai = 0; ai < arcCount; ai++) {
        var tBlock = targets[ai].b;
        st.arcs.push({
          x1: bx,
          y1: by,
          x2: tBlock.x + tBlock.w * 0.5,
          y2: tBlock.y + tBlock.h * 0.5,
          color: '#ffe14d',
          life: 0.18,
          maxLife: 0.18
        });
        damageBlock(st, tBlock, arcDmg, null, 1);
      }
      if (arcCount > 0) emit(st, 'lightning', st.combo, 1, arcCount);
    }

    if (block.hp <= 0) {
      onBlockShatter(st, block, chainDepth);
    }
  }

  function onBlockShatter(st, block, chainDepth) {
    var bx = block.x + block.w * 0.5;
    var by = block.y + block.h * 0.5;
    var bonusPts = (block.kind === 'armored' ? 80 : block.kind === 'bomb' ? 65 : 35) * st.wave;
    st.score += bonusPts;
    var col = block.kind === 'bomb' ? '#ff7b3b' : block.kind === 'prism' ? '#ff70c8' : block.kind === 'armored' ? '#ffd24d' : '#47ecff';
    spawnParticles(st, bx, by, col, block.kind === 'bomb' ? 18 : 11, block.kind === 'bomb' ? 240 : 185);
    addRing(st, bx, by, block.kind === 'bomb' ? 92 : 42, col, block.kind === 'bomb' ? 0.38 : 0.24);
    addShake(st, block.kind === 'bomb' ? 8.5 : 3.8);
    st.hitStop = Math.max(st.hitStop, block.kind === 'bomb' ? 2 : 1);
    emit(st, block.kind === 'bomb' ? 'bomb' : 'shatter', st.combo, 1, block.maxHp);

    if (st.combo >= 5 && st.combo % 5 === 0) {
      addFloater(st, bx, by - 22, st.combo + 'x CHAIN!', '#ffe14d', 1.25);
    }

    // Bomb block AoE chain explosion
    if (block.kind === 'bomb' && chainDepth < 3) {
      var blastR2 = (CELL_W * 1.85) * (CELL_W * 1.85);
      var blastDmg = Math.max(4, st.wave * 2 + 4);
      addFloater(st, bx, by - 16, 'BOOM!', '#ff934f', 1.3);
      for (var i = 0; i < st.blocks.length; i++) {
        var nb = st.blocks[i];
        if (nb.id !== block.id && nb.hp > 0) {
          if (distSq(bx, by, nb.x + nb.w * 0.5, nb.y + nb.h * 0.5) <= blastR2) {
            damageBlock(st, nb, blastDmg, null, chainDepth + 1);
          }
        }
      }
    }

    // Nova Shatter upgrade AoE
    if (st.upgrades.nova > 0 && chainDepth < 2) {
      var novaR2 = (CELL_W * 1.45) * (CELL_W * 1.45);
      var novaDmg = st.upgrades.nova * 2;
      for (var ni = 0; ni < st.blocks.length; ni++) {
        var ob = st.blocks[ni];
        if (ob.id !== block.id && ob.hp > 0) {
          if (distSq(bx, by, ob.x + ob.w * 0.5, ob.y + ob.h * 0.5) <= novaR2) {
            damageBlock(st, ob, novaDmg, null, chainDepth + 1);
          }
        }
      }
    }
  }

  function mergeOrbUp(st, orb, x, y, label) {
    var nextTier = Math.min(4, orb.tier + 1);
    orb.tier = nextTier;
    orb.r = 5.5 + (nextTier - 1) * 1.6;
    orb.dmg = orbDamageFor(st, nextTier);
    st.combo += 2;
    if (st.combo > st.maxComboThisVolley) st.maxComboThisVolley = st.combo;
    if (st.combo > st.bestCombo) st.bestCombo = st.combo;

    var bonus = (40 + st.upgrades.overclock * 15) * nextTier * Math.max(1, Math.min(8, Math.ceil(st.combo / 2)));
    st.score += bonus;
    var col = TIER_COLORS[nextTier] || '#ffd24d';
    addRing(st, x, y, 48 + nextTier * 10, col, 0.32);
    spawnParticles(st, x, y, col, 12, 200);
    addFloater(st, x, y - 14, (label || 'MERGE') + ' T' + nextTier + '!', col, 1.2);
    addShake(st, 5.2);
    st.hitStop = Math.max(st.hitStop, 2);
    emit(st, 'merge', st.combo, nextTier, bonus);
  }

  function stepPhysics(st, dt) {
    st.volleyElapsed += dt;

    if (st.orbsToFire > 0) {
      if (st.fireCooldown <= 0) fireNextVolleyOrb(st);
      else st.fireCooldown -= 1;
    }

    // Update gravity wells
    for (var wi = st.wells.length - 1; wi >= 0; wi--) {
      st.wells[wi].life -= dt;
      if (st.wells[wi].life <= 0) st.wells.splice(wi, 1);
    }

    var subDt = dt / SUBSTEPS;
    var stallBoost = st.volleyElapsed > MAX_VOLLEY_SEC;

    for (var sub = 0; sub < SUBSTEPS; sub++) {
      for (var oi = st.orbs.length - 1; oi >= 0; oi--) {
        var o = st.orbs[oi];
        if (!o) continue;
        o.age += subDt;

        // Gravity wells gently pull nearby orbs into curved multi-hit trajectories
        for (var gw = 0; gw < st.wells.length; gw++) {
          var well = st.wells[gw];
          var wx = well.x - o.x;
          var wy = well.y - o.y;
          var wd2 = wx * wx + wy * wy;
          if (wd2 > 64 && wd2 < well.r * well.r) {
            var wd = Math.sqrt(wd2);
            var pull = (580 + st.upgrades.gravity * 140) * subDt;
            o.vx += (wx / wd) * pull;
            o.vy += (wy / wd) * pull;
          }
        }

        // Magnet upgrade softly pulls orbs toward nearby Prism Cores
        if (st.upgrades.magnet > 0) {
          var magR2 = (92 + st.upgrades.magnet * 22) * (92 + st.upgrades.magnet * 22);
          for (var mp = 0; mp < st.pickups.length; mp++) {
            var pk = st.pickups[mp];
            if (pk.kind !== 'prism') continue;
            var pdx = pk.x - o.x;
            var pdy = pk.y - o.y;
            var pd2 = pdx * pdx + pdy * pdy;
            if (pd2 > 25 && pd2 < magR2) {
              var pd = Math.sqrt(pd2);
              var mPull = (420 + st.upgrades.magnet * 120) * subDt;
              o.vx += (pdx / pd) * mPull;
              o.vy += (pdy / pd) * mPull;
            }
          }
        }

        if (stallBoost) {
          o.vy += 520 * subDt;
        }

        // Normalize speed back to crisp arcade velocity
        var curSpd = Math.sqrt(o.vx * o.vx + o.vy * o.vy) || ORB_SPEED;
        var targetSpd = stallBoost ? ORB_SPEED * 1.25 : ORB_SPEED * (1 + (o.tier - 1) * 0.04);
        o.vx = (o.vx / curSpd) * targetSpd;
        o.vy = (o.vy / curSpd) * targetSpd;

        o.x += o.vx * subDt;
        o.y += o.vy * subDt;

        // Wall reflections
        if (o.x - o.r < BOUNDS.left) {
          o.x = BOUNDS.left + o.r;
          o.vx = Math.abs(o.vx);
          o.bounces += 1;
        } else if (o.x + o.r > BOUNDS.right) {
          o.x = BOUNDS.right - o.r;
          o.vx = -Math.abs(o.vx);
          o.bounces += 1;
        }
        if (o.y - o.r < BOUNDS.top) {
          o.y = BOUNDS.top + o.r;
          o.vy = Math.abs(o.vy);
          o.bounces += 1;
        }

        // Anti-flat-bounce guard
        if (Math.abs(o.vy) < 95) {
          o.vy = o.vy >= 0 ? 115 : -115;
        }

        // Block collisions (closest-point circle vs AABB)
        for (var bi = 0; bi < st.blocks.length; bi++) {
          var b = st.blocks[bi];
          if (b.hp <= 0) continue;
          var nearX = clamp(o.x, b.x, b.x + b.w);
          var nearY = clamp(o.y, b.y, b.y + b.h);
          var dx = o.x - nearX;
          var dy = o.y - nearY;
          var d2 = dx * dx + dy * dy;
          if (d2 <= o.r * o.r) {
            if (Math.abs(dx) > Math.abs(dy)) {
              o.vx = dx >= 0 ? Math.abs(o.vx) : -Math.abs(o.vx);
              o.x = dx >= 0 ? b.x + b.w + o.r + 0.5 : b.x - o.r - 0.5;
            } else {
              o.vy = dy >= 0 ? Math.abs(o.vy) : -Math.abs(o.vy);
              o.y = dy >= 0 ? b.y + b.h + o.r + 0.5 : b.y - o.r - 0.5;
            }
            o.bounces += 1;
            damageBlock(st, b, o.dmg, o, 0);
            break;
          }
        }

        // Pickup collisions (Prism Merge Core / +1 Ammo)
        for (var pi = st.pickups.length - 1; pi >= 0; pi--) {
          var p = st.pickups[pi];
          var hitR = o.r + p.r;
          if (distSq(o.x, o.y, p.x, p.y) <= hitR * hitR) {
            st.pickups.splice(pi, 1);
            if (p.kind === 'prism') {
              mergeOrbUp(st, o, p.x, p.y, 'PRISM');
            } else {
              st.orbCount = Math.min(28, st.orbCount + 1);
              st.score += 25 * st.wave;
              addFloater(st, p.x, p.y - 10, '+1 ORB', '#4dff9b', 1.05);
              addRing(st, p.x, p.y, 32, '#4dff9b', 0.26);
              spawnParticles(st, p.x, p.y, '#4dff9b', 8, 150);
              emit(st, 'pickup', st.combo, 1, 1);
            }
          }
        }

        // Floor / Aegis Shield check
        if (o.y + o.r >= BOUNDS.floorY) {
          if (st.shieldBounces > 0 && !stallBoost) {
            st.shieldBounces -= 1;
            o.y = BOUNDS.floorY - o.r - 1;
            o.vy = -Math.abs(o.vy);
            addRing(st, o.x, BOUNDS.floorY, 44, '#4dff9b', 0.26);
            spawnParticles(st, o.x, BOUNDS.floorY, '#4dff9b', 8, 160);
            emit(st, 'shield', st.combo, o.tier, 1);
          } else {
            if (st.nextLauncherX === null) {
              st.nextLauncherX = clamp(o.x, BOUNDS.left + 26, BOUNDS.right - 26);
            }
            st.orbs.splice(oi, 1);
          }
        }
      }

      // Mid-air same-tier orb fusion (Drop-Merge Chain Combo)
      for (var a = st.orbs.length - 1; a >= 1; a--) {
        var oa = st.orbs[a];
        if (!oa || oa.tier >= 4 || oa.age < 0.24) continue;
        var canMergeA = st.upgrades.magnet > 0 || oa.bounces >= 2;
        if (!canMergeA) continue;
        for (var bIdx = a - 1; bIdx >= 0; bIdx--) {
          var ob = st.orbs[bIdx];
          if (!ob || ob.tier !== oa.tier || ob.age < 0.24) continue;
          if (st.upgrades.magnet === 0 && ob.bounces < 2) continue;
          var fuseR = oa.r + ob.r + (st.upgrades.magnet > 0 ? 5 : 1);
          if (distSq(oa.x, oa.y, ob.x, ob.y) <= fuseR * fuseR) {
            var mx = (oa.x + ob.x) * 0.5;
            var my = (oa.y + ob.y) * 0.5;
            ob.x = mx;
            ob.y = my;
            ob.vx = (oa.vx + ob.vx) * 0.5;
            ob.vy = (oa.vy + ob.vy) * 0.5;
            if (Math.abs(ob.vy) < 120) ob.vy = -220;
            st.orbs.splice(a, 1);
            mergeOrbUp(st, ob, mx, my, 'CHAIN');
            break;
          }
        }
      }
    }

    // Prune dead blocks cleanly
    for (var dbi = st.blocks.length - 1; dbi >= 0; dbi--) {
      if (st.blocks[dbi].hp <= 0) st.blocks.splice(dbi, 1);
    }

    // Record short trails once per frame
    for (var tr = 0; tr < st.orbs.length; tr++) {
      var orb = st.orbs[tr];
      orb.trail.push({ x: orb.x, y: orb.y });
      if (orb.trail.length > 6) orb.trail.shift();
    }

    // Volley finished?
    if (st.orbsToFire === 0 && st.orbs.length === 0) {
      finishVolley(st);
    }
  }

  function rollUpgradeChoices(st) {
    var pool = UPGRADE_CATALOG.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(st.rng() * (i + 1));
      var tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    var picked = [];
    for (var k = 0; k < 3; k++) {
      var c = pool[k];
      picked.push({
        id: c.id,
        name: c.name,
        tag: c.tag,
        desc: c.desc,
        level: (st.upgrades[c.id] || 0) + 1,
        accent: c.accent
      });
    }
    st.upgradeChoices = picked;
  }

  function advanceBoardRows(st) {
    for (var i = 0; i < st.blocks.length; i++) {
      st.blocks[i].row += 1;
      st.blocks[i].y = rowY(st.blocks[i].row);
    }
    for (var p = st.pickups.length - 1; p >= 0; p--) {
      st.pickups[p].row += 1;
      st.pickups[p].y = rowY(st.pickups[p].row) + CELL_H * 0.5;
      if (st.pickups[p].y > BOUNDS.dangerY - 14) st.pickups.splice(p, 1);
    }

    spawnWaveRow(st, 0, st.wave, false);

    var breached = false;
    var warning = false;
    for (var bi = 0; bi < st.blocks.length; bi++) {
      var bottom = st.blocks[bi].y + st.blocks[bi].h;
      if (bottom >= BOUNDS.dangerY) breached = true;
      else if (bottom >= BOUNDS.dangerY - STEP_Y * 2) warning = true;
    }

    if (breached) {
      if (st.revivesLeft > 0) {
        st.phase = 'awaiting_revive';
        st.awaiting_revive = true;
        st.game_over = false;
        addShake(st, 10);
        emit(st, 'warn', st.combo, 1, 2);
      } else {
        st.phase = 'game_over';
        st.game_over = true;
        st.awaiting_revive = false;
        addShake(st, 12);
        emit(st, 'gameover', st.combo, 1, 1);
      }
      return false;
    }

    if (warning) emit(st, 'warn', st.combo, 1, 1);
    return true;
  }

  function finishVolley(st) {
    if (st.nextLauncherX !== null) {
      st.launcherX = st.nextLauncherX;
      st.nextLauncherX = null;
    }
    st.wells.length = 0;

    var fullClear = st.blocks.length === 0;
    if (fullClear) {
      var clearBonus = 150 * st.wave;
      st.score += clearBonus;
      addFloater(st, W * 0.5, BOUNDS.top + 120, 'WAVE CLEAR +' + clearBonus, '#4dff9b', 1.35);
      addRing(st, W * 0.5, BOUNDS.top + 140, 140, '#4dff9b', 0.45);
    }

    st.wave += 1;
    emit(st, 'wave', st.combo, 1, st.wave);

    var shouldDraft = fullClear || st.wave === 2 || st.wave % 2 === 1;
    if (shouldDraft) {
      rollUpgradeChoices(st);
      st.phase = 'upgrade';
      return;
    }

    if (advanceBoardRows(st)) {
      st.phase = 'aim';
    }
  }

  function applyUpgradeChoice(st, choiceIdx) {
    if (st.phase !== 'upgrade' || st.upgradeChoices.length === 0) return;
    var idx = ((choiceIdx === undefined || choiceIdx === null ? 0 : Math.floor(choiceIdx)) % st.upgradeChoices.length + st.upgradeChoices.length) % st.upgradeChoices.length;
    var chosen = st.upgradeChoices[idx];
    st.upgrades[chosen.id] = (st.upgrades[chosen.id] || 0) + 1;
    st.upgradeChoices = [];
    addFloater(st, W * 0.5, BOUNDS.top + 150, chosen.name.toUpperCase() + ' LV.' + st.upgrades[chosen.id], chosen.accent, 1.25);
    addRing(st, st.launcherX, st.launcherY, 96, chosen.accent, 0.36);
    emit(st, 'upgrade', st.combo, st.upgrades[chosen.id], 1);

    if (st.blocks.length === 0) {
      spawnWaveRow(st, 0, st.wave, false);
      spawnWaveRow(st, 1, st.wave, false);
      st.phase = 'aim';
    } else if (advanceBoardRows(st)) {
      st.phase = 'aim';
    }
  }

  function applyReviveDecision(st, accept) {
    if (st.phase !== 'awaiting_revive') return;
    if (accept && st.revivesLeft > 0) {
      st.revivesLeft -= 1;
      st.awaiting_revive = false;
      st.game_over = false;
      st.phase = 'aim';
      // Vaporize bottom 3 danger rows with emergency shockwave
      var cutY = BOUNDS.dangerY - STEP_Y * 3;
      var cleared = 0;
      for (var i = st.blocks.length - 1; i >= 0; i--) {
        var b = st.blocks[i];
        if (b.y + b.h >= cutY) {
          spawnParticles(st, b.x + b.w * 0.5, b.y + b.h * 0.5, '#4dff9b', 10, 210);
          st.blocks.splice(i, 1);
          cleared += 1;
        }
      }
      st.upgrades.shield = Math.max(1, st.upgrades.shield + 1);
      st.score += 100 + cleared * 25;
      addRing(st, W * 0.5, BOUNDS.dangerY - 20, 220, '#4dff9b', 0.45);
      addFloater(st, W * 0.5, BOUNDS.dangerY - 80, 'SHOCKWAVE REVIVE!', '#4dff9b', 1.35);
      addShake(st, 10);
      emit(st, 'revive', st.combo, 1, cleared);
    } else {
      st.awaiting_revive = false;
      st.game_over = true;
      st.phase = 'game_over';
      emit(st, 'gameover', st.combo, 1, 1);
    }
  }

  function stepVisualFx(st, dt) {
    // Decay block hit flashes
    for (var bi = 0; bi < st.blocks.length; bi++) {
      if (st.blocks[bi].flash > 0) st.blocks[bi].flash = Math.max(0, st.blocks[bi].flash - dt * 6.5);
    }
    // Pulse pickups deterministically
    for (var pi = 0; pi < st.pickups.length; pi++) {
      st.pickups[pi].pulse += dt * 4.2;
    }
    // Particles
    for (var i = st.particles.length - 1; i >= 0; i--) {
      var pt = st.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.94;
      pt.vy = pt.vy * 0.94 + 140 * dt;
      pt.life -= dt;
      if (pt.life <= 0) st.particles.splice(i, 1);
    }
    // Floating combat numbers
    for (var fi = st.floaters.length - 1; fi >= 0; fi--) {
      var fl = st.floaters[fi];
      fl.y += fl.vy * dt;
      fl.vy *= 0.95;
      fl.life -= dt;
      if (fl.life <= 0) st.floaters.splice(fi, 1);
    }
    // Shockwave rings
    for (var ri = st.rings.length - 1; ri >= 0; ri--) {
      var rg = st.rings[ri];
      rg.life -= dt;
      var prog = 1 - Math.max(0, rg.life / rg.maxLife);
      rg.r = 8 + (rg.maxR - 8) * prog;
      if (rg.life <= 0) st.rings.splice(ri, 1);
    }
    // Lightning arcs
    for (var ai = st.arcs.length - 1; ai >= 0; ai--) {
      st.arcs[ai].life -= dt;
      if (st.arcs[ai].life <= 0) st.arcs.splice(ai, 1);
    }
    // Deterministic screen-shake decay
    if (st.shake.mag > 0.05) {
      var sang = st.rng() * Math.PI * 2;
      st.shake.x = Math.cos(sang) * st.shake.mag;
      st.shake.y = Math.sin(sang) * st.shake.mag;
      st.shake.mag *= 0.82;
    } else {
      st.shake.x = 0;
      st.shake.y = 0;
      st.shake.mag = 0;
    }
  }

  function stepCore(st, dtMs, inp) {
    var dt = clamp((typeof dtMs === 'number' && isFinite(dtMs) ? dtMs : 16.6667) / 1000, 0.001, 0.05);
    var input = inp || {};
    var down = Boolean(input.down);
    var tap = Boolean(input.tap);
    var hasXY = typeof input.x === 'number' && typeof input.y === 'number' && isFinite(input.x) && isFinite(input.y);
    var choice = input.choice;

    st.tick += 1;
    st.events.length = 0;

    if (st.phase === 'aim') {
      if (down && hasXY) {
        st.aiming = true;
        st.aimAngle = computeAimAngle(st, input.x, input.y);
        st.aimRay = computeAimRay(st);
      } else if (tap || (st.prevDown && !down && st.aiming)) {
        if (hasXY && !st.aiming) {
          st.aimAngle = computeAimAngle(st, input.x, input.y);
        }
        startVolley(st);
      } else {
        st.aiming = false;
        st.aimRay = [];
      }
    } else if (st.phase === 'firing') {
      if (st.hitStop > 0) {
        st.hitStop -= 1;
      } else {
        stepPhysics(st, dt);
      }
    } else if (st.phase === 'upgrade') {
      if (tap && choice !== null && choice !== undefined) {
        applyUpgradeChoice(st, choice);
      }
    } else if (st.phase === 'awaiting_revive') {
      if (tap) {
        applyReviveDecision(st, choice === 0 || choice === null || choice === undefined);
      }
    } else if (st.phase === 'game_over') {
      // Remain at game_over until explicit reset/restart
    }

    st.prevDown = down;
    stepVisualFx(st, dt);
  }

  function publicState(st) {
    return {
      phase: st.phase,
      wave: st.wave,
      score: st.score,
      entities: st.blocks.length + st.orbs.length + st.pickups.length,
      combo: st.combo,
      game_over: st.game_over,
      awaiting_revive: st.awaiting_revive
    };
  }

  function renderNow() {
    if (typeof rendererFn === 'function' && S) {
      rendererFn(buildSnapshot(S));
    }
  }

  function buildSnapshot(st) {
    return {
      W: W,
      H: H,
      bounds: BOUNDS,
      phase: st.phase,
      wave: st.wave,
      score: st.score,
      combo: st.combo,
      bestCombo: st.bestCombo,
      maxComboThisVolley: st.maxComboThisVolley,
      entities: st.blocks.length + st.orbs.length + st.pickups.length,
      game_over: st.game_over,
      awaiting_revive: st.awaiting_revive,
      revivesLeft: st.revivesLeft,
      launcherX: st.launcherX,
      launcherY: st.launcherY,
      aimAngle: st.aimAngle,
      aiming: st.aiming,
      aimRay: st.aimRay,
      orbCount: st.orbCount + st.upgrades.split * 2,
      baseDmg: st.baseDmg + st.upgrades.overclock,
      orbsToFire: st.orbsToFire,
      shieldBounces: st.shieldBounces,
      shieldMax: st.shieldMax,
      blocks: st.blocks,
      orbs: st.orbs,
      pickups: st.pickups,
      wells: st.wells,
      particles: st.particles,
      floaters: st.floaters,
      rings: st.rings,
      arcs: st.arcs,
      shake: st.shake,
      hitStop: st.hitStop,
      upgrades: st.upgrades,
      upgradeChoices: st.upgradeChoices,
      events: st.events,
      tick: st.tick
    };
  }

  function initWithSeed(seed, keepInteractive) {
    interactiveMode = Boolean(keepInteractive);
    S = createFreshState(seed);
    populateOpeningBoard(S);
    renderNow();
    return publicState(S);
  }

  // Boot immediately into playable Wave 1 with zero splash/tutorial wall
  S = createFreshState(2026);
  populateOpeningBoard(S);

  global.__GAME = {
    reset: function (seed_u32) {
      return initWithSeed(seed_u32, false);
    },
    step: function (dt_ms, input) {
      interactiveMode = false;
      stepCore(S, dt_ms, input);
      renderNow();
      return publicState(S);
    },
    state: function () {
      return publicState(S);
    },
    snapshot: function () {
      return buildSnapshot(S);
    },
    setRenderer: function (fn) {
      rendererFn = typeof fn === 'function' ? fn : null;
      renderNow();
    },
    setInteractive: function (flag) {
      interactiveMode = Boolean(flag);
    },
    isInteractive: function () {
      return interactiveMode;
    },
    stepInteractive: function (dt_ms, input) {
      if (!interactiveMode) return publicState(S);
      stepCore(S, dt_ms, input);
      renderNow();
      return publicState(S);
    },
    chooseUpgrade: function (idx) {
      applyUpgradeChoice(S, idx);
      renderNow();
      return publicState(S);
    },
    revive: function (accept) {
      applyReviveDecision(S, Boolean(accept));
      renderNow();
      return publicState(S);
    },
    recallVolley: function () {
      if (S.phase === 'firing') {
        S.orbsToFire = 0;
        S.orbs.length = 0;
        finishVolley(S);
        renderNow();
      }
      return publicState(S);
    },
    restart: function () {
      var nextSeed = ((S.seed + 1013904223) >>> 0) || 1;
      return initWithSeed(nextSeed, true);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
