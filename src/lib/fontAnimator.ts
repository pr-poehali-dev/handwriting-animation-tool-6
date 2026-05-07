import opentype from "opentype.js";

export interface GlyphPath {
  commands: opentype.PathCommand[];
  advanceWidth: number;
}

export interface Stroke {
  points: { x: number; y: number }[];
}

export interface AnimatableChar {
  char: string;
  commands: opentype.PathCommand[];
  /** Штрихи — последовательные полилинии контуров буквы, пронумерованные в порядке рисования */
  strokes: Stroke[];
  advanceWidth: number;
  x: number;
  y: number;
  fontSize: number;
  charIndex: number;
  lineIndex: number;
  isSpace: boolean;
}

export type WriteOnDirection =
  | "left-to-right"
  | "right-to-left"
  | "top-to-bottom"
  | "bottom-to-top"
  | "diagonal-tl";

export interface ManualStroke {
  points: { x: number; y: number }[];
}

export async function loadFontFromBuffer(buffer: ArrayBuffer): Promise<opentype.Font> {
  return opentype.parse(buffer);
}

// ─── measure ───────────────────────────────────────────────────────────────────
export function measureText(font: opentype.Font, text: string, fontSize: number): number {
  const scale = fontSize / font.unitsPerEm;
  let w = 0;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    // Пробелы тоже считаем через advanceWidth гlifа пробела
    if (g) {
      w += (g.advanceWidth ?? 0) * scale;
    }
  }
  return w;
}

// ─── word-wrap + build chars ───────────────────────────────────────────────────
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
  void bold; void italic; void color;

  const scale = fontSize / font.unitsPerEm;
  const lineHeight = fontSize * 1.5;
  const maxWidth = canvasWidth - padX * 2;

  // Жёсткие переносы по \n, затем word-wrap
  const hardLines = text.split("\n");
  const wrappedLines: string[] = [];

  for (const hard of hardLines) {
    if (hard.length === 0) { wrappedLines.push(""); continue; }

    // Word-wrap: разбиваем по пробелам, сохраняя пробелы в составе токенов
    const words = hard.split(/(?<= )/); // split after space — сохраняем пробелы
    let current = "";
    for (const word of words) {
      const test = current + word;
      if (measureText(font, test, fontSize) > maxWidth && current.length > 0) {
        wrappedLines.push(current.trimEnd());
        current = word.trimStart();
      } else {
        current = test;
      }
    }
    if (current.length > 0) wrappedLines.push(current);
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
      const advW = glyph ? (glyph.advanceWidth ?? 0) * scale : fontSize * 0.3;
      const isSpace = char === " " || (glyph !== null && (glyph.advanceWidth ?? 0) > 0 && (glyph.path?.commands?.length ?? 0) === 0);

      const path = glyph ? glyph.getPath(cursorX, baseline, fontSize) : { commands: [] as opentype.PathCommand[] };
      const commands = path.commands;

      result.push({
        char,
        commands,
        strokes: buildStrokes(commands),
        advanceWidth: advW,
        x: cursorX,
        y: baseline,
        fontSize,
        charIndex: globalIdx++,
        lineIndex: li,
        isSpace,
      });

      cursorX += advW;
    }
  });

  return result;
}

// ─── строим штрихи из SVG-команд ───────────────────────────────────────────────
/**
 * Разбиваем SVG-path на субпути (strokePoints).
 * Каждый M начинает новый штрих. Кривые Безье семплируются в точки.
 * Это и есть «перо» — именно по этим полилиниям рисуем штрих.
 */
function buildStrokes(commands: opentype.PathCommand[]): Stroke[] {
  const strokes: Stroke[] = [];
  let cur: { x: number; y: number }[] = [];
  let cx = 0, cy = 0;

  const flush = () => {
    if (cur.length >= 2) strokes.push({ points: cur });
    cur = [];
  };

  for (const cmd of commands) {
    if (cmd.type === "M") {
      flush();
      cur = [{ x: cmd.x, y: cmd.y }];
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === "L") {
      cur.push({ x: cmd.x, y: cmd.y });
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === "C") {
      const pts = sampleCubic(cx, cy, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y, 20);
      cur.push(...pts);
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === "Q") {
      const pts = sampleQuad(cx, cy, cmd.x1, cmd.y1, cmd.x, cmd.y, 12);
      cur.push(...pts);
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === "Z") {
      // замыкаем субпуть, добавляем точку возврата к началу
      if (cur.length > 0 && cur[0]) cur.push({ ...cur[0] });
      flush();
      cx = cur[0]?.x ?? cx;
      cy = cur[0]?.y ?? cy;
    }
  }
  flush();
  return strokes;
}

function sampleCubic(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number, n: number
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n; const mt = 1 - t;
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
    const t = i / n; const mt = 1 - t;
    pts.push({
      x: mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
      y: mt * mt * y0 + 2 * mt * t * y1 + t * t * y2,
    });
  }
  return pts;
}

// ─── АВТОМАТИЧЕСКАЯ АНИМАЦИЯ ───────────────────────────────────────────────────
/**
 * Рисует символ как «письмо ручкой»:
 * - Идём по strokes (субпутям), рисуя линию точка за точкой.
 * - Когда progress=1 — рисуем finalized filled shape.
 * - Никакого ghost, никакой отдельной обводки контура.
 * - Штрих имеет такую же ширину как толщина пера.
 */
export function drawGlyphHandwrite(
  ctx: CanvasRenderingContext2D,
  ac: AnimatableChar,
  progress: number,
  fillColor: string,
  penWidth: number
) {
  if (progress <= 0 || ac.isSpace) return;
  if (progress >= 1) {
    drawGlyphFull(ctx, ac.commands, fillColor);
    return;
  }

  const { strokes } = ac;
  if (strokes.length === 0) return;

  // Считаем общее число точек
  const totalPts = strokes.reduce((s, st) => s + st.points.length, 0);
  if (totalPts < 2) return;

  const targetPts = progress * totalPts;

  ctx.save();
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = penWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  let drawn = 0;

  for (const stroke of strokes) {
    if (drawn >= targetPts) break;
    const pts = stroke.points;
    const available = Math.min(pts.length, Math.ceil(targetPts - drawn));
    if (available < 1) { drawn += pts.length; continue; }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < available; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();

    drawn += pts.length;
  }

  ctx.restore();
}

// ─── РУЧНАЯ АНИМАЦИЯ — пользовательские штрихи ────────────────────────────────
/**
 * Рисует символ через пользовательские штрихи (manualStrokes).
 * Если manualStrokes не заданы — использует автоматические strokes.
 */
export function drawGlyphManual(
  ctx: CanvasRenderingContext2D,
  ac: AnimatableChar,
  progress: number,
  fillColor: string,
  penWidth: number,
  manualStrokes?: ManualStroke[]
) {
  if (progress <= 0 || ac.isSpace) return;
  if (progress >= 1) {
    drawGlyphFull(ctx, ac.commands, fillColor);
    return;
  }

  const strokes = manualStrokes && manualStrokes.length > 0 ? manualStrokes : ac.strokes;
  if (strokes.length === 0) return;

  const totalPts = strokes.reduce((s, st) => s + st.points.length, 0);
  if (totalPts < 2) return;

  const targetPts = progress * totalPts;

  ctx.save();
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = penWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  let drawn = 0;
  for (const stroke of strokes) {
    if (drawn >= targetPts) break;
    const pts = stroke.points;
    const available = Math.min(pts.length, Math.ceil(targetPts - drawn));
    if (available < 1) { drawn += pts.length; continue; }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < available; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    drawn += pts.length;
  }

  ctx.restore();
}

// ─── Полностью залитый символ ─────────────────────────────────────────────────
export function drawGlyphFull(
  ctx: CanvasRenderingContext2D,
  commands: opentype.PathCommand[],
  fillColor: string
) {
  if (!commands || commands.length === 0) return;
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

// Экспорт для совместимости
export { buildAnimatableCharsWrapped as buildAnimatableChars };
