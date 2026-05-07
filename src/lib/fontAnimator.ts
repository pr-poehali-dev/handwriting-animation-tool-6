import opentype from "opentype.js";

export interface GlyphPath {
  commands: opentype.PathCommand[];
  advanceWidth: number;
}

export interface AnimatableChar {
  char: string;
  glyphPaths: GlyphPath[];
  /** Набор точек для «чернильной» прорисовки (stroke по средней линии) */
  strokePoints: { x: number; y: number }[][];
  x: number;
  y: number;
  unitsPerEm: number;
  fontSize: number;
  /** Порядковый номер символа в строке */
  charIndex: number;
  /** Индекс строки */
  lineIndex: number;
}

export async function loadFontFromBuffer(buffer: ArrayBuffer): Promise<opentype.Font> {
  return opentype.parse(buffer);
}

/** Строит набор AnimatableChar с учётом переноса строк (word-wrap) */
export function buildAnimatableCharsWrapped(
  font: opentype.Font,
  text: string,
  fontSize: number,
  bold: boolean,
  italic: boolean,
  align: "left" | "center" | "right",
  color: string,
  canvasWidth: number,
  padX: number,
  padY: number
): AnimatableChar[] {
  const scale = fontSize / font.unitsPerEm;
  const lineHeight = fontSize * 1.45;
  const maxWidth = canvasWidth - padX * 2;

  // Разбиваем на «жёсткие» строки по \n, затем word-wrap
  const hardLines = text.split("\n");
  const wrappedLines: string[] = [];

  for (const hard of hardLines) {
    if (hard.length === 0) { wrappedLines.push(""); continue; }
    const words = hard.split(" ");
    let currentLine = "";
    for (const word of words) {
      const test = currentLine ? currentLine + " " + word : word;
      const testWidth = measureText(font, test, fontSize);
      if (testWidth > maxWidth && currentLine.length > 0) {
        wrappedLines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = test;
      }
    }
    if (currentLine) wrappedLines.push(currentLine);
  }

  const result: AnimatableChar[] = [];
  let globalIdx = 0;

  wrappedLines.forEach((lineText, li) => {
    const lineWidth = measureText(font, lineText, fontSize);
    let startX = padX;
    if (align === "center") startX = (canvasWidth - lineWidth) / 2;
    else if (align === "right") startX = canvasWidth - padX - lineWidth;

    const baseline = padY + li * lineHeight + fontSize;
    let cursorX = startX;

    for (let ci = 0; ci < lineText.length; ci++) {
      const char = lineText[ci];
      const glyph = font.charToGlyph(char);
      if (!glyph) { cursorX += fontSize * 0.3; continue; }

      const path = glyph.getPath(cursorX, baseline, fontSize);
      const commands = path.commands;
      const advW = (glyph.advanceWidth ?? 0) * scale;

      result.push({
        char,
        glyphPaths: [{ commands, advanceWidth: advW }],
        strokePoints: buildStrokePoints(commands),
        x: cursorX,
        y: baseline,
        unitsPerEm: font.unitsPerEm,
        fontSize,
        charIndex: globalIdx++,
        lineIndex: li,
      });

      cursorX += advW;
    }
  });

  void bold; void italic; void color;
  return result;
}

function measureText(font: opentype.Font, text: string, fontSize: number): number {
  const scale = fontSize / font.unitsPerEm;
  let w = 0;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    if (g) w += (g.advanceWidth ?? 0) * scale;
    else w += fontSize * 0.3;
  }
  return w;
}

/**
 * Из SVG-команд строим «скелетные» полилинии для рисования пером.
 * Каждый subpath — отдельный штрих.
 */
function buildStrokePoints(commands: opentype.PathCommand[]): { x: number; y: number }[][] {
  const strokes: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  let cx = 0, cy = 0;

  for (const cmd of commands) {
    if (cmd.type === "M") {
      if (current.length > 1) strokes.push(current);
      current = [{ x: cmd.x, y: cmd.y }];
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === "L") {
      current.push({ x: cmd.x, y: cmd.y });
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === "C") {
      const pts = sampleCubic(cx, cy, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y, 16);
      current.push(...pts);
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === "Q") {
      const pts = sampleQuad(cx, cy, cmd.x1, cmd.y1, cmd.x, cmd.y, 10);
      current.push(...pts);
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === "Z") {
      if (current.length > 0 && current[0]) {
        current.push({ x: current[0].x, y: current[0].y });
      }
      if (current.length > 1) strokes.push(current);
      current = [];
    }
  }
  if (current.length > 1) strokes.push(current);
  return strokes;
}

function sampleCubic(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number, n: number
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    pts.push({
      x: mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
      y: mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
    });
  }
  return pts;
}

function sampleQuad(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, n: number
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    pts.push({
      x: mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
      y: mt * mt * y0 + 2 * mt * t * y1 + t * t * y2,
    });
  }
  return pts;
}

/**
 * ПРАВИЛЬНАЯ рукописная анимация:
 * Рисуем символ через off-screen canvas с clip-маской, которая открывается по progress.
 * Финальный вид (filled) всегда сохраняется — маска только «открывает» его как Write-on.
 */
export function drawGlyphWriteOn(
  ctx: CanvasRenderingContext2D,
  ac: AnimatableChar,
  progress: number,
  fillColor: string,
  direction: WriteOnDirection = "left-to-right"
) {
  if (progress <= 0) return;
  if (progress >= 1) {
    drawGlyphFull(ctx, ac.glyphPaths[0].commands, fillColor);
    return;
  }

  const { x, y, fontSize } = ac;
  const w = ac.glyphPaths[0].advanceWidth + fontSize * 0.2;
  const h = fontSize * 1.4;
  const left = x - fontSize * 0.05;
  const top = y - fontSize * 1.1;

  ctx.save();
  ctx.beginPath();

  if (direction === "left-to-right") {
    const clipW = w * progress;
    ctx.rect(left, top - 4, clipW, h + 8);
  } else if (direction === "top-to-bottom") {
    const clipH = h * progress;
    ctx.rect(left - 4, top, w + 8, clipH);
  } else if (direction === "right-to-left") {
    const clipW = w * progress;
    ctx.rect(left + w - clipW, top - 4, clipW, h + 8);
  } else if (direction === "bottom-to-top") {
    const clipH = h * progress;
    ctx.rect(left - 4, top + h - clipH, w + 8, clipH);
  } else if (direction === "diagonal-tl") {
    ctx.rect(left, top, w * progress * 1.5, h * progress * 1.5);
  }

  ctx.clip();
  drawGlyphFull(ctx, ac.glyphPaths[0].commands, fillColor);
  ctx.restore();
}

export type WriteOnDirection =
  | "left-to-right"
  | "right-to-left"
  | "top-to-bottom"
  | "bottom-to-top"
  | "diagonal-tl";

/**
 * Рисует «живую» прорисовку штрихом (режим авто):
 * Сначала рисуем финальный символ с очень низкой прозрачностью (ghost),
 * затем поверх — нарастающий stroke по скелетным точкам.
 * Когда progress=1, переключаемся на полный filled.
 */
export function drawGlyphHandwrite(
  ctx: CanvasRenderingContext2D,
  ac: AnimatableChar,
  progress: number,
  fillColor: string,
  strokeWidth: number
) {
  if (progress <= 0) return;
  if (progress >= 1) {
    drawGlyphFull(ctx, ac.glyphPaths[0].commands, fillColor);
    return;
  }

  // Ghost: финальный символ с прозрачностью 0.08 — пользователь видит куда идёт
  ctx.save();
  ctx.globalAlpha = 0.08;
  drawGlyphFull(ctx, ac.glyphPaths[0].commands, fillColor);
  ctx.restore();

  // Stroke: рисуем нарастающий путь по strokePoints
  const strokes = ac.strokePoints;
  if (strokes.length === 0) {
    // Fallback: Write-on через clip
    drawGlyphWriteOn(ctx, ac, progress, fillColor, "left-to-right");
    return;
  }

  // Общее количество точек
  const totalPts = strokes.reduce((s, st) => s + st.length, 0);
  const targetPts = Math.floor(totalPts * progress);

  ctx.save();
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  let drawn = 0;
  for (const stroke of strokes) {
    if (drawn >= targetPts) break;
    const avail = Math.min(stroke.length, targetPts - drawn);
    if (avail < 2) { drawn += stroke.length; continue; }

    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < avail; i++) {
      ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();
    drawn += stroke.length;
  }

  ctx.restore();

  // Когда нарисовано >90% — начинаем плавно показывать filled поверх
  if (progress > 0.85) {
    const alpha = (progress - 0.85) / 0.15;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawGlyphFull(ctx, ac.glyphPaths[0].commands, fillColor);
    ctx.restore();
  }
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

/** Устаревший экспорт, оставлен для совместимости */
export { buildAnimatableCharsWrapped as buildAnimatableChars };
export type { AnimatableChar };
