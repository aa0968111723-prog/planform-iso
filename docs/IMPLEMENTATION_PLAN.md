# Planform ISO — Real-Scale Classroom Layout Implementation Plan

## Goal

Build a usable classroom / corridor 3D layout PWA for real event setup planning. The tool must prioritize real-world dimensions, floor-tile alignment, mat placement simulation, area planning, and human flow routes over decorative 3D rendering.

The product should let a user stand in a real classroom, measure or identify floor tiles, model the room at true scale, place mats / tables / chairs by tile reference, and export a clear setup plan for staff.

## Product scope

### Large areas

- Classroom
- Corridor

### Small areas

- Registration area
- Life-team area
- Small-group area
- Instructor meditation area
- Shoe placement area
- Backpack placement area

Small areas are semantic zones, not physical walls. They should be semi-transparent, labeled, resizable, movable, lockable, hideable, and duplicable.

### 3D / layout objects

Only these objects are required in the first implementation:

- Computer
- Door
- Light switch
- Projection screen
- Table
- Chair
- Mat
- Registration table

Do not add stage, incense, colored lights, audio equipment, microphones, AI, accounts, cloud sync, or other unrelated objects/features.

## Engineering baseline

Use:

- Vite
- TypeScript
- Three.js
- PWA support
- IndexedDB or another robust local-first persistence layer
- Responsive desktop / tablet / mobile UI
- GitHub Pages-compatible production build

Do not put the whole application in one `index.html`. Separate scene, camera, objects, zones, routes, snapping, history, storage, export, and UI concerns.

## Real-world scale model

Use one consistent unit system across the project.

Recommended internal convention:

- `1 Three.js unit = 1 meter`
- UI supports meters and centimeters

All room sizes, tile sizes, object sizes, spacing, measurements, route points, and exports must use the same coordinate system.

## Classroom and corridor dimensions

Users must be able to set real dimensions for each large area:

- length
- width
- position
- name

The classroom and corridor must be visible together in one plan.

## Floor-tile alignment system — core feature

Floor tiles are not decoration. They are a physical positioning reference for real setup work.

### Tile configuration

Allow the user to configure:

- tile width
- tile depth
- X/Y grid origin
- tile rotation / orientation when needed
- show / hide tile grid

Provide common presets such as 30×30 cm, 40×40 cm, 60×60 cm, while always allowing custom dimensions.

### Tile rendering

Render tile boundaries at true scale in top view and readable form in 3D/isometric view.

The grid should remain visually lightweight and must not become noisy at distant zoom levels.

### Snapping modes

Objects and zones must support:

- snap to tile intersection
- snap to tile edge
- snap to tile center
- half-tile snap
- free placement / snapping off

Snapping must use the configured real tile size rather than a hard-coded generic grid.

### Tile-based positioning feedback

When selecting or moving an object, show useful physical placement information such as:

- current tile row / column reference
- distance from nearest wall
- X / Y coordinates
- number of tiles spanned when meaningful

The intent is to support instructions such as:

> Place the first mat at the third tile from the entrance and second tile from the left.

## On-site calibration

Support calibration when the complete room dimensions are unknown.

At minimum, allow either:

1. entering the known size of one floor tile, or
2. entering a known real-world length for a measured wall / reference segment.

The application should use that reference to keep all subsequent placement at a consistent physical scale.

## Mat model — core feature

Mats must be modeled using real dimensions, not generic decorative rectangles.

Each mat supports:

- width
- depth / length
- thickness
- position
- rotation

Provide editable defaults rather than one fixed size.

In top view, a mat occupies its real footprint. In 3D view, it can have a small true-scale thickness.

## Mat simulation / preview mode

Before committing a large mat layout, users need a simulation preview.

### Inputs

Allow configuration of:

- mat width
- mat depth
- rows
- columns
- horizontal gap
- vertical gap
- rotation
- starting anchor point

### Preview

Render the proposed layout as semi-transparent ghost mats before creating real scene objects.

While previewing, show:

- total mat count
- total occupied width
- total occupied depth
- clearance to relevant walls / zone boundaries when available
- whether the layout exceeds the selected area
- overlap / collision warnings

### Confirm / cancel

The preview must have explicit:

- Confirm placement
- Cancel

Do not create dozens of permanent objects while the user is still adjusting spacing.

## Tile-based mat layout

Users should also be able to reason directly in tile units.

Example workflow:

- one mat spans N tiles wide
- one mat spans M tiles deep
- gap is half a tile / one tile / custom centimeters

The system should translate this into real dimensions based on the configured tile size.

## Zone-aware mat capacity

When arranging mats inside a selected small area, calculate how many mats can fit using the current mat dimensions and spacing.

At minimum, show:

- maximum rows / columns that fit
- total mat capacity
- remaining horizontal / vertical clearance
- overflow amount when the requested layout exceeds the zone

Do not silently allow a preview to extend outside its intended zone without warning.

## Essential object behavior

Applicable objects support:

- select
- drag
- rotate
- duplicate
- delete
- undo
- redo
- multi-select
- box select
- lock
- show / hide
- tile/grid snap

Tables, chairs, and mats should support array placement / repeated layout.

## Door behavior

Doors are spatial objects that affect how users understand flow.

Support:

- position
- width
- opening direction
- opening arc / direction indicator

Routes should be visually understandable relative to doors.

## Object rendering style

Use lightweight, clear low-poly geometry.

Priority order:

1. accurate position and scale
2. clear interaction
3. mobile performance
4. visual polish

Avoid high-poly models, heavy materials, photorealistic rendering, or expensive effects.

## Route / flow map system

Create a dedicated flow-route editing mode.

A route is created by clicking:

start → intermediate points → end

Support:

- polyline paths
- directional arrows
- route name
- route color
- draggable route nodes
- deleting a node
- deleting a route
- show / hide

Suggested defaults:

- entrance flow
- registration flow
- shoe placement flow
- backpack placement flow
- seating / mat entry flow
- small-group movement
- staff flow

Allow custom route names.

The route tool should make workflows such as this easy to read:

Entrance → Shoe area → Registration → Backpack area → Mat / small-group area

## Views

Support at least:

- isometric 3D
- top view
- front
- left
- right

Top view is the primary precision planning view.

Camera changes must never alter scene data.

## Display layers / modes

Separate at least:

- large areas
- small zones
- objects
- floor tiles
- routes

Each can be shown / hidden independently.

Provide useful quick modes such as:

- Layout mode
- Zone mode
- Flow mode

Flow mode should visually de-emphasize unrelated scene elements so routes remain readable.

## Mobile UX

Do not shrink desktop UI onto phones.

Suggested bottom actions:

- Add
- Zones
- Routes
- View
- More

When an object is selected, expose contextual actions such as:

- Move
- Rotate
- Duplicate
- Delete

Touch behavior:

- one finger: select / drag
- two fingers: zoom
- two-finger drag: pan
- tap empty space: clear selection

Avoid forcing users to edit raw X/Y/Z coordinates for ordinary placement.

## Local-first persistence

No backend is required.

Persist:

- room / corridor dimensions
- tile settings
- calibration
- zones
- objects
- object dimensions and transforms
- routes
- view preferences

Provide autosave and named local layouts.

## Import / export

Support JSON project export and import so plans can be backed up manually.

Support image export for:

- top-view layout PNG
- isometric 3D PNG
- flow-map PNG

Exported images must not contain editor selection handles or UI chrome.

## Performance requirements

Design for mobile from the start.

Use strategies such as:

- shared geometry / materials
- `InstancedMesh` where appropriate for repeated chairs / mats
- render-on-demand where practical
- capped device pixel ratio on mobile
- lightweight geometry
- lazy loading for any optional GLB assets

Large repeated mat/chair layouts should remain interactive on ordinary phones.

## Validation and tests

Add automated or deterministic validation for core logic where practical.

Must verify at least:

- tile coordinate conversion
- snapping modes
- mat footprint calculations
- mat array width / depth calculations
- zone capacity / overflow calculations
- undo / redo
- local persistence and reload
- JSON import / export
- route create / edit / delete
- camera view switching
- production build

Manually verify mobile touch interactions and PWA install/offline behavior.

## Required end-to-end workflow

The feature is not complete until this workflow works:

1. Open the app.
2. Create a classroom and corridor.
3. Enter real classroom dimensions or calibrate from a known reference.
4. Configure the real floor-tile size.
5. See the tile grid at true scale.
6. Place a door and projection screen.
7. Add shoe, registration, life-team, backpack, instructor meditation, and small-group zones.
8. Add registration table and computer.
9. Place tables and chairs.
10. Choose real mat dimensions.
11. Preview a multi-row / multi-column mat layout.
12. Snap the mat layout to floor tiles.
13. See total mat count, occupied size, and overflow / clearance information.
14. Confirm the simulated mat layout.
15. Draw the participant flow route through the planned areas.
16. Switch between top and isometric views.
17. Save locally.
18. Reload and retain the plan.
19. Export project JSON.
20. Export a clean top-view and flow-map PNG.

## Definition of done

Do not ship placeholder buttons, mock-only UI, or README-only claims.

All primary interactions in the end-to-end workflow must be functional. Run available lint, typecheck, tests, and production build before considering implementation complete.
