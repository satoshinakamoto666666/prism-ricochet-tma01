# PRISM RICOCHET (ARENA-TMA-01)

Offline 9:16 portrait (`390x844`) one-thumb physics ricochet and orb-merge roguelite mini-game built with zero external dependencies, zero network requests, and a deterministic simulation bridge.

## Controls & Core Loop
- **One-Thumb Aim & Release:** Drag anywhere on the arena (direct aim above the launcher or slingshot pull below) to preview primary + reflected trajectory rays, then lift to fire your orb volley.
- **Drop-Merge Chain Combos:** Collide orbs with floating **Prism Cores** or fuse bounced same-tier orbs mid-flight to upgrade from **Tier 1 -> Tier 4** (`2x / 4x / 8x` damage, expanding radius, shockwave rings, hit-stop, and escalating combo multipliers).
- **Special Hazards:** Numbered blocks, **Bomb Cores** (chain AoE detonation), **Prism Splitters** (fork hitting orbs), and Wave 4+/5+ **Armored Boss Tiles**.
- **Between-Wave 3-Card Roguelite Draft:** Scale builds across Wave 1..10+ with **Split Shot**, **Gravity Well**, **Chain Arc**, **Prism Magnet**, **Aegis Barrier**, **Nova Shatter**, **Overclock**, and **Cryo Fracture**.
- **Near-Miss Last Stand (`awaiting_revive`):** On first perimeter breach, trigger an **Aegis Revive & Blast** shockwave that clears the bottom danger rows and restores floor shields, or end the run cleanly.
- **Procedural Audio & Juice:** Zero-asset WebAudio pentatonic synth SFX, hit-stop, directional screen-shake, particle bursts, lightning arcs, and floating damage callouts.

## Deterministic Verification Bridge
- `window.__GAME.reset(seed_u32)` resets the seeded PRNG (`mulberry32`) and board state deterministically and renders frame 0 synchronously.
- `window.__GAME.step(dt_ms, { x, y, down, tap, choice })` advances fixed-substep physics and renders synchronously with zero `requestAnimationFrame` race.
- `window.__GAME.state()` returns `{ phase, wave, score, entities, combo, game_over, awaiting_revive }`.

## Payout & License
- **License:** MIT (`LICENSE`)
- **Solana Wallet:** `Aw2hhJvjewAcxssyWMzKmFge6jWxEzN6GiFQgyZNKakt`
