// Adapted from ripple-field/src/grid/contour.mjs (local source, 2026-10-28).
// Fixed anchors; ambient noise and a mouse-driven ripple change only dot size and ink.
export const vertexShader = `#version 300 es
precision highp float;
in vec2 aPosition;
uniform vec2 uSize;
uniform float uTime;
uniform float uDpr;
uniform float uMaxPointSize;
uniform vec2 uPointer;
uniform float uPointerStrength;
out float vAlpha;
#define A_TIME 1.35
#define A_NOISE_F 1.5
#define A_LEVELS 8.0
#define A_LINE_W 12.0
#define A_LINE_EDGE 0.25
#define A_WARP_AMP 1.6
#define A_WARP_F 0.55
#define A_WARP_SP 0.23
#define A_OCTAVES 2
#define A_WARP_OCTAVES 2

/* Per-corner gradient in [-1, 1]^2. From https://iquilezles.org/articles/gradientnoise/ */
vec2 ambHash(vec2 x) {
  vec2 k = vec2(0.3183099, 0.3678794);
  x = x * k + k.yx;
  return -1.0 + 2.0 * fract(16.0 * k * fract(x.x * x.y * (x.x + x.y)));
}

/*
 * Gradient noise: value in .x, analytic gradient in .yz. The derivative is what makes the
 * warped stack affordable in a vertex shader — a finite-difference gradient would cost three
 * full evaluations of the whole octave stack per vertex instead of one.
 */
vec3 ambNoised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);

  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

  vec2 ga = ambHash(i);
  vec2 gb = ambHash(i + vec2(1.0, 0.0));
  vec2 gc = ambHash(i + vec2(0.0, 1.0));
  vec2 gd = ambHash(i + vec2(1.0, 1.0));

  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));

  float k1 = vb - va;
  float k2 = vc - va;
  float k3 = va - vb - vc + vd;

  return vec3(
    va + u.x * k1 + u.y * k2 + u.x * u.y * k3,
    ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) +
      du * (u.yx * k3 + vec2(k1, k2))
  );
}

/* Value-only noise for the warp field, where the gradient is never needed. */
float ambNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  float va = dot(ambHash(i), f);
  float vb = dot(ambHash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float vc = dot(ambHash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float vd = dot(ambHash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));

  return va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd);
}

/* Value + gradient fBm. Octaves are rotated between steps so features never align to an axis. */
vec3 ambFbmd(vec2 x) {
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  mat2 rotI = mat2(0.8, -0.6, 0.6, 0.8);
  mat2 m = mat2(1.0, 0.0, 0.0, 1.0);
  float a = 0.0;
  float b = 0.5;
  vec2 d = vec2(0.0);
  for (int i = 0; i < A_OCTAVES; i++) {
    vec3 n = ambNoised(x);
    a += b * n.x;
    d += b * m * n.yz;
    b *= 0.55;
    x = 1.9 * rot * x;
    m = 1.9 * rotI * m;
  }
  return vec3(a, d);
}

float ambFbm(vec2 x) {
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  float a = 0.0;
  float b = 0.5;
  for (int i = 0; i < A_WARP_OCTAVES; i++) {
    a += b * ambNoise(x);
    b *= 0.55;
    x = 1.9 * rot * x;
  }
  return a;
}

/*
 * Ambient surface: contour band in .x (0 off a line, 1 on one), height gradient in .yz.
 *
 * Domain-warped gradient noise (https://iquilezles.org/articles/warp/). The generator is the
 * whole point: summed directional sine waves are anisotropic, so their level sets are always
 * long parallel bands, however hard you warp them. Isotropic noise scatters its extrema across
 * the plane, so contours close into the rounded cells a water surface actually shows.
 *
 * What reaches the dots is not the height but its level sets, drawn at even intervals the way a
 * topographic map draws a hill. Mapping height straight to dot size fills every cell edge to edge
 * and reads as cloud; drawing distance-to-contour instead leaves the interiors empty and produces
 * closed, nested, interconnected loops — which is the line character this is after.
 *
 * One warp level, not two. A second level adds structure at frequencies finer than a 6px dot
 * lattice can resolve, so it would spend evaluations producing aliasing rather than shape.
 */
vec3 ambientSurface(vec2 q, float t, float worldPerPx) {
  // The lattice offset is load-bearing, not decoration. ambHash folds on x*y*(x+y), which
  // collapses toward zero around the origin — and the origin is screen centre. Sampled in place
  // the field goes slack across the middle of the viewport and only develops texture at the
  // corners. Pushing the domain well away from zero keeps the gradients well distributed.
  vec2 p = q * A_NOISE_F + vec2(137.0, 219.0);
  vec2 drift = vec2(t * 0.11, t * 0.07) * A_WARP_SP * A_TIME;

  // The two warp components travel in opposite directions, so cells reshape in place rather
  // than sliding across the screen as one rigid pattern.
  vec2 w = vec2(
    ambFbm(p * A_WARP_F + drift),
    ambFbm(p * A_WARP_F + vec2(5.2, 1.3) - drift * 0.83)
  );

  vec3 n = ambFbmd(p + A_WARP_AMP * w);

  // Position within a contour band, folded about its midpoint to give distance to the nearest
  // band edge. Unclamped on purpose: clamping height would flatten the outermost rings into a
  // plateau, and a plateau has no gradient, so those lines would simply stop being drawn.
  float u = n.x * A_LEVELS;
  float f = fract(u);
  float toLine = min(f, 1.0 - f);

  // Dividing by the gradient turns that into a real screen distance, and is what holds the line
  // to an even weight. Without it bands balloon wherever the field flattens, so the drawing pools
  // into thick blots exactly where it should be at its thinnest. Near an extremum the gradient
  // vanishes and the nearest contour genuinely is far away, so the line fades out instead of
  // flooding the cell interior — the same reason a contour map leaves summits blank.
  vec2 gradU = n.yz * (A_NOISE_F * A_LEVELS);
  float distPx = toLine / max(length(gradU) * worldPerPx, 1e-4);

  // Full strength across the core, then a short falloff, rather than a smoothstep from zero.
  float line = 1.0 - smoothstep(A_LINE_W * A_LINE_EDGE, A_LINE_W, distPx);

  // The returned gradient is of the smooth height, not of the contour field. The contour value is
  // discontinuous at every band edge, so steering dot drift with it would tear the lattice along
  // each line. The warp's Jacobian is left out; it only steers a sub-pixel drift, and the exact
  // chain rule would cost two more fbm evaluations to correct a direction nobody can see.
  return vec3(line, n.yz * A_NOISE_F);
}


void main() {
  vec2 uv = aPosition / uSize;
  vec2 q = (aPosition - uSize * 0.5) * 2.0 / uSize.y;
  // Bend the sampled field around the mouse without displacing any grid anchors.
  vec2 delta = (aPosition - uPointer) * 2.0 / uSize.y;
  float radius = length(delta);
  float influence = exp(-dot(delta, delta) / 0.16) * uPointerStrength;
  float ripple = sin(radius * 22.0 - uTime * 3.2);
  q += delta / (radius + 0.15) * (0.09 * ripple * influence);
  float line = ambientSurface(q, uTime, 2.0 / uSize.y).x;
  float quiet = smoothstep(0.18, 0.7, length((uv - vec2(0.5, 0.44)) * vec2(1.8, 1.2)));
  vAlpha = (0.10 + 0.48 * line + 0.12 * influence) * mix(0.12, 1.0, quiet);
  gl_PointSize = min((1.0 + 2.3 * line + 0.65 * influence) * uDpr, uMaxPointSize);
  gl_Position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
}
`;

export const fragmentShader = `#version 300 es
precision mediump float;
uniform vec3 uInk;
in float vAlpha;
out vec4 outColor;
void main() {
  float radius = length(gl_PointCoord - 0.5);
  float edge = fwidth(radius);
  float coverage = 1.0 - smoothstep(0.5 - edge, 0.5, radius);
  outColor = vec4(uInk, vAlpha * coverage);
}
`;
