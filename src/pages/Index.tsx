import { useState, useRef, useEffect, useCallback } from "react";
import opentype from "opentype.js";
import Icon from "@/components/ui/icon";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  loadFontFromBuffer,
  buildAnimatableChars,
  drawGlyphProgress,
  drawGlyphFull,
  type AnimatableChar,
} from "@/lib/fontAnimator";

// ── Types ──────────────────────────────────────────────────────────────────────
type AnimMode = "auto" | "manual" | "typewriter";
type AspectRatio = "16:9" | "9:16" | "4:3";
type Section = "editor" | "animation" | "fonts" | "export" | "settings" | "docs";

interface TextStyle {
  bold: boolean;
  italic: boolean;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
}

interface Line {
  text: string;
  style: TextStyle;
}

const ASPECT_SIZES: Record<AspectRatio, { w: number; h: number }> = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "4:3": { w: 1440, h: 1080 },
};

const DISPLAY_SCALE = 0.42; // отображаемый масштаб превью

const NAV_ITEMS: { id: Section; icon: string; label: string }[] = [
  { id: "editor", icon: "PenLine", label: "Редактор" },
  { id: "animation", icon: "Sparkles", label: "Анимация" },
  { id: "fonts", icon: "Type", label: "Шрифты" },
  { id: "export", icon: "Download", label: "Экспорт" },
  { id: "settings", icon: "SlidersHorizontal", label: "Настройки" },
  { id: "docs", icon: "BookOpen", label: "Справка" },
];

const HOTKEYS = [
  { key: "Enter", action: "Новая строка" },
  { key: "Space", action: "Пауза / старт" },
  { key: "Ctrl + Z", action: "Отмена" },
  { key: "Ctrl + B", action: "Жирный" },
  { key: "Ctrl + I", action: "Курсив" },
  { key: "Ctrl + E", action: "Экспорт" },
];

const DEFAULT_STYLE: TextStyle = {
  bold: false,
  italic: false,
  fontSize: 72,
  color: "#000000",
  align: "left",
};

// ── Компонент ──────────────────────────────────────────────────────────────────
export default function Index() {
  // Навигация
  const [section, setSection] = useState<Section>("editor");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Шрифт
  const [font, setFont] = useState<opentype.Font | null>(null);
  const [fontName, setFontName] = useState<string>("");
  const fontInputRef = useRef<HTMLInputElement>(null);

  // Текст / строки
  const [lines, setLines] = useState<Line[]>([{ text: "", style: { ...DEFAULT_STYLE } }]);
  const [activeLine, setActiveLine] = useState(0);
  const [textStyle, setTextStyle] = useState<TextStyle>({ ...DEFAULT_STYLE });

  // Фон
  const [bgColor, setBgColor] = useState("#ffffff");
  const [bgTransparent, setBgTransparent] = useState(false);

  // Формат
  const [aspect, setAspect] = useState<AspectRatio>("16:9");

  // Анимация
  const [animMode, setAnimMode] = useState<AnimMode>("auto");
  const [animSpeed, setAnimSpeed] = useState([70]);
  const [smoothness, setSmoothness] = useState([60]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animProgress, setAnimProgress] = useState(0); // 0..1 общий прогресс
  const animRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // Экспорт
  const [exportFormat, setExportFormat] = useState("mp4");
  const [exportQuality] = useState("1080p");

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animCharsRef = useRef<AnimatableChar[]>([]);

  // ── Загрузка шрифта ──────────────────────────────────────────────────────────
  const handleFontUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const loaded = await loadFontFromBuffer(buf);
    setFont(loaded);
    setFontName(file.name.replace(/\.[^.]+$/, ""));
  }, []);

  // ── Сборка AnimatableChars при изменении текста/шрифта ───────────────────────
  useEffect(() => {
    if (!font) return;
    const { w, h } = ASPECT_SIZES[aspect];
    const allChars: AnimatableChar[] = [];
    const lineHeight = (textStyle.fontSize * 1.35);
    const topPad = 80;

    lines.forEach((line, li) => {
      const baseline = topPad + li * lineHeight + textStyle.fontSize;
      const chars = buildAnimatableChars(font, line.text, line.style.fontSize, 60, baseline);
      allChars.push(...chars);
    });
    animCharsRef.current = allChars;
    void w; void h;
  }, [font, lines, textStyle, aspect]);

  // ── Рендер Canvas ────────────────────────────────────────────────────────────
  const renderCanvas = useCallback((progress: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = ASPECT_SIZES[aspect];
    const dpr = DISPLAY_SCALE;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    // Фон
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!bgTransparent) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    const chars = animCharsRef.current;
    if (!chars.length) {
      // Фолбэк: рисуем текст нативным canvas
      lines.forEach((line, li) => {
        const lineHeight = line.style.fontSize * 1.35;
        const y = 80 + li * lineHeight + line.style.fontSize;
        ctx.font = `${line.style.italic ? "italic " : ""}${line.style.bold ? "bold " : ""}${line.style.fontSize}px sans-serif`;
        ctx.fillStyle = line.style.color;
        ctx.fillText(line.text, 60, y);
      });
      ctx.restore();
      return;
    }

    const totalChars = chars.length;
    if (totalChars === 0) { ctx.restore(); return; }

    if (animMode === "typewriter" && progress > 0) {
      // Режим печатной машинки — показываем символы по одному
      const visibleCount = Math.floor(progress * totalChars);
      for (let i = 0; i < totalChars; i++) {
        const ac = chars[i];
        if (i < visibleCount) {
          ac.glyphPaths.forEach(gp => drawGlyphFull(ctx, gp.commands, getLineStyle(i, chars, lines).color));
        } else if (i === visibleCount && progress < 1) {
          // Мигающий курсор
          ctx.fillStyle = getLineStyle(i, chars, lines).color;
          ctx.fillRect(ac.x, ac.y - ac.fontSize, 3, ac.fontSize * 1.1);
        }
      }
    } else if (animMode === "auto" && progress > 0) {
      // Рукописная анимация — каждый символ по очереди, штрих за штрихом
      const progressPerChar = 1 / totalChars;
      for (let i = 0; i < totalChars; i++) {
        const ac = chars[i];
        const charStart = i * progressPerChar;
        const charEnd = (i + 1) * progressPerChar;
        const style = getLineStyle(i, chars, lines);
        const strokeWidth = Math.max(1.5, ac.fontSize * 0.04);

        if (progress >= charEnd) {
          // Символ уже дорисован — показываем как filled
          ac.glyphPaths.forEach(gp => drawGlyphFull(ctx, gp.commands, style.color));
        } else if (progress > charStart) {
          // Символ рисуется прямо сейчас
          const charProgress = (progress - charStart) / progressPerChar;
          // Сначала рисуем финальный символ прозрачно (позиция не меняется)
          ac.glyphPaths.forEach(gp =>
            drawGlyphProgress(ctx, gp.commands, charProgress, style.color, strokeWidth)
          );
        }
      }
    } else {
      // progress === 0 или manual — показываем все символы финально
      chars.forEach((ac, i) => {
        const style = getLineStyle(i, chars, lines);
        ac.glyphPaths.forEach(gp => drawGlyphFull(ctx, gp.commands, style.color));
      });
    }

    ctx.restore();
  }, [aspect, bgColor, bgTransparent, animMode, lines]);

  // Рендер при изменении прогресса
  useEffect(() => {
    renderCanvas(animProgress);
  }, [animProgress, renderCanvas]);

  // Рендер при смене раздела
  useEffect(() => {
    if (section === "editor") renderCanvas(animProgress);
  }, [section, renderCanvas, animProgress]);

  // ── Анимационный цикл ────────────────────────────────────────────────────────
  const startAnimation = useCallback(() => {
    setAnimProgress(0);
    startTimeRef.current = performance.now();
    // Длительность: speed 100 = ~4с, speed 10 = ~20с
    const duration = 4000 * (100 / animSpeed[0]);

    const tick = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const p = Math.min(elapsed / duration, 1);

      // Плавность: easing
      const sm = smoothness[0] / 100;
      const eased = sm > 0.5
        ? easeInOut(p)
        : p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;

      setAnimProgress(eased);

      if (p < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        setIsPlaying(false);
        setAnimProgress(1);
      }
    };

    animRef.current = requestAnimationFrame(tick);
  }, [animSpeed, smoothness]);

  const stopAnimation = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setIsPlaying(false);
  }, []);

  const togglePlay = () => {
    if (isPlaying) {
      stopAnimation();
    } else {
      setIsPlaying(true);
      startAnimation();
    }
  };

  const resetAnim = () => {
    stopAnimation();
    setAnimProgress(0);
    renderCanvas(0);
  };

  // ── Редактирование текста ────────────────────────────────────────────────────
  const updateLineText = (idx: number, val: string) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, text: val } : l));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, idx: number) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const newLine: Line = { text: "", style: { ...lines[idx].style } };
      setLines(prev => {
        const next = [...prev];
        next.splice(idx + 1, 0, newLine);
        return next;
      });
      setActiveLine(idx + 1);
    }
    if (e.key === "Backspace" && lines[idx].text === "" && lines.length > 1) {
      e.preventDefault();
      setLines(prev => prev.filter((_, i) => i !== idx));
      setActiveLine(Math.max(0, idx - 1));
    }
    if (e.ctrlKey && e.key === "b") { e.preventDefault(); applyStyle("bold", !textStyle.bold); }
    if (e.ctrlKey && e.key === "i") { e.preventDefault(); applyStyle("italic", !textStyle.italic); }
  };

  const applyStyle = <K extends keyof TextStyle>(key: K, val: TextStyle[K]) => {
    setTextStyle(prev => ({ ...prev, [key]: val }));
    setLines(prev => prev.map((l, i) => i === activeLine ? { ...l, style: { ...l.style, [key]: val } } : l));
  };

  // ── Экспорт ────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `script-frame.png`;
    a.click();
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const canvasSize = (() => {
    const { w, h } = ASPECT_SIZES[aspect];
    return { w: Math.round(w * DISPLAY_SCALE), h: Math.round(h * DISPLAY_SCALE) };
  })();

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`flex flex-col transition-all duration-200 border-r border-border flex-shrink-0 ${sidebarOpen ? "w-52" : "w-14"}`}
        style={{ background: "hsl(var(--sidebar-background))" }}
      >
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
              className={`w-full flex items-center gap-2.5 px-2 py-2 rounded text-sm transition-all ${
                section === item.id
                  ? "font-medium text-[hsl(var(--ink))]"
                  : "text-[hsl(var(--sidebar-foreground))] hover:text-foreground hover:bg-[hsl(var(--sidebar-accent))]"
              }`}
              style={section === item.id ? { background: "hsl(158 64% 52% / 0.12)" } : {}}>
              <Icon name={item.icon} size={16} className="flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        <button onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex items-center justify-center h-10 border-t border-border text-[hsl(var(--muted-foreground))] hover:text-foreground transition-colors">
          <Icon name={sidebarOpen ? "PanelLeftClose" : "PanelLeft"} size={15} />
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center justify-between px-4 h-11 border-b border-border flex-shrink-0"
          style={{ background: "hsl(var(--panel-bg))" }}>
          <div className="flex items-center gap-3">
            {font
              ? <span className="text-xs font-medium text-foreground">{fontName}</span>
              : <span className="text-xs text-[hsl(var(--muted-foreground))]">Шрифт не загружен</span>
            }
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">
              {aspect}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleExport}
              className="text-xs px-2.5 py-1 rounded font-medium transition-colors"
              style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
              Экспорт кадра
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">

          {/* ═══ EDITOR ═══ */}
          {section === "editor" && (
            <div className="flex-1 flex overflow-hidden animate-fade-in">

              {/* Left: text input + formatting */}
              <div className="w-72 flex-shrink-0 flex flex-col border-r border-border overflow-y-auto"
                style={{ background: "hsl(var(--panel-bg))" }}>

                {/* Font upload */}
                <div className="px-4 pt-4 pb-3 border-b border-border">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Шрифт</p>
                  <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff" className="hidden" onChange={handleFontUpload} />
                  <button onClick={() => fontInputRef.current?.click()}
                    className="w-full py-2 rounded border-2 border-dashed border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--ink-dim))] hover:text-foreground transition-colors flex items-center justify-center gap-2">
                    <Icon name="Upload" size={13} />
                    {font ? `Заменить (${fontName})` : "Загрузить .ttf / .otf / .woff"}
                  </button>
                  {font && (
                    <div className="mt-2 flex gap-1.5">
                      <button onClick={() => { setAnimMode("auto"); setSection("animation"); }}
                        className="flex-1 py-1.5 text-[11px] rounded border transition-colors text-center"
                        style={{ borderColor: animMode === "auto" ? "hsl(var(--ink))" : "hsl(var(--border))", color: animMode === "auto" ? "hsl(var(--ink))" : "hsl(var(--muted-foreground))", background: animMode === "auto" ? "hsl(158 64% 52% / 0.1)" : "transparent" }}>
                        ✍️ Авто
                      </button>
                      <button onClick={() => { setAnimMode("manual"); setSection("animation"); }}
                        className="flex-1 py-1.5 text-[11px] rounded border transition-colors text-center"
                        style={{ borderColor: animMode === "manual" ? "hsl(var(--ink))" : "hsl(var(--border))", color: animMode === "manual" ? "hsl(var(--ink))" : "hsl(var(--muted-foreground))", background: animMode === "manual" ? "hsl(158 64% 52% / 0.1)" : "transparent" }}>
                        🎛️ Ручная
                      </button>
                      <button onClick={() => { setAnimMode("typewriter"); setSection("animation"); }}
                        className="flex-1 py-1.5 text-[11px] rounded border transition-colors text-center"
                        style={{ borderColor: animMode === "typewriter" ? "hsl(var(--ink))" : "hsl(var(--border))", color: animMode === "typewriter" ? "hsl(var(--ink))" : "hsl(var(--muted-foreground))", background: animMode === "typewriter" ? "hsl(158 64% 52% / 0.1)" : "transparent" }}>
                        ⌨️ Машинка
                      </button>
                    </div>
                  )}
                </div>

                {/* Formatting toolbar */}
                <div className="px-4 py-2.5 border-b border-border flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => applyStyle("bold", !textStyle.bold)}
                    className={`px-2 py-1 rounded text-xs font-bold transition-colors ${textStyle.bold ? "text-[hsl(var(--ink))]" : "text-[hsl(var(--muted-foreground))] hover:text-foreground"}`}
                    style={textStyle.bold ? { background: "hsl(158 64% 52% / 0.1)" } : {}}>B</button>
                  <button onClick={() => applyStyle("italic", !textStyle.italic)}
                    className={`px-2 py-1 rounded text-xs italic transition-colors ${textStyle.italic ? "text-[hsl(var(--ink))]" : "text-[hsl(var(--muted-foreground))] hover:text-foreground"}`}
                    style={textStyle.italic ? { background: "hsl(158 64% 52% / 0.1)" } : {}}>I</button>
                  <div className="w-px h-4 bg-[hsl(var(--border))]" />
                  {(["left", "center", "right"] as const).map(a => (
                    <button key={a} onClick={() => applyStyle("align", a)}
                      className={`p-1 rounded transition-colors ${textStyle.align === a ? "text-[hsl(var(--ink))]" : "text-[hsl(var(--muted-foreground))] hover:text-foreground"}`}
                      style={textStyle.align === a ? { background: "hsl(158 64% 52% / 0.1)" } : {}}>
                      <Icon name={a === "left" ? "AlignLeft" : a === "center" ? "AlignCenter" : "AlignRight"} size={13} />
                    </button>
                  ))}
                  <div className="w-px h-4 bg-[hsl(var(--border))]" />
                  <input type="color" value={textStyle.color}
                    onChange={e => applyStyle("color", e.target.value)}
                    className="w-6 h-6 rounded cursor-pointer border border-[hsl(var(--border))] bg-transparent" />
                  <div className="w-px h-4 bg-[hsl(var(--border))]" />
                  <div className="flex items-center gap-1">
                    <button onClick={() => applyStyle("fontSize", Math.max(12, textStyle.fontSize - 4))}
                      className="px-1.5 py-0.5 rounded text-xs text-[hsl(var(--muted-foreground))] hover:text-foreground transition-colors">−</button>
                    <span className="text-[11px] font-mono-code text-foreground w-6 text-center">{textStyle.fontSize}</span>
                    <button onClick={() => applyStyle("fontSize", Math.min(200, textStyle.fontSize + 4))}
                      className="px-1.5 py-0.5 rounded text-xs text-[hsl(var(--muted-foreground))] hover:text-foreground transition-colors">+</button>
                  </div>
                </div>

                {/* Text input — линии */}
                <div className="flex-1 p-4 space-y-1.5">
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Текст (Enter = новая строка)</p>
                  {lines.map((line, idx) => (
                    <div key={idx} className="relative">
                      <textarea
                        value={line.text}
                        rows={1}
                        onFocus={() => setActiveLine(idx)}
                        onChange={e => updateLineText(idx, e.target.value)}
                        onKeyDown={e => handleKeyDown(e, idx)}
                        className="w-full bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded px-3 py-2 text-sm resize-none focus:outline-none transition-colors text-foreground placeholder:text-[hsl(var(--muted-foreground))]"
                        style={{
                          fontWeight: line.style.bold ? "bold" : "normal",
                          fontStyle: line.style.italic ? "italic" : "normal",
                          textAlign: line.style.align,
                          borderColor: activeLine === idx ? "hsl(var(--ink))" : undefined,
                        }}
                        placeholder={idx === 0 ? "Введите текст…" : "Строка " + (idx + 1)}
                      />
                      {lines.length > 1 && (
                        <button onClick={() => { setLines(prev => prev.filter((_, i) => i !== idx)); setActiveLine(Math.max(0, idx - 1)); }}
                          className="absolute right-2 top-2 text-[hsl(var(--muted-foreground))] hover:text-red-400 transition-colors">
                          <Icon name="X" size={11} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setLines(prev => [...prev, { text: "", style: { ...textStyle } }])}
                    className="w-full py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-foreground border border-dashed border-[hsl(var(--border))] rounded hover:border-[hsl(var(--ink-dim))] transition-colors flex items-center justify-center gap-1.5">
                    <Icon name="Plus" size={12} />
                    Добавить строку
                  </button>
                </div>

                {/* Background */}
                <div className="px-4 py-3 border-t border-border space-y-2">
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Фон</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setBgTransparent(!bgTransparent)}
                      className={`px-2.5 py-1.5 rounded text-xs border transition-colors flex items-center gap-1.5 ${bgTransparent ? "text-[hsl(var(--ink))]" : "text-[hsl(var(--muted-foreground))] hover:text-foreground"}`}
                      style={bgTransparent ? { borderColor: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.1)" } : { borderColor: "hsl(var(--border))" }}>
                      <Icon name="Layers" size={11} />
                      Прозрачный
                    </button>
                    {!bgTransparent && (
                      <div className="flex items-center gap-1.5">
                        <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                          className="w-7 h-7 rounded cursor-pointer border border-[hsl(var(--border))] bg-transparent" />
                        <span className="text-[11px] font-mono-code text-[hsl(var(--muted-foreground))]">{bgColor}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Aspect ratio */}
                <div className="px-4 py-3 border-t border-border">
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">Формат (Full HD)</p>
                  <div className="flex gap-1.5">
                    {(["16:9", "9:16", "4:3"] as AspectRatio[]).map(a => (
                      <button key={a} onClick={() => setAspect(a)}
                        className={`flex-1 py-1.5 text-[11px] rounded border transition-colors font-mono-code ${aspect === a ? "text-[hsl(var(--ink))]" : "text-[hsl(var(--muted-foreground))] hover:text-foreground"}`}
                        style={aspect === a ? { borderColor: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.1)" } : { borderColor: "hsl(var(--border))" }}>
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Preview canvas */}
              <div className="flex-1 flex flex-col min-w-0">
                <div className="flex-1 flex items-center justify-center overflow-auto p-6 relative"
                  style={{ background: "hsl(220 18% 6%)" }}>
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ backgroundImage: "linear-gradient(hsl(220 12% 18% / 0.25) 1px, transparent 1px), linear-gradient(90deg, hsl(220 12% 18% / 0.25) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
                  <div className="relative shadow-2xl"
                    style={{ width: canvasSize.w, height: canvasSize.h,
                      backgroundImage: bgTransparent ? "repeating-conic-gradient(#888 0% 25%, #bbb 0% 50%) 0 0 / 16px 16px" : undefined }}>
                    <canvas ref={canvasRef}
                      style={{ width: canvasSize.w, height: canvasSize.h, display: "block" }} />
                  </div>
                </div>

                {/* Playback bar */}
                <div className="flex-shrink-0 px-5 py-3 border-t border-border" style={{ background: "hsl(var(--panel-bg))" }}>
                  <div className="timeline-track mb-3 cursor-pointer"
                    onClick={e => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setAnimProgress(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
                    }}>
                    <div className="timeline-progress" style={{ width: `${animProgress * 100}%` }} />
                    <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 bg-background transition-all"
                      style={{ left: `calc(${animProgress * 100}% - 5px)`, borderColor: "hsl(var(--ink))" }} />
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={resetAnim} className="text-[hsl(var(--muted-foreground))] hover:text-foreground transition-colors">
                      <Icon name="SkipBack" size={15} />
                    </button>
                    <button onClick={togglePlay}
                      className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                      style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
                      <Icon name={isPlaying ? "Pause" : "Play"} size={14} />
                    </button>
                    <div className="flex-1" />
                    <span className="text-xs font-mono-code text-[hsl(var(--muted-foreground))]">
                      {animMode === "auto" ? "✍️ Рукопись" : animMode === "manual" ? "🎛️ Ручная" : "⌨️ Машинка"}
                    </span>
                    <div className="w-px h-4 bg-[hsl(var(--border))]" />
                    <span className="text-xs font-mono-code text-[hsl(var(--muted-foreground))]">{aspect} · Full HD</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ ANIMATION ═══ */}
          {section === "animation" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in max-w-2xl">
              <h2 className="text-sm font-semibold mb-1">Режим анимации</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-5">Выберите способ появления текста</p>

              <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                  { id: "auto" as AnimMode, icon: "✍️", name: "Авто-рукопись", desc: "Каждый символ пишется штрихами по SVG-контурам шрифта, слева направо" },
                  { id: "manual" as AnimMode, icon: "🎛️", name: "Ручная настройка", desc: "Пользователь сам задаёт порядок и вектор появления каждого символа" },
                  { id: "typewriter" as AnimMode, icon: "⌨️", name: "Печатная машинка", desc: "Символы появляются один за другим с курсором" },
                ].map(m => (
                  <div key={m.id} onClick={() => setAnimMode(m.id)}
                    className={`mode-card p-4 cursor-pointer ${animMode === m.id ? "selected" : ""}`}>
                    <div className="text-2xl mb-2">{m.icon}</div>
                    <div className="text-sm font-medium mb-1">{m.name}</div>
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">{m.desc}</div>
                  </div>
                ))}
              </div>

              <div className="border-t border-[hsl(var(--border))] pt-5 space-y-5">
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-xs text-foreground">Скорость анимации</label>
                    <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>{animSpeed[0]}%</span>
                  </div>
                  <Slider value={animSpeed} onValueChange={setAnimSpeed} min={10} max={200} step={5} />
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">100% ≈ скорость реального письма</p>
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-xs text-foreground">Плавность штриха</label>
                    <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>{smoothness[0]}%</span>
                  </div>
                  <Slider value={smoothness} onValueChange={setSmoothness} min={0} max={100} step={5} />
                </div>

                {animMode === "manual" && (
                  <div className="rounded-lg border border-[hsl(var(--border))] p-4" style={{ background: "hsl(var(--surface))" }}>
                    <div className="flex items-center gap-2 mb-3">
                      <Icon name="Edit3" size={14} style={{ color: "hsl(var(--ink))" }} />
                      <span className="text-sm font-medium">Ручной редактор символов</span>
                    </div>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3">
                      Загрузите шрифт и введите текст. Затем для каждого символа можно задать вектор проявления — направление штриха и его порядок.
                    </p>
                    <div className="space-y-1.5 mb-3">
                      {lines.flatMap(l => l.text.split("")).slice(0, 12).map((ch, i) => (
                        <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-[hsl(var(--border))]"
                          style={{ background: "hsl(var(--panel-bg))" }}>
                          <span className="font-mono-code text-[11px] w-5 text-center text-[hsl(var(--muted-foreground))]">{i + 1}</span>
                          <span className="text-base" style={{ fontFamily: "serif", minWidth: 20 }}>{ch}</span>
                          <div className="flex-1" />
                          <select className="text-[10px] bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded px-1.5 py-0.5 text-foreground">
                            <option>Слева направо →</option>
                            <option>Сверху вниз ↓</option>
                            <option>По диагонали ↘</option>
                          </select>
                        </div>
                      ))}
                    </div>
                    <button className="text-xs px-3 py-1.5 rounded font-medium transition-colors"
                      style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
                      Активировать настройки
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ FONTS ═══ */}
          {section === "fonts" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold">Шрифты</h2>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Загрузите .ttf/.otf/.woff — программа прочитает контуры букв</p>
                </div>
                <button onClick={() => fontInputRef.current?.click()}
                  className="text-xs px-3 py-1.5 rounded border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-foreground hover:border-[hsl(var(--ink-dim))] transition-colors flex items-center gap-1.5">
                  <Icon name="Upload" size={12} />
                  Загрузить шрифт
                </button>
              </div>
              {font ? (
                <div className="rounded-lg border p-4 mb-4 max-w-lg" style={{ borderColor: "hsl(var(--ink))", background: "hsl(158 64% 52% / 0.06)" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon name="CheckCircle" size={14} style={{ color: "hsl(var(--ink))" }} />
                    <span className="text-sm font-medium">{fontName}</span>
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">Загружен</Badge>
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    SVG-контуры букв готовы. Режим анимации «Авто-рукопись» будет рисовать каждый символ штрихами по кривым Безье.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border-2 border-dashed border-[hsl(var(--border))] p-8 text-center max-w-lg">
                  <Icon name="Upload" size={24} className="mx-auto mb-3 text-[hsl(var(--muted-foreground))]" />
                  <p className="text-sm text-foreground mb-1">Загрузите шрифтовой файл</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Поддерживаются .ttf, .otf, .woff</p>
                </div>
              )}
              <div className="rounded-lg border border-[hsl(var(--border))] p-4 max-w-lg" style={{ background: "hsl(var(--surface))" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="Info" size={13} style={{ color: "hsl(var(--ink))" }} />
                  <span className="text-xs font-medium">Как работает анимация</span>
                </div>
                <ul className="text-xs text-[hsl(var(--muted-foreground))] space-y-1">
                  <li>• opentype.js читает векторные контуры букв прямо из файла шрифта</li>
                  <li>• Каждая буква строится штрихами по кривым Безье — как пером по бумаге</li>
                  <li>• Размер штриха соответствует размеру обводки символа</li>
                  <li>• Текст не стирается, контуры сохраняются до конца анимации</li>
                </ul>
              </div>
            </div>
          )}

          {/* ═══ EXPORT ═══ */}
          {section === "export" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in max-w-lg">
              <h2 className="text-sm font-semibold mb-1">Экспорт</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-5">Настройте формат и скачайте видео</p>
              <div className="space-y-5">
                <div>
                  <label className="text-[11px] text-[hsl(var(--muted-foreground))] block mb-2 uppercase tracking-wider">Формат видео</label>
                  <div className="flex gap-2">
                    {["mp4", "webm", "gif", "mov"].map(f => (
                      <button key={f} onClick={() => setExportFormat(f)}
                        className={`px-3 py-1.5 rounded text-xs font-mono-code transition-all border ${exportFormat === f ? "text-[hsl(var(--ink))]" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--ink-dim))]"}`}
                        style={exportFormat === f ? { background: "hsl(158 64% 52% / 0.12)", borderColor: "hsl(var(--ink))" } : {}}>
                        .{f}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <div className="text-xs font-medium">Прозрачный фон (Alpha)</div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))]">Только для .webm и .mov</div>
                  </div>
                  <Switch checked={bgTransparent} onCheckedChange={setBgTransparent} />
                </div>
                <div className="space-y-2.5 py-3 border-y border-[hsl(var(--border))]">
                  {[
                    { label: "Формат", value: `.${exportFormat.toUpperCase()}` },
                    { label: "Разрешение", value: aspect === "16:9" ? "1920×1080" : aspect === "9:16" ? "1080×1920" : "1440×1080" },
                    { label: "Частота кадров", value: "60 fps" },
                    { label: "Прозрачность", value: bgTransparent ? "Да (Alpha)" : "Нет" },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between">
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">{r.label}</span>
                      <span className="text-xs font-mono-code">{r.value}</span>
                    </div>
                  ))}
                </div>
                <button onClick={handleExport}
                  className="w-full py-2.5 rounded text-sm font-medium transition-all flex items-center justify-center gap-2"
                  style={{ background: "hsl(var(--ink))", color: "hsl(var(--panel-bg))" }}>
                  <Icon name="Download" size={15} />
                  Скачать кадр (PNG)
                </button>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] text-center">Полный видеоэкспорт — в следующей версии</p>
              </div>
            </div>
          )}

          {/* ═══ SETTINGS ═══ */}
          {section === "settings" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in max-w-lg">
              <h2 className="text-sm font-semibold mb-1">Настройки</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-5">Размер шрифта, фон, формат</p>
              <div className="space-y-5">
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-xs text-foreground">Размер шрифта по умолчанию</label>
                    <span className="text-xs font-mono-code" style={{ color: "hsl(var(--ink))" }}>{textStyle.fontSize}px</span>
                  </div>
                  <Slider value={[textStyle.fontSize]} onValueChange={([v]) => applyStyle("fontSize", v)} min={16} max={200} step={2} />
                </div>
                <div className="border-t border-[hsl(var(--border))] pt-4 space-y-3">
                  <label className="text-[11px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider block">Вид</label>
                  {[
                    { label: "Сетка в превью", desc: "Направляющие линии" },
                    { label: "Автосохранение", desc: "Каждые 5 минут" },
                  ].map(o => (
                    <div key={o.label} className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium">{o.label}</div>
                        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{o.desc}</div>
                      </div>
                      <Switch />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══ DOCS ═══ */}
          {section === "docs" && (
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in max-w-2xl">
              <h2 className="text-sm font-semibold mb-1">Справка</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-5">Горячие клавиши и принципы работы</p>
              <div className="space-y-1.5 mb-6">
                {HOTKEYS.map(hk => (
                  <div key={hk.key} className="flex items-center justify-between py-2 border-b border-[hsl(var(--border)/0.5)]">
                    <span className="text-xs">{hk.action}</span>
                    <kbd className="px-2 py-0.5 rounded text-[10px] font-mono-code border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
                      style={{ background: "hsl(var(--surface))" }}>{hk.key}</kbd>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-[hsl(var(--ink-dim)/0.4)] p-4" style={{ background: "hsl(158 64% 52% / 0.06)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="Lightbulb" size={14} style={{ color: "hsl(var(--ink))" }} />
                  <span className="text-xs font-medium">Быстрый старт</span>
                </div>
                <ol className="text-xs text-[hsl(var(--muted-foreground))] space-y-1 list-decimal list-inside">
                  <li>Загрузите рукописный .ttf шрифт через раздел «Шрифты»</li>
                  <li>Введите текст — он сразу отобразится в превью</li>
                  <li>Выберите режим анимации: «Авто-рукопись», «Машинка» или «Ручная»</li>
                  <li>Нажмите ▶ — текст нарисуется штрих за штрихом</li>
                  <li>Экспортируйте кадр или видео</li>
                </ol>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function getLineStyle(charIdx: number, chars: AnimatableChar[], lines: Line[]): TextStyle {
  let count = 0;
  for (const line of lines) {
    count += line.text.length;
    if (charIdx < count) return line.style;
  }
  return lines[lines.length - 1]?.style ?? DEFAULT_STYLE;
}
