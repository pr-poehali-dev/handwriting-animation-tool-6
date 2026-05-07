import opentype from "opentype.js";

export interface GlyphPath {
  commands: opentype.PathCommand[];
  advanceWidth: number;
}

export interface AnimatableChar {
  char: string;
  glyphPaths: GlyphPath[];
  x: number;
  y: number;
  unitsPerEm: number;
  fontSize: number;
}

/** Загружает шрифт из ArrayBuffer и возвращает opentype.Font */
export async function loadFontFromBuffer(buffer: ArrayBuffer): Promise<opentype.Font> {
  return opentype.parse(buffer);
}

/** Строит список анимируемых символов для строки текста */
export function buildAnimatableChars(
  font: opentype.Font,
  text: string,
  fontSize: number,
  startX: number,
  baselineY: number
): AnimatableChar[] {
  const scale = fontSize / font.unitsPerEm;
  const result: AnimatableChar[] = [];
  let cursorX = startX;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\n") continue;

    const glyph = font.charToGlyph(char);
    if (!glyph) continue;

    const path = glyph.getPath(cursorX, baselineY, fontSize);
    const commands = path.commands;

    result.push({
      char,
      glyphPaths: [{ commands, advanceWidth: (glyph.advanceWidth ?? 0) * scale }],
      x: cursorX,
      y: baselineY,
      unitsPerEm: font.unitsPerEm,
      fontSize,
    });

    cursorX += (glyph.advanceWidth ?? 0) * scale;
  }

  return result;
}

/** Вычисляет суммарную длину пути SVG-команд (приблизительно) */
function approxPathLength(commands: opentype.PathCommand[]): number {
  let total = 0;
  let cx = 0, cy = 0;
  for (const cmd of commands) {
    if (cmd.type === "M") { cx = cmd.x; cy = cmd.y; }
    else if (cmd.type === "L") {
      const dx = cmd.x - cx; const dy = cmd.y - cy;
      total += Math.sqrt(dx * dx + dy * dy);
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === "C") {
      // Приблизительная длина кривой Безье
      const dx = cmd.x - cx; const dy = cmd.y - cy;
      total += Math.sqrt(dx * dx + dy * dy) * 1.4;
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === "Q") {
      const dx = cmd.x - cx; const dy = cmd.y - cy;
      total += Math.sqrt(dx * dx + dy * dy) * 1.2;
      cx = cmd.x; cy = cmd.y;
    }
  }
  return Math.max(total, 1);
}

/**
 * Рисует частичный прогресс одного символа на Canvas.
 * progress: 0.0 — 1.0
 */
export function drawGlyphProgress(
  ctx: CanvasRenderingContext2D,
  commands: opentype.PathCommand[],
  progress: number,
  strokeColor: string,
  strokeWidth: number
) {
  if (progress <= 0) return;

  // Разбиваем на контуры (subpath)
  const subpaths: opentype.PathCommand[][] = [];
  let current: opentype.PathCommand[] = [];

  for (const cmd of commands) {
    if (cmd.type === "M" && current.length > 0) {
      subpaths.push(current);
      current = [];
    }
    current.push(cmd);
  }
  if (current.length > 0) subpaths.push(current);

  // Длины каждого сабпата
  const lengths = subpaths.map(sp => approxPathLength(sp));
  const totalLength = lengths.reduce((a, b) => a + b, 0);
  const targetLength = totalLength * progress;

  let drawn = 0;
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = "transparent";

  for (let si = 0; si < subpaths.length; si++) {
    const sp = subpaths[si];
    const spLen = lengths[si];
    if (drawn >= targetLength) break;

    const remaining = targetLength - drawn;
    const subProgress = Math.min(1, remaining / spLen);

    ctx.beginPath();
    drawSubpathProgress(ctx, sp, subProgress);
    ctx.stroke();

    drawn += spLen;
  }

  ctx.restore();
}

/** Рисует subpath с заданным прогрессом */
function drawSubpathProgress(
  ctx: CanvasRenderingContext2D,
  commands: opentype.PathCommand[],
  progress: number
) {
  if (progress <= 0) return;

  const segLengths = computeSegmentLengths(commands);
  const total = segLengths.reduce((a, b) => a + b, 0);
  const target = total * progress;

  let drawn = 0;
  let started = false;

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const seg = segLengths[i];

    if (cmd.type === "M") {
      ctx.moveTo(cmd.x, cmd.y);
      started = true;
      continue;
    }
    if (!started) continue;
    if (drawn >= target) break;

    const remaining = target - drawn;
    const t = seg > 0 ? Math.min(1, remaining / seg) : 1;

    if (cmd.type === "L") {
      const prev = getPrevPoint(commands, i);
      const px = prev.x + (cmd.x - prev.x) * t;
      const py = prev.y + (cmd.y - prev.y) * t;
      ctx.lineTo(px, py);
    } else if (cmd.type === "C") {
      const prev = getPrevPoint(commands, i);
      const pt = bezierPoint(t, prev.x, prev.y, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
      // Используем дробную кривую
      const c1 = bezierPoint(t * 0.33, prev.x, prev.y, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
      const c2 = bezierPoint(t * 0.67, prev.x, prev.y, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, pt.x, pt.y);
    } else if (cmd.type === "Q") {
      const prev = getPrevPoint(commands, i);
      const pt = quadPoint(t, prev.x, prev.y, cmd.x1, cmd.y1, cmd.x, cmd.y);
      const cp = quadPoint(t * 0.5, prev.x, prev.y, cmd.x1, cmd.y1, cmd.x, cmd.y);
      ctx.quadraticCurveTo(cp.x, cp.y, pt.x, pt.y);
    } else if (cmd.type === "Z") {
      ctx.closePath();
    }

    drawn += seg;
  }
}

function computeSegmentLengths(commands: opentype.PathCommand[]): number[] {
  const lengths: number[] = [];
  let cx = 0, cy = 0;
  for (const cmd of commands) {
    if (cmd.type === "M") { cx = cmd.x; cy = cmd.y; lengths.push(0); }
    else if (cmd.type === "L") {
      const dx = cmd.x - cx; const dy = cmd.y - cy;
      lengths.push(Math.sqrt(dx * dx + dy * dy));
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === "C") {
      const dx = cmd.x - cx; const dy = cmd.y - cy;
      lengths.push(Math.sqrt(dx * dx + dy * dy) * 1.4);
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === "Q") {
      const dx = cmd.x - cx; const dy = cmd.y - cy;
      lengths.push(Math.sqrt(dx * dx + dy * dy) * 1.2);
      cx = cmd.x; cy = cmd.y;
    } else {
      lengths.push(0);
    }
  }
  return lengths;
}

function getPrevPoint(commands: opentype.PathCommand[], i: number): { x: number; y: number } {
  for (let j = i - 1; j >= 0; j--) {
    const c = commands[j];
    if (c.type === "M" || c.type === "L" || c.type === "C" || c.type === "Q") {
      return { x: c.x, y: c.y };
    }
  }
  return { x: 0, y: 0 };
}

function bezierPoint(
  t: number,
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number
) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
    y: mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
  };
}

function quadPoint(t: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
  const mt = 1 - t;
  return {
    x: mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
    y: mt * mt * y0 + 2 * mt * t * y1 + t * t * y2,
  };
}

/** Рисует символ полностью как filled shape */
export function drawGlyphFull(
  ctx: CanvasRenderingContext2D,
  commands: opentype.PathCommand[],
  fillColor: string
) {
  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  for (const cmd of commands) {
    if (cmd.type === "M") ctx.moveTo(cmd.x, cmd.y);
    else if (cmd.type === "L") ctx.lineTo(cmd.x, cmd.y);
    else if (cmd.type === "C") ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
    else if (cmd.type === "Q") ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
    else if (cmd.type === "Z") ctx.closePath();
  }
  ctx.fill("evenodd");
  ctx.restore();
}
