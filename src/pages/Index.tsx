import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import opentype from "opentype.js";
import Icon from "@/components/ui/icon";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  loadFontFromBuffer,
  buildAnimatableCharsWrapped,
  drawGlyphHandwrite,
  drawGlyphManual,
  drawGlyphFull,
  type AnimatableChar,
  type ManualStroke,
} from "@/lib/fontAnimator";

// ── Types ──────────────────────────────────────────────────────────────────────
type AnimMode = "auto" | "manual" | "typewriter";
type AspectRatio = "16:9" | "9:16" | "4:3";
type Section = "editor" | "animation" | "fonts" | "export" | "docs";

interface TextStyle {
  bold: boolean;
  italic: boolean;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
}

const ASPECT_SIZES: Record<AspectRatio, { w: number; h: number }> = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "4:3": { w: 1440, h: 1080 },
};
const DISPLAY_SCALE = 0.38;

const NAV_ITEMS: { id: Section; icon: string; label: string }[] = [
  { id: "editor", icon: "PenLine", label: "Редактор" },
  { id: "animation", icon: "Sparkles", label: "Анимация" },
  { id: "fonts", icon: "Type", label: "Шрифты" },
  { id: "export", icon: "Download", label: "Экспорт" },
  { id: "docs", icon: "BookOpen", label: "Справка" },
];

const DEFAULT_STYLE: TextStyle = {
  bold: false, italic: false, fontSize: 72, color: "#000000", align: "left",
};

const ALL_CHARS_LIST = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?;:-()\"'".split("");

// ── Component ──────────────────────────────────────────────────────────────────
export default function Index() {
  const [section, setSection] = useState<Section>("editor");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Шрифт
  const [font, setFont] = useState<opentype.Font | null>(null);
  const [fontName, setFontName] = useState("");
  const fontInputRef = useRef<HTMLInputElement>(null);

  // Текст
  const [text, setText] = useState("");
  const [textStyle, setTextStyle] = useState<TextStyle>({ ...DEFAULT_STYLE });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Фон
  const [bgColor, setBgColor] = useState("#ffffff");
  const [bgTransparent, setBgTransparent] = useState(false);
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [bgImageScale, setBgImageScale] = useState([100]);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);

  // Формат
  const [aspect, setAspect] = useState<AspectRatio>("16:9");

  // Анимация
  const [animMode, setAnimMode] = useState<AnimMode>("auto");
  const [animSpeed, setAnimSpeed] = useState([20]);
  const [smoothness, setSmoothness] = useState([60]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);

  // Экспорт
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Ручной режим
  const [manualStrokes, setManualStrokes] = useState<Record<string, ManualStroke[]>>({});
  const [manualEditChar, setManualEditChar] = useState<string | null>(null);
  const [manualCharFilter, setManualCharFilter] = useState("all");
  const [isDrawingManual, setIsDrawingManual] = useState(false);
  const manualCanvasRef = useRef<HTMLCanvasElement>(null);
  const manualCurrentStroke = useRef<{ x: number; y: number }[]>([]);
  const manualStrokesForChar = useRef<ManualStroke[]>([]);
  const [manualStrokeCount, setManualStrokeCount] = useState(0);

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animCharsRef = useRef<AnimatableChar[]>([]);

  // ── Авторасширение textarea ──────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [text]);

  // ── Загрузка шрифта ──────────────────────────────────────────────────────────
  const handleFontUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const loaded = await loadFontFromBuffer(await file.arrayBuffer());
    setFont(loaded);
    setFontName(file.name.replace(/\.[^.]+$/, ""));
  }, []);

  // ── Загрузка фона ────────────────────────────────────────────────────────────
  const handleBgUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    setBgImageUrl(url);
    const img = new Image();
    img.onload = () => { bgImageRef.current = img; };
    img.src = url;
  }, []);

  // ── Сборка AnimatableChars ───────────────────────────────────────────────────
  const rebuildChars = useCallback(() => {
    if (!font || !text.trim()) { animCharsRef.current = []; return; }
    const { w } = ASPECT_SIZES[aspect];
    animCharsRef.current = buildAnimatableCharsWrapped(
      font, text, textStyle.fontSize, textStyle.bold, textStyle.italic,
      textStyle.align, textStyle.color, w, 60, 60
    );
  }, [font, text, textStyle, aspect]);

  useEffect(() => { rebuildChars(); }, [rebuildChars]);

  // ── getDuration ──────────────────────────────────────────────────────────────
  const getDuration = useCallback(() => 30000 / animSpeed[0], [animSpeed]);

  // ── Рендер кадра (общий — для превью и экспорта) ────────────────────────────
  const renderFrame = useCallback((
    ctx: CanvasRenderingContext2D,
    cw: number, ch: number,
    progress: number,
    scale: number
  ) => {
    ctx.clearRect(0, 0, cw, ch);

    if (!bgTransparent) {
      if (bgImageRef.current && bgImageUrl) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, cw, ch);
        const sc = bgImageScale[0] / 100;
        const iw = bgImageRef.current.naturalWidth * sc * scale;
        const ih = bgImageRef.current.naturalHeight * sc * scale;
        ctx.drawImage(bgImageRef.current, (cw - iw) / 2, (ch - ih) / 2, iw, ih);
      } else {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, cw, ch);
      }
    }

    ctx.save();
    ctx.scale(scale, scale);

    const chars = animCharsRef.current;

    if (!font || chars.length === 0) {
      // Фолбэк — нативный canvas text
      const lines = text.split("\n");
      lines.forEach((line, li) => {
        const lh = textStyle.fontSize * 1.5;
        const baseline = 60 + li * lh + textStyle.fontSize;
        ctx.font = `${textStyle.italic ? "italic " : ""}${textStyle.bold ? "bold " : ""}${textStyle.fontSize}px sans-serif`;
        ctx.fillStyle = textStyle.color;
        ctx.textAlign = textStyle.align;
        const { w: cWidth } = ASPECT_SIZES[aspect];
        const tx = textStyle.align === "center" ? cWidth / 2 : textStyle.align === "right" ? cWidth - 60 : 60;
        ctx.fillText(line, tx, baseline);
      });
      ctx.restore(); return;
    }

    // Считаем только не-пробельные символы для прогресса
    const visChars = chars.filter(c => !c.isSpace);
    const n = visChars.length;
    const ppc = n > 0 ? 1 / n : 1;

    if (progress === 0) {
      // Статичный вид — всё финально
      chars.forEach(ac => { if (!ac.isSpace) drawGlyphFull(ctx, ac.commands, textStyle.color); });
      ctx.restore(); return;
    }

    visChars.forEach((ac, idx) => {
      const cs = idx * ppc;
      const ce = (idx + 1) * ppc;
      const penWidth = Math.max(1.5, ac.fontSize * 0.04);

      if (animMode === "typewriter") {
        if (progress >= ce) drawGlyphFull(ctx, ac.commands, textStyle.color);
        else if (progress > cs) {
          ctx.fillStyle = textStyle.color;
          ctx.fillRect(ac.x, ac.y - ac.fontSize, 2.5, ac.fontSize * 1.1);
        }
      } else if (animMode === "auto") {
        if (progress >= ce) {
          drawGlyphFull(ctx, ac.commands, textStyle.color);
        } else if (progress > cs) {
          drawGlyphHandwrite(ctx, ac, (progress - cs) / ppc, textStyle.color, penWidth);
        }
      } else if (animMode === "manual") {
        const userStrokes = manualStrokes[ac.char];
        if (progress >= ce) {
          drawGlyphFull(ctx, ac.commands, textStyle.color);
        } else if (progress > cs) {
          drawGlyphManual(ctx, ac, (progress - cs) / ppc, textStyle.color, penWidth, userStrokes);
        }
      }
    });

    ctx.restore();
  }, [aspect, bgColor, bgTransparent, bgImageUrl, bgImageScale, animMode, textStyle, text, font, manualStrokes]);

  // ── Рендер превью ────────────────────────────────────────────────────────────
  const renderPreview = useCallback((progress: number) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const { w, h } = ASPECT_SIZES[aspect];
    const cw = Math.round(w * DISPLAY_SCALE);
    const ch = Math.round(h * DISPLAY_SCALE);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    renderFrame(ctx, cw, ch, progress, DISPLAY_SCALE);
  }, [aspect, renderFrame]);

  useEffect(() => { renderPreview(animProgress); }, [animProgress, renderPreview]);
  useEffect(() => { setTimeout(() => renderPreview(animProgress), 30); }, [section]); // eslint-disable-line

  // ── Анимационный цикл ────────────────────────────────────────────────────────
  const easeIO = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

  const startAnimation = useCallback((fromP = 0) => {
    const duration = getDuration();
    startTimeRef.current = performance.now() - fromP * duration;
    const tick = (now: number) => {
      const raw = Math.min((now - startTimeRef.current) / duration, 1);
      const p = smoothness[0] > 50 ? easeIO(raw) : raw;
      setAnimProgress(p);
      if (raw < 1) { rafRef.current = requestAnimationFrame(tick); }
      else { setIsPlaying(false); setAnimProgress(1); }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [getDuration, smoothness]);  

  const togglePlay = () => {
    if (isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    } else {
      const from = animProgress >= 1 ? 0 : animProgress;
      if (animProgress >= 1) setAnimProgress(0);
      setIsPlaying(true);
      startAnimation(from);
    }
  };

  const resetAnim = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setIsPlaying(false); setAnimProgress(0);
  };

  // ── Форматирование ───────────────────────────────────────────────────────────
  const applyStyle = <K extends keyof TextStyle>(key: K, val: TextStyle[K]) =>
    setTextStyle(s => ({ ...s, [key]: val }));

  const handleTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.ctrlKey && e.key === "b") { e.preventDefault(); applyStyle("bold", !textStyle.bold); }
    if (e.ctrlKey && e.key === "i") { e.preventDefault(); applyStyle("italic", !textStyle.italic); }
  };

  // ── Экспорт видео ────────────────────────────────────────────────────────────
  const handleExportVideo = useCallback(async () => {
    const { w, h } = ASPECT_SIZES[aspect];
    const offscreen = document.createElement("canvas");
    offscreen.width = w; offscreen.height = h;
    const ctx = offscreen.getContext("2d"); if (!ctx) return;

    const useAlpha = bgTransparent;
    const mimeAlpha = "video/webm;codecs=vp9";
    const mimeStd = "video/webm";
    const mime = useAlpha && MediaRecorder.isTypeSupported(mimeAlpha) ? mimeAlpha : mimeStd;

    if (!MediaRecorder.isTypeSupported(mime) && !MediaRecorder.isTypeSupported(mimeStd)) {
      alert("Браузер не поддерживает запись видео. Используйте Chrome или Edge.");
      return;
    }

    setIsExporting(true); setExportProgress(0);

    const fps = 30;
    const duration = getDuration();
    const totalFrames = Math.ceil((duration / 1000) * fps);
    const stream = offscreen.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 15_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start(200);

    for (let f = 0; f <= totalFrames; f++) {
      const raw = f / totalFrames;
      const p = smoothness[0] > 50 ? easeIO(raw) : raw;
      renderFrame(ctx, w, h, p, 1);
      setExportProgress(Math.round((f / totalFrames) * 100));
      await new Promise<void>(res => setTimeout(res, 1000 / fps));
    }

    recorder.stop();
    await new Promise<void>(res => { recorder.onstop = () => res(); });

    const blob = new Blob(chunks, { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = useAlpha ? "script-animation-transparent.webm" : "script-animation.webm";
    a.click();
    URL.revokeObjectURL(url);
    setIsExporting(false); setExportProgress(0);
  }, [aspect, bgTransparent, getDuration, renderFrame, smoothness]);

  // ── Ручной Canvas ────────────────────────────────────────────────────────────
  const redrawManualCanvas = useCallback(() => {
    const cv = manualCanvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);

    // Фон и сетка
    ctx.fillStyle = "hsl(220 18% 10%)";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = "hsl(220 12% 20%)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 8; i++) {
      const x = (cv.width / 8) * i; const y = (cv.height / 8) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke();
    }
    // Базовая линия
    ctx.strokeStyle = "hsl(220 12% 38%)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, cv.height * 0.75); ctx.lineTo(cv.width, cv.height * 0.75); ctx.stroke();
    ctx.setLineDash([]);

    // Нарисованные штрихи (цветные — порядок)
    const colors = ["hsl(160 70% 55%)", "hsl(200 70% 60%)", "hsl(280 70% 65%)", "hsl(40 80% 60%)", "hsl(0 70% 60%)"];
    manualStrokesForChar.current.forEach((stroke, si) => {
      const color = colors[si % colors.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      stroke.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
      if (stroke.points[0]) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(stroke.points[0].x, stroke.points[0].y, 5, 0, Math.PI * 2); ctx.fill();
        // Номер штриха
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(si + 1), stroke.points[0].x, stroke.points[0].y + 3.5);
      }
    });

    // Текущий штрих
    const cur = manualCurrentStroke.current;
    if (cur.length > 1) {
      ctx.strokeStyle = "hsl(var(--ink, 160 70% 55%))";
      ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      cur.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
    }
  }, []);

  const getManualPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = manualCanvasRef.current; if (!cv) return { x: 0, y: 0 };
    const rect = cv.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (cv.width / rect.width),
      y: (e.clientY - rect.top) * (cv.height / rect.height),
    };
  };

  const onManualDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    manualCurrentStroke.current = [getManualPos(e)];
    setIsDrawingManual(true);
  };

  const onManualMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingManual) return;
    manualCurrentStroke.current.push(getManualPos(e));
    redrawManualCanvas();
  };

  const onManualUp = () => {
    if (manualCurrentStroke.current.length > 1) {
      manualStrokesForChar.current = [...manualStrokesForChar.current, { points: [...manualCurrentStroke.current] }];
      setManualStrokeCount(manualStrokesForChar.current.length);
    }
    manualCurrentStroke.current = [];
    setIsDrawingManual(false);
    redrawManualCanvas();
  };

  const saveManualChar = () => {
    if (!manualEditChar) return;
    setManualStrokes(s => ({ ...s, [manualEditChar]: [...manualStrokesForChar.current] }));
    setManualEditChar(null);
    manualStrokesForChar.current = [];
    setManualStrokeCount(0);
  };

  const clearManualCanvas = () => {
    manualStrokesForChar.current = [];
    manualCurrentStroke.current = [];
    setManualStrokeCount(0);
    redrawManualCanvas();
  };

  const undoManualStroke = () => {
    manualStrokesForChar.current = manualStrokesForChar.current.slice(0, -1);
    setManualStrokeCount(manualStrokesForChar.current.length);
    redrawManualCanvas();
  };

  const openManualEditor = (ch: string) => {
    setManualEditChar(ch);
    manualStrokesForChar.current = manualStrokes[ch]
      ? manualStrokes[ch].map(s => ({ points: [...s.points] }))
      : [];
    manualCurrentStroke.current = [];
    setManualStrokeCount(manualStrokesForChar.current.length);
    setTimeout(redrawManualCanvas, 50);
  };

  // ── Фильтр символов ──────────────────────────────────────────────────────────
  const filteredChars = useMemo(() => {
    if (manualCharFilter === "upper") return ALL_CHARS_LIST.filter(c => /[А-ЯA-ZЁ]/.test(c));
    if (manualCharFilter === "lower") return ALL_CHARS_LIST.filter(c => /[а-яa-zё]/.test(c));
    if (manualCharFilter === "digits") return ALL_CHARS_LIST.filter(c => /[0-9]/.test(c));
    if (manualCharFilter === "punct") return ALL_CHARS_LIST.filter(c => /[.,!?;:()"'-]/.test(c));
    return ALL_CHARS_LIST;
  }, [manualCharFilter]);

  const canvasSize = useMemo(() => {
    const { w, h } = ASPECT_SIZES[aspect];
    return { w: Math.round(w * DISPLAY_SCALE), h: Math.round(h * DISPLAY_SCALE) };
  }, [aspect]);

  // ── JSX ─────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">

      {/* Sidebar */}
      <aside className={`flex flex-col border-r border-border flex-shrink-0 transition-all duration-200 ${sidebarOpen ? "w-52" : "w-14"}`}
        style={{ background: "hsl(var(--sidebar-background))" }}>
        <div className="flex items-center gap-2.5 px-3 py-4 border-b border-border">
          <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
            style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
            <Icon name="PenLine" size={14} />
          </div>
          {sidebarOpen && <span className="font-semibold text-sm tracking-tight">Скрипт</span>}
        </div>
        <nav className="flex-1 py-2 space-y-0.5 px-1.5">
          {NAV_ITEMS.map(item => (
            <button key={item.id} onClick={() => setSection(item.id)}
              className={`w-full flex items-center gap-2.5 px-2 py-2 rounded text-sm transition-all ${section === item.id ? "font-medium text-[hsl(var(--ink))]" : "text-[hsl(var(--sidebar-foreground))] hover:text-foreground hover:bg-[hsl(var(--sidebar-accent))]"}`}
              style={section === item.id ? { background: "hsl(158 64% 52% / 0.12)" } : {}}>
              <Icon name={item.icon} size={16} className="flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        <button onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex items-center justify-center h-10 border-t border-border text-[hsl(var(--muted-foreground))] hover:text-foreground">
          <Icon name={sidebarOpen ? "PanelLeftClose" : "PanelLeft"} size={15} />
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Topbar */}
        <header className="flex items-center justify-between px-4 h-11 border-b border-border flex-shrink-0"
          style={{ background: "hsl(var(--panel-bg))" }}>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              {font ? fontName : "Шрифт не загружен"}
            </span>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{aspect}</Badge>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
              {animMode === "auto" ? "✍️ Авто" : animMode === "manual" ? "🎛️ Ручная" : "⌨️ Машинка"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {isExporting && (
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 rounded-full bg-[hsl(var(--border))]">
                  <div className="h-full rounded-full" style={{ width: `${exportProgress}%`, background: "hsl(var(--ink))" }} />
                </div>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{exportProgress}%</span>
              </div>
            )}
            <button onClick={handleExportVideo} disabled={isExporting}
              className="text-xs px-2.5 py-1 rounded font-medium disabled:opacity-50 flex items-center gap-1.5"
              style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
              <Icon name="Film" size={11} />
              {isExporting ? "Рендер…" : bgTransparent ? "Экспорт (прозрачный)" : "Экспорт видео"}
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">

          {/* ══════════ EDITOR ══════════ */}
          {section === "editor" && (
            <div className="flex-1 flex overflow-hidden animate-fade-in">

              {/* Left panel */}
              <div className="w-80 flex-shrink-0 flex flex-col border-r border-border overflow-y-auto"
                style={{ background: "hsl(var(--panel-bg))" }}>

                {/* Шрифт */}
                <div className="px-4 pt-4 pb-3 border-b border-border">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Шрифт</p>
                  <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff" className="hidden" onChange={handleFontUpload} />
                  <button onClick={() => fontInputRef.current?.click()}
                    className="w-full py-2 rounded border-2 border-dashed border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--ink-dim))] hover:text-foreground transition-colors flex items-center justify-center gap-2">
                    <Icon name="Upload" size={13} />
                    {font ? `Заменить: ${fontName}` : "Загрузить .ttf / .otf / .woff"}
                  </button>
                </div>

                {/* Режим анимации */}
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Режим анимации</p>
                  <div className="flex gap-1">
                    {([["auto","✍️ Авто"],["manual","🎛️ Ручная"],["typewriter","⌨️ Машинка"]] as [AnimMode,string][]).map(([id, label]) => (
                      <button key={id} onClick={() => setAnimMode(id)}
                        className="flex-1 py-1.5 text-[11px] rounded border transition-colors text-center"
                        style={animMode === id
                          ? { borderColor: "hsl(var(--ink))", color: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.1)" }
                          : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Скорость */}
                <div className="px-4 py-3 border-b border-border">
                  <div className="flex justify-between mb-1.5">
                    <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Скорость</p>
                    <span className="text-[11px] font-mono-code" style={{ color: "hsl(var(--ink))" }}>
                      ~{(getDuration() / 1000).toFixed(0)}с
                    </span>
                  </div>
                  <Slider value={animSpeed} onValueChange={setAnimSpeed} min={1} max={100} step={1} />
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Медленно</span>
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">20 ≈ письмо рукой</span>
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Быстро</span>
                  </div>
                </div>

                {/* Форматирование */}
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Форматирование</p>
                  <div className="flex items-center gap-1 flex-wrap mb-3">
                    <button onClick={() => applyStyle("bold", !textStyle.bold)}
                      className={`px-2 py-1 rounded text-xs font-bold transition-colors ${textStyle.bold ? "text-[hsl(var(--ink))]" : "text-[hsl(var(--muted-foreground))] hover:text-foreground"}`}
                      style={textStyle.bold ? { background: "hsl(158 64% 52% / 0.1)" } : {}}>B</button>
                    <button onClick={() => applyStyle("italic", !textStyle.italic)}
                      className={`px-2 py-1 rounded text-xs italic transition-colors ${textStyle.italic ? "text-[hsl(var(--ink))]" : "text-[hsl(var(--muted-foreground))] hover:text-foreground"}`}
                      style={textStyle.italic ? { background: "hsl(158 64% 52% / 0.1)" } : {}}>I</button>
                    <div className="w-px h-4 bg-[hsl(var(--border))]" />
                    {(["left","center","right"] as const).map(a => (
                      <button key={a} onClick={() => applyStyle("align", a)}
                        className={`p-1 rounded transition-colors ${textStyle.align === a ? "text-[hsl(var(--ink))]" : "text-[hsl(var(--muted-foreground))] hover:text-foreground"}`}
                        style={textStyle.align === a ? { background: "hsl(158 64% 52% / 0.1)" } : {}}>
                        <Icon name={a === "left" ? "AlignLeft" : a === "center" ? "AlignCenter" : "AlignRight"} size={13} />
                      </button>
                    ))}
                    <div className="w-px h-4 bg-[hsl(var(--border))]" />
                    <input type="color" value={textStyle.color} onChange={e => applyStyle("color", e.target.value)}
                      title="Цвет текста" className="w-6 h-6 rounded cursor-pointer border border-[hsl(var(--border))] bg-transparent" />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1.5">
                      <label className="text-[11px] text-[hsl(var(--muted-foreground))]">Размер шрифта</label>
                      <span className="text-[11px] font-mono-code" style={{ color: "hsl(var(--ink))" }}>{textStyle.fontSize}px</span>
                    </div>
                    <Slider value={[textStyle.fontSize]} onValueChange={([v]) => applyStyle("fontSize", v)} min={12} max={200} step={1} />
                  </div>
                </div>

                {/* Текст */}
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">
                    Текст <span className="normal-case font-normal">(Enter = новая строка)</span>
                  </p>
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={handleTextKeyDown}
                    className="w-full bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded px-3 py-2.5 text-sm resize-none focus:outline-none overflow-hidden placeholder:text-[hsl(var(--muted-foreground))]"
                    style={{
                      fontWeight: textStyle.bold ? "bold" : "normal",
                      fontStyle: textStyle.italic ? "italic" : "normal",
                      textAlign: textStyle.align,
                      minHeight: 80,
                    }}
                    placeholder="Введите текст… (автоперенос, Enter = новая строка)"
                  />
                </div>

                {/* Фон */}
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Фон</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <button onClick={() => setBgTransparent(!bgTransparent)}
                      className="px-2.5 py-1.5 rounded text-[11px] border transition-colors flex items-center gap-1.5"
                      style={bgTransparent
                        ? { borderColor: "hsl(var(--ink))", color: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.1)" }
                        : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                      <Icon name="Layers" size={11} />Прозрачный
                    </button>
                    {!bgTransparent && (
                      <div className="flex items-center gap-1.5">
                        <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                          className="w-7 h-7 rounded cursor-pointer border border-[hsl(var(--border))] bg-transparent" />
                        <span className="text-[11px] font-mono-code text-[hsl(var(--muted-foreground))]">{bgColor}</span>
                      </div>
                    )}
                  </div>
                  <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
                  <button onClick={() => bgFileRef.current?.click()}
                    className="w-full py-1.5 text-[11px] rounded border border-dashed border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--ink-dim))] hover:text-foreground transition-colors flex items-center justify-center gap-1.5 mb-2">
                    <Icon name="ImagePlus" size={12} />
                    {bgImageUrl ? "Заменить фон" : "Загрузить фоновое изображение"}
                  </button>
                  {bgImageUrl && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between">
                        <label className="text-[11px] text-[hsl(var(--muted-foreground))]">Масштаб фона</label>
                        <span className="text-[11px] font-mono-code" style={{ color: "hsl(var(--ink))" }}>{bgImageScale[0]}%</span>
                      </div>
                      <Slider value={bgImageScale} onValueChange={setBgImageScale} min={10} max={300} step={5} />
                      <button onClick={() => { setBgImageUrl(null); bgImageRef.current = null; }}
                        className="text-[11px] text-red-400 hover:text-red-300">Удалить изображение</button>
                    </div>
                  )}
                </div>

                {/* Формат */}
                <div className="px-4 py-3">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Формат Full HD</p>
                  <div className="flex gap-1.5">
                    {(["16:9","9:16","4:3"] as AspectRatio[]).map(a => (
                      <button key={a} onClick={() => setAspect(a)}
                        className="flex-1 py-1.5 text-[11px] rounded border transition-colors font-mono-code"
                        style={aspect === a
                          ? { borderColor: "hsl(var(--ink))", color: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.1)" }
                          : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="flex-1 flex flex-col min-w-0">
                <div className="flex-1 flex items-center justify-center overflow-auto p-6 relative"
                  style={{ background: "hsl(220 18% 6%)" }}>
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ backgroundImage: "linear-gradient(hsl(220 12% 18% / 0.18) 1px, transparent 1px), linear-gradient(90deg, hsl(220 12% 18% / 0.18) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
                  <div className="relative shadow-2xl overflow-hidden" style={{
                    borderRadius: 4,
                    width: canvasSize.w, height: canvasSize.h,
                    backgroundImage: bgTransparent ? "repeating-conic-gradient(#555 0% 25%, #888 0% 50%) 0 0 / 14px 14px" : undefined,
                  }}>
                    <canvas ref={canvasRef} style={{ width: canvasSize.w, height: canvasSize.h, display: "block" }} />
                  </div>
                </div>

                {/* Playback */}
                <div className="flex-shrink-0 px-5 py-3 border-t border-border" style={{ background: "hsl(var(--panel-bg))" }}>
                  <div className="timeline-track mb-3 cursor-pointer"
                    onClick={e => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      if (rafRef.current) cancelAnimationFrame(rafRef.current);
                      setIsPlaying(false); setAnimProgress(p);
                    }}>
                    <div className="timeline-progress" style={{ width: `${animProgress * 100}%` }} />
                    <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 bg-background"
                      style={{ left: `calc(${animProgress * 100}% - 5px)`, borderColor: "hsl(var(--ink))" }} />
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={resetAnim} className="text-[hsl(var(--muted-foreground))] hover:text-foreground">
                      <Icon name="SkipBack" size={15} />
                    </button>
                    <button onClick={togglePlay}
                      className="w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
                      <Icon name={isPlaying ? "Pause" : "Play"} size={14} />
                    </button>
                    <div className="flex-1" />
                    <span className="text-[11px] font-mono-code text-[hsl(var(--muted-foreground))]">
                      {(animProgress * getDuration() / 1000).toFixed(1)}с / {(getDuration() / 1000).toFixed(1)}с
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════ ANIMATION ══════════ */}
          {section === "animation" && (
            <div className="flex-1 flex overflow-hidden animate-fade-in">
              <div className="w-72 flex-shrink-0 border-r border-border overflow-y-auto p-4 space-y-4"
                style={{ background: "hsl(var(--panel-bg))" }}>
                <div>
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Режим</p>
                  <div className="space-y-1.5">
                    {([
                      ["auto","✍️","Авто-рукопись","Штрихи по контурам шрифта, как пером"],
                      ["manual","🎛️","Ручная настройка","Нарисуйте штрихи каждой буквы вручную"],
                      ["typewriter","⌨️","Печатная машинка","Символы появляются по одному"],
                    ] as [AnimMode,string,string,string][]).map(([id,icon,name,desc]) => (
                      <div key={id} onClick={() => setAnimMode(id)}
                        className={`mode-card p-3 cursor-pointer ${animMode === id ? "selected" : ""}`}>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span>{icon}</span><span className="text-sm font-medium">{name}</span>
                        </div>
                        <p className="text-[11px] text-[hsl(var(--muted-foreground))] ml-6">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-t border-[hsl(var(--border))] pt-4 space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-xs">Скорость</label>
                      <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>~{(getDuration()/1000).toFixed(0)}с</span>
                    </div>
                    <Slider value={animSpeed} onValueChange={setAnimSpeed} min={1} max={100} step={1} />
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">20 ≈ скорость письма рукой</p>
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-xs">Плавность (easing)</label>
                      <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>{smoothness[0]}%</span>
                    </div>
                    <Slider value={smoothness} onValueChange={setSmoothness} min={0} max={100} step={5} />
                  </div>
                </div>
              </div>

              {/* Ручной редактор */}
              <div className="flex-1 overflow-y-auto p-5">
                {animMode === "manual" ? (
                  <>
                    <h2 className="text-sm font-semibold mb-1">Ручная настройка штрихов</h2>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4">
                      Выберите букву, затем нарисуйте её штрихи в том порядке, как вы пишете рукой.
                      Каждое касание — один штрих. Программа воспроизведёт их в том же порядке.
                    </p>
                    <div className="flex gap-1.5 mb-4 flex-wrap">
                      {[["all","Все"],["upper","Заглавные"],["lower","Строчные"],["digits","Цифры"],["punct","Знаки"]].map(([id,label]) => (
                        <button key={id} onClick={() => setManualCharFilter(id)}
                          className="px-2.5 py-1 rounded text-xs border transition-colors"
                          style={manualCharFilter === id
                            ? { borderColor: "hsl(var(--ink))", color: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.1)" }
                            : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-5">
                      {filteredChars.map(ch => {
                        const has = !!manualStrokes[ch];
                        return (
                          <button key={ch} onClick={() => openManualEditor(ch)}
                            className="w-10 h-10 rounded border text-base transition-all relative"
                            style={{
                              borderColor: has ? "hsl(var(--ink))" : "hsl(var(--border))",
                              background: has ? "hsl(158 64% 52% / 0.1)" : "hsl(var(--surface))",
                            }}>
                            {ch}
                            {has && (
                              <span className="absolute top-0 right-0 w-2 h-2 rounded-full"
                                style={{ background: "hsl(var(--ink))", transform: "translate(30%,-30%)" }} />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {manualEditChar && (
                      <div className="flex gap-5 animate-fade-in">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium">«{manualEditChar}» — штрихов: {manualStrokeCount}</p>
                          </div>
                          <canvas
                            ref={manualCanvasRef}
                            width={320} height={320}
                            style={{ width: 320, height: 320, borderRadius: 8, border: "1px solid hsl(var(--border))", cursor: "crosshair", touchAction: "none" }}
                            onPointerDown={onManualDown}
                            onPointerMove={onManualMove}
                            onPointerUp={onManualUp}
                            onPointerCancel={onManualUp}
                          />
                          <div className="flex gap-2 mt-2">
                            <button onClick={clearManualCanvas}
                              className="px-3 py-1.5 text-xs rounded border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-foreground">
                              Очистить
                            </button>
                            <button onClick={undoManualStroke}
                              className="px-3 py-1.5 text-xs rounded border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-foreground">
                              Отменить
                            </button>
                            <button onClick={saveManualChar}
                              className="px-3 py-1.5 text-xs rounded font-medium flex-1"
                              style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
                              Сохранить
                            </button>
                          </div>
                        </div>
                        <div className="text-[11px] text-[hsl(var(--muted-foreground))] max-w-[170px] space-y-2 pt-1">
                          <p className="font-medium text-foreground text-xs">Как рисовать:</p>
                          <p>Каждое касание = один штрих</p>
                          <p>Цифра в точке начала = порядок штриха</p>
                          <p>Рисуйте так, как пишете эту букву ручкой</p>
                          <p style={{ color: "hsl(var(--ink))" }}>Анимация воспроизведёт штрихи в том же порядке и направлении</p>
                        </div>
                      </div>
                    )}
                    {Object.keys(manualStrokes).length > 0 && !manualEditChar && (
                      <div className="mt-4 flex items-center gap-2">
                        <Icon name="CheckCircle" size={13} style={{ color: "hsl(var(--ink))" }} />
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          Настроено {Object.keys(manualStrokes).length} символов
                        </span>
                        <button onClick={() => setManualStrokes({})}
                          className="text-xs text-red-400 hover:text-red-300 ml-2">Сбросить всё</button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Icon name="Pen" size={28} className="mb-3 text-[hsl(var(--muted-foreground))]" />
                    <p className="text-sm text-foreground mb-1">Выберите «Ручная настройка»</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">Чтобы нарисовать штрихи для каждой буквы</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════ FONTS ══════════ */}
          {section === "fonts" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
              <h2 className="text-sm font-semibold mb-4">Шрифт</h2>
              {font ? (
                <div className="rounded-lg border p-4 mb-4 max-w-md" style={{ borderColor: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.06)" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon name="CheckCircle" size={14} style={{ color: "hsl(var(--ink))" }} />
                    <span className="text-sm font-medium">{fontName}</span>
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Векторные контуры прочитаны. Штрихи рисуются по кривым Безье.</p>
                  <button onClick={() => fontInputRef.current?.click()}
                    className="mt-2 text-xs" style={{ color: "hsl(var(--ink))" }}>Заменить шрифт</button>
                </div>
              ) : (
                <div onClick={() => fontInputRef.current?.click()}
                  className="rounded-lg border-2 border-dashed border-[hsl(var(--border))] p-8 text-center max-w-md cursor-pointer hover:border-[hsl(var(--ink-dim))] transition-colors mb-4">
                  <Icon name="Upload" size={24} className="mx-auto mb-3 text-[hsl(var(--muted-foreground))]" />
                  <p className="text-sm text-foreground mb-1">Загрузите шрифтовой файл</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">.ttf, .otf, .woff</p>
                </div>
              )}
              <div className="rounded-lg border border-[hsl(var(--border))] p-4 max-w-md" style={{ background: "hsl(var(--surface))" }}>
                <p className="text-xs font-medium mb-2">Как работает анимация</p>
                <ul className="text-xs text-[hsl(var(--muted-foreground))] space-y-1.5">
                  <li>• <b className="text-foreground">opentype.js</b> читает векторные контуры из файла шрифта</li>
                  <li>• Кривые Безье семплируются в последовательные точки</li>
                  <li>• Каждый субпуть — отдельный штрих, рисуется как линия пера</li>
                  <li>• Пробелы учитываются через advanceWidth гlifа пробела</li>
                  <li>• Финальный вид неизменен до и после анимации</li>
                </ul>
              </div>
            </div>
          )}

          {/* ══════════ EXPORT ══════════ */}
          {section === "export" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in max-w-lg">
              <h2 className="text-sm font-semibold mb-1">Экспорт</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-5">
                Прозрачный фон → WebM с alpha.<br />
                Цветной/с изображением → WebM (совместим с большинством плееров).
              </p>
              <div className="space-y-4">
                <div className="space-y-2 py-3 border-y border-[hsl(var(--border))]">
                  {[
                    ["Разрешение", aspect === "16:9" ? "1920×1080" : aspect === "9:16" ? "1080×1920" : "1440×1080"],
                    ["Частота кадров", "30 fps"],
                    ["Длительность", `${(getDuration()/1000).toFixed(1)} сек`],
                    ["Прозрачность", bgTransparent ? "✅ WebM Alpha" : "❌ Без прозрачности"],
                  ].map(([l,v]) => (
                    <div key={l} className="flex justify-between">
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">{l}</span>
                      <span className="text-xs font-mono-code">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between py-2 rounded-lg border border-[hsl(var(--border))] px-3"
                  style={{ background: "hsl(var(--surface))" }}>
                  <div>
                    <div className="text-xs font-medium">Прозрачный фон</div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))]">WebM с alpha-каналом</div>
                  </div>
                  <Switch checked={bgTransparent} onCheckedChange={setBgTransparent} />
                </div>
                {isExporting && (
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-xs">Рендеринг покадрово…</span>
                      <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>{exportProgress}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-[hsl(var(--border))]">
                      <div className="h-full rounded-full transition-all" style={{ width: `${exportProgress}%`, background: "hsl(var(--ink))" }} />
                    </div>
                  </div>
                )}
                <button onClick={handleExportVideo} disabled={isExporting}
                  className="w-full py-2.5 rounded text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                  style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
                  <Icon name="Film" size={15} />
                  {isExporting ? `Рендер ${exportProgress}%…` : bgTransparent ? "Скачать WebM (прозрачный)" : "Скачать видео"}
                </button>
                <button onClick={() => {
                  const c = canvasRef.current; if (!c) return;
                  const a = document.createElement("a");
                  a.href = c.toDataURL("image/png"); a.download = "frame.png"; a.click();
                }}
                  className="w-full py-2 rounded text-sm border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-foreground flex items-center justify-center gap-2">
                  <Icon name="Image" size={15} />Скачать PNG (текущий кадр)
                </button>
                <div className="p-3 rounded-lg text-[11px] text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))]"
                  style={{ background: "hsl(var(--surface))" }}>
                  <b className="text-foreground">Примечание:</b> Экспорт через MediaRecorder API.
                  Работает в Chrome и Edge. Файл .webm открывается в VLC, браузере, медиаплеерах.
                  Для конвертации в .mp4 используйте FFmpeg или HandBrake.
                </div>
              </div>
            </div>
          )}

          {/* ══════════ DOCS ══════════ */}
          {section === "docs" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in max-w-2xl">
              <h2 className="text-sm font-semibold mb-4">Справка</h2>
              <div className="space-y-1.5 mb-6">
                {[["Enter","Новая строка"],["Ctrl+B","Жирный"],["Ctrl+I","Курсив"]].map(([k,a]) => (
                  <div key={k} className="flex items-center justify-between py-2 border-b border-[hsl(var(--border)/0.5)]">
                    <span className="text-xs">{a}</span>
                    <kbd className="px-2 py-0.5 rounded text-[10px] font-mono-code border border-[hsl(var(--border))]"
                      style={{ background: "hsl(var(--surface))" }}>{k}</kbd>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-[hsl(var(--ink-dim)/0.4)] p-4" style={{ background: "hsl(158 64% 52% / 0.06)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="Lightbulb" size={14} style={{ color: "hsl(var(--ink))" }} />
                  <span className="text-xs font-medium">Быстрый старт</span>
                </div>
                <ol className="text-xs text-[hsl(var(--muted-foreground))] space-y-1.5 list-decimal list-inside">
                  <li>Загрузите рукописный .ttf шрифт</li>
                  <li>Введите текст — пробелы и переносы работают корректно</li>
                  <li>Выберите режим анимации</li>
                  <li>Нажмите ▶ — анимация воспроизводится</li>
                  <li>Кнопка «Экспорт видео» — в шапке или разделе Экспорт</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
