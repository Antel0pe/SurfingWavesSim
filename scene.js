export function createScene(engine, canvas) {
    // This creates a basic Babylon Scene object (non-mesh)
    var scene = new BABYLON.Scene(engine);

    // This creates and positions a free camera (non-mesh)
    var camera = new BABYLON.FreeCamera("camera1", new BABYLON.Vector3(0, 5, -10), scene);

    // This targets the camera to scene origin
    camera.setTarget(BABYLON.Vector3.Zero());

    // This attaches the camera to the canvas
    camera.attachControl(canvas, true);

    // Make sure the canvas has focus to receive key events
canvas.tabIndex = 1;
canvas.focus();

// WASD + arrows
camera.keysUp = [87, 38];     // W / ↑
camera.keysDown = [83, 40];   // S / ↓
camera.keysLeft = [65, 37];   // A / ←
camera.keysRight = [68, 39];  // D / →
camera.speed = 1.0;           // movement speed (units per frame)
camera.inertia = 0.7;         // lower = snappier stops


    // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
    var light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);

    // Default intensity is 1. Let's dim the light a small amount
    light.intensity = 0.7;


    // --- Denser ground so vertex displacement has detail ---
    var ground = BABYLON.MeshBuilder.CreateGround(
        "ground",
        { width: 10, height: 10, subdivisionsX: 200, subdivisionsY: 300 },
        scene
    );

    // --- Minimal custom shader: displace Y = f(X,Z) in the vertex stage ---
    BABYLON.Effect.ShadersStore["beachVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;

// Base linear slope (drop per world-unit of Z) and a height offset
uniform float uSlope;
uniform float uOffset;

// Optional "sand bar" band centered at some Z with a width
uniform float uBandCenterZ;
uniform float uBandWidth;

// Along-shore atoll pattern: cosine comb along X
uniform float uAmp;       // mound amplitude
uniform float uPeriod;    // spacing along X (world units)
uniform float uSharpness; // >=1, higher => sharper crests

varying float vH; // pass height to fragment for simple coloring
const float angleOfSlop = 0.1;
const float amountShorelineVisible = 0.25;

void main(void) {
  float x = position.x;
  float z = position.z;

  float y;
  if (2.0 <= x && x <= 4.0){
      float xSlope = cos(x-2.0) / 2.0;
      float zSlope = cos(z-2.0)/2.0 - 0.25;
      y = max(angleOfSlop*-position.x-amountShorelineVisible, xSlope + zSlope);
  } else {
      y = angleOfSlop*-position.x-amountShorelineVisible;
  }

    vec4 p = vec4(position.x, y, position.z, 1.0);
  gl_Position = worldViewProjection * p;
}
`;

    BABYLON.Effect.ShadersStore["beachFragmentShader"] = `
precision highp float;
varying float vH;
void main(void) {
  // Simple height-based color (greens for sand/shallows)
//   float t = clamp(vH * 0.1 + 0.5, 0.0, 1.0);
//   vec3 shallow = vec3(0.85, 0.78, 0.55);
//   vec3 deep    = vec3(0.15, 0.35, 0.55);
//   vec3 col = mix(deep, shallow, t);
//   gl_FragColor = vec4(col, 1.0);
}
`;

    var mat = new BABYLON.ShaderMaterial(
        "beachMat",
        scene,
        { vertex: "beach", fragment: "beach" },
        {
            attributes: ["position", "uv"],
            uniforms: [
                "worldViewProjection",
                "uSlope", "uOffset",
                "uBandCenterZ", "uBandWidth",
                "uAmp", "uPeriod", "uSharpness"
            ]
        }
    );

    // Set some sensible first-pass params (tweak live)
    mat.setFloat("uSlope", 0.05);        // drop 0.05 units per Z unit
    mat.setFloat("uOffset", 1.0);        // lift nearshore a bit
    mat.setFloat("uBandCenterZ", 0.0);   // band centered near mesh middle (Z=0)
    mat.setFloat("uBandWidth", 8.0);     // half-width of the band
    mat.setFloat("uAmp", 0.6);           // bar amplitude
    mat.setFloat("uPeriod", 6.0);        // along-shore spacing
    mat.setFloat("uSharpness", 1.8);     // 1 = pure cosine, higher = sharper

    ground.material = mat;

    // Optional: put a "waterline" at Y=0 so the slope reads
    var water = BABYLON.MeshBuilder.CreateGround("water", { width: 40, height: 60 }, scene);
    water.position.y = 0.0;
    var wmat = new BABYLON.StandardMaterial("wmat", scene);
    wmat.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.8);
    wmat.alpha = 0.25;
    wmat.backFaceCulling = false;
    water.material = wmat;

    return scene;
};