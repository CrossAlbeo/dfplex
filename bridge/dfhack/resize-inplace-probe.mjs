// In-place resize probe (de-risk: can we resize a stockpile WITHOUT deconstruct+reconstruct?).
// The shipped resize rebuilds the building, which loses links / item-level config. An in-place edit
// pokes b.x1..y2 + b.room.{x,y,width,height} + the extents bytes directly. Open questions:
//   (1) GROWTH needs a bigger extents buffer. `b.room.extents = df.new('uint8_t',n)` failed once with
//       "incompatible pointer type". This probe tests it directly with a rollback: capture the old
//       pointer first, and if anything looks wrong, restore it so the pile is untouched.
//   (2) Does DF honor a hand-edited bbox+extents on a LIVE (constructed) building across frames, and
//       does it adopt/release the changed tiles? Re-read in a later RPC + check the RFR stream.
//
// The pile is located by a fixed interior anchor tile (so it's found regardless of current shape).
//
// Modes:
//   node bridge/dfhack/resize-inplace-probe.mjs            # READ-ONLY: find + print state
//   node bridge/dfhack/resize-inplace-probe.mjs --extend-t # grow the 5x5 into a T (realloc test)
//   node bridge/dfhack/resize-inplace-probe.mjs --reduce   # carve the current shape -> non-rectangular
import { DFHackClient } from "./client.mjs";

const host = process.env.DF_HOST || "127.0.0.1";
const port = Number(process.env.DF_PORT) || 5000;
const mode = process.argv[2] || "--find";

// Anchor: an interior tile of the original 5x5 pile that stays inside the stem after a T-extend.
const AX = 129, AY = 118, AZ = 158;

const client = await DFHackClient.connect({ host, port });
console.log(`connected to DFHack at ${host}:${port}`);

async function lua(code) {
  const { text } = await client.callText("RunCommand", { command: "lua", arguments: [code] });
  for (const line of text) if (/^PROBE/.test(line)) console.log("  " + line);
}

const dump = (varB) => `
local b = ${varB}
local r = b.room
print('PROBE box=('..b.x1..','..b.y1..','..b.z..')-('..b.x2..','..b.y2..') room '..r.width..'x'..r.height)
for dy=0,r.height-1 do local s='' for dx=0,r.width-1 do s=s..tostring(r.extents[dy*r.width+dx]) end print('PROBE row '..s) end`;

if (mode === "--find") {
  console.log("\n[find] state of the pile under the anchor tile:");
  await lua(`local b=dfhack.buildings.findAtTile(${AX},${AY},${AZ}) if not b then print('PROBE not found') return end ${dump("b")}`);
} else if (mode === "--survey") {
  // READ-ONLY: list every stockpile (29) + civzone (30) on the anchor's z-level, with box + shape mask.
  // Used to see what the user hand-edited in DF and what sits on "the other side".
  console.log(`\n[survey] all stockpiles/zones at z=${AZ}:`);
  await lua(`
local Z = ${AZ}
local n = 0
for _,b in ipairs(df.global.world.buildings.all) do
  local t = b:getType()
  if (t==df.building_type.Stockpile or t==df.building_type.Civzone) and b.z==Z then
    n = n + 1
    local r = b.room
    local kind = (t==df.building_type.Stockpile) and 'pile' or 'zone'
    print('PROBE ['..n..'] '..kind..' id='..b.id..' box=('..b.x1..','..b.y1..')-('..b.x2..','..b.y2..') room='..((r and (r.width..'x'..r.height)) or 'nil'))
    if r and r.extents~=nil then
      for dy=0,r.height-1 do local s='' for dx=0,r.width-1 do s=s..tostring(r.extents[dy*r.width+dx]) end print('PROBE       '..s) end
    end
  end
end
print('PROBE total at z='..Z..' = '..n)
`);
} else if (mode === "--reflect") {
  console.log("\n[reflect] guarded dump of building_extents_type field metadata:");
  await lua(`
local function try(label, fn) local ok,v = pcall(fn) print('PROBE '..label..' ok='..tostring(ok)..' val='..tostring(v)) end
try('_fields type', function() return type(df.building_extents_type._fields) end)
try('_fields.extents', function() return df.building_extents_type._fields.extents end)
local okf, fl = pcall(function() return df.building_extents_type._fields end)
if okf and fl then
  for i=1,#fl do
    local v = fl[i]
    local nm = pcall(function() return v.name end) and tostring(v.name) or '?'
    local tn = pcall(function() return v.type_name end) and tostring(v.type_name) or '?'
    local ti = pcall(function() return v.type_identity end) and tostring(v.type_identity) or '?'
    print('PROBE field['..i..'] name='..nm..' type_name='..tn..' type_identity='..ti)
  end
end
`);
} else if (mode === "--type") {
  console.log("\n[type] introspect the extents field's element type (to allocate a bigger buffer):");
  await lua(`local fi = df.building_extents_type._fields.extents
print('PROBE field-info = '..tostring(fi))`);
  await lua(`local fi = df.building_extents_type._fields.extents
print('PROBE type_name = '..tostring(fi.type_name)..' mode = '..tostring(fi.mode)..' count = '..tostring(fi.count))`);
  await lua(`local fi = df.building_extents_type._fields.extents
print('PROBE type_identity = '..tostring(fi.type_identity))`);
  await lua(`local fi = df.building_extents_type._fields.extents
local ti = fi.type_identity
local okMake, made = pcall(df.new, ti, 8)
print('PROBE df.new(type_identity,8) ok='..tostring(okMake)..' made='..tostring(made))
if okMake and made then pcall(df.delete, made) end`);
} else if (mode === "--extend-t") {
  // T geometry: bar = full 9 wide x 2 tall on top; stem = center 5 wide for the lower 5 rows.
  const nX = 125, nY = 114, nW = 9, nH = 7;
  console.log(`\n[extend-t] grow to a T at (${nX},${nY}) ${nW}x${nH} (the realloc test, with rollback):`);
  await lua(`
local b = dfhack.buildings.findAtTile(${AX},${AY},${AZ})
if not b then print('PROBE not found') return end
local r = b.room
local nX,nY,nW,nH = ${nX},${nY},${nW},${nH}
local nN = nW*nH
-- The extents element type is the enum building_extents_type (df.building.xml: pointer 'extents'
-- original-name 'occmap', <enum type-name='building_extents_type'/>; None=0, Stockpile=1, Wall=2,
-- Interior=3, DistanceBoundary=4). df.new('uint8_t') was rejected because the field is that enum*.
local nb, okN = nil, false
-- df.new can't make arrays of the enum (non-primitive), but the enum's base is int8_t. Allocate an
-- int8_t array (primitive, allowed) and reinterpret_cast it to the enum pointer to pass the field's
-- strict type check.
local okMake, buf = pcall(df.new, 'int8_t', nN)
if okMake and buf then
  local okR, view = pcall(df.reinterpret_cast, df.building_extents_type, buf)
  print('PROBE reinterpret_cast ok='..tostring(okR)..' view='..tostring(view))
  if okR and view then
    local okA, eA = pcall(function() r.extents = view end)
    print('PROBE realloc(int8_t->enum,'..nN..') -> assign ok='..tostring(okA)..' err='..tostring(eA))
    if okA then nb, okN = view, true end
  end
  if not okN then pcall(df.delete, buf) end
else
  print('PROBE df.new(int8_t) failed = '..tostring(buf))
end
if not okN then
  print('PROBE GROWTH BLOCKED in place - extents buffer cannot be enlarged; pile UNCHANGED')
  return
end
-- assigned: fill the T mask (rows 0-1 full bar; rows 2+ center 5 = stem)
for dy=0,nH-1 do for dx=0,nW-1 do
  local v = (dy<2 or (dx>=2 and dx<=6)) and 1 or 0
  r.extents[dy*nW+dx] = v
end end
-- commit room dims + bbox (after the buffer is already big enough)
r.x,r.y,r.width,r.height = nX,nY,nW,nH
b.x1,b.y1,b.x2,b.y2 = nX,nY,nX+nW-1,nY+nH-1
print('PROBE committed T')
${dump("b")}
`);
  // persistence (separate RPC, frames later) + RFR stream check
  console.log("  [persistence] re-read via findAtTile in a later RPC:");
  await lua(`local b=dfhack.buildings.findAtTile(${AX},${AY},${AZ}) if not b then print('PROBE not found') return end ${dump("b")}`);
} else if (mode === "--mirror") {
  // Mirror the user's hand-edit across the vertical axis: extents[dx] |= extents[W-1-dx].
  // The pile is already left-right symmetric except the arm the user carved on one side, so
  // OR-symmetrizing adds exactly the mirror arm and changes nothing else. The bbox is UNCHANGED,
  // so this is an in-place per-byte fill (no realloc) — the proven-safe path.
  console.log("\n[mirror] reflect the hand-edit across the vertical axis (in place, no realloc):");
  await lua(`
local b = dfhack.buildings.findAtTile(${AX},${AY},${AZ})
if not b then print('PROBE not found') return end
local r = b.room
local W,H = r.width,r.height
local changed = 0
for dy=0,H-1 do for dx=0,math.floor(W/2) do
  local a = r.extents[dy*W+dx]
  local m = r.extents[dy*W+(W-1-dx)]
  local v = ((a~=0) or (m~=0)) and 1 or 0
  if r.extents[dy*W+dx] ~= v then r.extents[dy*W+dx]=v changed=changed+1 end
  if r.extents[dy*W+(W-1-dx)] ~= v then r.extents[dy*W+(W-1-dx)]=v changed=changed+1 end
end end
print('PROBE mirrored '..changed..' cell(s) (bbox unchanged)')
${dump("b")}
`);
  console.log("  [persistence] re-read via findAtTile in a later RPC:");
  await lua(`local b=dfhack.buildings.findAtTile(${AX},${AY},${AZ}) if not b then print('PROBE not found') return end ${dump("b")}`);
} else if (mode === "--occ") {
  // Does DF adopt in-place extents changes into per-tile occupancy (so dwarves haul to grown tiles and
  // release shrunk ones), or must we poke block.occupancy ourselves? Also: is df.delete(old extents)
  // safe after a realloc, or should we leak? Builds a THROWAWAY pile and verifies across RPCs.
  const ox = Number(process.argv[3]), oy = Number(process.argv[4]), oz = Number(process.argv[5]);
  if (![ox, oy, oz].every(Number.isFinite)) {
    console.error("--occ needs X Y Z (an open spot for a throwaway pile)");
  } else {
    // tile_occupancy in 53.x flattens its bitfield: the building-occupancy enum is o.building directly
    // (no .bits). A stockpile tile reads building=2 (tile_building_occ.Passable); open tile reads 0.
    const occHelper = `local function occAt(x,y,z) local blk=dfhack.maps.getTileBlock(x,y,z) if not blk then return 'noblock' end local o=blk.occupancy[x%16][y%16] return 'building='..tostring(o.building)..' whole='..tostring(o.whole) end `;
    // [a] ground-truth target: occupancy of an ESTABLISHED pile's interior tile (DF's pass has run on it)
    console.log(`\n[occ a] target occupancy from the established pile under the anchor (${AX},${AY},${AZ}):`);
    await lua(occHelper + `print('PROBE established interior occ '..occAt(${AX},${AY},${AZ}))`);
    // [b] build a throwaway 5x4, fill extents, read interior + a soon-to-grow tile (baseline)
    console.log(`\n[occ b] build throwaway 5x4 @ (${ox},${oy},${oz}); read interior + the to-be-grown tile:`);
    await lua(occHelper + `
local X,Y,Z = ${ox},${oy},${oz}
for i=#df.global.world.buildings.all-1,0,-1 do local b=df.global.world.buildings.all[i] if b:getType()==df.building_type.Stockpile and b.z==Z and not(b.x2<X or b.x1>X+8 or b.y2<Y or b.y1>Y+6) then pcall(dfhack.buildings.deconstruct,b) end end
local ok,b = pcall(dfhack.buildings.constructBuilding,{type=df.building_type.Stockpile,pos={x=X,y=Y,z=Z},width=5,height=4,abstract=true})
if not ok or not b then print('PROBE build FAILED='..tostring(b)) return end
local r=b.room for i=0,5*4-1 do r.extents[i]=1 end
print('PROBE built id='..b.id..' box=('..b.x1..','..b.y1..')-('..b.x2..','..b.y2..') room '..r.width..'x'..r.height)
print('PROBE   interior  ('..(X+1)..','..(Y+1)..') occ '..occAt(X+1,Y+1,Z))
print('PROBE   to-grow   ('..(X+5)..','..(Y+1)..') occ '..occAt(X+5,Y+1,Z))`);
    // [c] grow in place to 7x4 (realloc), test df.delete(old), commit dims+bbox
    console.log(`\n[occ c] grow in place to 7x4 (realloc), test df.delete(old buffer):`);
    await lua(occHelper + `
local X,Y,Z = ${ox},${oy},${oz}
local b = dfhack.buildings.findAtTile(X+1,Y+1,Z) if not b then print('PROBE grow: not found') return end
local r = b.room
local nW,nH = 7,4 local nN = nW*nH
local old = r.extents
local okMake, buf = pcall(df.new, 'int8_t', nN)
if not (okMake and buf) then print('PROBE grow: df.new failed='..tostring(buf)) return end
local okR, view = pcall(df.reinterpret_cast, df.building_extents_type, buf)
if not (okR and view) then print('PROBE grow: reinterpret failed') pcall(df.delete,buf) return end
local okA = pcall(function() r.extents = view end)
print('PROBE grow: assign ok='..tostring(okA))
if not okA then pcall(df.delete,buf) return end
local okD, eD = pcall(df.delete, old)
print('PROBE grow: df.delete(old) ok='..tostring(okD)..' err='..tostring(eD))
for i=0,nN-1 do r.extents[i]=1 end
r.x,r.y,r.width,r.height = X,Y,nW,nH
b.x1,b.y1,b.x2,b.y2 = X,Y,X+nW-1,Y+nH-1
print('PROBE grow: committed 7x4 box=('..b.x1..','..b.y1..')-('..b.x2..','..b.y2..')')`);
    // [d] later RPC: did the new tile's occupancy get adopted to match the target?
    console.log(`\n[occ d] later RPC — is the grown tile's occupancy adopted (vs target from [a])?`);
    await lua(occHelper + `local X,Y,Z=${ox},${oy},${oz} print('PROBE grown tile ('..(X+5)..','..(Y+1)..') occ '..occAt(X+5,Y+1,Z))`);
    // [e] shrink in place to 3x4 (reuse buffer), then later check a removed tile releases occupancy
    console.log(`\n[occ e] shrink in place to 3x4 (reuse buffer); read a removed tile next RPC:`);
    await lua(occHelper + `
local X,Y,Z = ${ox},${oy},${oz}
local b = dfhack.buildings.findAtTile(X+1,Y+1,Z) if not b then print('PROBE shrink: not found') return end
local r = b.room for i=0,3*4-1 do r.extents[i]=1 end
r.x,r.y,r.width,r.height = X,Y,3,4
b.x1,b.y1,b.x2,b.y2 = X,Y,X+2,Y+3
print('PROBE shrink: committed 3x4 box=('..b.x1..','..b.y1..')-('..b.x2..','..b.y2..')')`);
    await lua(occHelper + `local X,Y,Z=${ox},${oy},${oz} print('PROBE removed tile ('..(X+5)..','..(Y+1)..') occ '..occAt(X+5,Y+1,Z)..' ; still-in ('..(X+1)..','..(Y+1)..') occ '..occAt(X+1,Y+1,Z))`);
    // cleanup
    console.log(`\n[occ cleanup] deconstruct the throwaway:`);
    await lua(`local X,Y,Z=${ox},${oy},${oz} local n=0 for i=#df.global.world.buildings.all-1,0,-1 do local b=df.global.world.buildings.all[i] if b:getType()==df.building_type.Stockpile and b.z==Z and not(b.x2<X or b.x1>X+8 or b.y2<Y or b.y1>Y+6) then if pcall(dfhack.buildings.deconstruct,b) then n=n+1 end end end print('PROBE cleanup removed '..n)`);
  }
} else if (mode === "--reduce") {
  // Carve the current shape to a non-rectangle WITHOUT changing the bbox (no realloc).
  // Remove the bottom-right block of the current footprint.
  console.log("\n[reduce] carve current footprint -> non-rectangular (in place, no realloc):");
  await lua(`
local b = dfhack.buildings.findAtTile(${AX},${AY},${AZ})
if not b then print('PROBE not found') return end
local r = b.room
local W,H = r.width,r.height
-- zero out the bottom-right quadrant (keeps the anchor tile, makes an L/notch)
for dy=0,H-1 do for dx=0,W-1 do
  if dx >= math.ceil(W/2) and dy >= math.ceil(H/2) then r.extents[dy*W+dx]=0 end
end end
print('PROBE carved bottom-right quadrant (bbox unchanged)')
${dump("b")}
`);
  console.log("  [persistence] re-read via findAtTile in a later RPC:");
  await lua(`local b=dfhack.buildings.findAtTile(${AX},${AY},${AZ}) if not b then print('PROBE not found') return end ${dump("b")}`);
}

client.quit();
console.log("\ndone.");
