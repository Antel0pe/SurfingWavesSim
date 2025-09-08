const DOMAIN = {
  minX: -5.0, maxX: 5.0,
  minZ: -5.0, maxZ: 5.0
};

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
    camera.keysUpward = [32];   // space bar
camera.keysDownward = [16]; // shift

camera.speed = 1.0;           // movement speed (units per frame)
camera.inertia = 0.7;         // lower = snappier stops


    // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
    var light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);

    // Default intensity is 1. Let's dim the light a small amount
    light.intensity = 0.7;
// --- 1) Domain mapping (world <-> texture) ---
// Match the ground you plan to render. If you CreateGround({width:10,height:10}) the x/z range is [-5..+5].

// Your analytic parameters (same ones you currently use in the vertex shader)
const params = {
  uSlope: 0.1,                 // angleOfSlop (rename for clarity if you like)
  uOffset: 0.25,               // amountShorelineVisible (sign-bias)
  atollXMin: 2.0,
  atollXMax: 4.0,
  atollCenterX: 3.0,           // used in cos((x-3.0))
  atollCenterZ: 3.0            // used in cos((z-3.0))
};

// --- 2) Allocate a float RenderTargetTexture for height (R32F via RGBA32F) ---
const heightSize = 512; // 512x512 is plenty to start; bump to 1024 if you need crisper gradients
const heightRTT = new BABYLON.RenderTargetTexture(
  "heightRTT",
  { width: heightSize, height: heightSize },
    scene,
  
  false,                                  // generateMipMaps
  true,                                   // doNotChangeAspectRatio
  BABYLON.Constants.TEXTURETYPE_FLOAT,    // use 32F if available; Babylon will fall back to 16F if needed
  false,                                  // isCube
  BABYLON.Constants.TEXTUREFORMAT_RED,    // store only height in R if supported (engine may promote to RGBA)
  true                                    // noColorAttachment? (false keeps color; true avoids depth)
);
heightRTT.wrapU = heightRTT.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    heightRTT.refreshRate = 1; // we'll bake once, on demand

// --- 3) Tiny offscreen quad + ortho camera to "draw" into the RTT ---
const bakeQuad = BABYLON.MeshBuilder.CreatePlane("bakeQuad", { size: 2 }, scene);
    bakeQuad.position.set(0, 0, 0);
    bakeQuad.setEnabled(true);

const bakeCam = new BABYLON.FreeCamera("bakeCam", new BABYLON.Vector3(0, 0, -1), scene);
bakeCam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
// Make the quad exactly fill the view
bakeCam.orthoLeft   = -1;
bakeCam.orthoRight  =  1;
bakeCam.orthoTop    =  1;
bakeCam.orthoBottom = -1;
bakeCam.setTarget(BABYLON.Vector3.Zero());

// Link the RTT to render only our bake quad with the bake camera
heightRTT.renderList = [bakeQuad];
heightRTT.activeCamera = bakeCam;
heightRTT.ignoreCameraViewport = true;

// --- 4) Bake shader (fragment computes height at each texel) ---
BABYLON.Effect.ShadersStore["bakeHeightVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUV;
void main() {
  vUV = uv;
  gl_Position = vec4(position, 1.0); // full-screen plane in clip space using ortho cam
}
`;

BABYLON.Effect.ShadersStore["bakeHeightFragmentShader"] = `
precision highp float;
varying vec2 vUV;

// World-domain mapping
uniform float minX, maxX, minZ, maxZ;

// Your analytic params
uniform float uSlope;    // matches your angleOfSlop
uniform float uOffset;   // matches your amountShorelineVisible
uniform float atollXMin, atollXMax;
uniform float atollCenterX, atollCenterZ;

// Compute the same height you had in the vertex shader, but here in the fragment
void main() {
  // Map UV -> world x,z
  float x = mix(minX, maxX, vUV.x);
  float z = mix(minZ, maxZ, vUV.y);

  float defaultHeight = uSlope * (-x) - uOffset;

  float y;
  if (x >= atollXMin && x <= atollXMax) {
    float xSlope = cos(x - atollCenterX);
    float zSlope = cos(z - atollCenterZ);
    float calculatedAtollHeight = xSlope + zSlope - 2.0;
    y = max(defaultHeight, calculatedAtollHeight);
  } else {
    y = defaultHeight;
  }

  // Store in RED channel. If GPU promotes to RGBA, other channels are don't-care.
  gl_FragColor = vec4(y, defaultHeight, 0.0, 1.0);
}
`;

// Material to bake height
const bakeMat = new BABYLON.ShaderMaterial(
  "bakeHeightMat",
  scene,
  { vertex: "bakeHeight", fragment: "bakeHeight" },
  {
    attributes: ["position", "uv"],
    uniforms: [
      "minX","maxX","minZ","maxZ",
      "uSlope","uOffset",
      "atollXMin","atollXMax","atollCenterX","atollCenterZ"
    ]
  }
);
// Set uniforms (same truth you use for the ground)
bakeMat.setFloat("minX", DOMAIN.minX);
bakeMat.setFloat("maxX", DOMAIN.maxX);
bakeMat.setFloat("minZ", DOMAIN.minZ);
bakeMat.setFloat("maxZ", DOMAIN.maxZ);
bakeMat.setFloat("uSlope", params.uSlope);
bakeMat.setFloat("uOffset", params.uOffset);
bakeMat.setFloat("atollXMin", params.atollXMin);
bakeMat.setFloat("atollXMax", params.atollXMax);
bakeMat.setFloat("atollCenterX", params.atollCenterX);
bakeMat.setFloat("atollCenterZ", params.atollCenterZ);

bakeQuad.material = bakeMat;

// Attach the RTT to the scene so it renders; then freeze it to bake-once
scene.customRenderTargets = scene.customRenderTargets || [];
scene.customRenderTargets.push(heightRTT);

heightRTT.onAfterUnbindObservable.addOnce(() => {
  // 1) lock sampling to base (already nearest + no mips)
  // 2) prevent any further render passes by removing it from the scene list
  const i = scene.customRenderTargets.indexOf(heightRTT);
  if (i !== -1) scene.customRenderTargets.splice(i, 1);

  // 3) only now is it safe to disable the quad
  bakeQuad.setEnabled(false);
});

// --- 5) Replace your ground material to SAMPLE the baked height in the vertex shader ---
// New vertex/fragment that consume sampler2D heightTex:
BABYLON.Effect.ShadersStore["beachFromHeightVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;

uniform mat4 worldViewProjection;
uniform sampler2D heightTex;

// Same domain mapping as baker
uniform float minX, maxX, minZ, maxZ;

varying float vH;
varying float sandAtollHeight; // keep for your color logic if you want

void main() {
  // Sample baked height at this vertex's UV
  float y = texture2D(heightTex, uv).r;
  float defaultHeight = texture2D(heightTex, uv).g;

  // (Optional) Recompute sandAtollHeight-style mask if you still need it, otherwise set 0.
  sandAtollHeight = y - defaultHeight;

  vH = y;
  gl_Position = worldViewProjection * vec4(position.x, y, position.z, 1.0);
}
`;

BABYLON.Effect.ShadersStore["beachFromHeightFragmentShader"] = `
precision highp float;
varying float vH;
varying float sandAtollHeight;
void main() {
  if (sandAtollHeight > 0.0) {
    gl_FragColor = vec4(0.8, 0.65, 0.38, 1.0);
  } else if (vH > 0.0) {
    gl_FragColor = vec4(0.9, 0.8, 0.5, 1.0);
  } else {
    gl_FragColor = vec4(0.45, 0.31, 1.0, 1.0);
  }
}
`;

// Create your ground AFTER the baker is set up, so UVs match the domain [0..1] across X/Z
const ground = BABYLON.MeshBuilder.CreateGround(
  "ground",
  { width: 10, height: 10, subdivisionsX: 200, subdivisionsY: 300 },
  scene
);

// Ground material that uses the baked height texture
const groundMat = new BABYLON.ShaderMaterial(
  "beachFromHeightMat",
  scene,
  { vertex: "beachFromHeight", fragment: "beachFromHeight" },
  {
    attributes: ["position", "uv"],
    uniforms: ["worldViewProjection", "minX","maxX","minZ","maxZ"],
    samplers: ["heightTex"]
  }
    );
    
// Bind the RTT as the height sampler
groundMat.setTexture("heightTex", heightRTT);
groundMat.setFloat("minX", DOMAIN.minX);
groundMat.setFloat("maxX", DOMAIN.maxX);
groundMat.setFloat("minZ", DOMAIN.minZ);
groundMat.setFloat("maxZ", DOMAIN.maxZ);

ground.material = groundMat;


    // Optional: put a "waterline" at Y=0 so the slope reads
    var water = BABYLON.MeshBuilder.CreateGround("water", { width: 40, height: 60 }, scene);
    water.position.y = 0.0;
    var wmat = new BABYLON.StandardMaterial("wmat", scene);
    wmat.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.8);
    wmat.alpha = 0.25;
    wmat.backFaceCulling = false;
    water.material = wmat;

    // particles(scene);
    simpleParticles(scene, heightRTT);
    

    return scene;
};
function simpleParticles(scene, heightTex) {
  const TEX_SIZE = 32; // 10x10 grid 
    const GRID = 10;                   // 10 x 10 x 10
  const COUNT = GRID * GRID * GRID; // 1000

  // --- Create two RTTs ---
  function makeRTT(name) {
    const tex = new BABYLON.RenderTargetTexture(
      name,
      { width: TEX_SIZE, height: TEX_SIZE },
      scene,
      false, true,
      BABYLON.Constants.TEXTURETYPE_FLOAT
    );
    tex.wrapU = tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    tex.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
    tex.refreshRate = 0; // no auto updates
    return tex;
  }

  let posA = makeRTT("posA");
  let posB = makeRTT("posB");

  const fxr = new BABYLON.EffectRenderer(scene.getEngine());

  // --- Init shader ---
  const initFx = new BABYLON.EffectWrapper({
    engine: scene.getEngine(),
    name: "initPos",
    vertexShader: `
      precision highp float;
      attribute vec2 position;
      varying vec2 vUV;
      void main() {
        vUV = (position + 1.0) * 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUV;
      uniform float texSize; 
      uniform float grid;    

      void main() {
        // linear texel id in [0 .. texSize*texSize-1]
        vec2 ij = floor(vUV * texSize);
        float id = ij.x + ij.y * texSize;

        float G = grid;
        float plane = G * G;

        // id -> (x,y,z) in [0..G-1]
        float z = floor(id / plane);
        float rem = id - z * plane;
        float y = floor(rem / G);
        float yNorm = y / (G - 1.0);
        float yScaled = yNorm * 2.0 + 2.5;
        float x = rem - y * G;
        x+= 10.0;

        // center the cube around origin; spacing = 1.0
        vec3 p = vec3(x, yScaled, z) - vec3((G - 1.0) * 0.5);

        gl_FragColor = vec4(p, 1.0);
      }
    `,
    uniformNames: ["texSize", "grid"]
  });
    
initFx.onApplyObservable.add(() => {
  const e = initFx.effect;
  e.setFloat("texSize", 32.0);
  e.setFloat("grid", 10.0);
});
    

  fxr.render(initFx, posA);

    // --- Copy shader ---
  const updateFx = new BABYLON.EffectWrapper({
    engine: scene.getEngine(),
    name: "copy",
    vertexShader: `
      precision highp float;
      attribute vec2 position;
      varying vec2 vUV;
      void main() {
        vUV = (position + 1.0) * 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `,
    fragmentShader: `
precision highp float;
varying vec2 vUV;

uniform sampler2D srcTex;     // particle positions (R16/32F)
uniform sampler2D heightTex;  // baked height, .r channel

// SAME domain you used when baking the height texture
uniform float minX, maxX, minZ, maxZ;

// helper: world xz -> height UV
vec2 xzToUV(vec2 xz) {
  float u = (xz.x - minX) / (maxX - minX);
  float v = (xz.y - minZ) / (maxZ - minZ);
  return clamp(vec2(u, v), 0.0, 1.0);
}

void main() {
  // 1) read current particle position
  vec3 p = texture2D(srcTex, vUV).xyz;

  // 2) sample height at this particle’s x,z
  vec2 uvH = xzToUV(p.xz);
  float h = texture2D(heightTex, uvH).r;

  // 3) collision-ish rule: if particle is below surface, pop it up
//   if (p.y < h) {
//     // choose your policy:
//     // (a) teleport:
//     p.y = 10.0;

//     // (b) place on surface with a small lift:
//     // p.y = h + 0.05;
//   } else {
//     p.x -= 0.01;
//     }

p.x -= 0.01;
p.y = h;
  // 4) write new position (keep x,z unchanged, you can add your own x/z motion)
  gl_FragColor = vec4(p, 1.0);
}

    `,
      samplerNames: ["srcTex", "heightTex"],
      uniformNames: ["minX","maxX","minZ","maxZ"]
  });
    updateFx.onApply = (effect) => {
  effect.setTexture("heightTex", heightTex);
  effect.setFloat("minX", DOMAIN.minX);
  effect.setFloat("maxX", DOMAIN.maxX);
  effect.setFloat("minZ", DOMAIN.minZ);
  effect.setFloat("maxZ", DOMAIN.maxZ);

  // also bind the current read texture each frame
  effect.setTexture("srcTex", readTex);
};

  // --- Particle shaders ---
  BABYLON.Effect.ShadersStore["particlesVertexShader"] = `
    precision highp float;
    attribute vec3 position;
    attribute float instanceParticleIndex;

    uniform mat4 worldViewProjection;
    uniform sampler2D posTex;
    uniform float texSize;

    vec2 idToUV(float id, float N) {
      float x = mod(id, N);
      float y = floor(id / N);
      return (vec2(x, y) + 0.5) / N;
    }

    void main() {
      vec2 uv = idToUV(instanceParticleIndex, texSize);
      vec3 worldPos = texture2D(posTex, uv).xyz;
      gl_Position = worldViewProjection * vec4(worldPos + position * 0.1, 1.0);
    }
  `;

  BABYLON.Effect.ShadersStore["particlesFragmentShader"] = `
    precision highp float;
    void main() {
      gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0);
    }
  `;

  // --- Mesh setup ---
  const sprite = BABYLON.MeshBuilder.CreateSphere("sprite", { diameter: 1 }, scene);

  // identity matrices
  const matrices = new Float32Array(COUNT * 16);
  for (let i = 0; i < COUNT; i++) {
    const o = i * 16;
    matrices[o] = matrices[o+5] = matrices[o+10] = matrices[o+15] = 1;
  }
  sprite.thinInstanceSetBuffer("matrix", matrices, 16);

  // index buffer
  const idx = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) idx[i] = i;
  sprite.thinInstanceSetBuffer("instanceParticleIndex", idx, 1);

  // shader material
  const mat = new BABYLON.ShaderMaterial(
    "particlesMat",
    scene,
    { vertex: "particles", fragment: "particles" },
    {
      attributes: ["position", "instanceParticleIndex"],
      uniforms: ["worldViewProjection", "texSize"],
      samplers: ["posTex"]
    }
  );
  mat.setFloat("texSize", TEX_SIZE);
  sprite.material = mat;

  sprite.thinInstanceBufferUpdated("matrix");
  sprite.thinInstanceBufferUpdated("instanceParticleIndex");

  // --- Ping-pong loop ---
  let readTex  = posA; // scene samples this
  let writeTex = posB; // compute writes here

  mat.setTexture("posTex", readTex); // initial bind

scene.onBeforeRenderObservable.add(() => {
  updateFx.onApply = (effect) => effect.setTexture("srcTex", readTex);
  fxr.render(updateFx, writeTex);
});

scene.onAfterRenderObservable.add(() => {
    // 3) swap so next frame reads what we just wrote
    const tmp = readTex;
    readTex = writeTex;
    writeTex = tmp;

    // binding the scene to render the writeTex for next frame
    mat.setTexture("posTex", writeTex);
});

}
