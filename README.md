# Baltic Skies

Fly an airliner around the Baltic, in your phone's browser.

**Play: https://artisvitols.github.io/baltic-skies/**

Open it on a phone, turn the phone sideways, tap **FLY!**

You start lined up on runway 36 at Riga. Push the thrust up, roll down the
runway, lift the nose at about 290 km/h - and watch the wheels fold away.
Then fly anywhere: Tallinn, Helsinki, Vilnius, Liepāja, Visby… fourteen
airports, and you can land at any of them.

## Controls

| On screen | Keyboard | What it does |
|---|---|---|
| ▲ UP / ▼ DOWN | ↑ / ↓ | Nose up / nose down. Let go and the plane holds its climb or descent. |
| ◀ / ▶ | ← / → | Bank left / right (steers the nose wheel on the ground). Let go and the wings level. |
| + / − | W / S | Thrust. Hold for smooth, tap for 10 % steps. |
| GEAR | G | Wheels up / down. They also go up after take-off and down near an airport by themselves. |
| FLAPS | F | Flaps for slow flight and landing (1, 2, 3, FULL). |
| BRAKE | B / Space | Wheel brakes. After landing, thrust to 0 % brakes automatically. |
| CAM | C | Chase / far / cockpit view. Drag the sky to look around. |
| minimap | M | Big map - tap an airport to fly there. |

## Landing

Near the destination, green rings show the glide path to the runway, and the
four PAPI lights beside the runway say how you are doing: two white and two
red is perfect, all white is too high, all red is too low. Slow to about
280 km/h, keep the wings level, come down gently (CLIMB better than −4 m/s)
and touch down on the runway. Stars for a soft landing; a stamp in your
passport for every airport you visit.

## How it is made

Static site, no build step, vanilla ES modules and [three.js](https://threejs.org)
(vendored in `vendor/`). Nothing is downloaded that can be drawn: the plane is
built from code and painted on a canvas, the coastline is hand-placed lat/lon
polygons turned into a signed distance field, the land, forests, fields and
water are shaders, and the engine noise is synthesised. Distances between
places are squeezed (×0.14) so a flight takes minutes, while runways, the
aircraft and the trees are real size.

Built by Claude 🦀 - the crab on the loading screen.
