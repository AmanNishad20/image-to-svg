/* IMG→SVG — raster to vector converter, fully client-side.
   Engine: ImageTracer.js v1.2.6 (public domain / Unlicense). */

const $ = (id) => document.getElementById(id);

const stage = $("stage");
const dropzone = $("dropzone");
const compare = $("compare");
const svgLayer = $("svgLayer");
const origImg = $("origImg");
const divider = $("divider");
const busy = $("busy");
const fileInput = $("fileInput");
const toast = $("toast");

const presetSel = $("preset");
const colorsIn = $("colors");
const detailIn = $("detail");
const noiseIn = $("noise");
const blurIn = $("blur");
const linefilterSw = $("linefilter");
const rightangleSw = $("rightangle");
const graysrcSw = $("graysrc");

const downloadBtn = $("downloadBtn");
const copyBtn = $("copyBtn");
const replaceBtn = $("replaceBtn");

const MAX_TRACE_DIM = 1200; // px — larger source images are downscaled before tracing

const state = {
  fileName: "image",
  imgData: null,      // ImageData ready for tracing
  traceW: 0,
  traceH: 0,
  svgString: null,
  traceTimer: null,
  busyCount: 0,
};

const PRESETS = {
  poster: { colors: 8,  detail: 1.0, noise: 8, blur: 0, linefilter: false, gray: false },
  photo:  { colors: 24, detail: 0.7, noise: 2, blur: 0, linefilter: false, gray: false },
  gray:   { colors: 8,  detail: 1.0, noise: 8, blur: 0, linefilter: false, gray: true },
  line:   { colors: 2,  detail: 2.0, noise: 4, blur: 1, linefilter: true,  gray: true },
};

/* ---------------- helpers ---------------- */

function showToast(msg, ok = false) {
  toast.textContent = msg;
  toast.classList.toggle("ok", ok);
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2600);
}

function fmtKB(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function setBusy(on) {
  state.busyCount = Math.max(0, state.busyCount + (on ? 1 : -1));
  busy.classList.toggle("on", state.busyCount > 0);
}

function getSwitch(btn) {
  return btn.getAttribute("aria-checked") === "true";
}
function setSwitch(btn, val) {
  btn.setAttribute("aria-checked", String(!!val));
}

/* ---------------- file intake ---------------- */

function openFileDialog() { fileInput.click(); }

dropzone.addEventListener("click", openFileDialog);
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFileDialog(); }
});
replaceBtn.addEventListener("click", resetToDropzone);

fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((ev) =>
  stage.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragging");
  })
);
["dragleave", "drop"].forEach((ev) =>
  stage.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragging");
  })
);
stage.addEventListener("drop", (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) handleFile(f);
});

function handleFile(file) {
  if (!file.type.startsWith("image/")) {
    showToast("Not an image file — try PNG, JPG, WebP, GIF or BMP");
    return;
  }
  if (file.size > 30 * 1024 * 1024) {
    showToast("File is over 30 MB — please use a smaller image");
    return;
  }
  state.fileName = (file.name || "image").replace(/\.[^.]+$/, "");

  const reader = new FileReader();
  reader.onerror = () => showToast("Could not read that file");
  reader.onload = () => loadImage(String(reader.result));
  reader.readAsDataURL(file);
}

function loadImage(dataURL) {
  const img = new Image();
  img.onload = () => {
    try {
      const scale = Math.min(1, MAX_TRACE_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);

      state.imgData = ctx.getImageData(0, 0, w, h);
      state.traceW = w;
      state.traceH = h;

      origImg.src = dataURL;
      enterCompareMode(w / h);
      applyPreset(presetSel.value, { silent: true });
      trace();
    } catch (err) {
      console.error(err);
      showToast("This image could not be decoded");
    }
  };
  img.onerror = () => {
    showToast("This image could not be decoded");
  };
  img.src = dataURL;
}

function resetToDropzone() {
  state.imgData = null;
  state.svgString = null;
  compare.classList.remove("ready");
  compare.style.display = "none";
  dropzone.style.display = "flex";
  svgLayer.innerHTML = "";
  downloadBtn.disabled = true;
  copyBtn.disabled = true;
  ["stDims", "stPaths", "stColors", "stSize", "stTime"].forEach((id) => ($(id).textContent = "—"));
  const palette = $("palette");
  palette.classList.remove("on");
  palette.querySelectorAll(".chip").forEach((c) => c.remove());
}

/* ---------------- compare view ---------------- */

function enterCompareMode(aspect) {
  dropzone.style.display = "none";
  compare.classList.add("ready");
  compare.style.display = "block";
  sizeCompare(aspect);
  setSplit(50);
}

function sizeCompare(aspect) {
  const pad = 48;
  const availW = stage.clientWidth - pad;
  const availH = stage.clientHeight - pad;
  let w = availW;
  let h = w / aspect;
  if (h > availH) { h = availH; w = h * aspect; }
  compare.style.width = Math.max(80, Math.floor(w)) + "px";
  compare.style.height = Math.max(80, Math.floor(h)) + "px";
}

window.addEventListener("resize", () => {
  if (state.imgData && state.traceH) sizeCompare(state.traceW / state.traceH);
});

function setSplit(pct) {
  const p = Math.min(100, Math.max(0, pct));
  compare.style.setProperty("--split", p + "%");
  divider.setAttribute("aria-valuenow", String(Math.round(p)));
}

let dragging = false;
divider.addEventListener("pointerdown", (e) => {
  dragging = true;
  divider.setPointerCapture(e.pointerId);
});
window.addEventListener("pointerup", () => { dragging = false; });
window.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const r = compare.getBoundingClientRect();
  setSplit(((e.clientX - r.left) / r.width) * 100);
});
divider.addEventListener("keydown", (e) => {
  const cur = parseFloat(divider.getAttribute("aria-valuenow")) || 50;
  if (e.key === "ArrowLeft") { e.preventDefault(); setSplit(cur - 2); }
  if (e.key === "ArrowRight") { e.preventDefault(); setSplit(cur + 2); }
  if (e.key === "Home") { e.preventDefault(); setSplit(0); }
  if (e.key === "End") { e.preventDefault(); setSplit(100); }
});

/* ---------------- controls ---------------- */

presetSel.addEventListener("change", () => applyPreset(presetSel.value));

function applyPreset(name, opts = {}) {
  const p = PRESETS[name];
  if (!p) return;
  colorsIn.value = p.colors;
  detailIn.value = p.detail;
  noiseIn.value = p.noise;
  blurIn.value = p.blur;
  setSwitch(linefilterSw, p.linefilter);
  setSwitch(graysrcSw, p.gray);
  syncLabels();
  if (!opts.silent && state.imgData) scheduleTrace();
}

function markCustom() {
  presetSel.value = "custom";
}

[colorsIn, detailIn, noiseIn, blurIn].forEach((input) => {
  input.addEventListener("input", () => {
    syncLabels();
    markCustom();
    scheduleTrace();
  });
});

function bindSwitch(btn) {
  btn.addEventListener("click", () => {
    setSwitch(btn, !getSwitch(btn));
    markCustom();
    scheduleTrace();
  });
}
[linefilterSw, rightangleSw, graysrcSw].forEach(bindSwitch);

function syncLabels() {
  $("colorsVal").textContent = colorsIn.value;
  $("detailVal").textContent = Number(detailIn.value).toFixed(1);
  $("noiseVal").textContent = noiseIn.value + " px";
  $("blurVal").textContent = blurIn.value;
}

/* ---------------- tracing ---------------- */

function scheduleTrace() {
  if (!state.imgData) return;
  clearTimeout(state.traceTimer);
  state.traceTimer = setTimeout(trace, 350);
}

function buildOptions() {
  const detail = Number(detailIn.value);
  return {
    ltres: detail,
    qtres: detail,
    pathomit: Number(noiseIn.value),
    rightangleenhance: getSwitch(rightangleSw),
    colorsampling: 2,
    numberofcolors: Number(colorsIn.value),
    mincolorratio: 0,
    colorquantcycles: 3,
    layering: 0,
    strokewidth: 1,
    linefilter: getSwitch(linefilterSw),
    scale: 1,
    roundcoords: 1,
    viewbox: true,
    desc: false,
    blurradius: Number(blurIn.value),
    blurdelta: 24,
  };
}

function grayscaleImageData(imgd) {
  const copy = new ImageData(new Uint8ClampedArray(imgd.data), imgd.width, imgd.height);
  const d = copy.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  return copy;
}

function trace() {
  if (!state.imgData) return;
  setBusy(true);
  downloadBtn.disabled = true;
  copyBtn.disabled = true;

  // let the overlay paint before the synchronous trace blocks the main thread
  setTimeout(() => {
    const t0 = performance.now();
    try {
      const src = getSwitch(graysrcSw) ? grayscaleImageData(state.imgData) : state.imgData;
      const options = buildOptions();
      const svgstr = ImageTracer.imagedataToSVG(src, options);
      const elapsed = performance.now() - t0;
      onTraceDone(svgstr, elapsed);
    } catch (err) {
      console.error(err);
      setBusy(false);
      showToast("Tracing failed — try fewer colors or a smaller image");
    }
  }, 60);
}

function onTraceDone(svgstr, elapsed) {
  state.svgString = svgstr;

  svgLayer.innerHTML = svgstr;
  const svgEl = svgLayer.querySelector("svg");
  if (svgEl) {
    svgEl.removeAttribute("width");
    svgEl.removeAttribute("height");
    svgEl.style.width = "100%";
    svgEl.style.height = "100%";
    svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }

  const pathCount = (svgstr.match(/<path/g) || []).length;
  const fills = [...new Set([...svgstr.matchAll(/fill="(rgb\([^)]+\))"/g)].map((m) => m[1]))];

  $("stDims").textContent = state.traceW + " × " + state.traceH;
  $("stPaths").textContent = pathCount.toLocaleString("en-US");
  $("stColors").textContent = String(fills.length);
  $("stSize").textContent = fmtKB(new Blob([svgstr]).size);
  $("stTime").textContent = (elapsed / 1000).toFixed(2) + " s";

  renderPalette(fills);

  downloadBtn.disabled = false;
  copyBtn.disabled = false;
  setBusy(false);
}

function renderPalette(fills) {
  const palette = $("palette");
  palette.querySelectorAll(".chip").forEach((c) => c.remove());
  fills.forEach((rgb) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.style.background = rgb;
    chip.title = rgb + " — click to copy";
    chip.setAttribute("aria-label", "Copy color " + rgb);
    chip.addEventListener("click", () => copyText(rgbToHex(rgb), "Color copied"));
    palette.appendChild(chip);
  });
  palette.classList.toggle("on", fills.length > 0);
}

function rgbToHex(rgb) {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return rgb;
  return "#" + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

/* ---------------- export ---------------- */

downloadBtn.addEventListener("click", () => {
  if (!state.svgString) return;
  const blob = new Blob([state.svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = state.fileName + ".svg";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  showToast("SVG downloaded", true);
});

copyBtn.addEventListener("click", () => {
  if (state.svgString) copyText(state.svgString, "SVG code copied");
});

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(okMsg, true);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast(okMsg, true);
    } catch {
      showToast("Copy failed — your browser blocked it");
    }
    ta.remove();
  }
}

/* ---------------- init ---------------- */

syncLabels();
