/* PRISM RICOCHET — Canvas 2D renderer, zero-asset WebAudio procedural synth, HUD, and single-thumb input driver. */
(function () {
  'use strict';

  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var hudWave = document.getElementById('hud-wave');
  var hudScore = document.getElementById('hud-score');
  var hudCombo = document.getElementById('hud-combo');
  var hudMods = document.getElementById('hud-mods');
  var aimHint = document.getElementById('aim-hint');
  var btnRecall = document.getElementById('btn-recall');
  var btnMute = document.getElementById('btn-mute');
  var icoOn = document.getElementById('ico-sound-on');
  var icoOff = document.getElementById('ico-sound-off');

  var ovUpgrade = document.getElementById('overlay-upgrade');
  var draftWaveLabel = document.getElementById('draft-wave-label');
  var draftCardsEl = document.getElementById('draft-cards');
  var ovRevive = document.getElementById('overlay-revive');
  var reviveWaveEl = document.getElementById('revive-wave');
  var reviveScoreEl = document.getElementById('revive-score');
  var reviveComboEl = document.getElementById('revive-combo');
  var btnReviveYes = document.getElementById('btn-revive-yes');
  var btnReviveNo = document.getElementById('btn-revive-no');
  var ovGameOver = document.getElementById('overlay-gameover');
  var goScoreEl = document.getElementById('go-score');
  var goWaveEl = document.getElementById('go-wave');
  var goComboEl = document.getElementById('go-combo');
  var goBestEl = document.getElementById('go-best');
  var btnRestart = document.getElementById('btn-restart');

  var intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  var bestScoreSession = 0;

  /* ---------------- Zero-Asset WebAudio Synth ---------------- */
  var audioCtx = null;
  var noiseBuf = null;
  var muted = false;
  var lastHitAudioAt = 0;
  var SCALE = [293.66, 349.23, 392.00, 440.00, 523.25, 587.33, 698.46, 783.99, 880.00, 1046.50, 1174.66, 1396.91];

  function unlockAudio() {
    if (muted) return null;
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        audioCtx = new AC();
        var len = Math.floor(audioCtx.sampleRate * 0.16);
        noiseBuf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        var ch = noiseBuf.getChannelData(0);
        var s = 0x13579bdf;
        for (var i = 0; i < len; i++) {
          s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
          ch[i] = (s / 2147483648) - 1;
        }
      } catch (e) {
        return null;
      }
    }
    if (audioCtx.state === 'suspended') {
      try { audioCtx.resume(); } catch (e) {}
    }
    return audioCtx;
  }

  function playTone(ac, type, f0, f1, dur, peak, delay) {
    var t0 = ac.currentTime + (delay || 0);
    var osc = ac.createOscillator();
    var g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(24, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.007);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.015);
  }

  function playNoise(ac, dur, freq, peak) {
    if (!noiseBuf) return;
    var t0 = ac.currentTime;
    var src = ac.createBufferSource();
    src.buffer = noiseBuf;
    var filt = ac.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(freq, t0);
    filt.Q.value = 1.5;
    var g = ac.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(ac.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.015);
  }

  function playEvents(events) {
    if (!events || !events.length || muted || !audioCtx || audioCtx.state !== 'running') return;
    var ac = audioCtx;
    var now = ac.currentTime;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (!ev) continue;
      var combo = Math.max(0, ev.combo || 0);
      var note = SCALE[Math.min(SCALE.length - 1, combo)];
      switch (ev.type) {
        case 'launch':
          playTone(ac, 'triangle', 220, 480, 0.075, 0.08);
          break;
        case 'hit':
          if (now - lastHitAudioAt < 0.025) break;
          lastHitAudioAt = now;
          playTone(ac, 'sine', note, note * 1.03, 0.065, 0.06);
          break;
        case 'shatter':
          playTone(ac, 'triangle', note * 0.5, 92, 0.13, 0.11);
          playTone(ac, 'sine', note * 1.5, note * 2.0, 0.10, 0.07);
          playNoise(ac, 0.08, 1500, 0.07);
          break;
        case 'merge':
          playTone(ac, 'sine', 440 * Math.pow(1.15, (ev.tier || 2) - 2), 660 * Math.pow(1.15, (ev.tier || 2) - 2), 0.15, 0.10, 0);
          playTone(ac, 'triangle', 587.33, 880, 0.18, 0.08, 0.04);
          break;
        case 'bomb':
          playTone(ac, 'sawtooth', 160, 44, 0.24, 0.13);
          playNoise(ac, 0.16, 700, 0.11);
          break;
        case 'lightning':
          playTone(ac, 'sawtooth', 1020, 310, 0.085, 0.05);
          playNoise(ac, 0.065, 3200, 0.055);
          break;
        case 'shield':
          playTone(ac, 'sine', 520, 780, 0.11, 0.085);
          break;
        case 'pickup':
          playTone(ac, 'sine', 587.33, 880, 0.10, 0.075);
          break;
        case 'wave':
          playTone(ac, 'triangle', 392.00, 392.00, 0.11, 0.08, 0.00);
          playTone(ac, 'triangle', 493.88, 493.88, 0.11, 0.08, 0.065);
          playTone(ac, 'triangle', 587.33, 587.33, 0.13, 0.085, 0.13);
          playTone(ac, 'sine', 783.99, 783.99, 0.22, 0.095, 0.195);
          break;
        case 'upgrade':
          playTone(ac, 'sine', 523.25, 783.99, 0.12, 0.09);
          break;
        case 'warn':
          playTone(ac, 'sawtooth', 195, 145, 0.18, 0.07);
          break;
        case 'revive':
          playTone(ac, 'triangle', 261.63, 523.25, 0.19, 0.11, 0.00);
          playTone(ac, 'sine', 392.00, 783.99, 0.25, 0.11, 0.08);
          playNoise(ac, 0.14, 920, 0.08);
          break;
        case 'gameover':
          playTone(ac, 'triangle', 349.23, 293.66, 0.17, 0.09, 0.00);
          playTone(ac, 'triangle', 261.63, 196.00, 0.27, 0.09, 0.16);
          break;
      }
    }
  }

  /* ---------------- Geometric Icons (Zero Network URLs) ---------------- */
  var svgProbe = document.createElement('template');
  svgProbe.innerHTML = '<svg></svg>';
  var SVG_NS = svgProbe.content.firstChild.namespaceURI;

  var ICON_PATHS = {
    split: 'M9 15V9M9 9L4 4M9 9L14 4M4 7V4H7M11 4H14V7',
    gravity: 'M9 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M3.5 9a5.5 5.5 0 0 1 9.5 -3.8M14.5 9a5.5 5.5 0 0 1 -9.5 3.8',
    lightning: 'M10 2L4.5 10H9L8 16L13.5 8H9L10 2Z',
    magnet: 'M5 4V10A4 4 0 0 0 13 10V4M3.5 6.5H6.5M11.5 6.5H14.5',
    shield: 'M9 2.5L14.5 5V9.5C14.5 12.8 12.1 15 9 16C5.9 15 3.5 12.8 3.5 9.5V5L9 2.5Z',
    nova: 'M9 2.5V5M9 13V15.5M2.5 9H5M13 9H15.5M4.5 4.5L6.5 6.5M11.5 11.5L13.5 13.5M13.5 4.5L11.5 6.5M6.5 11.5L4.5 13.5',
    overclock: 'M9 3.5A5.5 5.5 0 1 0 14.5 9M9 9L13 5M12 3.5H14.5V6',
    cryo: 'M9 2.5V15.5M3.5 5.7L14.5 12.3M14.5 5.7L3.5 12.3'
  };

  function makeIconSvg(id) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 18 18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', ICON_PATHS[id] || ICON_PATHS.nova);
    svg.appendChild(p);
    return svg;
  }

  /* ---------------- Canvas 2D Precision Optical-Bench Renderer ---------------- */
  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function blockPalette(b) {
    if (b.kind === 'bomb') return { fill: '#451524', stroke: '#fb7185', accent: '#f43f5e', text: '#fff1f2' };
    if (b.kind === 'prism') return { fill: '#123142', stroke: '#38bdf8', accent: '#fde047', text: '#f0f9ff' };
    if (b.kind === 'armored') return { fill: '#222b38', stroke: '#94a3b8', accent: '#cbd5e1', text: '#f8fafc' };
    if (b.hp >= 28) return { fill: '#3d1725', stroke: '#f43f5e', accent: '#fb7185', text: '#fff1f2' };
    if (b.hp >= 14) return { fill: '#3b2810', stroke: '#f59e0b', accent: '#fbbf24', text: '#fffbeb' };
    if (b.hp >= 6) return { fill: '#10352b', stroke: '#10b981', accent: '#34d399', text: '#ecfdf5' };
    return { fill: '#12283d', stroke: '#0ea5e9', accent: '#38bdf8', text: '#f0f9ff' };
  }

  function orbStyle(tier) {
    if (tier >= 4) return { core: '#ffffff', body: '#fde047', halo: 'rgba(253, 224, 71, 0.34)', trail: 'rgba(253, 224, 71, 0.48)' };
    if (tier === 3) return { core: '#ecfdf5', body: '#34d399', halo: 'rgba(52, 211, 153, 0.32)', trail: 'rgba(52, 211, 153, 0.45)' };
    if (tier === 2) return { core: '#fffbeb', body: '#f59e0b', halo: 'rgba(245, 158, 11, 0.30)', trail: 'rgba(245, 158, 11, 0.42)' };
    return { core: '#f8fafc', body: '#38bdf8', halo: 'rgba(56, 189, 248, 0.28)', trail: 'rgba(56, 189, 248, 0.40)' };
  }

  function drawArena(snap) {
    var W = snap.W || 390;
    var H = snap.H || 844;
    var B = snap.bounds || { left: 14, right: 376, top: 92, dangerY: 684, floorY: 746 };
    var t = (snap.tick || 0) / 60;
    var sx = snap.shake ? snap.shake.x : 0;
    var sy = snap.shake ? snap.shake.y : 0;

    ctx.save();
    // Base basalt surface
    ctx.fillStyle = '#0d121b';
    ctx.fillRect(0, 0, W, H);

    // Subtle radial optical vignette centered on upper playfield
    var vig = ctx.createRadialGradient(W * 0.5, 290, 40, W * 0.5, 420, 470);
    vig.addColorStop(0, 'rgba(56, 189, 248, 0.055)');
    vig.addColorStop(0.65, 'rgba(13, 18, 27, 0)');
    vig.addColorStop(1, 'rgba(4, 6, 10, 0.52)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    ctx.translate(sx, sy);

    // Milled precision grid inside playfield
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var step = 36;
    for (var gx = B.left + step; gx < B.right; gx += step) {
      ctx.moveTo(gx + 0.5, B.top);
      ctx.lineTo(gx + 0.5, B.floorY);
    }
    for (var gy = B.top + step; gy < B.floorY; gy += step) {
      ctx.moveTo(B.left, gy + 0.5);
      ctx.lineTo(B.right, gy + 0.5);
    }
    ctx.stroke();

    // Playfield perimeter rails
    roundRectPath(ctx, B.left, B.top, B.right - B.left, B.floorY - B.top, 10);
    ctx.strokeStyle = '#243247';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Danger rail (pulses bright red when any block nears dangerY)
    var threat = false;
    var blocks = snap.blocks || [];
    for (var bi = 0; bi < blocks.length; bi++) {
      if (blocks[bi].y + blocks[bi].h >= B.dangerY - 64) { threat = true; break; }
    }
    var dangerAlpha = threat ? (0.48 + 0.32 * Math.sin(t * 7)) : 0.22;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(244, 63, 94, ' + dangerAlpha.toFixed(3) + ')';
    ctx.lineWidth = threat ? 1.75 : 1;
    ctx.beginPath();
    ctx.moveTo(B.left + 4, B.dangerY);
    ctx.lineTo(B.right - 4, B.dangerY);
    ctx.stroke();
    ctx.restore();

    if (threat) {
      ctx.fillStyle = 'rgba(244, 63, 94, 0.65)';
      ctx.font = '600 9px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('BREACH LINE', B.right - 8, B.dangerY - 3);
    }

    // Active Aegis Shield floor segments
    var sMax = snap.shieldMax || 0;
    var sCur = snap.shieldBounces || 0;
    if (sCur > 0) {
      var segs = Math.max(1, sMax || sCur);
      var span = (B.right - B.left) - 16;
      var segW = (span - (segs - 1) * 6) / segs;
      for (var si = 0; si < segs; si++) {
        var sx0 = B.left + 8 + si * (segW + 6);
        ctx.fillStyle = si < sCur ? '#34d399' : 'rgba(52, 211, 153, 0.16)';
        ctx.fillRect(sx0, B.floorY - 3, segW, 3);
      }
    }

    // Gravity Wells
    var wells = snap.wells || [];
    for (var wi = 0; wi < wells.length; wi++) {
      var w = wells[wi];
      var wRatio = Math.max(0, Math.min(1, (w.life || 1) / (w.maxLife || 1)));
      var wg = ctx.createRadialGradient(w.x, w.y, 4, w.x, w.y, w.r);
      wg.addColorStop(0, 'rgba(56, 189, 248, ' + (0.28 * wRatio).toFixed(3) + ')');
      wg.addColorStop(0.65, 'rgba(56, 189, 248, ' + (0.09 * wRatio).toFixed(3) + ')');
      wg.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(t * 2.2 + wi);
      ctx.setLineDash([7, 7]);
      ctx.strokeStyle = 'rgba(56, 189, 248, ' + (0.55 * wRatio).toFixed(3) + ')';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, w.r * 0.65, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Pickups (extra ammo & prism merge nodes)
    var pickups = snap.pickups || [];
    for (var pi = 0; pi < pickups.length; pi++) {
      var pk = pickups[pi];
      var pPulse = 1 + 0.14 * Math.sin(t * 5.2 + (pk.pulse || pi));
      var isPrism = pk.kind === 'prism';
      var pkCol = isPrism ? '#fde047' : '#34d399';

      ctx.strokeStyle = isPrism ? 'rgba(253, 224, 71, 0.35)' : 'rgba(52, 211, 153, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, pk.r * pPulse * 1.42, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = pkCol;
      if (isPrism) {
        ctx.save();
        ctx.translate(pk.x, pk.y);
        ctx.rotate(Math.PI / 4 + t * 0.9);
        var d = pk.r * 0.95;
        ctx.fillRect(-d * 0.7, -d * 0.7, d * 1.4, d * 1.4);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, pk.r * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#071018';
        ctx.font = '700 10px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', pk.x, pk.y + 0.5);
      }
    }

    // Blocks (Numbered Monolith Tiles)
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var pal = blockPalette(b);
      var flash = b.flash || 0;
      var pad = flash > 0 ? 1 : 0;
      var bx = b.x + pad;
      var by = b.y + pad;
      var bw = b.w - pad * 2;
      var bh = b.h - pad * 2;

      roundRectPath(ctx, bx, by, bw, bh, 6);
      ctx.fillStyle = flash > 0 ? '#f8fafc' : pal.fill;
      ctx.fill();

      // Top inner light bevel
      if (flash <= 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(bx + 3, by + 1.5, bw - 6, 3);
      }

      ctx.strokeStyle = flash > 0 ? '#ffffff' : pal.stroke;
      ctx.lineWidth = b.kind === 'armored' ? 2.2 : 1.5;
      ctx.stroke();

      // Armored corner rivets / Bomb ring / Prism diamond corner
      if (flash <= 0) {
        if (b.kind === 'armored') {
          ctx.fillStyle = pal.accent;
          ctx.fillRect(bx + 4, by + 4, 3, 3);
          ctx.fillRect(bx + bw - 7, by + 4, 3, 3);
          ctx.fillRect(bx + 4, by + bh - 7, 3, 3);
          ctx.fillRect(bx + bw - 7, by + bh - 7, 3, 3);
        } else if (b.kind === 'bomb') {
          ctx.strokeStyle = 'rgba(251, 113, 133, 0.55)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(bx + bw * 0.5, by + bh * 0.5, Math.min(bw, bh) * 0.37, 0, Math.PI * 2);
          ctx.stroke();
        } else if (b.kind === 'prism') {
          ctx.strokeStyle = pal.accent;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(bx + bw * 0.5, by + 4);
          ctx.lineTo(bx + bw - 5, by + bh * 0.5);
          ctx.lineTo(bx + bw * 0.5, by + bh - 4);
          ctx.lineTo(bx + 5, by + bh * 0.5);
          ctx.closePath();
          ctx.stroke();
        }
      }

      // Thin bottom HP meter when damaged
      if (b.maxHp > 1 && b.hp < b.maxHp && flash <= 0) {
        var frac = Math.max(0.06, Math.min(1, b.hp / b.maxHp));
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(bx + 4, by + bh - 5, bw - 8, 2.5);
        ctx.fillStyle = pal.accent;
        ctx.fillRect(bx + 4, by + bh - 5, (bw - 8) * frac, 2.5);
      }

      // Crisp centered tabular HP numeral
      ctx.fillStyle = flash > 0 ? '#0d121b' : pal.text;
      ctx.font = '600 ' + (b.hp >= 100 ? '13px' : '15px') + ' ui-monospace, "SF Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.hp), bx + bw * 0.5, by + bh * 0.5 + 0.5);
    }

    // Shockwave Rings
    var rings = snap.rings || [];
    for (var ri = 0; ri < rings.length; ri++) {
      var rg = rings[ri];
      var rAlpha = Math.max(0, Math.min(1, (rg.life || 0) / (rg.maxLife || 1)));
      ctx.save();
      ctx.globalAlpha = rAlpha * 0.72;
      ctx.strokeStyle = rg.color || '#38bdf8';
      ctx.lineWidth = 2 * rAlpha + 0.6;
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Chain Lightning Arcs (deterministic jagged bolt from coordinates + tick)
    var arcs = snap.arcs || [];
    for (var ai = 0; ai < arcs.length; ai++) {
      var a = arcs[ai];
      var aAlpha = Math.max(0, Math.min(1, (a.life || 0) / (a.maxLife || 1)));
      var dx = a.x2 - a.x1;
      var dy = a.y2 - a.y1;
      var len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len;
      var ny = dx / len;
      ctx.save();
      ctx.globalAlpha = aAlpha;
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      var segN = 5;
      for (var k = 1; k < segN; k++) {
        var frac = k / segN;
        var zig = Math.sin((k * 2.7) + ai * 3.1 + t * 28) * 7;
        ctx.lineTo(a.x1 + dx * frac + nx * zig, a.y1 + dy * frac + ny * zig);
      }
      ctx.lineTo(a.x2, a.y2);
      ctx.strokeStyle = a.color || '#38bdf8';
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    // Predictive 1-2 Bounce Aiming Ray
    var lx = snap.launcherX || W * 0.5;
    var ly = snap.launcherY || 724;
    if (snap.aiming && snap.aimRay && snap.aimRay.length >= 2) {
      var ray = snap.aimRay;
      ctx.save();
      for (var rIdx = 0; rIdx < ray.length - 1; rIdx++) {
        var p0 = ray[rIdx];
        var p1 = ray[rIdx + 1];
        ctx.strokeStyle = rIdx === 0 ? 'rgba(56, 189, 248, 0.85)' : 'rgba(56, 189, 248, 0.36)';
        ctx.lineWidth = rIdx === 0 ? 2 : 1.5;
        ctx.setLineDash(rIdx === 0 ? [6, 6] : [4, 6]);
        ctx.lineDashOffset = -(snap.tick || 0) * 0.8;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      // Specular impact marker at first bounce point
      var bp = ray[1];
      ctx.setLineDash([]);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, 5.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Orbs + Luminous Trails
    var orbs = snap.orbs || [];
    for (var oi = 0; oi < orbs.length; oi++) {
      var o = orbs[oi];
      var st = orbStyle(o.tier || 1);
      var tr = o.trail || [];
      if (tr.length >= 2) {
        for (var ti = 1; ti < tr.length; ti++) {
          var alpha = (ti / tr.length) * 0.55;
          ctx.strokeStyle = st.trail;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = Math.max(1.5, (o.r * 1.45) * (ti / tr.length));
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(tr[ti - 1].x, tr[ti - 1].y);
          ctx.lineTo(tr[ti].x, tr[ti].y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // Halo
      ctx.fillStyle = st.halo;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r * 1.7, 0, Math.PI * 2);
      ctx.fill();
      // Main sphere
      ctx.fillStyle = st.body;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fill();
      // Specular core
      ctx.fillStyle = st.core;
      ctx.beginPath();
      ctx.arc(o.x - o.r * 0.24, o.y - o.r * 0.24, o.r * 0.44, 0, Math.PI * 2);
      ctx.fill();
      // Tier 2+ orbiting prism ring
      if ((o.tier || 1) >= 2) {
        ctx.strokeStyle = st.core;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r + 2.5, t * 4, t * 4 + Math.PI * 1.25);
        ctx.stroke();
      }
    }

    // Particles
    var parts = snap.particles || [];
    for (var pIdx = 0; pIdx < parts.length; pIdx++) {
      var pt = parts[pIdx];
      var pLife = Math.max(0, Math.min(1, (pt.life || 0) / (pt.maxLife || 1)));
      ctx.save();
      ctx.globalAlpha = pLife;
      ctx.fillStyle = pt.color || '#38bdf8';
      var pr = Math.max(1, (pt.r || 2.5) * pLife);
      ctx.fillRect(pt.x - pr, pt.y - pr, pr * 2, pr * 2);
      ctx.restore();
    }

    // Launcher Turret & Ammo Readout
    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.beginPath();
    ctx.arc(lx, ly, 16 + Math.sin(t * 3.2) * 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#141c29';
    ctx.strokeStyle = snap.aiming ? '#38bdf8' : '#475569';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(lx, ly, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Diegetic ammo & damage bar beneath launcher
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 11px ui-monospace, "SF Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var info;
    if (snap.phase === 'firing') {
      info = (snap.orbsToFire || 0) > 0
        ? ('LAUNCHING ' + snap.orbsToFire + '  ·  ' + orbs.length + ' ACTIVE')
        : (orbs.length + ' IN FLIGHT  ·  DMG ' + (snap.baseDmg || 1));
    } else {
      info = 'x' + (snap.orbCount || 1) + ' ORBS  ·  DMG ' + (snap.baseDmg || 1);
    }
    if (sCur > 0) info += '  ·  SHIELD ' + sCur;
    ctx.fillText(info, W * 0.5, B.floorY + 12);
    ctx.restore();

    // Floating Combo / Damage / Merge Callouts
    var floaters = snap.floaters || [];
    for (var fi = 0; fi < floaters.length; fi++) {
      var fl = floaters[fi];
      var fAlpha = Math.max(0, Math.min(1, (fl.life || 0) / (fl.maxLife || 1)));
      var fSize = Math.round(12 * (fl.scale || 1));
      ctx.save();
      ctx.globalAlpha = fAlpha;
      ctx.font = '700 ' + fSize + 'px ui-monospace, "SF Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(7, 10, 15, 0.92)';
      ctx.strokeText(fl.text, fl.x, fl.y);
      ctx.fillStyle = fl.color || '#f8fafc';
      ctx.fillText(fl.text, fl.x, fl.y);
      ctx.restore();
    }

    ctx.restore();
  }

  /* ---------------- HUD & Modal Synchronization ---------------- */
  var lastDraftKey = '';
  var lastModsKey = '';

  function syncHud(snap) {
    if (snap.score > bestScoreSession) bestScoreSession = snap.score;
    hudWave.textContent = String(snap.wave || 1);
    hudScore.textContent = intFmt.format(snap.score || 0);
    if ((snap.combo || 0) >= 2) {
      hudCombo.textContent = snap.combo + 'x';
      hudCombo.className = 'hud-val hud-combo' + (snap.combo >= 6 ? ' hot' : '');
    } else {
      hudCombo.textContent = '-';
      hudCombo.className = 'hud-val hud-combo';
    }

    btnRecall.hidden = snap.phase !== 'firing';
    aimHint.className = 'aim-hint' + (snap.phase === 'aim' && (snap.wave || 1) === 1 && (snap.score || 0) === 0 && !snap.aiming ? '' : ' hidden');

    // Active mods strip
    var up = snap.upgrades || {};
    var modNames = Object.keys(up).filter(function (k) { return up[k] > 0; });
    var modsKey = modNames.map(function (k) { return k + ':' + up[k]; }).join(',');
    if (modsKey !== lastModsKey) {
      lastModsKey = modsKey;
      hudMods.textContent = '';
      var labels = { split: 'SPLIT', gravity: 'WELL', lightning: 'ARC', magnet: 'MAG', shield: 'SHD', nova: 'NOVA', overclock: 'OC', cryo: 'CRYO' };
      modNames.slice(0, 5).forEach(function (k) {
        var pill = document.createElement('span');
        pill.className = 'mod-pill';
        pill.appendChild(document.createTextNode((labels[k] || k.toUpperCase()) + ' '));
        var b = document.createElement('b');
        b.textContent = 'L' + up[k];
        pill.appendChild(b);
        hudMods.appendChild(pill);
      });
    }

    // 3-card roguelite draft overlay
    var showUpgrade = snap.phase === 'upgrade';
    ovUpgrade.hidden = !showUpgrade;
    if (showUpgrade) {
      var choices = snap.upgradeChoices || [];
      var dKey = (snap.wave || 1) + ':' + choices.map(function (c) { return c.id + c.level; }).join('|');
      if (dKey !== lastDraftKey) {
        lastDraftKey = dKey;
        draftWaveLabel.textContent = 'WAVE ' + Math.max(1, (snap.wave || 2) - 1) + ' CLEARED · UPGRADE FOR WAVE ' + (snap.wave || 2);
        draftCardsEl.textContent = '';
        choices.forEach(function (card, idx) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'draft-card';
          btn.addEventListener('click', function () {
            unlockAudio();
            if (window.__GAME) {
              window.__GAME.setInteractive(true);
              window.__GAME.chooseUpgrade(idx);
              ensureLoop();
            }
          });
          var ico = document.createElement('div');
          ico.className = 'card-ico';
          if (card.accent) ico.style.color = card.accent;
          ico.appendChild(makeIconSvg(card.id));

          var body = document.createElement('div');
          body.className = 'card-body';
          var row = document.createElement('div');
          row.className = 'card-row';
          var name = document.createElement('span');
          name.className = 'card-name';
          name.textContent = card.name;
          var tag = document.createElement('span');
          tag.className = 'card-tag';
          if (card.accent) tag.style.color = card.accent;
          tag.textContent = (card.tag ? card.tag + ' · ' : '') + 'LV ' + (card.level || 1);
          row.appendChild(name);
          row.appendChild(tag);

          var desc = document.createElement('span');
          desc.className = 'card-desc';
          desc.textContent = card.desc;
          body.appendChild(row);
          body.appendChild(desc);

          btn.appendChild(ico);
          btn.appendChild(body);
          draftCardsEl.appendChild(btn);
        });
      }
    }

    // Near-miss awaiting_revive overlay
    var showRevive = snap.phase === 'awaiting_revive' || !!snap.awaiting_revive;
    ovRevive.hidden = !showRevive;
    if (showRevive) {
      reviveWaveEl.textContent = String(snap.wave || 1);
      reviveScoreEl.textContent = intFmt.format(snap.score || 0);
      reviveComboEl.textContent = (snap.bestCombo || 0) + 'x';
    }

    // Game Over overlay
    var showGO = !showRevive && (snap.phase === 'game_over' || !!snap.game_over);
    ovGameOver.hidden = !showGO;
    if (showGO) {
      goScoreEl.textContent = intFmt.format(snap.score || 0);
      goWaveEl.textContent = String(snap.wave || 1);
      goComboEl.textContent = (snap.bestCombo || 0) + 'x';
      goBestEl.textContent = intFmt.format(bestScoreSession);
    }
  }

  function renderFrame(snap) {
    if (!snap) return;
    drawArena(snap);
    syncHud(snap);
    if (window.__GAME && window.__GAME.isInteractive && window.__GAME.isInteractive()) {
      playEvents(snap.events);
    }
  }

  /* ---------------- Unified One-Thumb Input & Safe Interactive rAF ---------------- */
  var liveInput = { x: 0.5, y: 0.5, down: false, tap: false, choice: null };
  var rafId = 0;
  var lastFrameTs = 0;
  var accumMs = 0;

  function normPos(ev) {
    var rect = canvas.getBoundingClientRect();
    var rx = (ev.clientX - rect.left) / (rect.width || 390);
    var ry = (ev.clientY - rect.top) / (rect.height || 844);
    return { x: Math.max(0, Math.min(1, rx)), y: Math.max(0, Math.min(1, ry)) };
  }

  function tickLoop(ts) {
    rafId = 0;
    var g = window.__GAME;
    if (!g || !g.isInteractive || !g.isInteractive()) return;
    if (!lastFrameTs) lastFrameTs = ts;
    var dt = Math.min(50, Math.max(0, ts - lastFrameTs));
    lastFrameTs = ts;
    accumMs += dt;
    var STEP_MS = 16.6667;
    var stepped = false;
    while (accumMs >= STEP_MS) {
      g.stepInteractive(STEP_MS, { x: liveInput.x, y: liveInput.y, down: liveInput.down, tap: liveInput.tap, choice: liveInput.choice });
      liveInput.tap = false;
      liveInput.choice = null;
      accumMs -= STEP_MS;
      stepped = true;
    }
    if (!stepped && (liveInput.down || liveInput.tap)) {
      g.stepInteractive(STEP_MS, { x: liveInput.x, y: liveInput.y, down: liveInput.down, tap: liveInput.tap, choice: liveInput.choice });
      liveInput.tap = false;
      liveInput.choice = null;
    }
    rafId = requestAnimationFrame(tickLoop);
  }

  function ensureLoop() {
    if (!rafId) {
      lastFrameTs = 0;
      accumMs = 0;
      rafId = requestAnimationFrame(tickLoop);
    }
  }

  canvas.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    unlockAudio();
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    var pos = normPos(ev);
    liveInput.x = pos.x;
    liveInput.y = pos.y;
    liveInput.down = true;
    liveInput.tap = false;
    if (window.__GAME) {
      window.__GAME.setInteractive(true);
      ensureLoop();
    }
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (!liveInput.down) return;
    ev.preventDefault();
    var pos = normPos(ev);
    liveInput.x = pos.x;
    liveInput.y = pos.y;
  });

  function releasePointer(ev) {
    if (!liveInput.down) return;
    var pos = normPos(ev);
    liveInput.x = pos.x;
    liveInput.y = pos.y;
    liveInput.down = false;
    liveInput.tap = true;
    if (window.__GAME) {
      window.__GAME.setInteractive(true);
      ensureLoop();
    }
  }
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', function () { liveInput.down = false; liveInput.tap = false; });

  btnMute.addEventListener('click', function () {
    muted = !muted;
    btnMute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    icoOn.hidden = muted;
    icoOff.hidden = !muted;
    if (!muted) unlockAudio();
  });

  btnRecall.addEventListener('click', function () {
    unlockAudio();
    if (window.__GAME) {
      window.__GAME.setInteractive(true);
      window.__GAME.recallVolley();
      ensureLoop();
    }
  });

  btnReviveYes.addEventListener('click', function () {
    unlockAudio();
    if (window.__GAME) {
      window.__GAME.setInteractive(true);
      window.__GAME.revive(true);
      ensureLoop();
    }
  });

  btnReviveNo.addEventListener('click', function () {
    unlockAudio();
    if (window.__GAME) {
      window.__GAME.setInteractive(true);
      window.__GAME.revive(false);
      ensureLoop();
    }
  });

  btnRestart.addEventListener('click', function () {
    unlockAudio();
    if (window.__GAME) {
      window.__GAME.setInteractive(true);
      window.__GAME.restart();
      ensureLoop();
    }
  });

  window.addEventListener('keydown', function (ev) {
    var g = window.__GAME;
    if (!g) return;
    var st = g.state();
    if (st.phase === 'upgrade' && (ev.key === '1' || ev.key === '2' || ev.key === '3')) {
      unlockAudio();
      g.setInteractive(true);
      g.chooseUpgrade(Number(ev.key) - 1);
      ensureLoop();
    } else if (st.phase === 'awaiting_revive' && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      unlockAudio();
      g.setInteractive(true);
      g.revive(true);
      ensureLoop();
    } else if (st.phase === 'game_over' && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      unlockAudio();
      g.setInteractive(true);
      g.restart();
      ensureLoop();
    }
  });

  /* Register renderer synchronously with game.js and draw initial Wave 1 frame */
  if (window.__GAME && typeof window.__GAME.setRenderer === 'function') {
    window.__GAME.setRenderer(renderFrame);
    renderFrame(window.__GAME.snapshot());
  } else {
    window.__PENDING_RENDERER = renderFrame;
  }
})();
