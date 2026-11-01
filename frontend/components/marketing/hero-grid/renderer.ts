import { fragmentShader, vertexShader } from "./shaders";

export type GridRenderer = { setPaused: (paused: boolean) => void; destroy: () => void };

/** One static point buffer, one draw, no React updates on the animation path. */
export function createGridRenderer(canvas: HTMLCanvasElement): GridRenderer | null {
  const context = canvas.getContext("webgl2", {
    alpha: true, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: true, powerPreference: "low-power",
  });
  if (!context) return null;
  const gl: WebGL2RenderingContext = context;

  function compile(type: number, source: string) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  }
  const vertex = compile(gl.VERTEX_SHADER, vertexShader);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentShader);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    if (program) gl.deleteProgram(program);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  const buffer = gl.createBuffer();
  if (!buffer) { gl.deleteProgram(program); return null; }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const position = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const sizeUniform = gl.getUniformLocation(program, "uSize");
  const timeUniform = gl.getUniformLocation(program, "uTime");
  const dprUniform = gl.getUniformLocation(program, "uDpr");
  const inkUniform = gl.getUniformLocation(program, "uInk");
  const pointerUniform = gl.getUniformLocation(program, "uPointer");
  const pointerStrengthUniform = gl.getUniformLocation(program, "uPointerStrength");
  const maxPointSize = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
  const viewportLimits: Int32Array = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  const maxAxis = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), viewportLimits[0], viewportLimits[1]);
  gl.uniform1f(gl.getUniformLocation(program, "uMaxPointSize"), maxPointSize);
  gl.clearColor(0, 0, 0, 0);

  let frame = 0;
  let disposed = false;
  let paused = false;
  let visible = true;
  let width = 0;
  let height = 0;
  let dpr = 0;
  let count = 0;
  let time = 0;
  let previous: number | null = null;
  let lastPaint = -Infinity;
  const hover = matchMedia("(any-hover: hover) and (any-pointer: fine)");
  let clientX = 0, clientY = 0;
  let pointerX = 0, pointerY = 0, targetX = 0, targetY = 0;
  let pointerStrength = 0, targetStrength = 0;
  let pointerPending = false, pointerKnown = false;
  const canDraw = () => !disposed && !gl.isContextLost() && visible && !document.hidden && width > 0 && height > 0;
  function resetPointer() {
    pointerStrength = targetStrength = 0;
    pointerKnown = pointerPending = false;
  }
  function pointerMove(event: PointerEvent) {
    if (event.pointerType !== "mouse" || !hover.matches || paused || !canDraw()) return;
    clientX = event.clientX; clientY = event.clientY;
    pointerPending = true;
  }
  function pointerLeave() { targetStrength = 0; pointerKnown = pointerPending = false; }
  function pointerOut(event: PointerEvent) { if (event.pointerType === "mouse" && !event.relatedTarget) pointerLeave(); }
  function scroll() { if (pointerKnown && !paused && canDraw()) pointerPending = true; }
  function stepPointer(delta: number) {
    if (!hover.matches) pointerLeave();
    // Pointer events only record input; sample layout at most once per frame.
    if (pointerPending) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left, y = clientY - rect.top;
      targetStrength = x >= 0 && y >= 0 && x <= width && y <= height ? 1 : 0;
      if (targetStrength) {
        targetX = x; targetY = y;
        if (!pointerKnown) { pointerX = x; pointerY = y; pointerKnown = true; }
      }
      pointerPending = false;
    }
    const follow = 1 - Math.exp(-12 * delta);
    pointerX += (targetX - pointerX) * follow;
    pointerY += (targetY - pointerY) * follow;
    pointerStrength += (targetStrength - pointerStrength) * (1 - Math.exp(-8 * delta));
    if (!targetStrength && pointerStrength < 0.001) pointerStrength = 0;
  }
  const draw = () => {
    if (!canDraw()) return;
    gl.uniform1f(timeUniform, time);
    gl.uniform2f(pointerUniform, pointerX, pointerY);
    gl.uniform1f(pointerStrengthUniform, pointerStrength);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, count);
  };
  function tick(now: number) {
    frame = 0;
    if (!canDraw() || paused) { previous = null; return; }
    const delta = previous === null ? 1 / 60 : Math.min(now - previous, 50) / 1000;
    if (previous !== null) time += delta;
    stepPointer(delta);
    previous = now;
    if (now - lastPaint >= 1000 / 30) { draw(); lastPaint = now; }
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previous = null;
    if (!canDraw()) resetPointer();
    if (canDraw() && !paused) frame = requestAnimationFrame(tick);
  }
  function resize() {
    if (disposed || gl.isContextLost()) return;
    const rect = canvas.getBoundingClientRect();
    const nextDpr = Math.min(
      window.devicePixelRatio || 1, 1.5,
      Math.sqrt(2_000_000 / Math.max(1, rect.width * rect.height)),
      maxAxis / Math.max(1, rect.width, rect.height),
    );
    if (width === rect.width && height === rect.height && dpr === nextDpr) return;
    width = rect.width; height = rect.height; dpr = nextDpr;
    resetPointer();
    if (width <= 0 || height <= 0) { sync(); return; }
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Bound work on large displays without increasing the moving-dot size.
    const pitch = Math.max(7, Math.sqrt(width * height / 24000));
    const columns = Math.floor(width / pitch);
    const rows = Math.floor(height / pitch);
    count = columns * rows;
    const points = new Float32Array(count * 2);
    const left = (width - (columns - 1) * pitch) / 2;
    const top = (height - (rows - 1) * pitch) / 2;
    for (let row = 0, i = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        points[i++] = left + column * pitch;
        points[i++] = top + row * pitch;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW);
    gl.uniform2f(sizeUniform, width, height);
    gl.uniform1f(dprUniform, dpr);
    draw();
    sync();
  }
  function updateColor() {
    if (disposed || gl.isContextLost()) return;
    const color = getComputedStyle(canvas).color.match(/[\d.]+/g)?.map(Number);
    if (color && color.length >= 3) gl.uniform3f(inkUniform, color[0] / 255, color[1] / 255, color[2] / 255);
    draw();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
  intersection.observe(canvas);
  const themeObserver = new MutationObserver(updateColor);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", pointerMove, { passive: true });
  window.addEventListener("pointerout", pointerOut, { passive: true });
  window.addEventListener("blur", pointerLeave);
  window.addEventListener("scroll", scroll, { passive: true });
  updateColor();
  resize();

  return {
    setPaused(value) { paused = value; if (value) resetPointer(); sync(); },
    destroy() {
      if (disposed) return;
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerout", pointerOut);
      window.removeEventListener("blur", pointerLeave);
      window.removeEventListener("scroll", scroll);
      // A lost context already owns disposal; deleting stale objects can emit GL errors.
      if (!gl.isContextLost()) { gl.deleteBuffer(buffer); gl.deleteProgram(program); }
    },
  };
}
